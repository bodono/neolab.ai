import { describe, expect, it } from "vitest";

import {
  AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  calculateFrontierCapability,
  classifyCapabilityTier,
  createTransaction,
  isApparentAgiCandidate,
  processCapabilityTierMilestones,
  rating,
  type CapabilityVector,
  type GameState,
  type ModelId,
} from "@neolab/sim";

import { scenario, scenarioContent } from "../scenario.ts";

const content = scenarioContent();

function currentModelId(state: GameState): ModelId {
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  if (modelId === undefined) throw new Error("current model missing");
  return modelId;
}

function capability(value: number): CapabilityVector {
  return {
    language: rating(value),
    reasoning: rating(value),
    agency: rating(value),
    toolUse: rating(value),
    multimodality: rating(value),
    scientificAbility: rating(value),
    embodiment: rating(value),
  };
}

function withEvidence(
  state: GameState,
  value: number,
  options: {
    readonly reliability?: number;
    readonly evidenceFlags?: readonly string[];
  } = {},
): GameState {
  const modelId = currentModelId(state);
  const tx = createTransaction(state);
  tx.update((draft) => {
    const model = draft.models[modelId];
    if (model === undefined) throw new Error("current model missing");
    const values = capability(value);
    // Raw training FLOP is deliberately not a candidacy gate.
    model.investedTotalFlop = 0;
    const ownerLab = draft.labs[model.ownerLabId];
    if (ownerLab !== undefined) {
      ownerLab.flags["agi-component:project-panopticon:complete"] = true;
      ownerLab.flags["agi-component:world-engine:complete"] = true;
      ownerLab.flags["agi-component:oracle-grid:complete"] = true;
      ownerLab.flags["agi-component:mirror-test:complete"] = true;
    }
    model.measuredCapability = {
      values,
      frontierCapability: rating(calculateFrontierCapability(values)),
      confidence: "medium",
      evidenceFlags: [...(options.evidenceFlags ?? [])],
    };
    if (options.reliability !== undefined) {
      model.reliability = rating(options.reliability);
    }
  });
  return tx.commit({ description: "capability evidence fixture" }).state;
}

function withCapabilityAttribute(
  state: GameState,
  attribute: keyof CapabilityVector,
  value: number,
): GameState {
  const modelId = currentModelId(state);
  const tx = createTransaction(state);
  tx.update((draft) => {
    const estimate = draft.models[modelId]?.measuredCapability;
    if (estimate === undefined) throw new Error("capability evidence missing");
    estimate.values[attribute] = rating(value);
    estimate.frontierCapability = rating(calculateFrontierCapability(estimate.values));
  });
  return tx.commit({ description: "adjust capability attribute" }).state;
}

describe("compiled capability tiers", () => {
  it("loads the existing nine-tier catalogue as a closed predicate graph", () => {
    expect(content.capabilityTiers.orderedIds).toHaveLength(9);
    expect(
      content.capabilityTiers.orderedIds.map(
        (id) => content.capabilityTiers.definitions[id]?.level,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      content.capabilityTiers.definitions["base:capability-tier.4-tool-using-agent"],
    ).toMatchObject({
      name: "Tool-Using Agent",
      nominalFrontierCapability: { min: 50, max: 64 },
    });
    // Bands tile 0-100 without gap or overlap, which is the whole ruleset now.
    const bands = content.capabilityTiers.orderedIds.map(
      (id) => content.capabilityTiers.definitions[id]?.nominalFrontierCapability,
    );
    expect(bands[0]?.min).toBe(0);
    expect(bands.at(-1)?.max).toBe(100);
    for (const [index, band] of bands.entries()) {
      if (index === 0) continue;
      expect(band?.min).toBe((bands[index - 1]?.max ?? 0) + 1);
    }
    expect(content.capabilityTiers.progressPresentation).toEqual([
      "early",
      "developing",
      "approaching",
      "breakthrough-imminent",
    ]);
  });
});

describe("capability classification is the band and nothing else", () => {
  it("places a model by its frontier capability alone", () => {
    for (const [value, level] of [
      [5, 0],
      [15, 1],
      [25, 2],
      [40, 3],
      [55, 4],
      [72, 5],
      [84, 6],
      [90, 7],
      [97, 8],
    ] as const) {
      const state = withEvidence(scenario().withBaselineModel().build(), value);
      expect(classifyCapabilityTier(state, content, currentModelId(state)).level).toBe(
        level,
      );
    }
  });

  it("ignores reliability, which training never writes and tier 3 once demanded", () => {
    // The reported save: a frontier-72 model pinned at tier 2 because its
    // reliability was 30 against a threshold of 40.
    const tierAt = (reliability: number) => {
      const state = withEvidence(scenario().withBaselineModel().build(), 72, {
        reliability,
      });
      return classifyCapabilityTier(state, content, currentModelId(state)).level;
    };
    expect(tierAt(30)).toBe(tierAt(90));
    expect(tierAt(30)).toBe(5);
  });

  it("ignores evaluation evidence, so caution is never the price of a rung", () => {
    const bare = withEvidence(scenario().withBaselineModel().build(), 90);
    const evaluated = withEvidence(scenario().withBaselineModel().build(), 90, {
      evidenceFlags: ["evaluation:sandboxed-autonomy-trial:completed"],
    });
    expect(classifyCapabilityTier(bare, content, currentModelId(bare)).level).toBe(
      classifyCapabilityTier(evaluated, content, currentModelId(evaluated)).level,
    );
  });

  it("returns only a qualitative next-tier progress label", () => {
    const state = withEvidence(scenario().withBaselineModel().build(), 32, {
      reliability: 45,
    });
    const view = classifyCapabilityTier(state, content, currentModelId(state));
    expect(view.progressToNextTier).toMatch(
      /^(early|developing|approaching|breakthrough-imminent|top-tier)$/,
    );
    expect(view).not.toHaveProperty("trueCapability");
  });
});

/**
 * Three tiers used to be unreachable. Tier 5 wanted `replicated-novel-task-passed`,
 * tier 6 wanted `diverse-replication-completed`, and tier 8 wanted both
 * `agi-candidate-confirmed` and `superhuman-cross-domain-evaluations-passed` --
 * four flags this file read and nothing in the codebase ever wrote. The ladder
 * ran 0,1,2,3,4 and then jumped to 7.
 */
describe("every rung of the ladder is reachable", () => {
  it("admits a model to each of the nine tiers on capability alone", () => {
    const reached = new Set(
      [5, 15, 25, 40, 55, 72, 84, 90, 97].map((value) => {
        const state = withEvidence(scenario().withBaselineModel().build(), value);
        return classifyCapabilityTier(state, content, currentModelId(state)).level;
      }),
    );
    expect([...reached].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("tier milestones and candidate detection", () => {
  it("requires every capability attribute at 80 without preserving a special reasoning bar", () => {
    const complete = withEvidence(scenario().withBaselineModel().build(), 100);
    const completeModelId = currentModelId(complete);
    const completeModel = complete.models[completeModelId];
    if (completeModel === undefined) throw new Error("candidate model missing");
    expect(isApparentAgiCandidate(complete, completeModel)).toBe(true);

    for (const attribute of Object.keys(capability(100)) as Array<
      keyof CapabilityVector
    >) {
      const belowFloor = withCapabilityAttribute(
        complete,
        attribute,
        AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE - 1,
      );
      const model = belowFloor.models[currentModelId(belowFloor)];
      if (model === undefined) throw new Error("candidate model missing");
      expect(model.measuredCapability?.frontierCapability).toBeGreaterThanOrEqual(88);
      expect(isApparentAgiCandidate(belowFloor, model), attribute).toBe(false);
    }

    const reasoningAtCommonFloor = withCapabilityAttribute(
      complete,
      "reasoning",
      AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
    );
    const boundaryModel =
      reasoningAtCommonFloor.models[currentModelId(reasoningAtCommonFloor)];
    if (boundaryModel === undefined) throw new Error("candidate model missing");
    expect(isApparentAgiCandidate(reasoningAtCommonFloor, boundaryModel)).toBe(true);
  });

  it("enqueues a tier once and awards exact first-reached score entries once", () => {
    const state = withEvidence(scenario().withBaselineModel().build(), 55, {
      reliability: 60,
      evidenceFlags: ["evaluation:sandboxed-autonomy-trial:completed"],
    });
    const modelId = currentModelId(state);
    const firstTx = createTransaction(state);
    processCapabilityTierMilestones(firstTx, content, modelId);
    const first = firstTx.commit({ description: "tier milestone" }).state;

    expect(first.presentationQueue).toHaveLength(1);
    expect(first.score.entries.map((entry) => entry.amount)).toEqual([
      100, 150, 200, 300,
    ]);
    expect(
      first.score.entries.every((entry) => entry.categoryId === "score.race-operations"),
    ).toBe(true);

    const dismissTx = createTransaction(first);
    dismissTx.update((draft) => {
      draft.presentationQueue.splice(0, draft.presentationQueue.length);
    });
    const dismissed = dismissTx.commit({ description: "dismiss tier milestone" }).state;

    const secondTx = createTransaction(dismissed);
    processCapabilityTierMilestones(secondTx, content, modelId);
    const second = secondTx.commit({ description: "repeat tier milestone" }).state;
    expect(second.presentationQueue).toHaveLength(0);
    expect(second.score.entries).toHaveLength(4);
  });

  it("keeps measured tier milestones separate from exact-artifact candidacy", () => {
    const state = withEvidence(scenario().withBaselineModel().build(), 88, {
      reliability: 90,
    });
    const modelId = currentModelId(state);
    const tx = createTransaction(state);
    const tier = processCapabilityTierMilestones(tx, content, modelId);
    const result = tx.commit({ description: "candidate milestone" });

    expect(tier.level).toBe(7);
    expect(result.state.models[modelId]?.flags["agi-candidate"]).toBeUndefined();
    expect(result.state.run.autoPauseReasons).not.toContain("agi-candidate");
    expect(result.state.domainLog).not.toContainEqual({
      tick: result.state.run.tick,
      code: `agi-candidate:${modelId}`,
    });
  });

  it("never declares a model the world has already seen fail", () => {
    const base = withEvidence(scenario().withBaselineModel().build(), 100);
    const modelId = currentModelId(base);
    const tx = createTransaction(base);
    tx.update((draft) => {
      const model = draft.models[modelId];
      if (model === undefined) throw new Error("model missing");
      model.flags["endgame:false-dawn"] = true;
    });
    processCapabilityTierMilestones(tx, content, modelId);
    const result = tx.commit({ description: "blocked by false dawn" });
    expect(result.state.models[modelId]?.flags["agi-candidate"]).not.toBe(true);
  });

  it("holds any new declaration during the lab-level cooldown", () => {
    const base = withEvidence(scenario().withBaselineModel().build(), 100);
    const modelId = currentModelId(base);
    const tx = createTransaction(base);
    tx.update((draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("lab missing");
      lab.flags["endgame:candidate-declaration-cooldown-until"] = draft.run.tick + 14;
    });
    processCapabilityTierMilestones(tx, content, modelId);
    const held = tx.commit({ description: "held by lab cooldown" });
    const model = held.state.models[modelId];
    expect(model?.flags["agi-candidate"]).not.toBe(true);
  });
});
