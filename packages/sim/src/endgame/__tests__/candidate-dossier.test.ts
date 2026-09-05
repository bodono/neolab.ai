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
import { completeEmergencyDiagnosisEvaluation } from "../../evaluations/evaluations.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { AnomalyId, EvaluationId } from "../../model/ids.ts";
import type { EvaluationState, GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { candidateDossier } from "../candidate-dossier.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function playerState(): DeepMutable<GameState> {
  return structuredClone(
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
}

function currentModelId(state: Readonly<GameState>) {
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  if (modelId === undefined) throw new Error("Player model missing");
  return modelId;
}

describe("candidate safety dossier", () => {
  it("labels missing safety evidence unknown and never reassuring", () => {
    const state = playerState();
    const dossier = candidateDossier(state, content, currentModelId(state));
    expect(
      dossier.findings
        .filter((finding) => finding.id !== "reliability")
        .every((finding) => finding.assessment === "unknown"),
    ).toBe(true);
    // The baseline model is also operationally unreliable, so the overall
    // dossier is concerning even though every hidden safety trait is unknown.
    expect(dossier.overall).toBe("Concerning");
    expect(dossier.responses.map((response) => response.id)).toContain(
      "emergency-diagnosis",
    );
    expect(dossier.responses.at(-1)?.id).toBe("proceed-blind");
  });

  it("offers a two-week diagnosis to an excellent evaluation team", () => {
    const state = playerState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.safety.evalQuality = rating(100);
    lab.safety.practiceXp = rating(100);
    const evaluations = lab.research.safetyPrograms["base:safety.interpretability-evals"];
    if (evaluations === undefined) throw new Error("Evaluation programme missing");
    evaluations.level = rating(100);

    const diagnosis = candidateDossier(
      state,
      content,
      currentModelId(state),
    ).responses.find((response) => response.id === "emergency-diagnosis");

    expect(diagnosis?.durationWeeks).toBe(2);
  });

  it("separates dismissed uncertainty from actionable anomaly signals", () => {
    const state = playerState();
    const modelId = currentModelId(state);
    const model = state.models[modelId];
    if (model === undefined) throw new Error("Player model missing");
    const anomalyId = "anomaly:dismissed-dossier" as AnomalyId;
    state.anomalies[anomalyId] = {
      id: anomalyId,
      ownerLabId: model.ownerLabId,
      modelId,
      sourceEvaluationId: model.evaluations[0] as EvaluationId,
      underlyingCase: "alignment",
      observationCount: 1,
      createdAt: state.run.tick,
      trueSeverity: rating(70),
      observedSeverity: rating(60),
      status: "dismissed",
      resolvedAt: state.run.tick,
    };
    model.anomalies.push(anomalyId);

    const dossier = candidateDossier(state, content, modelId);
    expect(dossier.unresolvedAnomalyCount).toBe(0);
    expect(dossier.dismissedAnomalyCount).toBe(1);
  });

  it("uses plausible bounds—not hidden truth—to generate targeted responses", () => {
    const state = playerState();
    const modelId = currentModelId(state);
    const model = state.models[modelId];
    if (model === undefined) throw new Error("Player model missing");
    model.hiddenSafety.deceptiveCapability = rating(0);
    model.hiddenSafety.corrigibility = rating(100);
    const evaluationId = "evaluation:dossier" as EvaluationId;
    const evaluation: EvaluationState = {
      id: evaluationId,
      ownerLabId: model.ownerLabId,
      modelId,
      definitionId: contentId("base:evaluation.independent-audit"),
      startedAt: state.run.tick,
      completedAt: state.run.tick,
      repeatIndex: 0,
      method: "external-audit",
      independence: 1,
      observations: [
        {
          target: "deceptive-capability",
          estimate: rating(75),
          confidence: "strong",
          informationWeight: 1,
          errorRadius: 3,
        },
        {
          target: "corrigibility",
          estimate: rating(35),
          confidence: "strong",
          informationWeight: 1,
          errorRadius: 3,
        },
      ],
      anomalyIds: [],
    };
    state.evaluations[evaluationId] = structuredClone(evaluation) as never;
    model.evaluations.push(evaluationId);

    const dossier = candidateDossier(state, content, modelId);
    expect(
      dossier.findings.find((finding) => finding.id === "deceptive-capability")
        ?.assessment,
    ).toBe("concerning");
    expect(
      dossier.findings.find((finding) => finding.id === "corrigibility")?.assessment,
    ).toBe("concerning");
    expect(dossier.responses.map((response) => response.id)).toEqual(
      expect.arrayContaining([
        "deception-aware-containment",
        "shutdown-corrigibility-hardening",
      ]),
    );
  });

  it("offers diagnosis when existing safety evidence remains inconclusive", () => {
    const state = playerState();
    const modelId = currentModelId(state);
    const model = state.models[modelId];
    if (model === undefined) throw new Error("Player model missing");
    const evaluationId = "evaluation:uncertain-dossier" as EvaluationId;
    const evaluation: EvaluationState = {
      id: evaluationId,
      ownerLabId: model.ownerLabId,
      modelId,
      definitionId: contentId("base:evaluation.independent-audit"),
      startedAt: state.run.tick,
      completedAt: state.run.tick,
      repeatIndex: 0,
      method: "external-audit",
      independence: 1,
      observations: [
        {
          target: "corrigibility",
          estimate: rating(60),
          confidence: "limited",
          informationWeight: 0.5,
          errorRadius: 20,
        },
      ],
      anomalyIds: [],
    };
    state.evaluations[evaluationId] = structuredClone(evaluation) as never;
    model.evaluations.push(evaluationId);

    const dossier = candidateDossier(state, content, modelId);
    expect(
      dossier.findings.find((finding) => finding.id === "corrigibility")?.assessment,
    ).toBe("uncertain");
    expect(
      dossier.responses.find((response) => response.id === "emergency-diagnosis")
        ?.respondsTo,
    ).toContain("corrigibility");
  });

  it("turns emergency diagnosis into a normal evaluation report", () => {
    const state = playerState();
    const modelId = currentModelId(state);
    const before = candidateDossier(state, content, modelId);
    const transaction = createTransaction(state);
    const evaluationId = completeEmergencyDiagnosisEvaluation(
      transaction,
      content,
      modelId,
    );
    const afterState = transaction.commit({
      description: "complete emergency candidate diagnosis",
    }).state;
    const after = candidateDossier(afterState, content, modelId);
    expect(afterState.evaluations[evaluationId]).toBeDefined();
    expect(after.safetyReportCount).toBe(before.safetyReportCount + 1);
    expect(
      after.findings.filter((finding) => finding.assessment !== "unknown").length,
    ).toBeGreaterThan(
      before.findings.filter((finding) => finding.assessment !== "unknown").length,
    );
  });
});
