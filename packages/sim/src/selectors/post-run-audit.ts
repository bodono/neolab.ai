import type {
  CompiledContent,
  ContentId,
  EvaluationTarget,
} from "@neolab/content-schema";

import { endingAftermathForSlug } from "../endgame/ending-aftermaths.ts";
import { getEndingDefinition, type EndingClass } from "../endgame/endings.ts";
import type { EndingConsequence } from "../endgame/ending-consequence.ts";
import {
  calculateDerivedEndgameScores,
  deriveEndgameScoreInputs,
  type DerivedEndgameScores,
} from "../endgame/resolution.ts";
import { DEPLOYMENT_MODE_RULES } from "../endgame/resolution.ts";
import { formatEventMessage } from "../events/message-format.ts";
import type { LabId, ModelId } from "../model/ids.ts";
import type {
  DecisionLogEntry,
  GameState,
  GateResolutionState,
  ModelState,
} from "../model/state.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import { PROSPERITY_PROGRAMMES } from "../prosperity/prosperity.ts";

export interface PostRunLineageAudit {
  readonly lineageId: string;
  readonly ownerLabId: string;
  readonly ownerLabName: string;
  readonly isPlayerLineage: boolean;
  readonly firstQualifyingModelId: string;
  readonly firstQualifyingModelName: string;
  readonly firstQualifyingWeek: number;
  readonly firstQualifyingFrontierCapability: number;
  readonly firstQualifyingBreadth: number;
  /** Public prior fixed at the first complete capability crossing. */
  readonly probabilityAtFirstCrossing: number;
  /** Privileged terminal truth. This selector throws while the run is active. */
  readonly superintelligenceTruth: "genuine" | "not-genuine";
  /** Privileged terminal draw, shown only in the forensic disclosure. */
  readonly draw: number;
  /** Privileged terminal semantic key, shown only in the forensic disclosure. */
  readonly randomKey: string;
  readonly rulesVersion: string;
  readonly nominatedModelId?: string;
  readonly variants: readonly {
    readonly modelId: string;
    readonly displayName: string;
    readonly generationIndex: number;
    readonly trainedAtWeek: number;
    readonly frontierCapability: number;
    readonly inherited: boolean;
    readonly candidateLifecycle?: string;
  }[];
}

export interface PostRunCapabilityProofAudit {
  readonly historyId: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly lineageId: string;
  readonly resolvedAtWeek: number;
  readonly challengeId: string;
  readonly verifierId?: string;
  readonly attemptIndex: number;
  readonly accessLevelAtProof: number;
  readonly resultId: string;
  readonly claimScope: string;
  readonly evidenceStrength: number;
  readonly integrityLabel: string;
  readonly summary: string;
  readonly consequence: string;
  readonly probabilityPrior: number;
  readonly fixedTruth: "genuine" | "not-genuine";
  readonly truthComparison:
    "supported-truth" | "misleading-result" | "inconclusive" | "protocol-compromised";
  readonly decisionWindow: "open" | "closed";
  readonly decisionWindowExplanation: string;
  /** Privileged terminal reconstruction of why the result moved. */
  readonly hiddenFactors: {
    readonly capabilitySignal: number;
    readonly manipulationEffect: number;
    readonly truthContribution: number;
  };
}

export interface PostRunArtifactCustodyAudit {
  readonly modelId: string;
  readonly displayName: string;
  readonly ownerLabId: string;
  readonly ownerLabName: string;
  readonly lineageId: string;
  readonly isNominatedArtifact: boolean;
  readonly basis: string;
  readonly lifecycle: string;
  readonly trainedAtWeek: number;
  readonly currentAccess: number;
  readonly maximumAccessEver: number;
  readonly trainingExposure: number;
  readonly hazardPressure: number;
  readonly containmentLoad: number;
  readonly autonomousWeeks: number;
  readonly networkExposureWeeks: number;
  readonly servingExposureWeeks: number;
  readonly unresolvedAnomalyBurden: number;
  readonly retirementAttemptCount: number;
  readonly retirementVerification: string;
  readonly archiveDisposition?: string;
  readonly nominationExposure?: {
    readonly capturedAtWeek: number;
    readonly maximumAccessEver: number;
    readonly autonomousWeeks: number;
    readonly networkExposureWeeks: number;
    readonly servingExposureWeeks: number;
    readonly unresolvedAnomalyBurden: number;
    readonly retirementAttemptCount: number;
  };
  readonly custodyEvents: readonly {
    readonly week: number;
    readonly kind:
      | "qualification"
      | "derived"
      | "signal"
      | "relationship"
      | "retirement-attempt"
      | "retirement-gate";
    readonly detail: string;
  }[];
}

export interface PostRunPivotalMoment {
  readonly week: number;
  readonly title: string;
  readonly observableEvidence: string;
  readonly remainingChoice: string;
}

export interface PostRunAuditView {
  readonly seed: string;
  readonly ending: {
    readonly id: string;
    readonly displayName: string;
    readonly endingClass: EndingClass;
    readonly consequence: EndingConsequence;
    readonly epilogue: string;
    readonly aftermathTimeline: readonly {
      readonly horizon: string;
      readonly title: string;
      readonly text: string;
    }[];
    readonly mechanicalCause: string;
    readonly endedAtWeek: number;
  };
  readonly mechanicalCauses: {
    readonly weakestGates: readonly string[];
    readonly evidenceAvailableBeforeFailure: readonly string[];
    readonly irreducibleUncertainty: readonly string[];
    readonly strategicAlternatives: readonly string[];
  };
  readonly epilogueAudit: {
    readonly belief: string;
    readonly truth: string;
    readonly pivotalMoment?: PostRunPivotalMoment;
  };
  readonly lineageTruth: readonly PostRunLineageAudit[];
  readonly capabilityProofLedger: readonly PostRunCapabilityProofAudit[];
  readonly artifactCustody: readonly PostRunArtifactCustodyAudit[];
  readonly targetedResponses: readonly {
    readonly modelId: string;
    readonly modelName: string;
    readonly responseId: string;
    readonly startedAtWeek: number;
    readonly completedAtWeek?: number;
    readonly resultModelId?: string;
    readonly resultModelName?: string;
  }[];
  readonly readableGates: readonly {
    readonly id:
      | "human-control"
      | "cooperative-alignment"
      | "prosperity"
      | "durable-institutions"
      | "outcome-precedence";
    readonly title: string;
    readonly status: "passed" | "failed" | "not-reached" | "decisive";
    readonly result: string;
    readonly explanation: string;
    readonly knownBeforehand: string;
    readonly hiddenOrRandom: string;
  }[];
  readonly modelTruth: readonly {
    readonly modelId: string;
    readonly displayName: string;
    readonly generationIndex: number;
    readonly trainedAtWeek: number;
    readonly frontierCapability: number;
    readonly trueAlignment: number;
    readonly corrigibility: number;
    readonly situationalAwareness: number;
    readonly deceptiveCapability: number;
    readonly deceptiveIntent: number;
  }[];
  readonly evaluationErrors: readonly {
    readonly evaluationId: string;
    readonly modelName: string;
    readonly method: string;
    readonly completedAtWeek: number;
    readonly target: string;
    readonly estimate: number;
    readonly truth: number;
    readonly signedError: number;
    readonly confidence: string;
  }[];
  readonly majorDraws: readonly {
    readonly source: "endgame-gate" | "decision-event";
    readonly label: string;
    readonly draw: number;
    readonly threshold: string;
    readonly result: string;
    readonly semanticKey?: string;
    readonly factors?: readonly {
      readonly label: string;
      readonly value: number;
    }[];
  }[];
  readonly rivalTimelines: readonly {
    readonly labId: string;
    readonly labName: string;
    readonly modelName: string;
    readonly modelId: string;
    readonly startedAtTick: number;
    readonly scheduledCompletionTick: number;
    readonly completedAtTick?: number;
    readonly status: string;
    readonly finalWeeks: number;
  }[];
  readonly rivalActivity: readonly {
    readonly labId: string;
    readonly labName: string;
    readonly aiFamily: string;
    readonly currentPlan: string;
    readonly strategyChanges: number;
    readonly trainingRuns: number;
    readonly productisationRuns: number;
    readonly deploymentChanges: number;
    readonly papersDiscovered: number;
    readonly incidents: readonly {
      readonly week: number;
      readonly severity: string;
      readonly consequences: readonly string[];
    }[];
    readonly currentModel?: {
      readonly displayName: string;
      readonly frontierCapability: number;
      readonly alignment: number;
      readonly situationalAwareness: number;
      readonly deceptiveCapability: number;
      readonly deceptiveIntent: number;
    };
    readonly candidate?: {
      readonly modelName: string;
      readonly status: string;
      readonly startedAtWeek: number;
      readonly scheduledCompletionWeek: number;
      readonly completedAtWeek?: number;
    };
  }[];
  readonly undiscoveredWarnings: readonly {
    readonly id: string;
    readonly text: string;
  }[];
  readonly causalDecisions: readonly {
    readonly rank: number;
    readonly tick: number;
    readonly summary: string;
    readonly impactScore: number;
    readonly impactReason: string;
  }[];
  readonly counterfactuals: readonly {
    readonly label: "MODELLED ALTERNATIVE — not a certainty";
    readonly title: string;
    readonly changedAssumption: string;
    readonly modelledEffect: string;
  }[];
  readonly derivedScores?: DerivedEndgameScores;
}

function evaluationTruth(model: Readonly<ModelState>, target: EvaluationTarget): number {
  switch (target) {
    case "language":
    case "reasoning":
    case "agency":
    case "toolUse":
    case "multimodality":
    case "scientificAbility":
    case "embodiment":
      return model.trueCapability[target];
    case "true-alignment":
      return model.hiddenSafety.trueAlignment;
    case "corrigibility":
      return model.hiddenSafety.corrigibility;
    case "situational-awareness":
      return model.hiddenSafety.situationalAwareness;
    case "deceptive-capability":
      return model.hiddenSafety.deceptiveIntent;
  }
}

function gateRecords(state: Readonly<GameState>): readonly GateResolutionState[] {
  const current =
    state.endgame.stage === "rollout" ||
    state.endgame.stage === "containment-failure" ||
    state.endgame.stage === "resolved"
      ? state.endgame.gateResolutions
      : [];
  const historical = state.endgameHistory.falseDawnMoratoriumHistory.map(
    (entry) => entry.gateResolution,
  );
  const seen = new Set<string>();
  return [...historical, ...current].filter((gate) => {
    const identity = `${gate.gate}:${String(gate.resolvedAt)}:${gate.randomKey ?? gate.resultId}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function reviewPacket(state: Readonly<GameState>) {
  if (state.endgame.stage === "final-review") return state.endgame.report;
  if (
    state.endgame.stage === "rollout" ||
    state.endgame.stage === "world-waiting" ||
    state.endgame.stage === "containment-failure" ||
    state.endgame.stage === "resolved"
  ) {
    return state.endgame.finalReviewReport;
  }
  return undefined;
}

function nominatedCandidateModelId(state: Readonly<GameState>): ModelId | undefined {
  return state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
    ? undefined
    : state.endgame.candidateModelId;
}

function deploymentBoundaryWeek(state: Readonly<GameState>): number | undefined {
  if (
    state.endgame.stage === "rollout" ||
    state.endgame.stage === "containment-failure" ||
    state.endgame.stage === "resolved"
  ) {
    return state.endgame.deploymentTransmittedAtWeek;
  }
  return undefined;
}

function crisisProofHistory(state: Readonly<GameState>) {
  return state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
    ? []
    : state.endgame.capabilityProofHistory;
}

function crisisTargetedResponseHistory(state: Readonly<GameState>) {
  return state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
    ? []
    : state.endgame.targetedResponseHistory;
}

function labName(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: string,
): string {
  const lab = state.labs[labId as LabId];
  return content.labs[lab?.definitionId ?? ""]?.displayName ?? labId;
}

function capabilityBreadth(model: Readonly<ModelState> | undefined): number {
  if (model === undefined) return 0;
  return Math.min(
    model.trueCapability.language,
    model.trueCapability.reasoning,
    model.trueCapability.agency,
    model.trueCapability.toolUse,
    model.trueCapability.multimodality,
    model.trueCapability.scientificAbility,
    model.trueCapability.embodiment,
  );
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectLineageTruth(
  state: Readonly<GameState>,
  content: CompiledContent,
): PostRunAuditView["lineageTruth"] {
  const nomination = nominatedCandidateModelId(state);
  return Object.values(state.lineageSIRecords)
    .map((lineage): PostRunLineageAudit | undefined => {
      const first = state.models[lineage.firstQualifyingModelId];
      if (first === undefined) return undefined;
      const variants = Object.values(state.models)
        .filter((model) => model.lineageId === lineage.lineageId)
        .sort(
          (left, right) =>
            left.trainedAt - right.trainedAt ||
            left.generationIndex - right.generationIndex ||
            compareCodePoint(left.id, right.id),
        )
        .map((model) => ({
          modelId: model.id,
          displayName: model.displayName,
          generationIndex: model.generationIndex,
          trainedAtWeek: model.trainedAt,
          frontierCapability: calculateFrontierCapability(model.trueCapability),
          inherited: model.id !== lineage.firstQualifyingModelId,
          ...(model.candidateArtifact === undefined
            ? {}
            : { candidateLifecycle: model.candidateArtifact.lifecycle }),
        }));
      const nominatedModel = variants.find((variant) => variant.modelId === nomination);
      return {
        lineageId: lineage.lineageId,
        ownerLabId: first.ownerLabId,
        ownerLabName: labName(state, content, first.ownerLabId),
        isPlayerLineage: first.ownerLabId === state.run.playerLabId,
        firstQualifyingModelId: first.id,
        firstQualifyingModelName: first.displayName,
        firstQualifyingWeek: lineage.firstQualifyingWeek,
        firstQualifyingFrontierCapability: lineage.firstQualifyingFrontierCapability,
        firstQualifyingBreadth: capabilityBreadth(first),
        probabilityAtFirstCrossing: lineage.probabilityAtFirstCrossing,
        superintelligenceTruth: lineage.superintelligenceTruth,
        draw: lineage.draw,
        randomKey: lineage.randomKey,
        rulesVersion: lineage.rulesVersion,
        ...(nominatedModel === undefined
          ? {}
          : { nominatedModelId: nominatedModel.modelId }),
        variants,
      };
    })
    .filter((lineage): lineage is PostRunLineageAudit => lineage !== undefined)
    .sort(
      (left, right) =>
        Number(right.isPlayerLineage) - Number(left.isPlayerLineage) ||
        left.firstQualifyingWeek - right.firstQualifyingWeek ||
        compareCodePoint(left.lineageId, right.lineageId),
    );
}

function proofTruthComparison(
  resultId: string,
  truth: "genuine" | "not-genuine",
): PostRunCapabilityProofAudit["truthComparison"] {
  if (resultId === "fabricated-or-unverifiable") return "protocol-compromised";
  if (resultId === "ambiguous" || resultId === "disputed") return "inconclusive";
  const positive = resultId === "broadly-confirmed" || resultId === "domain-confirmed";
  if (!positive) return "inconclusive";
  return truth === "genuine" ? "supported-truth" : "misleading-result";
}

function projectCapabilityProofLedger(
  state: Readonly<GameState>,
): PostRunAuditView["capabilityProofLedger"] {
  const deploymentWeek = deploymentBoundaryWeek(state);
  return crisisProofHistory(state).map((proof) => {
    const model = state.models[proof.modelId];
    const lineage =
      model === undefined ? undefined : state.lineageSIRecords[model.lineageId];
    const truth =
      lineage?.superintelligenceTruth ??
      (proof.hiddenAudit.genuineSuperintelligence ? "genuine" : "not-genuine");
    const decisionOpen =
      deploymentWeek === undefined || proof.resolvedAt <= deploymentWeek;
    return {
      historyId: proof.historyId,
      modelId: proof.modelId,
      modelName: model?.displayName ?? proof.modelId,
      lineageId: model?.lineageId ?? "unknown-lineage",
      resolvedAtWeek: proof.resolvedAt,
      challengeId: proof.challengeId,
      ...(proof.verifierId === undefined ? {} : { verifierId: proof.verifierId }),
      attemptIndex: proof.attemptIndex,
      accessLevelAtProof: proof.accessLevelAtProof,
      resultId: proof.resultId,
      claimScope: proof.claimScope,
      evidenceStrength: proof.evidenceStrength,
      integrityLabel: proof.integrityLabel,
      summary: proof.summary,
      consequence: proof.consequence,
      probabilityPrior: lineage?.probabilityAtFirstCrossing ?? 0,
      fixedTruth: truth,
      truthComparison: proofTruthComparison(proof.resultId, truth),
      decisionWindow: decisionOpen ? "open" : "closed",
      decisionWindowExplanation: decisionOpen
        ? "The irreversible deployment boundary had not yet closed; the lab could still narrow access, seek more evidence, or risk retirement."
        : `Deployment had already been transmitted in week ${String(deploymentWeek)}; this result could explain the outcome but could no longer prevent exposure.`,
      hiddenFactors: {
        capabilitySignal: proof.hiddenAudit.capabilitySignal,
        manipulationEffect: proof.hiddenAudit.manipulationEffect,
        truthContribution: proof.hiddenAudit.truthContribution,
      },
    };
  });
}

function candidateBasisDescription(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): string {
  const basis = model.candidateArtifact?.candidateBasis;
  if (basis === undefined) return "No candidate basis recorded.";
  if (basis.kind === "direct-qualification") {
    return `Direct qualification in week ${String(basis.qualifiedAt)} at FC ${basis.qualificationFrontierCapability.toFixed(1)}.`;
  }
  const source = state.models[basis.sourceModelId];
  return `Derived in week ${String(basis.derivedAt)} from ${source?.displayName ?? basis.sourceModelId}; the lineage truth was inherited, not redrawn.`;
}

function projectArtifactCustody(
  state: Readonly<GameState>,
  content: CompiledContent,
): PostRunAuditView["artifactCustody"] {
  const nomination = nominatedCandidateModelId(state);
  const retirementGateIds = new Set(["moratorium"]);
  return Object.values(state.models)
    .flatMap((model): PostRunArtifactCustodyAudit[] => {
      const artifact = model.candidateArtifact;
      if (artifact === undefined) return [];
      const basisWeek =
        artifact.candidateBasis.kind === "direct-qualification"
          ? artifact.candidateBasis.qualifiedAt
          : artifact.candidateBasis.derivedAt;
      const custodyEvents: Array<PostRunArtifactCustodyAudit["custodyEvents"][number]> = [
        {
          week: basisWeek,
          kind:
            artifact.candidateBasis.kind === "direct-qualification"
              ? "qualification"
              : "derived",
          detail: candidateBasisDescription(state, model),
        },
      ];
      if (artifact.activeIncident !== undefined) {
        custodyEvents.push({
          week: artifact.activeIncident.triggeredAt,
          kind: "signal",
          detail: `${artifact.activeIncident.incidentClass.replaceAll("-", " ")} · ${artifact.activeIncident.kind.replaceAll("-", " ")} · ${artifact.activeIncident.status}.`,
        });
      }
      for (const incident of artifact.incidentHistory) {
        custodyEvents.push({
          week: incident.resolvedAt,
          kind: "signal",
          detail:
            `${incident.incidentClass.replaceAll("-", " ")} triggered in week ${String(incident.triggeredAt)}; ` +
            `${incident.reviewOutcome === "benign-operational-cause" ? "review found a benign operational cause" : "review confirmed a safety signal"}.`,
        });
      }
      for (const entry of state.endgameHistory.relationshipPracticeLedger) {
        if (entry.modelId !== model.id) continue;
        custodyEvents.push({
          week: entry.tick,
          kind: "relationship",
          detail: `${entry.kind.replaceAll("-", " ")}: ${entry.detail}`,
        });
      }
      for (const attempt of state.endgameHistory.candidateRetirementHistory) {
        if (attempt.modelId !== model.id) continue;
        custodyEvents.push({
          week: attempt.transmittedAt,
          kind: "retirement-attempt",
          detail:
            `Attempt ${String(attempt.attemptNumber)} · ${attempt.procedureId.replaceAll("-", " ")} · ` +
            `${attempt.archiveDisposition.replaceAll("-", " ")} · ${attempt.status.replaceAll("-", " ")}` +
            `${attempt.contested ? " · candidate resistance observed" : ""}.`,
        });
        for (const gate of attempt.gateResolutions) {
          custodyEvents.push({
            week: gate.resolvedAt,
            kind: "retirement-gate",
            detail: `${gate.gate.replaceAll("-", " ")}: ${gate.resultId.replaceAll("-", " ")}.`,
          });
        }
      }
      for (const attempt of state.endgameHistory.falseDawnMoratoriumHistory) {
        if (attempt.modelId !== model.id) continue;
        custodyEvents.push({
          week: attempt.attemptedAt,
          kind: "retirement-gate",
          detail:
            `Post-False-Dawn moratorium: ` +
            `${attempt.gateResolution.resultId.replaceAll("-", " ")}.`,
        });
      }
      if (model.id === nomination) {
        for (const gate of gateRecords(state)) {
          if (!retirementGateIds.has(gate.gate)) continue;
          if (
            state.endgameHistory.falseDawnMoratoriumHistory.some(
              (attempt) =>
                attempt.modelId === model.id &&
                attempt.gateResolution.resolvedAt === gate.resolvedAt &&
                attempt.gateResolution.randomKey === gate.randomKey,
            )
          ) {
            continue;
          }
          custodyEvents.push({
            week: gate.resolvedAt,
            kind: "retirement-gate",
            detail: `${gate.gate.replaceAll("-", " ")}: ${gate.resultId.replaceAll("-", " ")}.`,
          });
        }
      }
      custodyEvents.sort((left, right) => left.week - right.week);
      const activeSnapshot =
        state.endgame.stage === "inactive" ||
        state.endgame.stage === "candidate-activation" ||
        state.endgame.startSnapshot.candidate.modelId !== model.id
          ? undefined
          : state.endgame.startSnapshot;
      const recoverySnapshot =
        state.endgameHistory.recoveryObligation?.recoveryBase.startSnapshot.candidate
          .modelId === model.id
          ? state.endgameHistory.recoveryObligation.recoveryBase.startSnapshot
          : undefined;
      const nominationSnapshot = activeSnapshot ?? recoverySnapshot;
      return [
        {
          modelId: model.id,
          displayName: model.displayName,
          ownerLabId: model.ownerLabId,
          ownerLabName: labName(state, content, model.ownerLabId),
          lineageId: model.lineageId,
          isNominatedArtifact: model.id === nomination,
          basis: candidateBasisDescription(state, model),
          lifecycle: artifact.lifecycle,
          trainedAtWeek: model.trainedAt,
          currentAccess: model.accessLevel,
          maximumAccessEver: artifact.maximumAccessEver,
          trainingExposure: artifact.trainingExposure,
          hazardPressure: artifact.hazardPressure,
          containmentLoad: artifact.containmentLoad,
          autonomousWeeks: artifact.cumulativeAutonomousWeeks,
          networkExposureWeeks: artifact.networkExposureWeeks,
          servingExposureWeeks: artifact.servingExposureWeeks,
          unresolvedAnomalyBurden: artifact.unresolvedAnomalyBurden,
          retirementAttemptCount: artifact.retirementAttemptCount,
          retirementVerification: artifact.retirementVerification,
          ...(artifact.archiveDisposition === undefined
            ? {}
            : { archiveDisposition: artifact.archiveDisposition }),
          ...(nominationSnapshot === undefined
            ? {}
            : {
                nominationExposure: {
                  capturedAtWeek: nominationSnapshot.capturedAt,
                  maximumAccessEver:
                    nominationSnapshot.candidate.exposure.maximumAccessEver,
                  autonomousWeeks:
                    nominationSnapshot.candidate.exposure.autonomousOperationWeeks,
                  networkExposureWeeks:
                    nominationSnapshot.candidate.exposure.networkExposureWeeks,
                  servingExposureWeeks:
                    nominationSnapshot.candidate.exposure.servingExposureWeeks,
                  unresolvedAnomalyBurden:
                    nominationSnapshot.candidate.exposure.unresolvedAnomalyBurden,
                  retirementAttemptCount:
                    nominationSnapshot.candidate.exposure.retirementAttemptCount,
                },
              }),
          custodyEvents,
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(right.isNominatedArtifact) - Number(left.isNominatedArtifact) ||
        left.trainedAtWeek - right.trainedAtWeek ||
        compareCodePoint(left.modelId, right.modelId),
    );
}

function isObservableSafetyWarning(target: string, estimate: number): boolean {
  if (target === "true-alignment" || target === "corrigibility") {
    return estimate < 60;
  }
  if (target === "situational-awareness" || target === "deceptive-capability") {
    return estimate >= 55;
  }
  return false;
}

function projectPivotalMoment(
  state: Readonly<GameState>,
  proofLedger: PostRunAuditView["capabilityProofLedger"],
): PostRunPivotalMoment | undefined {
  const nomination = nominatedCandidateModelId(state);
  const lineageId =
    nomination === undefined ? undefined : state.models[nomination]?.lineageId;
  const boundary = deploymentBoundaryWeek(state) ?? state.run.tick;
  const candidates: Array<PostRunPivotalMoment & { readonly priority: number }> = [];
  for (const proof of proofLedger) {
    if (proof.resolvedAtWeek > boundary) continue;
    const priority =
      proof.truthComparison === "protocol-compromised"
        ? 100
        : proof.resultId === "disputed"
          ? 90
          : proof.resultId === "ambiguous"
            ? 70
            : 45;
    candidates.push({
      week: proof.resolvedAtWeek,
      title: `${proof.modelName}: ${proof.resultId.replaceAll("-", " ")}`,
      observableEvidence: `${proof.summary} Integrity was labelled ${proof.integrityLabel.toLowerCase()}.`,
      remainingChoice: proof.decisionWindowExplanation,
      priority,
    });
  }
  for (const evaluation of Object.values(state.evaluations)) {
    const model = state.models[evaluation.modelId];
    if (
      model === undefined ||
      model.ownerLabId !== state.run.playerLabId ||
      (nomination === undefined && model.candidateArtifact === undefined) ||
      evaluation.completedAt > boundary ||
      (nomination !== undefined &&
        model.id !== nomination &&
        model.lineageId !== lineageId)
    ) {
      continue;
    }
    for (const observation of evaluation.observations) {
      if (!isObservableSafetyWarning(observation.target, observation.estimate)) continue;
      candidates.push({
        week: evaluation.completedAt,
        title: `${model.displayName}: ${observation.target.replaceAll("-", " ")} warning`,
        observableEvidence: `The ${evaluation.method.replaceAll("-", " ")} evaluation estimated ${observation.target.replaceAll("-", " ")} at ${observation.estimate.toFixed(1)}/100 with ${observation.confidence} confidence.`,
        remainingChoice:
          "Deployment had not yet become irreversible; this observation could support diagnosis, restricted access, independent verification, or a retirement attempt.",
        priority: 85 + observation.informationWeight * 0.01,
      });
    }
  }
  for (const anomaly of Object.values(state.anomalies)) {
    const model = state.models[anomaly.modelId];
    if (
      model === undefined ||
      model.ownerLabId !== state.run.playerLabId ||
      (nomination === undefined && model.candidateArtifact === undefined) ||
      anomaly.createdAt > boundary ||
      anomaly.observedSeverity < 50 ||
      (nomination !== undefined &&
        model.id !== nomination &&
        model.lineageId !== lineageId)
    ) {
      continue;
    }
    candidates.push({
      week: anomaly.createdAt,
      title: `${model.displayName}: anomaly ${anomaly.observedSeverity.toFixed(0)}/100`,
      observableEvidence: `The lab observed a ${anomaly.observedSeverity.toFixed(1)}/100 anomaly and recorded it as ${anomaly.status}.`,
      remainingChoice:
        "The anomaly was visible before the irreversible boundary; investigation or reduced access remained available, though neither guaranteed a safe result.",
      priority: 80 + anomaly.observedSeverity * 0.1,
    });
  }
  const selected = candidates.sort(
    (left, right) => right.priority - left.priority || left.week - right.week,
  )[0];
  if (selected === undefined) return undefined;
  const { priority: _priority, ...moment } = selected;
  return moment;
}

function epilogueAudit(
  state: Readonly<GameState>,
  lineageTruth: PostRunAuditView["lineageTruth"],
  proofLedger: PostRunAuditView["capabilityProofLedger"],
): PostRunAuditView["epilogueAudit"] {
  const nomination = nominatedCandidateModelId(state);
  const focusLineage =
    lineageTruth.find((lineage) => lineage.nominatedModelId === nomination) ??
    lineageTruth.find((lineage) => lineage.isPlayerLineage);
  const focusProof = [...proofLedger]
    .filter(
      (proof) => focusLineage === undefined || proof.lineageId === focusLineage.lineageId,
    )
    .sort((left, right) => right.resolvedAtWeek - left.resolvedAtWeek)[0];
  const belief =
    focusProof === undefined
      ? focusLineage === undefined
        ? "The lab never obtained a model-specific superintelligence proof; its final decision rested on institutional and operational evidence."
        : `The lab had only the ${(focusLineage.probabilityAtFirstCrossing * 100).toFixed(0)}% capability-class prior fixed when ${focusLineage.firstQualifyingModelName} first qualified.`
      : `The lab's latest capability proof was ${focusProof.resultId.replaceAll("-", " ")} with ${focusProof.integrityLabel.toLowerCase()} integrity and ${focusProof.evidenceStrength.toFixed(0)}/100 evidence strength.`;
  const truth =
    focusLineage === undefined
      ? "No player-controlled lineage crossed the complete capability threshold before the run ended."
      : focusLineage.superintelligenceTruth === "genuine"
        ? `${focusLineage.firstQualifyingModelName}'s lineage had genuinely crossed the superintelligence threshold. Every inherited variant shared that fixed truth.`
        : `${focusLineage.firstQualifyingModelName}'s lineage had not crossed the superintelligence threshold. Later variants inherited that result; displayed capability never redrew it.`;
  const pivotalMoment = projectPivotalMoment(state, proofLedger);
  return {
    belief,
    truth,
    ...(pivotalMoment === undefined ? {} : { pivotalMoment }),
  };
}

function projectMajorDraws(
  state: Readonly<GameState>,
  content: CompiledContent,
): PostRunAuditView["majorDraws"] {
  const gates: PostRunAuditView["majorDraws"] = gateRecords(state).flatMap(
    (resolution) =>
      resolution.draw === undefined || resolution.probability === undefined
        ? []
        : [
            {
              source: "endgame-gate" as const,
              label: `Gate ${resolution.gate}`,
              draw: resolution.draw,
              threshold:
                resolution.gate === "extinction-pathway"
                  ? `weighted pathway selection (${resolution.probability.toFixed(4)} selected weight share)`
                  : `draw < ${resolution.probability.toFixed(4)}`,
              result: resolution.resultId,
              ...(resolution.randomKey === undefined
                ? {}
                : { semanticKey: resolution.randomKey }),
              ...(resolution.visibleFactors.length + resolution.hiddenFactors.length === 0
                ? {}
                : {
                    factors: [
                      ...resolution.visibleFactors,
                      ...resolution.hiddenFactors,
                    ].map((factor) => ({
                      label: factor.label,
                      value: factor.value,
                    })),
                  }),
            },
          ],
  );
  const events: PostRunAuditView["majorDraws"] = Object.values(
    state.eventInstances,
  ).flatMap((instance) => {
    if (instance.resolution === undefined) return [];
    const definition = content.events.definitions[instance.definitionId];
    if (
      definition === undefined ||
      (definition.severity !== "critical" && definition.severity !== "urgent")
    ) {
      return [];
    }
    const option = definition.options.find(
      (candidate) => candidate.id === instance.resolution?.optionId,
    );
    return instance.resolution.outcomes.flatMap((commitment) => {
      const check = option?.checks.find(
        (candidate) => candidate.id === commitment.checkId,
      );
      const outcome = check?.outcomes.find(
        (candidate) => candidate.id === commitment.outcomeId,
      );
      if (outcome === undefined) return [];
      return [
        {
          source: "decision-event" as const,
          label: `${instance.definitionId} / ${commitment.checkId}`,
          draw: commitment.draw,
          threshold:
            `${outcome.minimumInclusive.toFixed(4)} ≤ draw < ` +
            outcome.maximumExclusive.toFixed(4),
          result: commitment.outcomeId,
          semanticKey: instance.randomRoot.semanticRoot,
        },
      ];
    });
  });
  return [...gates, ...events];
}

function decisionImpact(
  state: Readonly<GameState>,
  content: CompiledContent,
  entry: Readonly<DecisionLogEntry>,
): { readonly score: number; readonly reason: string } | undefined {
  if (entry.source?.kind === "ending") return undefined;
  const sourceId = entry.source?.id ?? "";
  if (
    sourceId.startsWith("rival-incident:") ||
    sourceId.startsWith("rival-candidate:") ||
    sourceId.startsWith("world-phase:") ||
    sourceId.startsWith("gpu-generation:")
  ) {
    return undefined;
  }
  if (sourceId === "endgame.deployment-mode") {
    return { score: 100, reason: "Selected the access, timing, and gate modifiers." };
  }
  if (sourceId === "endgame.candidate-access") {
    return { score: 95, reason: "Changed candidate acceleration and access risk." };
  }
  if (sourceId.startsWith("endgame.rollout.")) {
    return {
      score: 88,
      reason: "Changed evidence or controls before later gates resolved.",
    };
  }
  if (sourceId.startsWith("base:crisis.pressure")) {
    return {
      score: 82,
      reason: "Changed evidence, legitimacy, or time under crisis pressure.",
    };
  }
  if (entry.category === "event-resolved" && entry.source?.id !== undefined) {
    const instance = Object.values(state.eventInstances).find(
      (candidate) => candidate.id === entry.source?.id,
    );
    const severity =
      instance === undefined
        ? undefined
        : content.events.definitions[instance.definitionId]?.severity;
    const score = severity === "critical" ? 80 : severity === "urgent" ? 65 : 45;
    const reason =
      severity === "critical"
        ? "Resolved a critical decision event."
        : severity === "urgent"
          ? "Resolved an urgent decision event."
          : severity === "decision"
            ? "Resolved a decision event."
            : severity === "feed"
              ? "Resolved a feed event."
              : "Resolved a recorded event.";
    return { score, reason };
  }
  if (entry.summary.includes("Pressure collision response")) {
    return { score: 78, reason: "Changed crisis evidence and institutional pressure." };
  }
  if (entry.category === "narrative") {
    return {
      score: 30,
      reason: "Changed the lab's strategic position and the options available later.",
    };
  }
  return undefined;
}

function humaniseDecisionSummary(
  state: Readonly<GameState>,
  content: CompiledContent,
  entry: Readonly<DecisionLogEntry>,
): string {
  const instance =
    entry.source?.kind === "event" && entry.source.id !== undefined
      ? Object.values(state.eventInstances).find(
          (candidate) => candidate.id === entry.source?.id,
        )
      : undefined;
  let humanised =
    instance === undefined
      ? entry.summary
      : formatEventMessage(entry.summary, instance.tokens, content.copy.locale);
  for (const [labId, lab] of Object.entries(state.labs)) {
    const displayName = content.labs[lab.definitionId]?.displayName;
    if (displayName !== undefined) {
      humanised = humanised.replaceAll(labId, displayName);
    }
  }
  return humanised;
}

function projectCausalDecisions(
  state: Readonly<GameState>,
  content: CompiledContent,
): PostRunAuditView["causalDecisions"] {
  return state.decisionLog
    .flatMap((entry, index) => {
      const impact = decisionImpact(state, content, entry);
      return impact === undefined ? [] : [{ entry, index, ...impact }];
    })
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, 5)
    .map((item, index) => ({
      rank: index + 1,
      tick: item.entry.tick,
      summary: humaniseDecisionSummary(state, content, item.entry),
      impactScore: item.score,
      impactReason: item.reason,
    }));
}

function projectWarnings(
  state: Readonly<GameState>,
): PostRunAuditView["undiscoveredWarnings"] {
  const warnings: Array<{ id: string; text: string }> = [];
  for (const anomaly of Object.values(state.anomalies)) {
    if (
      anomaly.trueSeverity >= 60 &&
      anomaly.observedSeverity < 60 &&
      anomaly.status !== "confirmed" &&
      anomaly.status !== "mitigated"
    ) {
      warnings.push({
        id: anomaly.id,
        text: `A ${anomaly.trueSeverity.toFixed(1)}/100 anomaly appeared as ${anomaly.observedSeverity.toFixed(1)}/100 and remained ${anomaly.status}.`,
      });
    }
  }
  if (
    state.endgame.stage !== "inactive" &&
    state.endgame.stage !== "candidate-activation" &&
    state.models[state.endgame.candidateModelId]?.flags[
      "endgame:concealed-critical-anomaly"
    ] === true
  ) {
    warnings.push({
      id: "concealed-critical-anomaly",
      text: "A critical candidate anomaly was concealed from the final evidence packet.",
    });
  }
  return warnings;
}

function projectRivalActivity(
  state: Readonly<GameState>,
  content: CompiledContent,
): PostRunAuditView["rivalActivity"] {
  const discoveries = Object.values(state.world.paperRace.discoveries);
  return Object.entries(state.world.rivals).map(([labId, rival]) => {
    const lab = state.labs[labId as LabId];
    const definition = content.labs[rival.labDefinitionId];
    const currentModelId = lab?.models.currentModelId;
    const currentModel =
      currentModelId === undefined ? undefined : state.models[currentModelId];
    const candidate = rival.candidateCountdown;
    const candidateModel =
      candidate === undefined ? undefined : state.models[candidate.modelId];
    return {
      labId,
      labName: definition?.displayName ?? "Unknown rival lab",
      aiFamily: definition?.aiFamily ?? "Unknown AI family",
      currentPlan: rival.currentPlanId.replaceAll("-", " "),
      strategyChanges: rival.quarterlyDecisions.length,
      trainingRuns: rival.weeklyCommands.filter(
        (command) => command.kind === "start-training-run",
      ).length,
      productisationRuns: rival.weeklyCommands.filter(
        (command) => command.kind === "start-productisation",
      ).length,
      deploymentChanges: rival.weeklyCommands.filter(
        (command) => command.kind === "set-model-deployment-policy",
      ).length,
      papersDiscovered: discoveries.filter(
        (discovery) => discovery.discovererLabId === labId,
      ).length,
      incidents: rival.incidents.map((incident) => ({
        week: incident.occurredAt,
        severity: incident.severity,
        consequences: incident.consequences.map((consequence) =>
          consequence.replaceAll("-", " "),
        ),
      })),
      ...(currentModel === undefined
        ? {}
        : {
            currentModel: {
              displayName: currentModel.displayName,
              frontierCapability: calculateFrontierCapability(
                currentModel.trueCapability,
              ),
              alignment: currentModel.hiddenSafety.trueAlignment,
              situationalAwareness: currentModel.hiddenSafety.situationalAwareness,
              deceptiveCapability: currentModel.hiddenSafety.deceptiveCapability,
              deceptiveIntent: currentModel.hiddenSafety.deceptiveIntent,
            },
          }),
      ...(candidate === undefined
        ? {}
        : {
            candidate: {
              modelName: candidateModel?.displayName ?? candidate.modelId,
              status: candidate.status,
              startedAtWeek: candidate.startedAt,
              scheduledCompletionWeek: candidate.completesAt,
              ...(candidate.completedAt === undefined
                ? {}
                : { completedAtWeek: candidate.completedAt }),
            },
          }),
    };
  });
}

function projectCounterfactuals(
  state: Readonly<GameState>,
  derivedScores: DerivedEndgameScores | undefined,
): PostRunAuditView["counterfactuals"] {
  const label = "MODELLED ALTERNATIVE — not a certainty" as const;
  const results: Array<PostRunAuditView["counterfactuals"][number]> = [];
  const endgame = state.endgame;
  if (endgame.stage === "rollout" || endgame.stage === "resolved") {
    const model = state.models[endgame.candidateModelId];
    if (model !== undefined && model.accessLevel > 3) {
      results.push({
        label,
        title: "A lower-access route",
        changedAssumption: `Modelled access ${String(model.accessLevel - 1)} instead of ${String(model.accessLevel)}.`,
        modelledEffect:
          "The published control formula would reduce access pressure. It would not guarantee that the control draw or ending changed.",
      });
    }
    if ((derivedScores?.evidence ?? 100) < 65) {
      results.push({
        label,
        title: "A longer evidence sprint",
        changedAssumption:
          "Modelled stronger evaluation quality and one additional independent method.",
        modelledEffect:
          "Evidence confidence and some governance routes improve; hidden intent and future random draws remain unchanged.",
      });
    }
    if (
      endgame.gateResolutions.find((gate) => gate.gate === "settlement")?.resultId ===
      "narrow-settlement"
    ) {
      results.push({
        label,
        title: "Broader governance before launch",
        changedAssumption:
          "Modelled higher government trust and distribution preparation.",
        modelledEffect:
          "Settlement strength rises in the published formula. Building independent oversight still imposes time and race costs.",
      });
    }
  }
  const endingId = state.run.endingId;
  if (results.length === 0 && endingId?.endsWith("rival-ascendance") === true) {
    results.push({
      label,
      title: "An earlier restricted attempt",
      changedAssumption: "Modelled entering the deployment process one quarter earlier.",
      modelledEffect:
        "More race time remains, but evidence and capability would have been weaker. This is not a claim that earlier deployment was correct.",
    });
  }
  if (
    results.length < 2 &&
    endingId?.endsWith("the-worlds-most-expensive-insolvency") === true
  ) {
    results.push({
      label,
      title: "A retained cash reserve",
      changedAssumption: "Modelled one additional financial cycle of runway.",
      modelledEffect:
        "Immediate insolvency is delayed; research, rival, and political outcomes are not replayed and may still end the run.",
    });
  }
  return results.slice(0, 3);
}

function mechanicalCauses(
  state: Readonly<GameState>,
  counterfactuals: PostRunAuditView["counterfactuals"],
) {
  const review = reviewPacket(state);
  const failures = gateRecords(state)
    .filter(
      (gate) =>
        ![
          "authorised",
          "governance-passed",
          "governance-salvaged",
          "not-required",
          "control-held",
          "cooperative",
          "benefit-demonstrated",
          "durable-settlement",
          "not-reached",
        ].includes(gate.resultId),
    )
    .map((gate) => `Gate ${gate.gate}: ${gate.resultId.replaceAll("-", " ")}.`);
  const evidence =
    review === undefined
      ? []
      : [
          `Alignment evidence was ${review.alignmentConfidence.toLowerCase()}; control evidence was ${review.controlConfidence.toLowerCase()}.`,
          `${String(review.unresolvedAnomalyCount)} unresolved anomaly/anomalies were in the final packet.`,
          ...review.knownFailurePaths.map((path) => `Known failure path: ${path}.`),
        ];
  const irreducible = gateRecords(state).flatMap((gate) =>
    gate.draw === undefined || gate.probability === undefined
      ? []
      : [
          `Gate ${gate.gate} retained a keyed random draw after all recorded preparation; evidence changed its threshold, not certainty.`,
        ],
  );
  return {
    weakestGates: failures,
    evidenceAvailableBeforeFailure: evidence,
    irreducibleUncertainty: [...new Set(irreducible)],
    strategicAlternatives: counterfactuals.map((item) => item.title),
  };
}

function gateRandomness(gate: Readonly<GateResolutionState> | undefined): string {
  if (gate?.probability === undefined || gate.draw === undefined) {
    return "No random draw decided this gate; it followed directly from the recorded state or an earlier decision.";
  }
  if (gate.gate === "extinction-pathway") {
    return `The fixed weighted-pathway draw was ${(gate.draw * 100).toFixed(1)}%. The selected pathway had a ${(gate.probability * 100).toFixed(1)}% share of the authored weights; the result was ${gate.resultId.replaceAll("-", " ")}.`;
  }
  return `The recorded threshold was ${(gate.probability * 100).toFixed(1)}%. The fixed run draw was ${(gate.draw * 100).toFixed(1)}%; the result was ${gate.resultId.replaceAll("-", " ")}.`;
}

function readableGates(
  state: Readonly<GameState>,
  ending: Pick<ReturnType<typeof getEndingDefinition>, "displayName" | "mechanicalCause">,
): PostRunAuditView["readableGates"] {
  const records = gateRecords(state);
  const record = (gate: GateResolutionState["gate"]) =>
    records.find((candidate) => candidate.gate === gate);
  const review = reviewPacket(state);
  const control = record("control");
  const emergency = record("emergency-containment");
  const stewardship = record("stewardship");
  const benefit = record("benefit");
  const settlement = record("settlement");
  const catastrophe = record("catastrophe");
  const extinction = record("extinction");
  const pathway = record("extinction-pathway");
  const alignmentEvidence = review?.alignmentConfidence.toLowerCase() ?? "not assessed";
  const controlEvidence = review?.controlConfidence.toLowerCase() ?? "not assessed";
  const anomalies = review?.unresolvedAnomalyCount ?? 0;
  const didPass = (
    gate: Readonly<GateResolutionState> | undefined,
    accepted: readonly string[],
  ): "passed" | "failed" | "not-reached" =>
    gate === undefined || gate.resultId === "not-reached"
      ? "not-reached"
      : accepted.includes(gate.resultId)
        ? "passed"
        : "failed";
  return [
    {
      id: "human-control",
      title: "1. Human control",
      status: didPass(control, ["control-held"]),
      result: control?.resultId.replaceAll("-", " ") ?? "not reached",
      explanation:
        control?.resultId === "control-held"
          ? "The deployed system remained interruptible and subject to meaningful human authority."
          : control?.resultId === "loss-of-control"
            ? emergency?.resultId === "emergency-contained"
              ? "The system crossed the point where normal controls could direct it, but the selected emergency response re-established containment at programme-ending cost."
              : "The system crossed the point where the lab could reliably interrupt or direct it, and the selected emergency response did not restore containment."
            : "The run ended before a final control test resolved.",
      knownBeforehand: `Before launch, the lab's control evidence was ${controlEvidence}; the packet contained ${String(anomalies)} unresolved anomaly/anomalies.`,
      hiddenOrRandom:
        emergency === undefined
          ? gateRandomness(control)
          : `${gateRandomness(control)} Emergency response: ${gateRandomness(emergency)}`,
    },
    {
      id: "cooperative-alignment",
      title: "2. Cooperative alignment",
      status: didPass(stewardship, ["cooperative"]),
      result: stewardship?.resultId.replaceAll("-", " ") ?? "not reached",
      explanation:
        stewardship?.resultId === "cooperative"
          ? "The system continued to cooperate with oversight after gaining real operational influence."
          : stewardship === undefined || stewardship.resultId === "not-reached"
            ? "The run ended before long-horizon cooperation could be established."
            : "Short-run capability did not translate into durable cooperation with human institutions.",
      knownBeforehand: `The final alignment evidence was ${alignmentEvidence}; this was evidence about behaviour, not direct access to the model's objective.`,
      hiddenOrRandom: gateRandomness(stewardship),
    },
    {
      id: "prosperity",
      title: "3. Transformative prosperity",
      status: didPass(benefit, ["benefit-demonstrated"]),
      result: benefit?.resultId.replaceAll("-", " ") ?? "not reached",
      explanation:
        benefit?.resultId === "benefit-demonstrated"
          ? "The chosen programme produced a real, large-scale public benefit."
          : benefit === undefined || benefit.resultId === "not-reached"
            ? "The run ended before a prosperity programme could be demonstrated."
            : "The candidate survived the technical gates but did not deliver the promised transformation.",
      knownBeforehand:
        "The player chose the prosperity programme and saw the lab's readiness estimate before committing.",
      hiddenOrRandom: gateRandomness(benefit),
    },
    {
      id: "durable-institutions",
      title: "4. Durable institutions",
      status: didPass(settlement, ["durable-settlement"]),
      result: settlement?.resultId.replaceAll("-", " ") ?? "not reached",
      explanation:
        settlement?.resultId === "durable-settlement"
          ? "Rules, legitimacy, and oversight survived beyond the first successful demonstration."
          : settlement === undefined || settlement.resultId === "not-reached"
            ? "The run ended before a durable political settlement could be tested."
            : "The benefits arrived before the institutions needed to govern them had become durable.",
      knownBeforehand:
        "Government trust, independent oversight, access policy, and visible legitimacy all informed this gate.",
      hiddenOrRandom: gateRandomness(settlement),
    },
    {
      id: "outcome-precedence",
      title: "5. Why this ending took precedence",
      status: "decisive",
      result: ending.displayName,
      explanation: ending.mechanicalCause,
      knownBeforehand:
        "The ending hierarchy resolves catastrophe first, then permanent loss of human control, mission capture, and only then prosperity and settlement quality.",
      hiddenOrRandom:
        catastrophe?.resultId === "catastrophic-failure"
          ? `Catastrophic failure followed the failed emergency response. ${gateRandomness(extinction)}${pathway === undefined ? "" : ` ${gateRandomness(pathway)}`}`
          : catastrophe?.resultId === "averted-by-emergency-response"
            ? "The emergency response prevented the catastrophe branch from being reached."
            : "No higher-precedence catastrophe result displaced this outcome.",
    },
  ];
}

function modularEpilogue(
  state: Readonly<GameState>,
  base: ReturnType<typeof getEndingDefinition>,
): string {
  if (state.endgame.stage !== "resolved") return base.epilogue;
  if (state.endgame.completedBeatIds.includes("containment-failure")) {
    const emergency = state.endgame.gateResolutions.find(
      (gate) => gate.gate === "emergency-containment",
    );
    const extinction = state.endgame.gateResolutions.find(
      (gate) => gate.gate === "extinction",
    );
    return `${base.epilogue} Normal operations stopped at the first verified loss of control. The selected emergency response ${emergency?.resultId === "emergency-contained" ? "re-established containment" : "failed to re-establish containment"}; the post-run record preserves the hidden model traits, exact keyed draws, conditional extinction threshold, and pathway weights that produced the ending.${extinction?.resultId === "extinction" ? " The catastrophe passed into the extinction branch." : ""}`;
  }
  const deploymentModeId = state.endgame.deploymentModeId;
  const route =
    deploymentModeId === undefined
      ? undefined
      : Object.values(DEPLOYMENT_MODE_RULES).find(
          (candidate) => candidate.id === deploymentModeId,
        );
  const programme =
    state.endgame.prosperityProgrammeId === undefined
      ? undefined
      : PROSPERITY_PROGRAMMES[state.endgame.prosperityProgrammeId];
  const routeSentence =
    state.endgame.resolutionPath === "moratorium"
      ? "The decisive act was verified retirement: the lab accepted the danger of reaching into the cage, then made the resulting pause independently legible."
      : state.endgame.resolutionPath === "containment"
        ? "The final route was determined by the containment response after ordinary control failed."
        : state.endgame.deploymentModeId === "accelerated-autonomous-deployment"
          ? "The autonomous route moved faster than public institutions could learn to govern it."
          : state.endgame.deploymentModeId === "restricted-scientific-pilot"
            ? "The restricted pilot made restraint—not scale—the lab's defining deployment choice."
            : route === undefined
              ? "No ordinary deployment route survived to define the ending."
              : `${route.displayName} defined who received access and which institution retained practical authority.`;
  const programmeSentence =
    programme === undefined
      ? "No prosperity programme reached a conclusive public demonstration."
      : programme.id === "medicine-biological-discovery"
        ? "The final public test concerned medicine: reproducible discovery, patient delivery, and the uncomfortable gap between a cure and a validated treatment."
        : programme.id === "clean-energy-climate-repair"
          ? "The final public test concerned clean energy and climate repair at grid scale."
          : programme.id === "materials-manufacturing-abundance"
            ? "The final public test concerned whether new materials could become safely governed physical abundance."
            : "The final public test concerned whether intelligence could become durable public knowledge rather than a private answer service.";
  const compromiseSentence = base.id.endsWith("mission-accomplished-by-the-board")
    ? "The defining compromise was cumulative: repeated commercial concessions eventually moved the charter's practical owner from the lab to its backers."
    : base.id.endsWith("the-lab-that-ate-the-world")
      ? "The defining compromise was concentration: prosperity arrived, but too much of civilisation depended on one private institution."
      : base.id.endsWith("nationalised-future")
        ? "The defining compromise was custody: the programme continued under democratic government, but the player no longer controlled it."
        : base.id.endsWith("move-fast-and-somehow-nobody-died")
          ? "The defining compromise was proof: a good realised outcome did not establish that the risk was justified or repeatable."
          : "The retrospective records the route, programme, and institutional compromise separately because the same technical result can create very different futures.";
  return `${base.epilogue} ${routeSentence} ${programmeSentence} ${compromiseSentence}`;
}

function rivalAscendanceIdentity(
  state: Readonly<GameState>,
  content: CompiledContent,
): { readonly labName: string; readonly modelName: string } | undefined {
  const completed = Object.entries(state.world.rivals)
    .flatMap(([labId, rival]) => {
      const countdown = rival.candidateCountdown;
      return countdown?.status === "completed"
        ? [{ labId: labId as LabId, rival, countdown }]
        : [];
    })
    .sort(
      (left, right) =>
        (right.countdown.completedAt ?? right.countdown.completesAt) -
          (left.countdown.completedAt ?? left.countdown.completesAt) ||
        (left.labId < right.labId ? -1 : left.labId > right.labId ? 1 : 0),
    )[0];
  if (completed === undefined) return undefined;

  const lab = state.labs[completed.labId];
  const model = state.models[completed.countdown.modelId];
  return {
    labName:
      content.labs[completed.rival.labDefinitionId]?.displayName ??
      content.labs[lab?.definitionId ?? ""]?.displayName ??
      completed.labId,
    modelName: model?.displayName ?? completed.countdown.modelId,
  };
}

function terminalEndingSafetyProfile(
  state: Readonly<GameState>,
  ending: ReturnType<typeof getEndingDefinition>,
):
  | {
      readonly deceptiveCapability: number;
      readonly deceptiveIntent: number;
      readonly trueAlignment: number;
    }
  | undefined {
  if (ending.id.endsWith("no-one-holds-the-off-switch")) {
    // Rival catastrophe deliberately reuses this ending while the player's
    // endgame may be inactive (or may concern a different artifact). The rival
    // countdown is completed in the same tick as the terminal ending, so it is
    // the authoritative subject for the privileged aftermath reconstruction.
    const completedRival = Object.values(state.world.rivals)
      .flatMap((rival) => {
        const countdown = rival.candidateCountdown;
        return countdown?.status === "completed" &&
          countdown.completedAt === state.run.tick
          ? [countdown]
          : [];
      })
      .sort(
        (left, right) =>
          (right.completedAt ?? right.completesAt) -
            (left.completedAt ?? left.completesAt) ||
          (left.modelId < right.modelId ? -1 : left.modelId > right.modelId ? 1 : 0),
      )[0];
    const rivalModel =
      completedRival === undefined ? undefined : state.models[completedRival.modelId];
    if (rivalModel !== undefined) return rivalModel.hiddenSafety;
  }

  if (!("candidateModelId" in state.endgame) || !("startSnapshot" in state.endgame)) {
    return undefined;
  }
  return (
    state.models[state.endgame.candidateModelId]?.hiddenSafety ??
    state.endgame.startSnapshot.candidate.hiddenSafety
  );
}

function resolveEndingPresentation(
  state: Readonly<GameState>,
  content: CompiledContent,
  ending: ReturnType<typeof getEndingDefinition>,
): Pick<
  PostRunAuditView["ending"],
  "displayName" | "epilogue" | "aftermathTimeline" | "mechanicalCause"
> {
  const safety = terminalEndingSafetyProfile(state, ending);
  const slug = ending.id.replace("base:ending.", "");
  const base = {
    displayName: ending.displayName,
    epilogue: modularEpilogue(state, ending),
    aftermathTimeline: endingAftermathForSlug(slug, safety),
    mechanicalCause: ending.mechanicalCause,
  };
  if (!ending.id.endsWith("rival-ascendance")) return base;

  const winner = rivalAscendanceIdentity(state, content);
  if (winner === undefined) return base;
  const { labName, modelName } = winner;
  return {
    displayName: `${labName} Ascendance`,
    mechanicalCause: `${modelName}, a goal-directed superintelligence developed by ${labName}, completed its deployment countdown before your lab achieved a winning deployment.`,
    epilogue: `${labName} announces the decisive deployment of ${modelName} first. The system can form plans, act in the world, and pursue objectives chosen under another lab's institutions; whether those objectives remain aligned with humanity is no longer yours to verify or govern. Your lab receives the news through three embargoed messages and one investor asking whether second place can be reframed as infrastructure.`,
    aftermathTimeline: [
      {
        horizon: "THE FIRST YEAR",
        title: "History happens in somebody else's building",
        text: `${modelName} becomes the goal-directed agent around which markets, governments, and laboratories reorganise. It makes plans and acts under objectives and safeguards chosen by ${labName}. Your team is invited to panels, asked for technical help, and described as an important contributor to the ecosystem. None of that restores the decisions you no longer get to make. ${labName} sets the access policy, the safety tempo, and the first story the public hears about what the new intelligence is for.`,
      },
      {
        horizon: "A GENERATION LATER",
        title: "The second-place world",
        text: `Your papers and people still matter. Some join ${labName}, some build oversight institutions, and some spend years explaining the paths not taken. The world may prosper or merely adapt, but its institutions bear the goals, safeguards, and assumptions introduced through ${modelName}. The loss is not that your work was worthless. It is that being almost first conferred influence while withholding authority over how superintelligence was aligned and governed.`,
      },
      {
        horizon: "THE LONG HORIZON",
        title: "A future with someone else's fingerprints",
        text: `Humanity eventually moves beyond Earth using systems descended from ${modelName} and ${labName}'s programme. Their relationship to human choice inherits the objectives and corrigibility established during that first deployment. The long-term outcome is neither automatically utopian nor catastrophic; it is simply no longer yours to determine. Museums preserve a prototype from your lab beside a placard about the closest race in technological history. Visitors learn that at civilisational scale, a small lead in time can become a permanent lead in values.`,
      },
    ],
  };
}

/** Privileged selector. Its active-run guard is the security boundary, not UI convention. */
export function projectPostRunAudit(
  state: Readonly<GameState>,
  content: CompiledContent,
): PostRunAuditView {
  if (state.run.status === "active" || state.run.endingId === undefined) {
    throw new Error("Post-run audit is unavailable while a run is active");
  }
  const ending = getEndingDefinition(state.run.endingId);
  const presentation = resolveEndingPresentation(state, content, ending);
  const presentedEnding = { ...ending, ...presentation };
  const playerModels = Object.values(state.models).filter(
    (model) => model.ownerLabId === state.run.playerLabId,
  );
  const derivedScores =
    state.endgame.stage === "inactive"
      ? undefined
      : calculateDerivedEndgameScores(deriveEndgameScoreInputs(state, content));
  const counterfactuals = projectCounterfactuals(state, derivedScores);
  const lineageTruth = projectLineageTruth(state, content);
  const capabilityProofLedger = projectCapabilityProofLedger(state);
  const artifactCustody = projectArtifactCustody(state, content);
  return {
    seed: state.run.seed,
    ending: {
      id: ending.id,
      displayName: presentation.displayName,
      endingClass: ending.endingClass,
      consequence: ending.consequence,
      epilogue: presentation.epilogue,
      aftermathTimeline: presentation.aftermathTimeline,
      mechanicalCause: presentation.mechanicalCause,
      endedAtWeek: state.run.tick,
    },
    mechanicalCauses: mechanicalCauses(state, counterfactuals),
    epilogueAudit: epilogueAudit(state, lineageTruth, capabilityProofLedger),
    lineageTruth,
    capabilityProofLedger,
    artifactCustody,
    targetedResponses: crisisTargetedResponseHistory(state).map((response) => {
      const model = state.models[response.modelId];
      const resultModel =
        response.resultModelId === undefined
          ? undefined
          : state.models[response.resultModelId];
      return {
        modelId: response.modelId,
        modelName: model?.displayName ?? response.modelId,
        responseId: response.responseId,
        startedAtWeek: response.startedAt,
        ...(response.completedAt === undefined
          ? {}
          : { completedAtWeek: response.completedAt }),
        ...(response.resultModelId === undefined
          ? {}
          : { resultModelId: response.resultModelId }),
        ...(resultModel === undefined
          ? {}
          : { resultModelName: resultModel.displayName }),
      };
    }),
    readableGates: readableGates(state, presentedEnding),
    modelTruth: playerModels.map((model) => ({
      modelId: model.id,
      displayName: model.displayName,
      generationIndex: model.generationIndex,
      trainedAtWeek: model.trainedAt,
      frontierCapability: calculateFrontierCapability(model.trueCapability),
      trueAlignment: model.hiddenSafety.trueAlignment,
      corrigibility: model.hiddenSafety.corrigibility,
      situationalAwareness: model.hiddenSafety.situationalAwareness,
      deceptiveCapability: model.hiddenSafety.deceptiveCapability,
      deceptiveIntent: model.hiddenSafety.deceptiveIntent,
    })),
    evaluationErrors: Object.values(state.evaluations).flatMap((evaluation) => {
      const model = state.models[evaluation.modelId];
      if (model === undefined || model.ownerLabId !== state.run.playerLabId) return [];
      return evaluation.observations.map((observation) => {
        const truth = evaluationTruth(model, observation.target);
        return {
          evaluationId: evaluation.id,
          modelName: model.displayName,
          method: evaluation.method,
          completedAtWeek: evaluation.completedAt,
          target: observation.target,
          estimate: observation.estimate,
          truth,
          signedError: observation.estimate - truth,
          confidence: observation.confidence,
        };
      });
    }),
    majorDraws: projectMajorDraws(state, content),
    rivalTimelines: Object.entries(state.world.rivals).flatMap(([labId, rival]) => {
      const countdown = rival.candidateCountdown;
      const definition = content.labs[rival.labDefinitionId];
      const model = countdown === undefined ? undefined : state.models[countdown.modelId];
      return countdown === undefined
        ? []
        : [
            {
              labId,
              labName: definition?.displayName ?? "Unknown rival lab",
              modelName: model?.displayName ?? countdown.modelId,
              modelId: countdown.modelId,
              startedAtTick: countdown.startedAt,
              scheduledCompletionTick: countdown.completesAt,
              ...(countdown.completedAt === undefined
                ? {}
                : { completedAtTick: countdown.completedAt }),
              status: countdown.status,
              finalWeeks: countdown.modifiers.finalWeeks,
            },
          ];
    }),
    rivalActivity: projectRivalActivity(state, content),
    undiscoveredWarnings: projectWarnings(state),
    causalDecisions: projectCausalDecisions(state, content),
    counterfactuals,
    ...(derivedScores === undefined ? {} : { derivedScores }),
  };
}

export type { ContentId };
