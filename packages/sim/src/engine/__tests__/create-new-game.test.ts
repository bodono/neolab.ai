import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import type { RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { calculateRivalProgramResearch } from "../../rivals/research.ts";
import {
  calculateDomainOutput,
  derivePaperBreakthroughChance,
  researchPointsForNextLevel,
} from "../../research/index.ts";
import { advanceOneTick } from "../advance-tick.ts";
import { createNewGame, type NewGameConfig } from "../create-new-game.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const SEED = seed128("0123456789abcdef0123456789abcdef");
const MAXIMUM_RESEARCH_VARIANCE: RandomOracle = {
  uniform: () => 1,
  integer: (_key, _minimum, maximum) => maximum,
  triangular: (_key, _minimum, _mode, maximum) => maximum,
  weighted: (_key, weights) => Object.keys(weights).sort().at(-1) as never,
  shuffle: (_key, values) => [...values],
};

const LEADERS = [
  "base:leader.thomas-hassabi",
  "base:leader.dario-amodeo",
  "base:leader.sam-altmann",
  "base:leader.elon-tusk",
  "base:leader.liang-wenfang",
] as const;

function config(overrides: Partial<NewGameConfig> = {}): NewGameConfig {
  return {
    seed: SEED,
    difficultyId: contentId("base:difficulty.standard"),
    leaderId: contentId("base:leader.sam-altmann"),
    mandateId: contentId("base:mandate.build-the-science"),
    ...overrides,
  };
}

function playerLab(state: ReturnType<typeof createNewGame>) {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  return lab;
}

function rivalLab(state: ReturnType<typeof createNewGame>, definitionId: string) {
  const lab = Object.values(state.labs).find(
    (candidate) =>
      candidate.control === "rival" && candidate.definitionId === definitionId,
  );
  if (lab === undefined) throw new Error(`rival lab ${definitionId} missing`);
  return lab;
}

function goldenState(state: ReturnType<typeof createNewGame>) {
  const { researchers, labs, models, ...rest } = state;
  const player = labs[state.run.playerLabId];
  const playerModelIds = new Set<string>(player?.models.modelIds ?? []);
  return {
    ...rest,
    labs: player === undefined ? {} : { [state.run.playerLabId]: player },
    models: Object.fromEntries(
      Object.entries(models).filter(([modelId]) => playerModelIds.has(modelId)),
    ),
    rivalBaseline: Object.values(labs)
      .filter((lab) => lab.control === "rival")
      .map((lab) => ({
        labId: lab.id,
        definitionId: lab.definitionId,
        modelIds: lab.models.modelIds,
        cash: lab.finance.cash,
        physicalGpus: lab.compute.lots.reduce(
          (total, lot) => total + lot.physicalCount,
          0,
        ),
      })),
    researchers: {
      count: Object.keys(researchers).length,
      orderedIds: Object.keys(researchers),
      allInitiallyAvailable: Object.values(researchers).every(
        (researcher) =>
          researcher.status === "available" && researcher.employerLabId === undefined,
      ),
    },
  };
}

describe("createNewGame baseline (GDD section 29.2, before lab modifiers)", () => {
  // Stan Altmann's modifiers do not touch these baseline fields, so the
  // ClopenAI run doubles as the per-field baseline assertion set.
  const state = createNewGame(config(), content);
  const lab = playerLab(state);

  it("starts at 2012 week 1, foundation phase, active", () => {
    expect(state.run.calendar).toEqual({ year: 2012, week: 1 });
    expect(state.run.tick).toBe(0);
    expect(state.run.phase).toBe("foundation");
    expect(state.run.status).toBe("active");
  });

  it("matches the financial and fleet baseline", () => {
    expect(lab.finance.cash).toBe(45);
    // Leases are gone as a mechanic: the authored owned+leased total starts
    // as a single owned lot.
    expect(lab.compute.lots.map((lot) => [lot.ownership, lot.physicalCount])).toEqual([
      ["owned", 2000],
    ]);
    expect(lab.compute.lots.every((lot) => lot.generationId === "base:gpu.kepler")).toBe(
      true,
    );
  });

  it("matches the rating baseline", () => {
    expect(lab.safety).toEqual({
      safetyCulture: 45,
      alignmentScience: 8,
      practiceXp: 0,
      evalQuality: 10,
      controlTheory: 6,
      // Lowered 2026-07-31: a fresh lab is a startup with a wiki page about
      // security. Operational defence starts near 10 of 100.
      practicalControlStrength: 7,
      securityPosture: 12,
    });
    expect(lab.organisation.hiddenInternalCandour).toBe(50);
    expect(lab.organisation.generalResearchers).toBe(18);
    expect(lab.organisation.engineersAndOps).toBe(12);
    expect(lab.politics.governmentAttention).toBe(5);
    expect(lab.politics.governmentTrust).toBe(50);
    expect(lab.roster.starSlots).toBe(3);
    expect(lab.market.marketShare).toBeCloseTo(0.005, 10);
  });

  it("matches the starting research domains", () => {
    expect(Object.keys(lab.research.domains)).toHaveLength(7);
    expect(Object.keys(lab.research.safetyPrograms)).toHaveLength(3);
    expect(lab.research.domains).toMatchObject({
      "base:domain.architectures": { level: 8, levelProgressRp: 0 },
      "base:domain.optimisation-scaling": { level: 6, levelProgressRp: 0 },
      "base:domain.reasoning-tools": { level: 0, levelProgressRp: 0 },
    });
    expect(lab.research.safetyPrograms).toMatchObject({
      "base:safety.alignment-control": { level: 8 },
      "base:safety.interpretability-evals": { level: 10 },
      "base:safety.security-containment": { level: 6 },
    });
  });

  it("starts without an AI or customer-serving allocation", () => {
    expect(lab.models).toEqual({ modelIds: [] });
    expect(state.models).toEqual({});
    expect(lab.compute.allocation.servingFleetShareBasisPoints).toBe(0);
    expect(
      Object.values(state.labs).every(
        (candidate) => candidate.models.modelIds.length === 0,
      ),
    ).toBe(true);
  });
});

describe("leader and lab modifiers", () => {
  it("ClopenAI: 40 spendable Aura and meaningful recurring overhead", () => {
    const state = createNewGame(config(), content);
    const lab = playerLab(state);
    expect(lab.aura.spendable).toBe(40);
    expect(lab.aura.lifetime).toBe(40); // lifted to spendable floor
    expect(
      Object.values(state.modifiers).find(
        (modifier) => modifier.target === "lab.finance.executiveCostPerCycle",
      ),
    ).toMatchObject({
      operation: "add",
      value: 1,
    });
  });

  it("DeepBrain: scientific AI unlocked at 6 without a first-model quality penalty", () => {
    const state = createNewGame(
      config({ leaderId: contentId("base:leader.thomas-hassabi") }),
      content,
    );
    const lab = playerLab(state);
    expect(lab.research.domains["base:domain.scientific-ai"]).toMatchObject({ level: 6 });
    expect(lab.flags["model:first-product-quality"]).toBe(
      content.balance.newGame.startingModel.productQuality,
    );
    expect(
      content.leaders["base:leader.thomas-hassabi"]?.labModifiers
        .flatMap((modifier) => modifier.effects)
        .some((effect) => effect.target === "lab.model.productQuality.starting"),
    ).toBe(false);
  });

  it("Humanic: eval quality 20, standard opening fleet, and 5% costlier GPUs", () => {
    const state = createNewGame(
      config({ leaderId: contentId("base:leader.dario-amodeo") }),
      content,
    );
    const lab = playerLab(state);
    expect(lab.safety.evalQuality).toBe(20);
    expect(lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0)).toBe(2000);
    expect(
      Object.values(state.modifiers).find(
        (modifier) => modifier.target === "lab.compute.acquisitionCost",
      ),
    ).toMatchObject({
      operation: "multiply",
      value: 1.05,
    });
  });

  it("xMind: robotics unlocked at 10, attention 10, $245m start", () => {
    const lab = playerLab(
      createNewGame(config({ leaderId: contentId("base:leader.elon-tusk") }), content),
    );
    expect(lab.finance.cash).toBe(245);
    expect(lab.research.domains["base:domain.robotics-embodiment"]).toMatchObject({
      level: 10,
    });
    expect(lab.politics.governmentAttention).toBe(10);
  });

  it("DeepSearch AI: government trust 65, attention 35, optimisation 9", () => {
    const lab = playerLab(
      createNewGame(
        config({ leaderId: contentId("base:leader.liang-wenfang") }),
        content,
      ),
    );
    expect(lab.politics.governmentTrust).toBe(65);
    expect(lab.politics.governmentAttention).toBe(35);
    expect(lab.research.domains["base:domain.optimisation-scaling"]).toMatchObject({
      level: 9,
    });
  });

  it("gives AI-controlled rivals their associated leader's research start", () => {
    const state = createNewGame(config(), content);
    expect(
      rivalLab(state, "base:lab.deepbrain").research.domains["base:domain.scientific-ai"],
    ).toMatchObject({ level: 6 });
    expect(
      rivalLab(state, "base:lab.xmind").research.domains[
        "base:domain.robotics-embodiment"
      ],
    ).toMatchObject({ level: 10 });
    expect(
      rivalLab(state, "base:lab.deepsearch").research.domains[
        "base:domain.optimisation-scaling"
      ],
    ).toMatchObject({ level: 9 });
  });

  it("keeps Support-Vector Networks out of Liang's first weekly paper roll", () => {
    const state = createNewGame(
      config({
        leaderId: contentId("base:leader.liang-wenfang"),
        mandateId: contentId("base:mandate.build-the-science"),
      }),
      content,
    );
    const lab = playerLab(state);
    const optimisation = contentId("base:domain.optimisation-scaling");
    const supportVectorNetworks = contentId("base:paper.support-vector-networks");
    const maximumOpeningOutput = calculateDomainOutput(
      state,
      content,
      lab.id,
      optimisation,
      state.run.tick,
      MAXIMUM_RESEARCH_VARIANCE,
    ).finalResearchPoints;
    expect(maximumOpeningOutput).toBeLessThan(
      researchPointsForNextLevel(content, optimisation, 9),
    );
    expect(
      derivePaperBreakthroughChance(
        state,
        content,
        state.run.playerLabId,
        supportVectorNetworks,
      ),
    ).toBe(0);

    const afterWeekOne = advanceOneTick(state, content).state;
    const labAfterWeekOne = playerLab(afterWeekOne);
    expect(labAfterWeekOne.research.domains[optimisation]).toMatchObject({ level: 9 });
    expect(labAfterWeekOne.research.discoveredPaperIds).not.toContain(
      supportVectorNetworks,
    );
    expect(
      derivePaperBreakthroughChance(
        afterWeekOne,
        content,
        afterWeekOne.run.playerLabId,
        supportVectorNetworks,
      ),
    ).toBe(0);
  });

  it("keeps Support-Vector Networks out of DeepSearch's first rival paper roll", () => {
    const state = createNewGame(config(), content);
    const optimisation = contentId("base:domain.optimisation-scaling");
    const supportVectorNetworks = contentId("base:paper.support-vector-networks");
    const deepSearch = rivalLab(state, "base:lab.deepsearch");
    const maximumOpeningOutput = calculateRivalProgramResearch(
      state,
      content,
      deepSearch.id,
      optimisation,
      MAXIMUM_RESEARCH_VARIANCE,
    ).finalResearchPoints;
    expect(maximumOpeningOutput).toBeLessThan(
      researchPointsForNextLevel(content, optimisation, 9),
    );
    expect(
      derivePaperBreakthroughChance(state, content, deepSearch.id, supportVectorNetworks),
    ).toBe(0);

    const afterWeekOne = advanceOneTick(state, content).state;
    const deepSearchAfterWeekOne = rivalLab(afterWeekOne, "base:lab.deepsearch");
    expect(deepSearchAfterWeekOne.research.domains[optimisation]).toMatchObject({
      level: 9,
    });
    expect(deepSearchAfterWeekOne.research.discoveredPaperIds).not.toContain(
      supportVectorNetworks,
    );
    expect(
      derivePaperBreakthroughChance(
        afterWeekOne,
        content,
        deepSearchAfterWeekOne.id,
        supportVectorNetworks,
      ),
    ).toBe(0);
  });

  it.each(LEADERS)(
    "%s can recruit any star researcher and still afford a competitive round",
    (leaderId) => {
      const lab = playerLab(
        createNewGame(config({ leaderId: contentId(leaderId) }), content),
      );
      const largestAuraCost = Math.max(
        ...Object.values(content.researchers.definitions).map(
          (researcher) => researcher.contract.auraCost,
        ),
      );
      expect(lab.aura.spendable - largestAuraCost).toBeGreaterThanOrEqual(
        content.fundraising.campaigns["competitive-round"].auraCost,
      );
    },
  );

  it("ongoing bonuses become sourced modifiers, never starting-state edits", () => {
    const state = createNewGame(
      config({ leaderId: contentId("base:leader.liang-wenfang") }),
      content,
    );
    const throughput = Object.values(state.modifiers).find(
      (modifier) => modifier.target === "lab.compute.workloadThroughput",
    );
    expect(throughput).toMatchObject({ operation: "multiply", value: 1.05 });
    expect(throughput?.source.kind).toBe("leader");
    // The physical count is untouched by throughput modifiers (TDD 11.2).
    const lab = playerLab(state);
    expect(lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0)).toBe(2_000);
  });
});

describe("difficulty and mandate application", () => {
  it("standard difficulty adds no difficulty modifiers", () => {
    const state = createNewGame(config(), content);
    const difficultyModifiers = Object.values(state.modifiers).filter(
      (modifier) => modifier.source.id?.startsWith("difficulty:") === true,
    );
    expect(difficultyModifiers).toHaveLength(0);
  });

  it.each([
    ["base:difficulty.fellowship", 4],
    ["base:difficulty.frontier", 3],
    ["base:difficulty.unhinged-scaling", 3],
  ])("%s emits its multiplier modifiers", (difficultyId, expected) => {
    const state = createNewGame(
      config({ difficultyId: contentId(difficultyId) }),
      content,
    );
    const difficultyModifiers = Object.values(state.modifiers).filter(
      (modifier) => modifier.source.id?.startsWith("difficulty:") === true,
    );
    expect(difficultyModifiers).toHaveLength(expected);
  });

  it("build-the-science mandate: capability up, ceiling and funding rounds down", () => {
    const state = createNewGame(
      config({ mandateId: contentId("base:mandate.build-the-science") }),
      content,
    );
    const mandateModifiers = Object.values(state.modifiers).filter(
      (modifier) => modifier.source.id?.startsWith("mandate:") === true,
    );
    expect(mandateModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "lab.research.capability.output",
          operation: "multiply",
          value: 1.08,
        }),
        expect.objectContaining({
          target: "lab.market.demandCeiling",
          operation: "multiply",
          value: 0.8,
        }),
        expect.objectContaining({
          target: "lab.fundraising.offerCash",
          operation: "multiply",
          value: 0.8,
        }),
      ]),
    );
  });

  it("build-the-business mandate: +25 full-game cash, larger ceiling, slower safety research", () => {
    const state = createNewGame(
      config({ mandateId: contentId("base:mandate.build-the-business") }),
      content,
    );
    const lab = playerLab(state);
    expect(lab.finance.cash).toBe(70);
    const ceiling = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.target === "lab.market.demandCeiling" &&
        modifier.source.id?.startsWith("mandate:") === true,
    );
    expect(ceiling).toMatchObject({ operation: "multiply", value: 1.25 });
    const offerCash = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.target === "lab.fundraising.offerCash" &&
        modifier.source.id?.startsWith("mandate:") === true,
    );
    expect(offerCash).toMatchObject({ operation: "multiply", value: 1.1 });
    const safetyOutput = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.target === "lab.research.safety.output" &&
        modifier.source.id?.startsWith("mandate:") === true,
    );
    expect(safetyOutput).toMatchObject({ operation: "multiply", value: 0.9 });
  });

  it("build-it-right mandate: safety research up, evals and trust up, throughput down", () => {
    const state = createNewGame(
      config({ mandateId: contentId("base:mandate.build-it-right") }),
      content,
    );
    const lab = playerLab(state);
    expect(lab.safety.evalQuality).toBe(20);
    expect(lab.politics.governmentTrust).toBe(60);
    const safetyOutput = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.target === "lab.research.safety.output" &&
        modifier.source.id?.startsWith("mandate:") === true,
    );
    expect(safetyOutput).toMatchObject({ operation: "multiply", value: 1.3 });
    const throughput = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.target === "lab.compute.workloadThroughput" &&
        modifier.source.id?.startsWith("mandate:") === true,
    );
    expect(throughput).toMatchObject({ operation: "multiply", value: 0.95 });
  });
});

describe("golden snapshots (all five leaders, standard difficulty)", () => {
  it.each(LEADERS)("%s starting state is frozen", (leaderId) => {
    const state = createNewGame(config({ leaderId: contentId(leaderId) }), content);
    expect(goldenState(state)).toMatchSnapshot();
  });

  it("identical config reproduces byte-identical state", () => {
    const a = createNewGame(config(), content);
    const b = createNewGame(config(), content);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rejects unknown leader, difficulty, and mandate", () => {
    expect(() =>
      createNewGame(config({ leaderId: contentId("base:leader.nobody") }), content),
    ).toThrow(/Unknown leader/);
    expect(() =>
      createNewGame(
        config({ difficultyId: contentId("base:difficulty.imaginary") }),
        content,
      ),
    ).toThrow(/Unknown difficulty/);
    expect(() =>
      createNewGame(config({ mandateId: contentId("base:mandate.imaginary") }), content),
    ).toThrow(/Unknown mandate/);
  });
});

describe("golden snapshots (remaining difficulties, DeepBrain)", () => {
  it.each([
    "base:difficulty.fellowship",
    "base:difficulty.frontier",
    "base:difficulty.unhinged-scaling",
  ])("%s starting state is frozen", (difficultyId) => {
    const state = createNewGame(
      config({
        leaderId: contentId("base:leader.thomas-hassabi"),
        difficultyId: contentId(difficultyId),
      }),
      content,
    );
    expect(goldenState(state)).toMatchSnapshot();
  });
});
