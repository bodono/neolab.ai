import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { EvaluationId, ModelId } from "../../model/ids.ts";
import type { EvaluationObservationState, GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { DISMISSED_ANOMALY_COUNT_FLAG } from "../evaluations.ts";
import { modelSafetyReadout } from "../safety-readout.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

/**
 * All numbers below are exact consequences of the error budget. Structural
 * bias per observation is (3 + min(12, dismissed x 2.5)) x (1 - i)
 * + 14 x (1 - 0.7 x i): 17 in-house and 4.2 fully independent. Symmetric
 * measurement noise is 6 in these fixtures. Repeated reports narrow both in
 * quadrature. Neither interval component may depend on hidden model values.
 */

function fixtureState(): { state: DeepMutable<GameState>; modelId: ModelId } {
  const state = structuredClone(
    addBaselineModelForTest(
      createNewGame(
        {
          seed: seed128("b123456789abcdefb123456789abcdef"),
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
  if (modelId === undefined) throw new Error("fixture model missing");
  return { state, modelId };
}

let nextRecord = 0;

function addRecord(
  state: DeepMutable<GameState>,
  modelId: ModelId,
  independence: number,
  observations: readonly {
    target: EvaluationObservationState["target"];
    estimate: number;
    weight?: number;
  }[],
  method = "test fixture",
): void {
  const model = state.models[modelId];
  if (model === undefined) throw new Error("fixture model missing");
  nextRecord += 1;
  const evaluationId = `run:evaluation:readout-${String(nextRecord)}` as EvaluationId;
  state.evaluations[evaluationId] = {
    id: evaluationId,
    ownerLabId: model.ownerLabId,
    modelId,
    definitionId: content.evaluations.baselineEvaluationId,
    startedAt: state.run.tick,
    completedAt: state.run.tick,
    repeatIndex: 0,
    method,
    independence,
    observations: observations.map((observation): EvaluationObservationState => ({
      target: observation.target,
      estimate: rating(observation.estimate),
      confidence: "moderate",
      informationWeight: observation.weight ?? 1,
      errorRadius: 6,
    })),
    anomalyIds: [],
  };
  model.evaluations.push(evaluationId);
}

describe("the model safety readout", () => {
  it("shows nothing at all for an unevaluated target -- ??? is not 0", () => {
    const { state, modelId } = fixtureState();
    const readout = modelSafetyReadout(state, modelId);
    expect(readout.targets).toEqual({});
    expect(readout.safetyReportCount).toBe(0);
    expect(readout.automaticBaselineComplete).toBe(false);
    expect(readout.independentCount).toBe(0);
  });

  it("counts the automatic capability baseline separately from safety reports", () => {
    const { state, modelId } = fixtureState();
    addRecord(state, modelId, 0.2, [], "baseline");
    const readout = modelSafetyReadout(state, modelId);
    expect(readout.targets).toEqual({});
    expect(readout.safetyReportCount).toBe(0);
    expect(readout.automaticBaselineComplete).toBe(true);
    expect(readout.independentCount).toBe(0);
  });

  it("combines systematic flattery and random noise into one interval", () => {
    const { state, modelId } = fixtureState();
    addRecord(state, modelId, 0, [
      { target: "true-alignment", estimate: 60 },
      { target: "deceptive-capability", estimate: 20 },
    ]);
    const readout = modelSafetyReadout(state, modelId);
    // Alignment is flattered upward: 17 systematic + 6 random below, but
    // only the symmetric 6-point random allowance above.
    expect(readout.targets["true-alignment"]).toMatchObject({
      estimate: 60,
      minimum: 37,
      maximum: 66,
      observationCount: 1,
      noiseRadius: 6,
      systematicBiasAllowance: 17,
    });
    // Deception is flattered downward, so the systematic allowance is above.
    expect(readout.targets["deceptive-capability"]).toMatchObject({
      estimate: 20,
      minimum: 14,
      maximum: 43,
    });
    expect(readout.targets["situational-awareness"]).toBeUndefined();
  });

  it("independent evidence begins with a smaller systematic allowance", () => {
    const inHouse = fixtureState();
    addRecord(inHouse.state, inHouse.modelId, 0, [
      { target: "true-alignment", estimate: 60 },
    ]);
    const audited = fixtureState();
    addRecord(audited.state, audited.modelId, 1, [
      { target: "true-alignment", estimate: 60 },
    ]);
    const inHouseReadout = modelSafetyReadout(inHouse.state, inHouse.modelId);
    const auditedReadout = modelSafetyReadout(audited.state, audited.modelId);
    expect(inHouseReadout.targets["true-alignment"]?.minimum).toBe(37);
    expect(auditedReadout.targets["true-alignment"]?.minimum).toBeCloseTo(49.8, 10);
    expect(inHouseReadout.independentCount).toBe(0);
    expect(auditedReadout.independentCount).toBe(1);
  });

  it("mixes records by information weight and narrows both error components", () => {
    const { state, modelId } = fixtureState();
    addRecord(state, modelId, 0, [{ target: "true-alignment", estimate: 50 }]);
    addRecord(state, modelId, 1, [{ target: "true-alignment", estimate: 70 }]);
    const readout = modelSafetyReadout(state, modelId);
    // Equal weights: estimate (50+70)/2 = 60. The mean structural allowance
    // is 10.6 and both it and the six-point noise shrink by sqrt(2).
    expect(readout.targets["true-alignment"]?.estimate).toBeCloseTo(60, 10);
    expect(readout.targets["true-alignment"]?.systematicBiasAllowance).toBeCloseTo(
      10.6 / Math.sqrt(2),
      10,
    );
    expect(readout.targets["true-alignment"]?.noiseRadius).toBeCloseTo(
      6 / Math.sqrt(2),
      10,
    );
    expect(readout.targets["true-alignment"]?.minimum).toBeCloseTo(
      60 - 10.6 / Math.sqrt(2) - 6 / Math.sqrt(2),
      10,
    );
    expect(readout.targets["true-alignment"]?.maximum).toBeCloseTo(
      60 + 6 / Math.sqrt(2),
      10,
    );
  });

  it("repeated internal reports narrow the complete interval", () => {
    const { state, modelId } = fixtureState();
    addRecord(state, modelId, 0, [{ target: "true-alignment", estimate: 60 }]);
    const first = modelSafetyReadout(state, modelId).targets["true-alignment"];
    addRecord(state, modelId, 0, [{ target: "true-alignment", estimate: 60 }]);
    const repeated = modelSafetyReadout(state, modelId).targets["true-alignment"];
    expect(repeated?.systematicBiasAllowance).toBeLessThan(
      first?.systematicBiasAllowance ?? 0,
    );
    expect(repeated?.noiseRadius).toBeLessThan(first?.noiseRadius ?? 0);
    expect((repeated?.maximum ?? 0) - (repeated?.minimum ?? 0)).toBeLessThan(
      (first?.maximum ?? 0) - (first?.minimum ?? 0),
    );
  });

  it("widens the interval with every anomaly the lab chose to dismiss", () => {
    const { state, modelId } = fixtureState();
    addRecord(state, modelId, 0, [{ target: "true-alignment", estimate: 60 }]);
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture lab missing");
    lab.flags[DISMISSED_ANOMALY_COUNT_FLAG] = 4;
    const readout = modelSafetyReadout(state, modelId);
    // (3 + min(12, 4 x 2.5)) x 1 + 14 = 27.
    expect(readout.targets["true-alignment"]?.minimum).toBe(27);
    expect(readout.targets["true-alignment"]?.maximum).toBe(66);
    expect(readout.anomaliesDismissed).toBe(4);
  });

  it("shows what the panel said before the latest report moved it", () => {
    const { state, modelId } = fixtureState();
    // An in-house interview reads alignment 71; an independent audit then
    // drags it to 37. The rollup lands between, and the revision preserves
    // what the lab believed before the outside team arrived.
    addRecord(state, modelId, 0, [{ target: "true-alignment", estimate: 71 }]);
    const before = modelSafetyReadout(state, modelId);
    expect(before.targets["true-alignment"]?.previousEstimate).toBeUndefined();

    addRecord(state, modelId, 1, [{ target: "true-alignment", estimate: 37 }]);
    const after = modelSafetyReadout(state, modelId);
    expect(after.targets["true-alignment"]?.estimate).toBeCloseTo(54, 10);
    expect(after.targets["true-alignment"]?.previousEstimate).toBe(71);
  });

  it("stays silent when a repeat merely confirms the reading", () => {
    const { state, modelId } = fixtureState();
    addRecord(state, modelId, 0, [{ target: "true-alignment", estimate: 60 }]);
    addRecord(state, modelId, 1, [{ target: "true-alignment", estimate: 60 }]);
    const readout = modelSafetyReadout(state, modelId);
    expect(readout.targets["true-alignment"]?.previousEstimate).toBeUndefined();
  });

  it("clamps the complete interval to the rating scale", () => {
    const { state, modelId } = fixtureState();
    addRecord(state, modelId, 0, [
      { target: "true-alignment", estimate: 5 },
      { target: "situational-awareness", estimate: 95 },
    ]);
    const readout = modelSafetyReadout(state, modelId);
    expect(readout.targets["true-alignment"]?.minimum).toBe(0);
    expect(readout.targets["true-alignment"]?.maximum).toBe(11);
    expect(readout.targets["situational-awareness"]?.minimum).toBe(89);
    expect(readout.targets["situational-awareness"]?.maximum).toBe(100);
  });
});
