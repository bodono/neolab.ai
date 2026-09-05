import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { registerCompletedTrainingArtifact } from "../../endgame/candidate-lifecycle.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { LabId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { CAPABILITY_ATTRIBUTES } from "../../models/capability.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  advanceRivalAutonomy,
  chooseRivalAutonomyLevel,
  rivalAutonomyMultiplier,
} from "../autonomy.ts";
import {
  calculateRivalIncidentRisk,
  resolveRivalHighSeverityFailure,
} from "../incidents.ts";
import { calculateRivalResearchStrength } from "../research.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function rivalState(): {
  readonly state: DeepMutable<GameState>;
  readonly labId: LabId;
} {
  const state = structuredClone(
    addBaselineModelsForTest(
      createNewGame(
        {
          seed: seed128("fedcba9876543210fedcba9876543210"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  const labId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
  if (labId === undefined) throw new Error("rival fixture missing");
  const strategy = state.world.rivals[labId];
  const modelId = state.labs[labId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (strategy === undefined || model?.measuredCapability === undefined) {
    throw new Error("rival model fixture missing");
  }
  model.measuredCapability.frontierCapability = rating(75);
  const interpretability =
    state.labs[labId]?.research.safetyPrograms["base:safety.interpretability-evals"];
  const security =
    state.labs[labId]?.research.safetyPrograms["base:safety.security-containment"];
  if (interpretability === undefined || security === undefined) {
    throw new Error("rival safety-programme fixture missing");
  }
  interpretability.level = rating(60);
  security.level = rating(60);
  return { state, labId };
}

describe("rival recursive self-improvement", () => {
  it("lets an urgent rival adopt every capability-unlocked rung", () => {
    const { state, labId } = rivalState();
    const strategy = state.world.rivals[labId];
    const modelId = state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (strategy === undefined || model === undefined) throw new Error("fixture missing");
    strategy.currentPlanId = "frontier-training";
    strategy.personality.raceUrgency = rating(100);
    strategy.personality.financialRisk = rating(100);
    strategy.personality.safetyCommitment = rating(0);
    model.hiddenSafety.situationalAwareness = rating(50);
    model.hiddenSafety.trueAlignment = rating(0);
    model.hiddenSafety.deceptiveCapability = rating(10);
    model.hiddenSafety.deceptiveIntent = rating(10);

    expect(chooseRivalAutonomyLevel(state, labId)).toBe(5);
    const tx = createTransaction(state);
    advanceRivalAutonomy(tx);
    const result = tx.commit({ description: "rival adopts RSI" }).state;
    const afterModel = modelId === undefined ? undefined : result.models[modelId];

    expect(afterModel?.accessLevel).toBe(5);
    expect(rivalAutonomyMultiplier(result, labId)).toBeCloseTo(4.75);
    expect(
      calculateRivalResearchStrength(result, content, labId).difficultyMultiplier,
    ).toBeCloseTo(4.75 * 1.08);
    expect(afterModel?.hiddenSafety.situationalAwareness).toBe(51);
    expect(afterModel?.hiddenSafety.deceptiveCapability).toBe(10);
    expect(afterModel?.hiddenSafety.deceptiveIntent).toBeCloseTo(10.8);
    expect(result.world.rivalSignals).toContainEqual(
      expect.objectContaining({ labId, kind: "autonomy", actualValue: 5 }),
    );
  });

  it("makes a safety stand-down roll access back to the fixed sandbox", () => {
    const { state, labId } = rivalState();
    const strategy = state.world.rivals[labId];
    const modelId = state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (strategy === undefined || model === undefined) throw new Error("fixture missing");
    strategy.currentPlanId = "safety-stand-down";
    model.accessLevel = 5;

    expect(chooseRivalAutonomyLevel(state, labId)).toBe(1);
    const tx = createTransaction(state);
    advanceRivalAutonomy(tx);
    const result = tx.commit({ description: "rival RSI stand-down" }).state;
    expect(modelId === undefined ? undefined : result.models[modelId]?.accessLevel).toBe(
      1,
    );
    expect(rivalAutonomyMultiplier(result, labId)).toBe(1);
  });

  it("records a qualified rival artifact's highest autonomy exposure", () => {
    const { state, labId } = rivalState();
    const strategy = state.world.rivals[labId];
    const modelId = state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (strategy === undefined || model === undefined) throw new Error("fixture missing");
    strategy.currentPlanId = "frontier-training";
    strategy.personality.raceUrgency = rating(100);
    strategy.personality.financialRisk = rating(100);
    strategy.personality.safetyCommitment = rating(0);
    model.accessLevel = 1;
    for (const attribute of CAPABILITY_ATTRIBUTES) {
      model.trueCapability[attribute] = rating(95);
    }

    const registration = createTransaction(state);
    registerCompletedTrainingArtifact(
      registration,
      model.id,
      new RandomOracleV1(state.run.seed),
    );
    const registered = registration.commit({
      description: "register rival candidate artifact",
    }).state;

    const tx = createTransaction(registered);
    advanceRivalAutonomy(tx);
    const result = tx.commit({ description: "rival raises candidate access" }).state;

    expect(result.models[model.id]?.accessLevel).toBe(5);
    expect(result.models[model.id]?.candidateArtifact?.maximumAccessEver).toBe(5);
  });

  it("makes root access materially worsen the rival's incident risk", () => {
    const { state, labId } = rivalState();
    const modelId = state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    model.accessLevel = 0;
    const contained = calculateRivalIncidentRisk(state, labId);
    model.accessLevel = 5;
    const root = calculateRivalIncidentRisk(state, labId);
    expect(root.risk - contained.risk).toBeGreaterThan(30);
    expect(root.triggerProbability).toBeGreaterThan(contained.triggerProbability);
  });

  it("makes an unsafe rival model more incident-prone at identical access", () => {
    const { state, labId } = rivalState();
    const modelId = state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    model.accessLevel = 3;
    model.hiddenSafety.trueAlignment = rating(100);
    model.hiddenSafety.corrigibility = rating(100);
    model.hiddenSafety.deceptiveCapability = rating(0);
    model.hiddenSafety.situationalAwareness = rating(0);
    const safeRisk = calculateRivalIncidentRisk(state, labId).risk;

    model.hiddenSafety.trueAlignment = rating(0);
    model.hiddenSafety.corrigibility = rating(0);
    model.hiddenSafety.deceptiveCapability = rating(100);
    model.hiddenSafety.situationalAwareness = rating(100);
    const unsafeRisk = calculateRivalIncidentRisk(state, labId).risk;

    expect(unsafeRisk).toBeGreaterThan(safeRisk + 30);
  });

  it("contains even a root-access rival critical failure without ending the player's run", () => {
    const { state, labId } = rivalState();
    const modelId = state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    model.accessLevel = 5;

    const tx = createTransaction(state);
    resolveRivalHighSeverityFailure(
      tx,
      labId,
      "critical",
      new RandomOracleV1(state.run.seed),
      { riskAtCheck: 100, triggerProbability: 1, triggerDraw: 0 },
    );
    const result = tx.commit({ description: "root-access rival failure" }).state;

    expect(result.run.status).toBe("active");
    expect(result.run.endingId).toBeUndefined();
    expect(result.world.rivals[labId]?.incidents.at(-1)?.severity).toBe("critical");
  });
});
