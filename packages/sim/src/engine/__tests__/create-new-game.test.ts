import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { seed128 } from "../../random/seed.ts";
import { createNewGame, type NewGameConfig } from "../create-new-game.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const SEED = seed128("0123456789abcdef0123456789abcdef");

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

describe("createNewGame baseline (GDD section 29.2, before lab modifiers)", () => {
  // Sam Altmann's modifiers do not touch these baseline fields, so the
  // OpenMind run doubles as the per-field baseline assertion set.
  const state = createNewGame(config(), content);
  const lab = playerLab(state);

  it("starts at 2012 week 1, foundation phase, active", () => {
    expect(state.run.calendar).toEqual({ year: 2012, week: 1 });
    expect(state.run.tick).toBe(0);
    expect(state.run.phase).toBe("foundation");
    expect(state.run.status).toBe("active");
  });

  it("matches the financial and fleet baseline", () => {
    expect(lab.finance.cash).toBe(18);
    expect(lab.compute.lots.map((lot) => [lot.ownership, lot.physicalCount])).toEqual([
      ["owned", 6000],
      ["leased", 4000],
    ]);
    expect(lab.compute.lots.every((lot) => lot.generationId === "base:gpu.kepler")).toBe(
      true,
    );
    expect(lab.compute.softwareEfficiency).toBe(1);
  });

  it("matches the rating baseline", () => {
    expect(lab.safety).toEqual({
      safetyCulture: 45,
      alignmentScience: 8,
      evalQuality: 10,
      controlTheory: 6,
      practicalControlStrength: 25,
      securityPosture: 35,
    });
    expect(lab.organisation.engineeringQuality).toBe(50);
    expect(lab.organisation.managementCapacity).toBe(45);
    expect(lab.organisation.researchFreedom).toBe(60);
    expect(lab.organisation.hiddenInternalCandour).toBe(50);
    expect(lab.organisation.generalResearchers).toBe(18);
    expect(lab.organisation.engineersAndOps).toBe(12);
    expect(lab.politics.governmentAttention).toBe(5);
    expect(lab.politics.governmentTrust).toBe(50);
    expect(lab.roster.starSlots).toBe(3);
    expect(lab.market.marketShare).toBeCloseTo(0.005, 10);
  });

  it("matches the starting research domains", () => {
    expect(lab.research.domains).toEqual({
      "base:domain.architectures": { level: 8 },
      "base:domain.optimisation-scaling": { level: 6 },
      "base:domain.data-representation": { level: 10 },
    });
  });

  it("creates the canonical starting model with hidden safety truth", () => {
    const modelId = lab.models.currentModelId;
    if (modelId === undefined) throw new Error("starting model missing");
    const model = state.models[modelId];
    if (model === undefined) throw new Error("starting model missing");
    expect(model.trueCapability).toEqual({
      language: 20,
      reasoning: 8,
      agency: 3,
      toolUse: 4,
      multimodality: 5,
      scientificAbility: 3,
      embodiment: 0,
    });
    expect(model.generality).toBe(5);
    expect(model.reliability).toBe(35);
    expect(model.hiddenSafety.trueAlignment).toBe(70);
    expect(model.hiddenSafety.corrigibility).toBe(75);
    expect(model.familyName).toBe("GPT");
  });
});

describe("leader and lab modifiers", () => {
  it("OpenMind: 20 spendable Aura, board patience 60, momentum modifiers", () => {
    const lab = playerLab(createNewGame(config(), content));
    expect(lab.aura.spendable).toBe(20);
    expect(lab.aura.lifetime).toBe(20); // lifted to spendable floor
    expect(lab.organisation.boardPatience).toBe(60);
  });

  it("DeepBrain: research freedom 70, scientific AI unlocked at 6, product quality 10", () => {
    const state = createNewGame(
      config({ leaderId: contentId("base:leader.thomas-hassabi") }),
      content,
    );
    const lab = playerLab(state);
    expect(lab.organisation.researchFreedom).toBe(70);
    expect(lab.research.domains["base:domain.scientific-ai"]).toEqual({ level: 6 });
    const modelId = lab.models.currentModelId;
    if (modelId === undefined) throw new Error("starting model missing");
    const model = state.models[modelId];
    expect(model?.productQuality).toBe(10);
    expect(model?.familyName).toBe("Gemini");
  });

  it("Humanic: safety constitution ratings and a 9,000-GPU fleet", () => {
    const lab = playerLab(
      createNewGame(config({ leaderId: contentId("base:leader.dario-amodeo") }), content),
    );
    expect(lab.safety.safetyCulture).toBe(58);
    expect(lab.safety.evalQuality).toBe(15);
    expect(lab.organisation.hiddenInternalCandour).toBe(60);
    expect(lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0)).toBe(9000);
  });

  it("xMind: engineering 62, robotics unlocked at 5, attention 15", () => {
    const lab = playerLab(
      createNewGame(config({ leaderId: contentId("base:leader.elon-tusk") }), content),
    );
    expect(lab.organisation.engineeringQuality).toBe(62);
    expect(lab.research.domains["base:domain.robotics-embodiment"]).toEqual({
      level: 5,
    });
    expect(lab.politics.governmentAttention).toBe(15);
  });

  it("DeepSearch: 15 cash, 10 Aura, optimisation 12", () => {
    const lab = playerLab(
      createNewGame(
        config({ leaderId: contentId("base:leader.liang-wenfang") }),
        content,
      ),
    );
    expect(lab.finance.cash).toBe(15);
    expect(lab.aura.spendable).toBe(10);
    expect(lab.research.domains["base:domain.optimisation-scaling"]).toEqual({
      level: 12,
    });
  });

  it("ongoing bonuses become sourced modifiers, never starting-state edits", () => {
    const state = createNewGame(
      config({ leaderId: contentId("base:leader.liang-wenfang") }),
      content,
    );
    const throughput = Object.values(state.modifiers).find(
      (modifier) => modifier.target === "lab.compute.workloadThroughput",
    );
    expect(throughput).toMatchObject({ operation: "multiply", value: 1.2 });
    expect(throughput?.source.kind).toBe("leader");
    // The physical count is untouched by throughput modifiers (TDD 11.2).
    const lab = playerLab(state);
    expect(lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0)).toBe(
      10_000,
    );
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
    ["base:difficulty.fellowship", 5],
    ["base:difficulty.frontier", 4],
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

  it("build-the-business mandate: +6 cash, -8 safety culture, starter contract", () => {
    const lab = playerLab(
      createNewGame(
        config({ mandateId: contentId("base:mandate.build-the-business") }),
        content,
      ),
    );
    expect(lab.finance.cash).toBe(24);
    expect(lab.safety.safetyCulture).toBe(37);
    expect(lab.flags["lab.contracts.starterContract"]).toBe(1);
  });

  it("build-it-right mandate: safety ratings up, throughput modifier down", () => {
    const state = createNewGame(
      config({ mandateId: contentId("base:mandate.build-it-right") }),
      content,
    );
    const lab = playerLab(state);
    expect(lab.safety.safetyCulture).toBe(55);
    expect(lab.safety.evalQuality).toBe(18);
    expect(lab.politics.governmentTrust).toBe(55);
    const throughput = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.target === "lab.compute.workloadThroughput" &&
        modifier.source.id?.startsWith("mandate:") === true,
    );
    expect(throughput).toMatchObject({ operation: "multiply", value: 0.9 });
  });
});

describe("golden snapshots (all five leaders, standard difficulty)", () => {
  it.each(LEADERS)("%s starting state is frozen", (leaderId) => {
    const state = createNewGame(config({ leaderId: contentId(leaderId) }), content);
    expect(state).toMatchSnapshot();
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
    expect(state).toMatchSnapshot();
  });
});
