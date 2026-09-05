import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import { rivalFacilityCompleteFlag } from "../../facilities/facilities.ts";
import type { CommandId, LabId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { cashMillions, gpuCount } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import {
  GPU_RESALE_FRACTION,
  calculateGpuFinanceCosts,
  quoteGpuPurchase,
  quoteGpuSale,
  unlockedGpuGenerationIds,
} from "../gpu-market.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(leaderId = contentId("base:leader.sam-altmann")): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId,
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function advance(state: GameState, count: number): GameState {
  let current = state;
  for (let index = 0; index < count; index += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

function buyCommand(state: GameState, generationId: string, thousandUnits: number) {
  return {
    kind: "buy-gpus" as const,
    meta: {
      commandId: `buy-${generationId}-${String(thousandUnits)}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    generationId: contentId(generationId),
    thousandUnits,
  };
}

function sellCommand(state: GameState, generationId: string, thousandUnits: number) {
  return {
    kind: "sell-gpus" as const,
    meta: {
      commandId: `sell-${generationId}-${String(thousandUnits)}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    generationId: contentId(generationId),
    thousandUnits,
  };
}

describe("GPU generation catalogue", () => {
  it("unlocks every generation the world has reached, newest first", () => {
    const state = newState();
    const unlocked = unlockedGpuGenerationIds(state, content);
    expect(unlocked).toContain(state.world.currentGpuGenerationId);
    const years = unlocked.map(
      (generationId) => content.gpuGenerations[generationId]?.nominalYear ?? 0,
    );
    expect([...years].sort((left, right) => right - left)).toEqual(years);
    const currentYear =
      content.gpuGenerations[state.world.currentGpuGenerationId]?.nominalYear ?? 0;
    for (const year of years) expect(year).toBeLessThanOrEqual(currentYear);
  });

  it("quotes purchases at catalogue price with capacity and cash blockers", () => {
    const state = newState();
    const generationId = state.world.currentGpuGenerationId;
    const generation = content.gpuGenerations[generationId];
    if (generation === undefined) throw new Error("current generation missing");

    const quote = quoteGpuPurchase(
      state,
      content,
      state.run.playerLabId,
      generationId,
      1,
    );
    expect(quote.physicalGpuCount).toBe(1000);
    expect(quote.deliveryWeeks).toBe(generation.deliveryWeeks);
    expect(quote.teraflopsAdded).toBeCloseTo(1000 * generation.trainingFactor * 4, 8);

    const broke = mutable(newState());
    const brokeLab = broke.labs[broke.run.playerLabId];
    if (brokeLab === undefined) throw new Error("player lab missing");
    brokeLab.finance.cash = cashMillions(0);
    expect(
      quoteGpuPurchase(broke, content, broke.run.playerLabId, generationId, 1).blockers,
    ).toContain("Insufficient cash");

    const overCapacity = quoteGpuPurchase(
      state,
      content,
      state.run.playerLabId,
      generationId,
      999,
    );
    expect(
      overCapacity.blockers.some((blocker) =>
        blocker.includes("Datacentre capacity supports"),
      ),
    ).toBe(true);
  });

  it("binds rival orders to their completed staged datacentre capacity", () => {
    const state = mutable(newState());
    const labId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    if (labId === undefined) throw new Error("rival lab missing");
    const lab = state.labs[labId];
    if (lab === undefined) throw new Error("rival lab missing");
    const lot = lab.compute.lots[0];
    if (lot === undefined) throw new Error("rival GPU lot missing");
    lot.physicalCount = gpuCount(4_000);
    lab.compute.deliveries = [];

    const quote = quoteGpuPurchase(
      state,
      content,
      lab.id,
      state.world.currentGpuGenerationId,
      1,
    );
    expect(quote.capacity.supportedPhysicalGpus).toBe(4_000);
    expect(quote.capacity.projectedOwnedPhysicalGpus).toBe(5_000);
    expect(
      quote.blockers.some((blocker) =>
        blocker.includes("Datacentre capacity supports 4,000 GPUs"),
      ),
    ).toBe(true);

    lab.flags[rivalFacilityCompleteFlag(contentId("base:facility.data-centre-4"))] = true;
    const expanded = quoteGpuPurchase(
      state,
      content,
      lab.id,
      state.world.currentGpuGenerationId,
      1,
    );
    expect(expanded.capacity.supportedPhysicalGpus).toBe(800_000);
    expect(expanded.canPurchase).toBe(true);
  });

  it("charges Humanic 5% more for every direct GPU purchase", () => {
    const baseline = newState();
    const humanic = newState(contentId("base:leader.dario-amodeo"));
    const generationId = baseline.world.currentGpuGenerationId;
    const baselineQuote = quoteGpuPurchase(
      baseline,
      content,
      baseline.run.playerLabId,
      generationId,
      1,
    );
    const humanicQuote = quoteGpuPurchase(
      humanic,
      content,
      humanic.run.playerLabId,
      generationId,
      1,
    );

    expect(humanicQuote.physicalGpuCount).toBe(1000);
    expect(humanicQuote.upfrontCostMillions).toBe(
      Math.round(baselineQuote.upfrontCostMillions * 1.05 * 100) / 100,
    );
  });
});

describe("GPU purchase lifecycle", () => {
  it("pays once, records the delivery, and lands the lot on the due tick", () => {
    let state = newState();
    const generationId = state.world.currentGpuGenerationId;
    const generation = content.gpuGenerations[generationId];
    if (generation === undefined) throw new Error("current generation missing");
    const quote = quoteGpuPurchase(
      state,
      content,
      state.run.playerLabId,
      generationId,
      1,
    );
    const cashBefore = state.labs[state.run.playerLabId]?.finance.cash ?? 0;

    const command = buyCommand(state, generationId, 1);
    expect(validateCommand(state, content, command).ok).toBe(true);
    state = applyCommand(state, content, command).state;
    const lab = state.labs[state.run.playerLabId];
    expect(lab?.finance.cash).toBeCloseTo(cashBefore - quote.upfrontCostMillions, 6);
    expect(lab?.compute.deliveries).toHaveLength(1);
    expect(lab?.compute.deliveries[0]).toMatchObject({
      generationId,
      ownership: "owned",
      physicalCount: 1000,
    });

    const lotsBefore = lab?.compute.lots.length ?? 0;
    state = advance(state, generation.deliveryWeeks);
    const landed = state.labs[state.run.playerLabId];
    expect(landed?.compute.deliveries).toHaveLength(0);
    expect(landed?.compute.lots.length).toBe(lotsBefore + 1);
    const newLot = landed?.compute.lots.at(-1);
    expect(newLot).toMatchObject({ generationId, physicalCount: 1000 });
  });

  it("counts in-transit orders against datacentre capacity", () => {
    let state = newState();
    const generationId = state.world.currentGpuGenerationId;
    state = applyCommand(state, content, buyCommand(state, generationId, 1)).state;
    const followUp = quoteGpuPurchase(
      state,
      content,
      state.run.playerLabId,
      generationId,
      1,
    );
    expect(followUp.capacity.incomingPhysicalGpus).toBe(1000);
    expect(followUp.capacity.projectedOwnedPhysicalGpus).toBe(
      followUp.capacity.ownedPhysicalGpus + 1000 + 1000,
    );
  });
});

describe("GPU sales", () => {
  it("sells owned unreserved GPUs at the flat resale fraction", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    const lot = lab.compute.lots[0];
    if (lot === undefined) throw new Error("starting lot missing");
    const generationId = lot.generationId;
    const generation = content.gpuGenerations[generationId];
    if (generation === undefined) throw new Error("generation missing");

    const quote = quoteGpuSale(state, content, state.run.playerLabId, generationId, 2);
    expect(quote.canSell).toBe(true);
    expect(quote.cashProceedsMillions).toBeCloseTo(
      2 * generation.gameCostMillionsPerThousand * GPU_RESALE_FRACTION,
      6,
    );

    const cashBefore = lab.finance.cash;
    const gpusBefore = lab.compute.lots.reduce(
      (sum, candidate) => sum + candidate.physicalCount,
      0,
    );
    const after = applyCommand(state, content, sellCommand(state, generationId, 2)).state;
    const afterLab = after.labs[after.run.playerLabId];
    expect(afterLab?.finance.cash).toBeCloseTo(
      cashBefore + quote.cashProceedsMillions,
      6,
    );
    expect(
      afterLab?.compute.lots.reduce((sum, candidate) => sum + candidate.physicalCount, 0),
    ).toBe(gpusBefore - 2000);
  });

  it("refuses to sell GPUs that reservations still need", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    const lot = lab.compute.lots[0];
    if (lot === undefined) throw new Error("starting lot missing");
    lab.compute.reservations = [
      {
        projectId: "project:pinned" as never,
        gpus: gpuCount(lot.physicalCount),
        generationCounts: { [lot.generationId]: lot.physicalCount },
      },
    ];
    const quote = quoteGpuSale(
      state,
      content,
      state.run.playerLabId,
      lot.generationId,
      1,
    );
    expect(quote.canSell).toBe(false);
    expect(quote.blockers.some((blocker) => blocker.includes("unreserved"))).toBe(true);
  });
});

describe("GPU finance costs", () => {
  it("makes later hardware progressively more expensive to operate", () => {
    const generations = ["base:gpu.kepler", "base:gpu.ampere", "base:gpu.kolmogorov"].map(
      (id) => content.gpuGenerations[contentId(id)],
    );
    const [kepler, ampere, kolmogorov] = generations;
    if (kepler === undefined || ampere === undefined || kolmogorov === undefined) {
      throw new Error("test GPU generation missing");
    }

    const recurringShareOfPurchasePrice = (generation: typeof kepler): number =>
      generation.gameOperatingCostMillionsPerThousandPerCycle /
      generation.gameCostMillionsPerThousand;

    expect(recurringShareOfPurchasePrice(kepler)).toBeCloseTo(0.0667, 3);
    expect(recurringShareOfPurchasePrice(ampere)).toBeCloseTo(0.087, 3);
    expect(recurringShareOfPurchasePrice(kolmogorov)).toBeCloseTo(0.1412, 3);
  });

  it("bills owned lots their recurring power cost", () => {
    const state = newState();
    const costs = calculateGpuFinanceCosts(state, content, state.run.playerLabId);
    expect(costs.lines.length).toBeGreaterThan(0);
    for (const line of costs.lines) {
      expect(line.category).toBe("compute-power");
      expect(line.amountMillionsPerCycle).toBeGreaterThanOrEqual(0);
    }
    expect(costs.totalMillionsPerCycle).toBeCloseTo(
      costs.lines.reduce((sum, line) => sum + line.amountMillionsPerCycle, 0),
      6,
    );
  });
});
