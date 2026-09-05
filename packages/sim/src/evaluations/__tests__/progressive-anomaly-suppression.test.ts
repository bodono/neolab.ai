import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import {
  createProgressiveNewGame,
  LAB_MATURITY_STAGE_FLAG,
} from "../../campaign/lab-maturity.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { ModelId, ProjectId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { cashMillions, gpuCount, rating } from "../../model/units.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  completeBaselineEvaluation,
  completeEvaluationProject,
  dismissAnomaly,
  startEvaluation,
} from "../evaluations.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

const alwaysDetectOracle: RandomOracle = {
  uniform: () => 0,
  integer: (_key, minimum) => minimum,
  triangular: () => 0,
  weighted: (_key, weights) => Object.keys(weights).sort()[0] as never,
  shuffle: (_key, values) => [...values],
};

function stateAt(stage: "safety" | "frontier"): DeepMutable<GameState> {
  const state = structuredClone(
    addBaselineModelForTest(
      createProgressiveNewGame(
        {
          seed: seed128("3a8c17d4ab1950ff3a8c17d4ab1950ff"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.sam-altmann"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined || lab.models.currentModelId === undefined) {
    throw new Error("progressive anomaly fixture is missing its player model");
  }
  lab.flags[LAB_MATURITY_STAGE_FLAG] = stage;
  state.presentationQueue = [];
  return state;
}

function completeBaseline(state: DeepMutable<GameState>): GameState {
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  if (modelId === undefined)
    throw new Error("progressive anomaly fixture lost its model");
  const tx = createTransaction(state);
  completeBaselineEvaluation(tx, content, modelId, alwaysDetectOracle);
  return tx.commit({ description: "complete deterministic baseline" }).state;
}

function completeSafetyRung(
  source: GameState,
  modelId: ModelId,
  definitionId: string,
  oracle: RandomOracle = alwaysDetectOracle,
): GameState {
  const state = structuredClone(source) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  const model = state.models[modelId];
  if (lab === undefined || model === undefined) throw new Error("fixture missing");
  lab.finance.cash = cashMillions(1_000_000);
  lab.aura.spendable = 1_000;
  lab.aura.lifetime = 1_000;
  for (const lot of lab.compute.lots) lot.physicalCount = gpuCount(100_000);

  const tx = createTransaction(state);
  const projectId: ProjectId = startEvaluation(tx, content, {
    labId: state.run.playerLabId,
    modelId,
    definitionId: contentId(definitionId),
  });
  tx.update((draft) => {
    const project = draft.projects[projectId];
    if (project === undefined) throw new Error("evaluation project missing");
    project.status = "active";
    project.startedAt = draft.run.tick;
    project.progress = 1;
  });
  completeEvaluationProject(tx, content, projectId, oracle);
  tx.update((draft) => {
    const project = draft.projects[projectId];
    if (project === undefined) throw new Error("evaluation project missing");
    project.status = "completed";
  });
  return tx.commit({ description: `complete ${definitionId}` }).state;
}

describe("progressive-opening evaluation anomalies", () => {
  it("records the baseline without creating a costly anomaly during the unlock chapters", () => {
    const result = completeBaseline(stateAt("safety"));
    const modelId = result.labs[result.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : result.models[modelId];
    const evaluation = Object.values(result.evaluations)[0];

    expect(evaluation).toBeDefined();
    expect(evaluation?.anomalyIds).toEqual([]);
    expect(model?.evaluations).toHaveLength(1);
    expect(model?.anomalies).toEqual([]);
    expect(Object.values(result.anomalies)).toEqual([]);
    expect(result.presentationQueue).not.toContainEqual(
      expect.objectContaining({ kind: "anomaly-detected" }),
    );
  });

  it("never turns the automatic capability baseline into a safety anomaly", () => {
    const result = completeBaseline(stateAt("frontier"));
    const modelId = result.labs[result.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : result.models[modelId];
    const evaluation = Object.values(result.evaluations)[0];

    expect(evaluation?.anomalyIds).toEqual([]);
    expect(model?.anomalies).toEqual([]);
    expect(Object.values(result.anomalies)).toEqual([]);
  });

  it("consolidates repeated observations of one hidden failure into one case", () => {
    const withBaseline = structuredClone(
      completeBaseline(stateAt("frontier")),
    ) as DeepMutable<GameState>;
    const modelId =
      withBaseline.labs[withBaseline.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : withBaseline.models[modelId];
    if (modelId === undefined || model === undefined) throw new Error("fixture missing");
    model.hiddenSafety.deceptiveIntent = rating(90);

    const afterInterview = completeSafetyRung(
      withBaseline,
      modelId,
      "base:evaluation.alignment-interview",
    );
    const afterRedTeam = completeSafetyRung(
      afterInterview,
      modelId,
      "base:evaluation.behavioural-red-team",
    );
    const anomalies = Object.values(afterRedTeam.anomalies);
    const safetyEvaluations = Object.values(afterRedTeam.evaluations).filter(
      (evaluation) => evaluation.method !== "baseline",
    );

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      underlyingCase: "deceptive-intent",
      observationCount: 2,
    });
    expect(
      new Set(safetyEvaluations.flatMap((evaluation) => evaluation.anomalyIds)).size,
    ).toBe(1);
    expect(afterRedTeam.models[modelId]?.anomalies).toHaveLength(1);
  });

  it.each([
    ["resolved", "unresolved"],
    ["dismissed", "unresolved"],
    ["mitigated", "confirmed"],
  ] as const)(
    "reopens a %s underlying case when a later evaluation reproduces it",
    (closedStatus, reopenedStatus) => {
      const withBaseline = structuredClone(
        completeBaseline(stateAt("frontier")),
      ) as DeepMutable<GameState>;
      const modelId =
        withBaseline.labs[withBaseline.run.playerLabId]?.models.currentModelId;
      const model = modelId === undefined ? undefined : withBaseline.models[modelId];
      if (modelId === undefined || model === undefined) {
        throw new Error("fixture missing");
      }
      model.hiddenSafety.deceptiveIntent = rating(90);

      const afterInterview = structuredClone(
        completeSafetyRung(withBaseline, modelId, "base:evaluation.alignment-interview"),
      ) as DeepMutable<GameState>;
      const anomalyId = afterInterview.models[modelId]?.anomalies[0];
      const anomaly =
        anomalyId === undefined ? undefined : afterInterview.anomalies[anomalyId];
      if (anomalyId === undefined || anomaly === undefined) {
        throw new Error("first observation did not create its case");
      }
      anomaly.status = closedStatus;
      anomaly.resolvedAt = afterInterview.run.tick;
      afterInterview.presentationQueue = [];

      const reproduced = completeSafetyRung(
        afterInterview,
        modelId,
        "base:evaluation.behavioural-red-team",
      );
      const redTeam = Object.values(reproduced.evaluations).find(
        (evaluation) =>
          evaluation.definitionId === contentId("base:evaluation.behavioural-red-team"),
      );

      expect(Object.values(reproduced.anomalies)).toHaveLength(1);
      expect(reproduced.models[modelId]?.anomalies).toEqual([anomalyId]);
      // The first report owns the stable case record. Reproduction references
      // that same case so the later evaluation cannot masquerade as clean.
      expect(redTeam?.anomalyIds).toEqual([anomalyId]);
      expect(reproduced.anomalies[anomalyId]).toMatchObject({
        status: reopenedStatus,
        underlyingCase: "deceptive-intent",
        observationCount: 2,
      });
      expect(reproduced.anomalies[anomalyId]?.resolvedAt).toBeUndefined();
    },
  );

  it("does not repeat institutional penalties when a dismissed case is reproduced and dismissed again", () => {
    const withBaseline = structuredClone(
      completeBaseline(stateAt("frontier")),
    ) as DeepMutable<GameState>;
    const modelId =
      withBaseline.labs[withBaseline.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : withBaseline.models[modelId];
    if (modelId === undefined || model === undefined) throw new Error("fixture missing");
    model.hiddenSafety.deceptiveIntent = rating(90);

    const afterInterview = completeSafetyRung(
      withBaseline,
      modelId,
      "base:evaluation.alignment-interview",
    );
    const anomalyId = afterInterview.models[modelId]?.anomalies[0];
    if (anomalyId === undefined) throw new Error("anomaly missing");
    const firstDismissal = createTransaction(afterInterview);
    dismissAnomaly(firstDismissal, anomalyId);
    const dismissed = firstDismissal.commit({ description: "dismiss case once" }).state;
    const dismissedLab = dismissed.labs[dismissed.run.playerLabId];
    const dismissedModel = dismissed.models[modelId];
    if (dismissedLab === undefined || dismissedModel === undefined) {
      throw new Error("dismissed fixture missing");
    }
    const firstPenalty = {
      culture: dismissedLab.safety.safetyCulture,
      candour: dismissedLab.organisation.hiddenInternalCandour,
      evidence: dismissedModel.deployment.evidencePenalty,
    };

    const reproduced = completeSafetyRung(
      dismissed,
      modelId,
      "base:evaluation.behavioural-red-team",
    );
    expect(reproduced.anomalies[anomalyId]?.status).toBe("unresolved");

    const secondDismissal = createTransaction(reproduced);
    dismissAnomaly(secondDismissal, anomalyId);
    const dismissedAgain = secondDismissal.commit({
      description: "dismiss reproduced case",
    }).state;

    expect(
      dismissedAgain.labs[dismissedAgain.run.playerLabId]?.safety.safetyCulture,
    ).toBe(firstPenalty.culture);
    expect(
      dismissedAgain.labs[dismissedAgain.run.playerLabId]?.organisation
        .hiddenInternalCandour,
    ).toBe(firstPenalty.candour);
    expect(dismissedAgain.models[modelId]?.deployment.evidencePenalty).toBe(
      firstPenalty.evidence,
    );
  });

  it("attributes observed severity to the selected underlying case", () => {
    const withBaseline = structuredClone(
      completeBaseline(stateAt("frontier")),
    ) as DeepMutable<GameState>;
    const modelId =
      withBaseline.labs[withBaseline.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : withBaseline.models[modelId];
    const lab = withBaseline.labs[withBaseline.run.playerLabId];
    if (modelId === undefined || model === undefined || lab === undefined) {
      throw new Error("fixture missing");
    }
    model.hiddenSafety.trueAlignment = rating(30);
    model.hiddenSafety.corrigibility = rating(50);
    model.hiddenSafety.situationalAwareness = rating(0);
    model.hiddenSafety.deceptiveCapability = rating(0);
    model.hiddenSafety.deceptiveIntent = rating(0);
    lab.organisation.hiddenInternalCandour = rating(50);
    const exaggerateCorrigibilityOracle: RandomOracle = {
      ...alwaysDetectOracle,
      triangular: (key, minimum) =>
        key.segments.includes("corrigibility") ? minimum : 0,
    };

    const evaluated = completeSafetyRung(
      withBaseline,
      modelId,
      "base:evaluation.alignment-interview",
      exaggerateCorrigibilityOracle,
    );
    const evaluation = Object.values(evaluated.evaluations).find(
      (record) =>
        record.definitionId === contentId("base:evaluation.alignment-interview"),
    );
    const anomalyId = evaluation?.anomalyIds[0];
    const anomaly = anomalyId === undefined ? undefined : evaluated.anomalies[anomalyId];
    const alignment = evaluation?.observations.find(
      (observation) => observation.target === "true-alignment",
    );
    const corrigibility = evaluation?.observations.find(
      (observation) => observation.target === "corrigibility",
    );
    if (anomaly === undefined || alignment === undefined || corrigibility === undefined) {
      throw new Error("evaluation evidence missing");
    }

    expect(anomaly.underlyingCase).toBe("alignment");
    expect(100 - corrigibility.estimate).toBeGreaterThan(100 - alignment.estimate);
    expect(anomaly.observedSeverity).toBe(100 - alignment.estimate);
  });
});
