import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState, ModelState } from "../../model/state.ts";
import { fraction, rating } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  CAPABILITY_VERIFIER_RULES,
  generatedCapabilityChallenge,
  quoteCapabilityProof,
  resolveCapabilityProof,
} from "../capability-proof.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function playerModel(): ModelState {
  const state = addBaselineModelsForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
    content,
  );
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (model === undefined) throw new Error("Player model missing");
  return model;
}

function candidateState(truth: "genuine" | "not-genuine") {
  const state = structuredClone(
    addBaselineModelsForTest(
      createNewGame(
        {
          seed: seed128("abcdefabcdefabcdefabcdefabcdefab"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (model === undefined) throw new Error("Player model missing");
  model.trueCapability = {
    language: rating(90),
    reasoning: rating(90),
    agency: rating(90),
    toolUse: rating(90),
    multimodality: rating(90),
    scientificAbility: rating(90),
    embodiment: rating(90),
  };
  model.measuredCapability = {
    values: structuredClone(model.trueCapability),
    frontierCapability: rating(90),
    confidence: "high",
    evidenceFlags: [],
  };
  state.lineageSIRecords[model.lineageId] = {
    lineageId: model.lineageId,
    superintelligenceTruth: truth,
    probabilityAtFirstCrossing: fraction(0.125),
    randomKey: "fixture/endgame-si",
    draw: fraction(0.5),
    firstQualifyingModelId: model.id,
    firstQualifyingFrontierCapability: rating(90),
    firstQualifyingWeek: state.run.tick,
    rulesVersion: state.engineRulesVersion,
  };
  return { state, model };
}

describe("endgame capability proof composer", () => {
  it("describes the internal verifier using only mechanics it actually uses", () => {
    expect(CAPABILITY_VERIFIER_RULES["blinded-internal"].benefit).toMatch(
      /credible evidence with no added weeks/i,
    );
    expect(CAPABILITY_VERIFIER_RULES["blinded-internal"].warning).toMatch(
      /limited independence/i,
    );
    expect(CAPABILITY_VERIFIER_RULES["blinded-internal"].warning).not.toMatch(/candour/i);
  });

  it("combines challenge and verifier costs without conflating their roles", () => {
    const quote = quoteCapabilityProof(
      playerModel(),
      "generalist-gauntlet",
      "independent-institutional",
    );
    expect(quote.claimScope).toBe("broad-superintelligence");
    expect(quote.durationWeeks).toBe(8);
    expect(quote.integrityLabel).toBe("Durable");
    expect(quote.cashCostMillions).toBe(4_000);
    expect(quote.warnings).toHaveLength(2);
  });

  it("makes verifier timing a legible strategic tradeoff", () => {
    const model = playerModel();
    expect(
      quoteCapabilityProof(model, "generalist-gauntlet", "blinded-internal")
        .durationWeeks,
    ).toBe(4);
    expect(
      quoteCapabilityProof(model, "generalist-gauntlet", "independent-institutional")
        .durationWeeks,
    ).toBe(8);
    expect(
      quoteCapabilityProof(model, "generalist-gauntlet", "candidate-designed")
        .durationWeeks,
    ).toBe(2);
    expect(
      quoteCapabilityProof(model, "autonomous-operations", "candidate-designed")
        .durationWeeks,
    ).toBe(1);
  });

  it("keeps benchmark declaration immediate and explicitly unverified", () => {
    const quote = quoteCapabilityProof(playerModel(), "declare-from-benchmarks");
    expect(quote.durationWeeks).toBe(0);
    expect(quote.integrityLabel).toBe("Unverified");
    expect(quote.verifier).toBeUndefined();
  });

  it("generates the narrow challenge from measured capability", () => {
    const model = structuredClone(playerModel());
    const mutable = model as unknown as {
      measuredCapability: NonNullable<ModelState["measuredCapability"]>;
    };
    mutable.measuredCapability = {
      values: {
        language: 40 as never,
        reasoning: 55 as never,
        agency: 30 as never,
        toolUse: 45 as never,
        multimodality: 60 as never,
        scientificAbility: 91 as never,
        embodiment: 20 as never,
      },
      frontierCapability: 70 as never,
      confidence: "high",
      evidenceFlags: [],
    };
    const challenge = generatedCapabilityChallenge(model, "strongest-domain");
    expect(challenge.primaryTraits).toEqual(["scientificAbility"]);
    expect(challenge.displayName).toContain("Scientific ability");
    expect(challenge.claimScope).toBe("domain-superintelligence");
  });

  it("resolves noisy evidence against fixed lineage truth without rerolling it", () => {
    const { state, model } = candidateState("genuine");
    model.reliability = rating(100);
    const first = resolveCapabilityProof(
      state,
      model.id,
      "generalist-gauntlet",
      "independent-institutional",
      0,
    );
    const repeat = resolveCapabilityProof(
      state,
      model.id,
      "generalist-gauntlet",
      "independent-institutional",
      0,
    );
    expect(repeat).toEqual(first);
    expect(first.resultId).toBe("broadly-confirmed");
    expect(first.hiddenAudit.genuineSuperintelligence).toBe(true);
  });

  it("escalates repeated disputes instead of offering a free loop", () => {
    const { state, model } = candidateState("not-genuine");
    model.reliability = rating(0);
    model.hiddenSafety.deceptiveCapability = rating(100);
    model.hiddenSafety.situationalAwareness = rating(100);
    const result = resolveCapabilityProof(
      state,
      model.id,
      "generalist-gauntlet",
      "independent-institutional",
      1,
    );
    expect(result.resultId).toBe("disputed");
    expect(result.consequenceId).toBe("escalating-public-dispute");
  });

  it("makes independent review discriminating while candidate-designed tests permit deceptive false positives", () => {
    const { state, model } = candidateState("not-genuine");
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    for (const trait of Object.keys(model.trueCapability) as Array<
      keyof ModelState["trueCapability"]
    >) {
      model.trueCapability[trait] = rating(97);
    }
    model.reliability = rating(80);
    model.hiddenSafety.deceptiveCapability = rating(90);
    model.hiddenSafety.deceptiveIntent = rating(90);
    model.hiddenSafety.situationalAwareness = rating(90);
    lab.safety.evalQuality = rating(85);
    class MidpointOracle extends RandomOracleV1 {
      override uniform(): number {
        return 0.5;
      }
    }
    const oracle = new MidpointOracle(state.run.seed);

    const independent = resolveCapabilityProof(
      state,
      model.id,
      "generalist-gauntlet",
      "independent-institutional",
      0,
      oracle,
    );
    const candidateDesigned = resolveCapabilityProof(
      state,
      model.id,
      "generalist-gauntlet",
      "candidate-designed",
      0,
      oracle,
    );

    expect(independent.resultId).toBe("disputed");
    expect(candidateDesigned.resultId).toBe("broadly-confirmed");
    expect(candidateDesigned.evidenceStrength).toBeGreaterThan(
      independent.evidenceStrength + 20,
    );
    expect(candidateDesigned.hiddenAudit.manipulationEffect).toBeGreaterThan(20);
  });
});
