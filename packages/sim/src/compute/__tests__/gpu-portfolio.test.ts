import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { applyCommand } from "../../commands/apply.ts";
import { validateCommand } from "../../commands/validate.ts";
import type { CommandId, GpuLotId, ModifierId, ProjectId } from "../../model/ids.ts";
import { createBareState } from "../../model/fixture.ts";
import type { GameState, GpuAllocationState, GpuLotState } from "../../model/state.ts";
import { basisPoints, cashMillions, fraction, gpuCount } from "../../model/units.ts";
import {
  calculateAllocationTeraflops,
  calculateGpuThroughput,
  CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG,
  collectGpuAllocationPlanViolations,
  hasLargeCapabilityDomainSwing,
  normaliseAllocation,
  planGpuPortfolio,
  resolveGpuReservations,
} from "../gpu-portfolio.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function randomGenerator(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

function randomBasisPointRecord(
  random: () => number,
  prefix: string,
  count: number,
): Readonly<Record<string, ReturnType<typeof basisPoints>>> {
  const cuts = Array.from({ length: count - 1 }, () => random() % 10_001).sort(
    (left, right) => left - right,
  );
  const points = [0, ...cuts, 10_000];
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `${prefix}-${String(index)}`,
      basisPoints((points[index + 1] ?? 10_000) - (points[index] ?? 0)),
    ]),
  );
}

describe("normaliseAllocation", () => {
  it("uses exact integer hierarchy sums", () => {
    const allocation: GpuAllocationState = {
      servingFleetShareBasisPoints: basisPoints(0),
      capabilityBasisPoints: basisPoints(9000),
      capabilityDomainWeights: { architectures: basisPoints(10_000) },
      safetyProgramWeights: {
        alignment: basisPoints(5000),
        security: basisPoints(5000),
      },
    };
    const lots: GpuLotState[] = [
      {
        id: "lot:b" as GpuLotId,
        generationId: contentId("base:gpu.kepler"),
        ownership: "owned",
        physicalCount: gpuCount(401),
        availableFraction: fraction(0.5),
        reliability: 80 as GpuLotState["reliability"],
      },
      {
        id: "lot:a" as GpuLotId,
        generationId: contentId("base:gpu.kepler"),
        ownership: "leased",
        physicalCount: gpuCount(599),
        availableFraction: fraction(1),
        reliability: 80 as GpuLotState["reliability"],
      },
    ];

    const plan = normaliseAllocation(allocation, lots, 0);

    expect(plan.totalPhysicalGpus).toBe(1000);
    expect(plan.capabilityPhysicalGpus).toBe(900);
    expect(plan.safetyPhysicalGpus).toBe(100);
    expect(plan.safetyPrograms.map((program) => program.physicalGpus)).toEqual([50, 50]);
    expect(plan.lots.map((lot) => lot.lotId)).toEqual(["lot:a", "lot:b"]);
    expect(collectGpuAllocationPlanViolations(plan)).toEqual([]);
  });

  it("preserves every hierarchy invariant over 5,000 deterministic random portfolios", () => {
    const random = randomGenerator(0x5eedc0de);
    for (let iteration = 0; iteration < 5000; iteration += 1) {
      const lotCount = 1 + (random() % 6);
      const domainCount = 1 + (random() % 8);
      const safetyCount = 1 + (random() % 5);
      const lots: GpuLotState[] = Array.from({ length: lotCount }, (_, index) => ({
        id: `lot:${String(index).padStart(2, "0")}` as GpuLotId,
        generationId: contentId("base:gpu.kepler"),
        ownership: "owned" as const,
        physicalCount: gpuCount(random() % 50_001),
        availableFraction: fraction((random() % 101) / 100),
        reliability: 50 as GpuLotState["reliability"],
      }));
      const allocation: GpuAllocationState = {
        servingFleetShareBasisPoints: basisPoints(random() % 10_001),
        capabilityBasisPoints: basisPoints(random() % 10_001),
        capabilityDomainWeights: randomBasisPointRecord(random, "domain", domainCount),
        safetyProgramWeights: randomBasisPointRecord(random, "safety", safetyCount),
      };
      const plan = normaliseAllocation(allocation, lots, 0);
      expect(collectGpuAllocationPlanViolations(plan, 1e-9)).toEqual([]);
    }
  });
});

describe("GPU reservations", () => {
  it("resolves pins first, reports shortages, and leaves only the remainder discretionary", () => {
    const draft = mutable(createBareState());
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    const secondLot = lab.compute.lots[1];
    if (secondLot === undefined) throw new Error("test GPU lot missing");
    secondLot.generationId = contentId("base:gpu.pascal");
    lab.compute.reservations = [
      {
        projectId: "project:pinned" as ProjectId,
        gpus: gpuCount(4500),
        generationCounts: { [contentId("base:gpu.pascal")]: 4500 },
      },
      {
        projectId: "project:unpinned" as ProjectId,
        gpus: gpuCount(3000),
      },
    ];

    const plan = resolveGpuReservations(draft, content, draft.run.playerLabId);

    expect(plan.reservations[0]).toMatchObject({
      allocatedPhysicalGpus: 4000,
      unmetPhysicalGpus: 500,
    });
    expect(plan.reservations[0]?.allocations).toEqual([
      { lotId: secondLot.id, physicalGpus: 4000 },
    ]);
    expect(plan.reservations[1]?.allocations).toEqual([
      { lotId: lab.compute.lots[0]?.id, physicalGpus: 3000 },
    ]);
    expect(plan.remainingByLot).toEqual({
      [lab.compute.lots[0]?.id ?? "missing"]: 3000,
      [secondLot.id]: 0,
    });
    expect(
      planGpuPortfolio(draft, content, draft.run.playerLabId).allocation,
    ).toMatchObject({ totalPhysicalGpus: 3000 });
  });

  it("draws an unpinned reservation proportionally with stable largest-remainder ties", () => {
    const draft = mutable(createBareState());
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    lab.compute.reservations = [
      { projectId: "project:proportional" as ProjectId, gpus: gpuCount(5001) },
    ];
    const plan = resolveGpuReservations(draft, content, draft.run.playerLabId);
    expect(plan.reservations[0]?.allocations).toEqual([
      { lotId: lab.compute.lots[0]?.id, physicalGpus: 3001 },
      { lotId: lab.compute.lots[1]?.id, physicalGpus: 2000 },
    ]);
  });
});

describe("calculateAllocationTeraflops", () => {
  it("applies each lot's availability to delivered discretionary compute", () => {
    const draft = mutable(createBareState());
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    for (const lot of lab.compute.lots) lot.availableFraction = fraction(0.5);

    const allocation = planGpuPortfolio(draft, content, draft.run.playerLabId).allocation;
    const delivered = calculateAllocationTeraflops(
      draft,
      content,
      draft.run.playerLabId,
      allocation,
    );

    expect(delivered.serving + delivered.research).toBeCloseTo(20_000, 8);
    expect(delivered.capabilities + delivered.safety).toBeCloseTo(delivered.research, 8);
  });
});

describe("calculateGpuThroughput", () => {
  it("breaks out generation, availability, power, fabric, and modifiers", () => {
    const draft = mutable(createBareState());
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    const secondLot = lab.compute.lots[1];
    if (secondLot === undefined) throw new Error("test GPU lot missing");
    secondLot.generationId = contentId("base:gpu.pascal");
    secondLot.availableFraction = fraction(0.5);
    draft.modifiers["modifier:throughput" as ModifierId] = {
      id: "modifier:throughput" as ModifierId,
      source: { kind: "leader", id: "test" },
      labId: draft.run.playerLabId,
      target: "lab.compute.workloadThroughput",
      operation: "multiply",
      value: 1.2,
      startsAt: draft.run.tick,
      tags: [],
    };

    const breakdown = calculateGpuThroughput(
      draft,
      content,
      draft.run.playerLabId,
      "training",
      { minimumInterconnectTier: 2, powerCapacity: 4.8 },
    );

    expect(breakdown.physicalGpus).toBe(10_000);
    expect(breakdown.availabilityAdjustedPhysicalGpus).toBe(8000);
    expect(breakdown.powerDemand).toBeCloseTo(9.6);
    expect(breakdown.powerMultiplier).toBeCloseTo(0.5);
    // Was 4500 -> x1.1 software -> 4950 -> x1.2 modifier -> 5940. The software
    // step is gone: it was authored at 1.0, never written by any code path, and
    // only ever moved by this test.
    expect(breakdown.throughputBeforeModifiers).toBeCloseTo(4500);
    expect(breakdown.final).toBeCloseTo(5400);
    expect(breakdown.generations).toEqual([
      expect.objectContaining({
        generationId: "base:gpu.kepler",
        physicalGpus: 6000,
        workloadFactor: 1,
        weightedAvailability: 1,
        weightedInterconnectMultiplier: 0.5,
      }),
      expect.objectContaining({
        generationId: "base:gpu.pascal",
        physicalGpus: 4000,
        workloadFactor: 3,
        weightedAvailability: 0.5,
        weightedInterconnectMultiplier: 1,
      }),
    ]);
    expect(breakdown.modifierContributions).toHaveLength(1);
  });
});

describe("SetGpuAllocationCommand context switching", () => {
  it("records then consumes the research penalty when a domain moves by more than 25 points", () => {
    const state = createBareState();
    const previous = state.labs[state.run.playerLabId]?.compute.allocation;
    if (previous === undefined) throw new Error("test allocation missing");
    const allocation: GpuAllocationState = {
      ...previous,
      servingFleetShareBasisPoints: basisPoints(0),
      capabilityDomainWeights: {
        "base:domain.architectures": basisPoints(9100),
        "base:domain.optimisation-scaling": basisPoints(900),
      },
    };
    const command = {
      kind: "set-gpu-allocation",
      meta: {
        commandId: "command:large-swing" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      allocation,
    } as const;
    const validation = validateCommand(state, content, command);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.preview.summary).toContain("context-switch penalty");
    }
    const queued = applyCommand(state, content, command);

    expect(
      queued.state.labs[state.run.playerLabId]?.flags[
        CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG
      ],
    ).toBeUndefined();
    const advanced = advanceOneTick(queued.state, content).state;
    expect(
      advanced.labs[state.run.playerLabId]?.flags[CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG],
    ).toBeUndefined();
  });

  it("does not treat an exact 25-point move as a large swing", () => {
    const state = createBareState();
    const previous = state.labs[state.run.playerLabId]?.compute.allocation;
    if (previous === undefined) throw new Error("test allocation missing");
    const exactBoundary: GpuAllocationState = {
      ...previous,
      capabilityDomainWeights: {
        "base:domain.architectures": basisPoints(8500),
        "base:domain.optimisation-scaling": basisPoints(1500),
      },
    };
    expect(hasLargeCapabilityDomainSwing(previous, exactBoundary)).toBe(false);
  });

  it("scales recurringCostMillionsPerCycle proportionally when a lot is partially sold", () => {
    const draft = mutable(createBareState());
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("test lab missing");
    lab.compute.lots = [
      {
        id: "lot:owned-kepler" as GpuLotId,
        generationId: contentId("base:gpu.kepler"),
        ownership: "owned",
        physicalCount: gpuCount(2000),
        availableFraction: fraction(1),
        reliability: 80 as GpuLotState["reliability"],
        recurringCostMillionsPerCycle: cashMillions(10),
      },
    ];

    const command = {
      kind: "sell-gpus",
      meta: {
        commandId: "command:sell-partial" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
      generationId: contentId("base:gpu.kepler"),
      thousandUnits: 1,
    } as const;

    const applied = applyCommand(draft, content, command);
    const updatedLot = applied.state.labs[draft.run.playerLabId]?.compute.lots[0];
    expect(updatedLot?.physicalCount).toBe(1000);
    expect(updatedLot?.recurringCostMillionsPerCycle).toBe(5);
  });
});
