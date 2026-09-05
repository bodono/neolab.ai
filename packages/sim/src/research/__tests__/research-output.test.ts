import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { CommandId, LabId, ModifierId, ResearcherId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { fraction, rating, tick } from "../../model/units.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { programmeModifierTarget } from "../../researchers/researchers.ts";
import { advancePaperRace, listEligiblePapers } from "../papers.ts";
import { calculateDomainOutput, calculateResearchOutputModifier } from "../research.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const architectures = contentId("base:domain.architectures");
const alignmentControl = contentId("base:safety.alignment-control");
const backprop = contentId("base:paper.backpropagation");
const backpropOnlyBreakthroughOracle: RandomOracle = {
  uniform: (key) => (key.segments.includes(backprop) ? 0 : 0.999_999),
  integer: (_key, minimum) => minimum,
  triangular: (_key, minimum) => minimum,
  weighted: (_key, weights) => Object.keys(weights).sort()[0] as never,
  shuffle: (_key, values) => [...values],
};

function newState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.sam-altmann"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

describe("research output modifiers", () => {
  it("shares one complete lead, diffusion, researcher, and authored-effect stack", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    state.modifiers = {};
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    const leadId = "base:researcher.geoffrey-hintoff" as unknown as ResearcherId;
    const diffuserId = "base:researcher.ash-vashwani" as unknown as ResearcherId;
    const lead = state.researchers[leadId];
    const diffuser = state.researchers[diffuserId];
    if (lead === undefined || diffuser === undefined) {
      throw new Error("researcher fixture missing");
    }
    lead.employerLabId = state.run.playerLabId;
    lead.employedAt = state.run.tick;
    lead.status = "employed";
    lead.housing = "housed";
    lead.assignment = {
      kind: "safety-program",
      targetId: alignmentControl,
      role: "lead",
      assignedAt: state.run.tick,
    };
    diffuser.employerLabId = state.run.playerLabId;
    diffuser.employedAt = state.run.tick;
    diffuser.status = "employed";
    diffuser.housing = "housed";
    lab.roster.researcherIds.push(leadId, diffuserId);

    const programmeTarget = programmeModifierTarget(alignmentControl);
    const modifierFixtures = [
      {
        id: "modifier:test-diffusion",
        source: { kind: "system" as const, id: "test-diffusion" },
        target: "lab.research.diffusionRate",
        operation: "add" as const,
        value: 0.5,
      },
      {
        id: "modifier:test-all-output",
        source: { kind: "system" as const, id: "test-all-output" },
        target: "lab.research.all.output",
        operation: "multiply" as const,
        value: 1.02,
      },
      {
        id: "modifier:test-programme-output",
        source: { kind: "system" as const, id: "test-programme-output" },
        target: programmeTarget,
        operation: "multiply" as const,
        value: 1.03,
      },
      {
        id: "modifier:test-kind-output",
        source: { kind: "system" as const, id: "test-kind-output" },
        target: "lab.research.safety.output",
        operation: "multiply" as const,
        value: 1.04,
      },
      {
        id: "modifier:test-specific-output",
        source: { kind: "system" as const, id: "test-specific-output" },
        target: "lab.research.alignment.output",
        operation: "multiply" as const,
        value: 1.05,
      },
      {
        id: "modifier:test-researcher-programme",
        source: {
          kind: "researcher" as const,
          id: "test-researcher-programme",
        },
        target: programmeTarget,
        operation: "multiply" as const,
        value: 1.06,
      },
      {
        id: "modifier:test-researcher-kind",
        source: { kind: "researcher" as const, id: "test-researcher-kind" },
        target: "lab.research.safety.output",
        operation: "multiply" as const,
        value: 1.07,
      },
    ];
    for (const fixture of modifierFixtures) {
      const id = fixture.id as ModifierId;
      state.modifiers[id] = {
        ...fixture,
        id,
        labId: state.run.playerLabId,
        startsAt: state.run.tick,
        tags: [],
      };
    }

    const modifier = calculateResearchOutputModifier(
      state,
      content,
      state.run.playerLabId,
      alignmentControl,
    );
    const output = calculateDomainOutput(
      state,
      content,
      state.run.playerLabId,
      alignmentControl,
    );

    // Hintoff has Alignment 4, so the housed lead contributes 12 points.
    // Vashwani has Alignment 1 and contributes 0.5 points at this diffusion rate.
    expect(modifier.assignedResearcherPercentagePoints).toBe(12);
    expect(modifier.diffusion.percentagePoints).toBeCloseTo(0.5, 10);
    expect(modifier.outputModifier).toBeCloseTo(
      1.02 * 1.03 * 1.04 * 1.05 * (1 + (12 + 0.5) / 100) * 1.06 * 1.07,
      10,
    );
    expect(output.outputModifier).toBeCloseTo(modifier.outputModifier, 10);
    expect(modifier.modifierContributions.map((entry) => entry.modifierId)).toEqual(
      expect.arrayContaining(
        modifierFixtures
          .filter((fixture) => fixture.target !== "lab.research.diffusionRate")
          .map((fixture) => fixture.id),
      ),
    );
  });
});

describe("research throughput coupling", () => {
  it("counts fleet-wide throughput modifiers as effective GPUs through the exponent", () => {
    const base = newState();
    const boosted = structuredClone(base) as DeepMutable<GameState>;
    boosted.modifiers["throughput-test" as unknown as ModifierId] = {
      id: "throughput-test" as unknown as ModifierId,
      labId: base.run.playerLabId,
      target: "lab.compute.workloadThroughput",
      operation: "multiply",
      value: 2,
      source: { kind: "leader" },
      startsAt: tick(0),
      tags: [],
    };
    const plain = calculateDomainOutput(
      base,
      content,
      base.run.playerLabId,
      architectures,
    );
    const doubled = calculateDomainOutput(
      boosted,
      content,
      base.run.playerLabId,
      architectures,
    );
    expect(plain.baseResearchPoints).toBeGreaterThan(0);
    expect(doubled.baseResearchPoints).toBeCloseTo(
      plain.baseResearchPoints * 2 ** content.research.rules.gpuExponent,
      10,
    );
  });

  it("reduces research compute and output when GPU lots are partly unavailable", () => {
    const base = newState();
    const impaired = structuredClone(base) as DeepMutable<GameState>;
    const lab = impaired.labs[impaired.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    for (const lot of lab.compute.lots) lot.availableFraction = fraction(0.5);

    const plain = calculateDomainOutput(
      base,
      content,
      base.run.playerLabId,
      architectures,
    );
    const reduced = calculateDomainOutput(
      impaired,
      content,
      impaired.run.playerLabId,
      architectures,
    );

    expect(reduced.effectiveTeraflops).toBeCloseTo(plain.effectiveTeraflops * 0.5, 8);
    expect(reduced.baseResearchPoints).toBeCloseTo(
      plain.baseResearchPoints * 0.5 ** content.research.rules.gpuExponent,
      10,
    );
  });

  it("removes training reservations before assigning compute to research", () => {
    const base = newState();
    const capabilityBefore = calculateDomainOutput(
      base,
      content,
      base.run.playerLabId,
      architectures,
    );
    const safetyBefore = calculateDomainOutput(
      base,
      content,
      base.run.playerLabId,
      alignmentControl,
    );
    const started = applyCommand(base, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:research-reservation" as CommandId,
        expectedTick: base.run.tick,
        issuedBy: "player",
      },
      labId: base.run.playerLabId,
      posture: "normal",
      durationWeeks: 8,
    }).state;
    const capabilityAfter = calculateDomainOutput(
      started,
      content,
      started.run.playerLabId,
      architectures,
    );
    const safetyAfter = calculateDomainOutput(
      started,
      content,
      started.run.playerLabId,
      alignmentControl,
    );
    const lab = started.labs[started.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");

    expect(lab.compute.reservations[0]?.gpus).toBeGreaterThan(0);
    expect(capabilityAfter.physicalGpus).toBeLessThan(capabilityBefore.physicalGpus);
    expect(capabilityAfter.effectiveTeraflops).toBeLessThan(
      capabilityBefore.effectiveTeraflops,
    );
    expect(capabilityAfter.baseResearchPoints).toBeLessThan(
      capabilityBefore.baseResearchPoints,
    );
    expect(safetyAfter.physicalGpus).toBeLessThan(safetyBefore.physicalGpus);
    expect(safetyAfter.effectiveTeraflops).toBeLessThan(safetyBefore.effectiveTeraflops);
    expect(safetyAfter.baseResearchPoints).toBeLessThan(safetyBefore.baseResearchPoints);
  });
});

describe("paper discovery interruptions", () => {
  it("records an independent player rediscovery without auto-pausing", () => {
    const draft = structuredClone(newState()) as DeepMutable<GameState>;
    const playerLab = draft.labs[draft.run.playerLabId];
    const rivalLabId = draft.world.paperRace.labOrder
      .map((labId) => labId as LabId)
      .find(
        (labId) => labId !== draft.run.playerLabId && draft.labs[labId] !== undefined,
      );
    const paperId = backprop;
    const paper = content.papers.definitions[paperId];
    if (playerLab === undefined || rivalLabId === undefined || paper === undefined) {
      throw new Error("paper rediscovery fixture missing");
    }
    const rivalLab = draft.labs[rivalLabId];
    if (rivalLab === undefined) throw new Error("rival lab fixture missing");
    const architectureState = playerLab.research.domains[architectures];
    const optimisationState =
      playerLab.research.domains[contentId("base:domain.optimisation-scaling")];
    if (architectureState === undefined || optimisationState === undefined) {
      throw new Error("paper programme fixture missing");
    }
    architectureState.level = rating(paper.breakthroughRequirement.level);
    optimisationState.level = rating(3);
    expect(
      listEligiblePapers(draft, content, draft.run.playerLabId).map(
        (candidate) => candidate.paperId,
      ),
    ).toContain(paperId);

    // The always-breakthrough oracle fires every eligible paper, and the levels
    // set above also make Perceptron eligible. Give it to the player already so
    // this test isolates the rediscovery event and its non-blocking behaviour.
    playerLab.research.discoveredPaperIds.push(contentId("base:paper.perceptron"));
    draft.world.paperRace.discoveries[paperId] = {
      paperId,
      discovererLabId: rivalLabId,
      discoveredAt: draft.run.tick,
    };
    rivalLab.research.discoveredPaperIds.push(paperId);

    const tx = createTransaction(draft);
    advancePaperRace(tx, content, backpropOnlyBreakthroughOracle);
    const result = tx.commit({ description: "rediscover rival paper" });

    expect(result.domainEvents).toContainEqual({
      kind: "paper-discovered",
      paperId,
      labId: draft.run.playerLabId,
      worldFirst: false,
    });
    expect(result.autoPauseReasons).not.toContain("paper-discovered");
  });

  it("handles simultaneous breakthroughs with random world-first tiebreaker and rediscovery credit", () => {
    const draft = structuredClone(newState()) as DeepMutable<GameState>;
    const playerLab = draft.labs[draft.run.playerLabId];
    const rivalLabId = Object.keys(draft.world.rivals)[0] as LabId | undefined;
    const paperId = backprop;
    const paper = content.papers.definitions[paperId];
    if (playerLab === undefined || rivalLabId === undefined || paper === undefined) {
      throw new Error("simultaneous race fixture missing");
    }
    const rivalLab = draft.labs[rivalLabId];
    if (rivalLab === undefined) throw new Error("rival lab missing");

    // Give both labs the requirements for Backpropagation
    playerLab.research.discoveredPaperIds.push(contentId("base:paper.perceptron"));
    const playerArch = playerLab.research.domains[architectures];
    const playerOpt =
      playerLab.research.domains[contentId("base:domain.optimisation-scaling")];
    const rivalArch = rivalLab.research.domains[architectures];
    const rivalOpt =
      rivalLab.research.domains[contentId("base:domain.optimisation-scaling")];
    if (
      playerArch === undefined ||
      playerOpt === undefined ||
      rivalArch === undefined ||
      rivalOpt === undefined
    ) {
      throw new Error("research domain fixtures missing");
    }
    playerArch.level = rating(paper.breakthroughRequirement.level);
    playerOpt.level = rating(3);
    rivalArch.level = rating(paper.breakthroughRequirement.level);
    rivalOpt.level = rating(3);

    const tx = createTransaction(draft);
    advancePaperRace(tx, content, backpropOnlyBreakthroughOracle);
    const result = tx.commit({ description: "simultaneous breakthrough" });

    const discoveries = result.domainEvents.filter(
      (event) => event.kind === "paper-discovered" && event.paperId === paperId,
    );
    expect(discoveries).toHaveLength(2);
    const worldFirsts = discoveries.filter(
      (d) => "worldFirst" in d && d.worldFirst === true,
    );
    const rediscoveries = discoveries.filter(
      (d) => "worldFirst" in d && d.worldFirst === false,
    );
    expect(worldFirsts).toHaveLength(1);
    expect(rediscoveries).toHaveLength(1);
  });
});
