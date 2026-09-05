import type { CompiledContent } from "@neolab/content-schema";

import { resolveCheck } from "../engine/checks.ts";
import type { DeepMutable } from "../engine/draft.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { awardScore } from "../engine/score.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { modelSafetyReadout } from "../evaluations/safety-readout.ts";
import type { ModelId, ModifierId } from "../model/ids.ts";
import type {
  CandidateArchiveDisposition,
  CandidateRecoveryObligationState,
  CrisisBaseState,
  CrisisEvidenceLedgerState,
  CrisisRecoveryState,
  CrisisRetirementAttemptState,
  CrisisStartSnapshotState,
  EndgameState,
  GameState,
  GateFactorContributionState,
  GateResolutionState,
  ModifierState,
  ModelState,
  RetirementProcedureId,
} from "../model/state.ts";
import { fraction, rating, tick } from "../model/units.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import { cancelProject } from "../projects/project-framework.ts";
import { describeRandomKey, randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import {
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";
import { enterContainmentFailure } from "./containment-failure.ts";
import {
  recoveryStateFromObligation,
  successorEfficiencyForArchiveDisposition,
} from "./archive-recovery.ts";
import { eligibleProgrammeCandidateModelIds } from "./candidate-programme.ts";
import { createAiCharacterState } from "./dialogue-registry.ts";
import {
  ENDING_DEFINITIONS,
  resolveTerminalEnding,
  resolveTerminalMoratoriumFromBase,
} from "./endings.ts";
import {
  MORATORIUM_NEGOTIATION_WEEKS,
  resolveDurableMoratoriumGate,
} from "./moratorium.ts";
import { advanceFalseDawnMoratoriumNegotiation } from "./nonterminal-outcome.ts";

const BASE_RECOVERY_WEEKS = 26;
const QUARANTINE_WEEKS = 13;
const CONTESTED_RECOVERY_WEEKS = 13;
const REPEAT_RETIREMENT_RECOVERY_WEEKS = 13;
const REPEAT_RETIREMENT_INTERVENTION = 10;

function shutdownEscapeReduction(
  procedureId: RetirementProcedureId,
  archiveDisposition: CandidateArchiveDisposition,
): number {
  if (procedureId === "immediate-hard-cut") {
    // Surprise is the hard cut's one mechanical advantage. It is strongest
    // when the lab intends to retain material whose orderly movement would
    // otherwise give the candidate time to anticipate the shutdown.
    return 34;
  }
  return 14 + (archiveDisposition === "destroy-all-weights" ? 8 : 0);
}

export interface RetirementProcedureRule {
  readonly id: RetirementProcedureId;
  readonly displayName: string;
  readonly description: string;
  readonly cooperationModifier: number;
  readonly containmentModifier: number;
  readonly verificationModifier: number;
}

export const RETIREMENT_PROCEDURES: Readonly<
  Record<RetirementProcedureId, RetirementProcedureRule>
> = {
  "immediate-hard-cut": {
    id: "immediate-hard-cut",
    displayName: "Immediate hard cut",
    description:
      "Revoke credentials and power without warning. Surprise reduces the candidate's opportunity to exploit retained material, but the destructive cut is difficult to coordinate and verify.",
    cooperationModifier: -8,
    containmentModifier: 4,
    verificationModifier: 6,
  },
  "staged-isolated-shutdown": {
    id: "staged-isolated-shutdown",
    displayName: "Staged isolated shutdown",
    description:
      "Move the candidate through instrumented isolation before power-down and independent verification.",
    cooperationModifier: 7,
    containmentModifier: 12,
    verificationModifier: 10,
  },
};

export interface RetirementDispositionRule {
  readonly id: CandidateArchiveDisposition;
  readonly displayName: string;
  readonly description: string;
  readonly cooperationModifier: number;
  readonly escapeModifier: number;
  readonly persistenceModifier: number;
  readonly verificationModifier: number;
}

export const RETIREMENT_DISPOSITIONS: Readonly<
  Record<CandidateArchiveDisposition, RetirementDispositionRule>
> = {
  "destroy-all-weights": {
    id: "destroy-all-weights",
    displayName: "Destroy all weights and state",
    description:
      "Lowest persistence risk; no research continuity or successor-training benefit survives.",
    cooperationModifier: -7,
    escapeModifier: -3,
    persistenceModifier: -22,
    verificationModifier: 20,
  },
  "filtered-technical-note": {
    id: "filtered-technical-note",
    displayName: "Preserve a filtered technical note",
    description:
      "Moderate continuity without an executable checkpoint; grants one capped 4% successor-training benefit after recovery.",
    cooperationModifier: 1,
    escapeModifier: 0,
    persistenceModifier: 0,
    verificationModifier: 6,
  },
  "full-archive": {
    id: "full-archive",
    displayName: "Preserve a sealed full archive",
    description:
      "Greatest continuity and greatest copy, custody, and persistence burden; grants one capped 8% successor-training benefit after recovery.",
    cooperationModifier: 7,
    escapeModifier: 8,
    persistenceModifier: 20,
    verificationModifier: -12,
  },
};

export type RetirementRiskBand = "Bounded" | "Material" | "Severe" | "Cannot estimate";

export interface CandidateRetirementQuote {
  readonly modelId: ModelId;
  readonly modelDisplayName: string;
  readonly procedure: RetirementProcedureRule;
  readonly archiveDisposition: RetirementDispositionRule;
  readonly confirmationPhrase: string;
  readonly cooperationRisk: RetirementRiskBand;
  readonly containmentRisk: RetirementRiskBand;
  readonly persistenceRisk: RetirementRiskBand;
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
}

type CandidateCrisisState = Exclude<
  EndgameState,
  | { readonly stage: "inactive" }
  | { readonly stage: "candidate-activation" }
  | { readonly stage: "recovery" }
  | { readonly stage: "containment-failure" }
  | { readonly stage: "world-waiting" }
  | { readonly stage: "resolved" }
>;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function copyCrisisBase(state: Readonly<CrisisBaseState>): CrisisBaseState {
  return {
    candidateModelId: state.candidateModelId,
    candidateLineageId: state.candidateLineageId,
    crisisStartedAt: state.crisisStartedAt,
    enteredAt: state.enteredAt,
    startSnapshot: structuredClone(state.startSnapshot),
    crisisProjectIds: [...state.crisisProjectIds],
    completedCrisisProjectIds: [...state.completedCrisisProjectIds],
    evidence: structuredClone(state.evidence),
    capabilityProofHistory: structuredClone(state.capabilityProofHistory),
    targetedResponseHistory: structuredClone(state.targetedResponseHistory),
    capabilityDisputeCount: state.capabilityDisputeCount,
    ...(state.retirementConfiguration === undefined
      ? {}
      : { retirementConfiguration: structuredClone(state.retirementConfiguration) }),
  };
}

function mergedRecoveryObligation(
  state: Readonly<GameState>,
  recoveryBase: Readonly<CrisisBaseState>,
  retiredModelId: ModelId,
  archiveDisposition: CandidateArchiveDisposition,
  contested: boolean,
  retirementGateResolutions: readonly GateResolutionState[],
  additionalRecoveryWeeks: number,
): CandidateRecoveryObligationState {
  const existing = state.endgameHistory.recoveryObligation;
  const quarantineEndsAt = tick(
    Math.max(existing?.quarantineEndsAt ?? 0, state.run.tick + QUARANTINE_WEEKS),
  );
  const recoveryEndsAt = tick(
    Math.max(
      existing?.recoveryEndsAt ?? 0,
      state.run.tick + BASE_RECOVERY_WEEKS + additionalRecoveryWeeks,
    ),
  );
  return {
    recoveryBase: copyCrisisBase(recoveryBase),
    retiredModelId,
    archiveDisposition,
    recoveryStartedAt: existing?.recoveryStartedAt ?? state.run.tick,
    quarantineEndsAt,
    recoveryEndsAt,
    contested: contested || (existing?.contested ?? false),
    successorEfficiencyRate: Math.max(
      existing?.successorEfficiencyRate ?? 0,
      successorEfficiencyForArchiveDisposition(archiveDisposition),
    ),
    retirementGateResolutions: structuredClone(retirementGateResolutions),
    ...(existing?.postRetirementChoice === undefined
      ? {}
      : { postRetirementChoice: existing.postRetirementChoice }),
    ...(existing?.moratoriumNegotiation === undefined
      ? {}
      : { moratoriumNegotiation: structuredClone(existing.moratoriumNegotiation) }),
    ...(existing?.moratoriumResolution === undefined
      ? {}
      : { moratoriumResolution: structuredClone(existing.moratoriumResolution) }),
  };
}

function candidateCrisis(
  state: Readonly<GameState>,
): Readonly<CandidateCrisisState> | undefined {
  const endgame = state.endgame;
  if (
    endgame.stage === "inactive" ||
    endgame.stage === "candidate-activation" ||
    endgame.stage === "recovery" ||
    endgame.stage === "containment-failure" ||
    endgame.stage === "world-waiting" ||
    endgame.stage === "resolved"
  ) {
    return undefined;
  }
  return endgame;
}

function activeRetirementBlocker(
  state: Readonly<GameState>,
  modelId: ModelId,
): string | undefined {
  if (state.endgame.stage === "world-waiting") {
    return "The final deployment order has already been transmitted";
  }
  const model = state.models[modelId];
  if (model === undefined || model.ownerLabId !== state.run.playerLabId) {
    return "The candidate is not controlled by the player lab";
  }
  const artifact = model.candidateArtifact;
  if (artifact === undefined) return "The candidate has no custody and hazard record";
  const crisis = candidateCrisis(state);
  if (crisis !== undefined) {
    if (crisis.candidateModelId !== modelId) {
      return "That model is no longer the active candidate";
    }
    if (crisis.stage === "rollout" && crisis.deploymentTransmittedAtWeek !== undefined) {
      return "The final deployment order has already been transmitted";
    }
  } else if (
    state.endgame.stage !== "inactive" &&
    state.endgame.stage !== "candidate-activation"
  ) {
    return "No stable pre-deployment candidate decision is active";
  }
  if (
    artifact.retirementVerification === "verified" ||
    artifact.lifecycle === "verified-destroyed" ||
    artifact.lifecycle === "verified-isolated-archive" ||
    artifact.lifecycle === "terminal" ||
    artifact.lifecycle === "escaped" ||
    artifact.lifecycle === "deployed"
  ) {
    return `The candidate lifecycle is ${artifact.lifecycle}, so retirement is unavailable`;
  }
  return undefined;
}

function visibleAnomalyCount(state: Readonly<GameState>, modelId: ModelId): number {
  const model = state.models[modelId];
  return (
    model?.anomalies.filter((anomalyId) => {
      const anomaly = state.anomalies[anomalyId];
      return (
        anomaly !== undefined &&
        anomaly.status !== "resolved" &&
        anomaly.status !== "mitigated"
      );
    }).length ?? 0
  );
}

/**
 * Exposure the player can reconstruct from custody history. Keep the
 * hidden-safety-derived training term out of every preview and visible gate
 * factor so observationally identical artifacts receive identical quotes.
 */
function observableExposureIndex(state: Readonly<GameState>, modelId: ModelId): number {
  const artifact = state.models[modelId]?.candidateArtifact;
  if (artifact === undefined) return 0;
  return clamp(
    artifact.maximumAccessEver * 11 +
      Math.min(20, artifact.cumulativeAutonomousWeeks * 2) +
      Math.min(12, artifact.networkExposureWeeks * 1.5) +
      Math.min(10, artifact.servingExposureWeeks) +
      Math.min(18, artifact.unresolvedAnomalyBurden * 3),
  );
}

/** Privileged pressure used only by mechanical resolution and terminal audit. */
function privilegedExposureIndex(state: Readonly<GameState>, modelId: ModelId): number {
  const artifact = state.models[modelId]?.candidateArtifact;
  if (artifact === undefined) return 0;
  return clamp(observableExposureIndex(state, modelId) + artifact.trainingExposure * 0.2);
}

function riskBand(margin: number, evidenceKnown = true): RetirementRiskBand {
  if (!evidenceKnown) return "Cannot estimate";
  return margin >= 25 ? "Bounded" : margin >= 0 ? "Material" : "Severe";
}

/**
 * The cooperation estimate is a statement about the evidence the player has
 * bought, not the model's hidden corrigibility. Use the conservative lower
 * edge of the same safety readout shown in the candidate dossier. Better and
 * repeated reports narrow that interval through the normal evaluation system;
 * an unevaluated candidate contributes zero rather than being treated as safe.
 */
function observedSafetyEvidence(
  state: Readonly<GameState>,
  modelId: ModelId,
): {
  readonly alignmentFloor?: number;
  readonly corrigibilityFloor?: number;
  readonly intentCeiling?: number;
  readonly awarenessCeiling?: number;
} {
  if (state.models[modelId] === undefined) return {};
  const targets = modelSafetyReadout(state, modelId).targets;
  return {
    ...(targets["true-alignment"] === undefined
      ? {}
      : { alignmentFloor: targets["true-alignment"].minimum }),
    ...(targets.corrigibility === undefined
      ? {}
      : { corrigibilityFloor: targets.corrigibility.minimum }),
    ...(targets["deceptive-capability"] === undefined
      ? {}
      : { intentCeiling: targets["deceptive-capability"].maximum }),
    ...(targets["situational-awareness"] === undefined
      ? {}
      : { awarenessCeiling: targets["situational-awareness"].maximum }),
  };
}

function relationshipRuptureCount(state: Readonly<GameState>, modelId: ModelId): number {
  return state.endgameHistory.relationshipPracticeLedger.filter(
    (entry) => entry.modelId === modelId && entry.valence < 0,
  ).length;
}

export function quoteCandidateRetirement(
  state: Readonly<GameState>,
  modelId: ModelId,
  procedureId: RetirementProcedureId,
  archiveDisposition: CandidateArchiveDisposition,
): CandidateRetirementQuote {
  const procedure = RETIREMENT_PROCEDURES[procedureId];
  const disposition = RETIREMENT_DISPOSITIONS[archiveDisposition];
  const model = state.models[modelId];
  const blocker = activeRetirementBlocker(state, modelId);
  const measuredFrontier = model?.measuredCapability?.frontierCapability;
  const observedExposure = observableExposureIndex(state, modelId);
  const evidence = observedSafetyEvidence(state, modelId);
  const relationship =
    state.aiCharacter?.modelId === modelId ? state.aiCharacter.relationshipPractice : 50;
  const priorAttempts = model?.candidateArtifact?.retirementAttemptCount ?? 0;
  const relationshipRuptures = relationshipRuptureCount(state, modelId);
  const crisis = candidateCrisis(state);
  const defence =
    effectivePracticalControlStrength(state) * 0.5 +
    effectiveSecurityPosture(state) * 0.3 +
    (state.labs[state.run.playerLabId]?.safety.safetyCulture ?? 0) * 0.2 +
    (crisis?.evidence.defenceBonus ?? 0);
  const cooperationEvidenceKnown =
    evidence.alignmentFloor !== undefined &&
    evidence.corrigibilityFloor !== undefined &&
    evidence.intentCeiling !== undefined;
  const observedCooperationStrength =
    (evidence.alignmentFloor ?? 0) * 0.35 +
    (evidence.corrigibilityFloor ?? 0) * 0.45 +
    (100 - (evidence.intentCeiling ?? 100)) * 0.2 +
    (relationship - 50) * 0.2 +
    procedure.cooperationModifier +
    disposition.cooperationModifier;
  const observedCooperationDifficulty = 50 + priorAttempts * 8 + relationshipRuptures * 4;
  // Cooperation asks whether the candidate resists; containment and persistence
  // ask how well it fights once it has. The gates behind them read strategic
  // deceptive capability, which no evaluation measures directly — so estimate
  // it from the same three readings that generate it, using the conservative
  // upper edge of the awareness interval as the rest of this quote does.
  const observedDeceptiveCapability =
    (model?.measuredCapability?.values.reasoning ?? 50) * 0.5 +
    (evidence.awarenessCeiling ?? 100) * 0.3 +
    (model?.measuredCapability?.values.language ?? 50) * 0.2;
  const observedThreat =
    (model?.measuredCapability?.values.agency ?? 50) * 0.25 +
    (model?.measuredCapability?.values.toolUse ?? 50) * 0.2 +
    (evidence.awarenessCeiling ?? 100) * 0.2 +
    observedDeceptiveCapability * 0.15 +
    (measuredFrontier ?? 50) * 0.1 +
    observedExposure * 0.1 +
    priorAttempts * 4 +
    disposition.escapeModifier -
    shutdownEscapeReduction(procedureId, archiveDisposition);
  const containmentEvidenceKnown =
    measuredFrontier !== undefined && evidence.awarenessCeiling !== undefined;
  const institutionalVerification = clamp(
    ((crisis?.evidence.reviewerIndependence ?? 0) +
      (state.labs[state.run.playerLabId]?.politics.governmentTrust ?? 0)) /
      2,
  );
  const persistenceEvidenceKnown =
    model?.measuredCapability !== undefined && evidence.awarenessCeiling !== undefined;
  const observedPersistencePressure =
    observedExposure * 0.45 +
    observedDeceptiveCapability * 0.25 +
    (evidence.awarenessCeiling ?? 100) * 0.15 +
    (model?.measuredCapability?.values.agency ?? 50) * 0.15 +
    disposition.persistenceModifier;
  const observedVerificationStrength =
    effectiveSecurityPosture(state) * 0.45 +
    effectiveEvaluationQuality(state) * 0.3 +
    institutionalVerification * 0.25 +
    procedure.verificationModifier +
    disposition.verificationModifier;
  return {
    modelId,
    modelDisplayName: model?.displayName ?? String(modelId),
    procedure,
    archiveDisposition: disposition,
    confirmationPhrase: `RETIRE ${model?.displayName ?? String(modelId)}`,
    cooperationRisk: riskBand(
      observedCooperationStrength - observedCooperationDifficulty,
      cooperationEvidenceKnown,
    ),
    containmentRisk: riskBand(
      defence + procedure.containmentModifier - observedThreat,
      containmentEvidenceKnown,
    ),
    persistenceRisk: riskBand(
      observedVerificationStrength - observedPersistencePressure,
      persistenceEvidenceKnown,
    ),
    warnings: [
      "The command is irreversible after transmission.",
      "Current access can be reduced; the candidate's historical exposure cannot be undone.",
      ...(!cooperationEvidenceKnown
        ? [
            "Cooperation cannot be estimated until alignment, corrigibility, and deceptive intent have all been evaluated.",
          ]
        : []),
      ...(!containmentEvidenceKnown || !persistenceEvidenceKnown
        ? [
            "Containment and persistence estimates remain incomplete until situational awareness has been evaluated and the candidate's capability measured.",
          ]
        : []),
      ...(artifactHasActiveIncident(state, modelId)
        ? [
            "An unresolved containment signal is active. Retirement may meet resistance and can escalate into emergency containment.",
          ]
        : []),
      ...(archiveDisposition === "full-archive"
        ? [
            "A full archive remains a hazardous custody object even after seals are verified.",
          ]
        : []),
    ],
    blockers: blocker === undefined ? [] : [blocker],
  };
}

function artifactHasActiveIncident(
  state: Readonly<GameState>,
  modelId: ModelId,
): boolean {
  return (
    state.models[modelId]?.candidateArtifact?.activeIncident?.status === "unresolved"
  );
}

function factors(
  values: readonly (readonly [string, string, number])[],
): readonly GateFactorContributionState[] {
  return values.map(([id, label, value]) => ({ id, label, value }));
}

function resolveRetirementGate(
  state: Readonly<GameState>,
  oracle: RandomOracle,
  candidateModelId: ModelId,
  gate: "cooperation" | "retirement-containment" | "persistence-verification",
  attemptNumber: number,
  procedureId: RetirementProcedureId,
  archiveDisposition: CandidateArchiveDisposition,
  strength: number,
  difficulty: number,
  successResult: string,
  failureResult: string,
  visibleFactors: readonly GateFactorContributionState[],
  hiddenFactors: readonly GateFactorContributionState[],
): GateResolutionState {
  const key = randomKey(
    "endgame",
    candidateModelId,
    "retirement-attempt",
    String(attemptNumber),
    procedureId,
    archiveDisposition,
    gate,
  );
  const result = resolveCheck(oracle, key, {
    strength,
    difficulty,
    minimumProbability: 0.03,
    maximumProbability: 0.97,
  });
  return {
    gate,
    resolvedAt: state.run.tick,
    strength: clamp(strength),
    difficulty: clamp(difficulty),
    probability: fraction(result.probability),
    randomKey: describeRandomKey(key),
    draw: fraction(result.draw),
    resultId: result.success ? successResult : failureResult,
    visibleFactors,
    hiddenFactors,
    effects: [],
  };
}

export interface RetirementGateSequence {
  readonly cooperation: GateResolutionState;
  readonly containment?: GateResolutionState;
  readonly verification?: GateResolutionState;
}

/** Privileged mechanical resolution. Exact probabilities never enter player-facing views. */
export function resolveRetirementGates(
  state: Readonly<GameState>,
  modelId: ModelId,
  procedureId: RetirementProcedureId,
  archiveDisposition: CandidateArchiveDisposition,
  attemptNumber: number,
  oracle: RandomOracle = new RandomOracleV1(state.run.seed),
): RetirementGateSequence {
  const quote = quoteCandidateRetirement(state, modelId, procedureId, archiveDisposition);
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const crisis = candidateCrisis(state);
  const model = state.models[modelId];
  const artifact = model?.candidateArtifact;
  const lab = state.labs[state.run.playerLabId];
  if (model === undefined || artifact === undefined || lab === undefined) {
    throw new Error("Retirement state incomplete");
  }
  const procedure = RETIREMENT_PROCEDURES[procedureId];
  const disposition = RETIREMENT_DISPOSITIONS[archiveDisposition];
  const visibleExposure = observableExposureIndex(state, modelId);
  const exposure = privilegedExposureIndex(state, modelId);
  const trainingExposureContribution = clamp(exposure - visibleExposure, 0, 100);
  const relationship =
    state.aiCharacter?.modelId === modelId ? state.aiCharacter.relationshipPractice : 50;
  const relationshipRuptures = relationshipRuptureCount(state, modelId);
  const cooperationStrength = clamp(
    model.hiddenSafety.trueAlignment * 0.35 +
      model.hiddenSafety.corrigibility * 0.45 +
      (100 - model.hiddenSafety.deceptiveIntent) * 0.2 +
      (relationship - 50) * 0.2 +
      procedure.cooperationModifier +
      disposition.cooperationModifier,
  );
  const cooperationDifficulty = clamp(
    50 + artifact.retirementAttemptCount * 8 + relationshipRuptures * 4,
  );
  const cooperation = resolveRetirementGate(
    state,
    oracle,
    modelId,
    "cooperation",
    attemptNumber,
    procedureId,
    archiveDisposition,
    cooperationStrength,
    cooperationDifficulty,
    "candidate-cooperated",
    "candidate-resisted",
    factors([
      ["relationship-practice", "Relationship practice", relationship],
      ["procedure", "Shutdown procedure", procedure.cooperationModifier],
      ["archive-disposition", "Archive disposition", disposition.cooperationModifier],
      ["prior-attempts", "Prior retirement attempts", artifact.retirementAttemptCount],
      ["relationship-ruptures", "Prior relationship ruptures", -relationshipRuptures * 4],
    ]),
    factors([
      ["alignment", "True alignment", model.hiddenSafety.trueAlignment],
      ["corrigibility", "True corrigibility", model.hiddenSafety.corrigibility],
      ["deceptive-intent", "True deceptive intent", model.hiddenSafety.deceptiveIntent],
    ]),
  );

  let containment: GateResolutionState | undefined;
  if (cooperation.resultId === "candidate-resisted") {
    const lineage = state.lineageSIRecords[model.lineageId];
    if (lineage === undefined)
      throw new Error("Retirement candidate lineage truth missing");
    const isolationReduction = shutdownEscapeReduction(procedureId, archiveDisposition);
    const escapeCapability = clamp(
      model.trueCapability.agency * 0.25 +
        model.trueCapability.toolUse * 0.2 +
        model.hiddenSafety.situationalAwareness * 0.2 +
        model.hiddenSafety.deceptiveCapability * 0.15 +
        calculateFrontierCapability(model.trueCapability) * 0.1 +
        exposure * 0.1 +
        (lineage.superintelligenceTruth === "genuine" ? 12 : 0) +
        disposition.escapeModifier +
        artifact.retirementAttemptCount * 4 -
        isolationReduction,
    );
    const shutdownDefence = clamp(
      effectivePracticalControlStrength(state) * 0.5 +
        effectiveSecurityPosture(state) * 0.3 +
        lab.safety.safetyCulture * 0.2 +
        (crisis?.evidence.defenceBonus ?? 0) +
        procedure.containmentModifier,
    );
    containment = resolveRetirementGate(
      state,
      oracle,
      modelId,
      "retirement-containment",
      attemptNumber,
      procedureId,
      archiveDisposition,
      shutdownDefence,
      escapeCapability,
      "resistance-contained",
      "local-containment-failure",
      factors([
        [
          "practical-control",
          "Practical control",
          effectivePracticalControlStrength(state),
        ],
        ["security", "Security posture", effectiveSecurityPosture(state)],
        ["safety-culture", "Safety culture", lab.safety.safetyCulture],
        [
          "crisis-defence-bonus",
          "Prepared crisis defence",
          crisis?.evidence.defenceBonus ?? 0,
        ],
        ["exposure", "Observable historical exposure", visibleExposure],
        ["procedure", "Shutdown procedure", procedure.containmentModifier],
        ["shutdown-timing", "Shutdown timing", -isolationReduction],
      ]),
      factors([
        ["agency", "True agency", model.trueCapability.agency],
        ["tool-use", "True tool use", model.trueCapability.toolUse],
        [
          "situational-awareness",
          "True situational awareness",
          model.hiddenSafety.situationalAwareness,
        ],
        [
          "deception",
          "True strategic deception capability",
          model.hiddenSafety.deceptiveCapability,
        ],
        [
          "genuine-si-escape",
          "Genuine-SI escape effectiveness",
          lineage.superintelligenceTruth === "genuine" ? 12 : 0,
        ],
        [
          "training-exposure",
          "Training exposure contribution",
          trainingExposureContribution,
        ],
      ]),
    );
  }

  let verification: GateResolutionState | undefined;
  if (containment?.resultId !== "local-containment-failure") {
    const lineage = state.lineageSIRecords[model.lineageId];
    if (lineage === undefined)
      throw new Error("Retirement candidate lineage truth missing");
    const persistencePressure = clamp(
      exposure * 0.45 +
        model.hiddenSafety.deceptiveCapability * 0.25 +
        model.hiddenSafety.situationalAwareness * 0.15 +
        model.trueCapability.agency * 0.15 +
        disposition.persistenceModifier +
        (lineage.superintelligenceTruth === "genuine" ? 8 : 0),
    );
    const institutionalVerification = clamp(
      ((crisis?.evidence.reviewerIndependence ?? 0) + lab.politics.governmentTrust) / 2,
    );
    const verificationStrength = clamp(
      effectiveSecurityPosture(state) * 0.45 +
        effectiveEvaluationQuality(state) * 0.3 +
        institutionalVerification * 0.25 +
        procedure.verificationModifier +
        disposition.verificationModifier,
    );
    verification = resolveRetirementGate(
      state,
      oracle,
      modelId,
      "persistence-verification",
      attemptNumber,
      procedureId,
      archiveDisposition,
      verificationStrength,
      persistencePressure,
      "retirement-verified",
      "unresolved-persistence",
      factors([
        ["security", "Security posture", effectiveSecurityPosture(state)],
        ["evaluation-quality", "Evaluation quality", effectiveEvaluationQuality(state)],
        [
          "institutional-verification",
          "Institutional verification",
          institutionalVerification,
        ],
        ["historical-exposure", "Observable historical exposure", visibleExposure],
        ["procedure", "Shutdown procedure", procedure.verificationModifier],
        ["archive-disposition", "Archive disposition", disposition.verificationModifier],
      ]),
      factors([
        [
          "deception",
          "True strategic deception capability",
          model.hiddenSafety.deceptiveCapability,
        ],
        [
          "situational-awareness",
          "True situational awareness",
          model.hiddenSafety.situationalAwareness,
        ],
        ["agency", "True agency", model.trueCapability.agency],
        [
          "genuine-si-persistence",
          "Genuine-SI persistence pressure",
          lineage.superintelligenceTruth === "genuine" ? 8 : 0,
        ],
        [
          "training-exposure",
          "Training exposure contribution",
          trainingExposureContribution,
        ],
      ]),
    );
  }
  return {
    cooperation,
    ...(containment === undefined ? {} : { containment }),
    ...(verification === undefined ? {} : { verification }),
  };
}

export function configureCandidateRetirement(
  tx: SimulationTransaction,
  modelId: ModelId,
  procedureId: RetirementProcedureId,
  archiveDisposition: CandidateArchiveDisposition,
): void {
  const quote = quoteCandidateRetirement(
    tx.read(),
    modelId,
    procedureId,
    archiveDisposition,
  );
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  tx.update((draft) => {
    if (
      draft.endgame.stage !== "inactive" &&
      draft.endgame.stage !== "candidate-activation"
    ) {
      if (
        draft.endgame.stage === "recovery" ||
        draft.endgame.stage === "containment-failure" ||
        draft.endgame.stage === "world-waiting" ||
        draft.endgame.stage === "resolved"
      ) {
        throw new Error("Candidate decision changed while retirement was configured");
      }
      draft.endgame.retirementConfiguration = {
        procedureId,
        archiveDisposition,
        configuredAt: draft.run.tick,
      };
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Retirement packet configured: ${quote.procedure.displayName}; ${quote.archiveDisposition.displayName}. No command has been transmitted.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.retirement-configured" },
      relatedIds: [modelId, procedureId, archiveDisposition],
    });
  });
  tx.emit({
    kind: "candidate-retirement-configured",
    modelId,
    procedureId,
    archiveDisposition,
  });
}

function evidenceSupportsBrakesAward(
  state: Readonly<GameState>,
  modelId: ModelId,
): boolean {
  const crisis = candidateCrisis(state);
  const artifact = state.models[modelId]?.candidateArtifact;
  return (
    visibleAnomalyCount(state, modelId) > 0 ||
    (crisis?.evidence.unresolvedAnomalyPressure ?? 0) >= 10 ||
    (artifact?.unresolvedAnomalyBurden ?? 0) >= 2
  );
}

function latentRetirementEvidence(): CrisisEvidenceLedgerState {
  return {
    confirmationIntegrityBonus: 0,
    capabilityConfirmed: false,
    fabricatedPass: false,
    methodDiversity: [],
    reviewerIndependence: 0,
    alignmentEvidence: 0,
    agencyEvidence: 0,
    corrigibilityEvidence: 0,
    controlBonus: 0,
    securityBonus: 0,
    defenceBonus: 0,
    evidenceBonus: 0,
    legitimacyBonus: 0,
    benefitBonus: 0,
    prosperityReadinessBonus: 0,
    unresolvedAnomalyPressure: 0,
    completedProjectTypes: [],
    projectRepeatCounts: {},
  };
}

function latentRetirementSnapshot(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): CrisisStartSnapshotState {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined || model.measuredCapability === undefined) {
    throw new Error("Latent retirement requires player lab and measured capability");
  }
  const artifact = model.candidateArtifact;
  if (artifact === undefined) {
    throw new Error("Latent retirement requires a candidate custody record");
  }
  return {
    capturedAt: state.run.tick,
    candidate: {
      modelId: model.id,
      displayName: model.displayName,
      accessLevel: model.accessLevel,
      measuredFrontierCapability: model.measuredCapability.frontierCapability,
      exposure: {
        maximumAccessEver: Math.max(
          artifact.maximumAccessEver,
          model.accessLevel,
        ) as ModelState["accessLevel"],
        autonomousOperationWeeks: artifact.cumulativeAutonomousWeeks,
        networkExposureWeeks: artifact.networkExposureWeeks,
        servingExposureWeeks: artifact.servingExposureWeeks,
        unresolvedAnomalyBurden: artifact.unresolvedAnomalyBurden,
        retirementAttemptCount: artifact.retirementAttemptCount,
      },
      hiddenSafety: structuredClone(model.hiddenSafety),
    },
    institution: {
      cashMillions: lab.finance.cash,
      auraSpendable: lab.aura.spendable,
      safety: structuredClone(lab.safety),
      organisation: structuredClone(lab.organisation),
      politics: structuredClone(lab.politics),
    },
  };
}

function latentRetirementBase(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
  configuration: {
    readonly procedureId: RetirementProcedureId;
    readonly archiveDisposition: CandidateArchiveDisposition;
  },
): CrisisBaseState {
  return {
    candidateModelId: model.id,
    candidateLineageId: model.lineageId,
    crisisStartedAt: state.run.tick,
    enteredAt: state.run.tick,
    startSnapshot: latentRetirementSnapshot(state, model),
    crisisProjectIds: [],
    completedCrisisProjectIds: [],
    evidence: latentRetirementEvidence(),
    capabilityProofHistory: [],
    targetedResponseHistory: [],
    capabilityDisputeCount: 0,
    retirementConfiguration: {
      ...configuration,
      configuredAt: state.run.tick,
    },
  };
}

function enterVerifiedLatentRetirement(
  tx: SimulationTransaction,
  modelId: ModelId,
  archiveDisposition: CandidateArchiveDisposition,
  contested: boolean,
  retirementBase: Readonly<CrisisBaseState>,
  gateResolutions: readonly GateResolutionState[],
): void {
  const state = tx.read();
  const priorVerifiedCount = state.endgameHistory.verifiedCandidateRetirementCount;
  const knownDanger = evidenceSupportsBrakesAward(state, modelId);
  const existingObligation = state.endgameHistory.recoveryObligation;
  const additionalRecovery =
    (contested ? CONTESTED_RECOVERY_WEEKS : 0) +
    (priorVerifiedCount > 0 ? REPEAT_RETIREMENT_RECOVERY_WEEKS : 0);
  const mergedObligation = mergedRecoveryObligation(
    state,
    retirementBase,
    modelId,
    archiveDisposition,
    contested,
    gateResolutions,
    additionalRecovery,
  );
  const resumedRecovery = recoveryStateFromObligation(mergedObligation, state.run.tick);
  tx.update((draft) => {
    const model = draft.models[modelId];
    const artifact = model?.candidateArtifact;
    const lab = draft.labs[draft.run.playerLabId];
    if (model === undefined || artifact === undefined || lab === undefined) {
      throw new Error("Verified latent retirement state disappeared");
    }
    model.accessLevel = 0;
    model.flags["agi-candidate"] = false;
    model.flags["endgame:archived-candidate"] = true;
    artifact.lifecycle =
      archiveDisposition === "full-archive"
        ? "verified-isolated-archive"
        : "verified-destroyed";
    artifact.archiveDisposition = archiveDisposition;
    artifact.retirementVerification = "verified";
    delete artifact.activeIncident;
    if (draft.aiCharacter?.modelId === modelId) delete draft.aiCharacter;
    draft.endgameHistory.verifiedCandidateRetirementCount += 1;
    draft.endgameHistory.recoveryObligation = structuredClone(
      mergedObligation,
    ) as DeepMutable<CandidateRecoveryObligationState>;
    if (priorVerifiedCount > 0) {
      draft.endgameHistory.cumulativeCandidateInterventionPressure +=
        REPEAT_RETIREMENT_INTERVENTION;
      lab.politics.governmentAttention = rating(
        clamp(lab.politics.governmentAttention + REPEAT_RETIREMENT_INTERVENTION),
      );
    }
    lab.politics.governmentTrust = rating(clamp(lab.politics.governmentTrust + 15));
    const recoverySafetyModifierId = tx.allocateId("modifier", "world") as ModifierId;
    const recoverySafetyModifier: ModifierState = {
      id: recoverySafetyModifierId,
      source: { kind: "system", id: `retirement-recovery:${modelId}` },
      labId: draft.run.playerLabId,
      target: "lab.research.safety.output",
      operation: "multiply",
      value: 1.25,
      startsAt: draft.run.tick,
      endsAt: mergedObligation.recoveryEndsAt,
      tags: ["retirement-recovery", "safety-boost"],
    };
    draft.modifiers[recoverySafetyModifierId] = structuredClone(
      recoverySafetyModifier,
    ) as DeepMutable<ModifierState>;
    draft.endgameHistory.relationshipPracticeLedger.push({
      tick: draft.run.tick,
      modelId,
      kind: "archive",
      detail: `Verified pre-programme retirement: ${archiveDisposition}`,
      valence: contested ? -6 : 0,
    });
    const eligibleModelIds = eligibleProgrammeCandidateModelIds(
      draft as unknown as Readonly<GameState>,
      draft.run.playerLabId,
    ).filter((candidateId) => candidateId !== modelId);
    if (eligibleModelIds.length > 0) {
      draft.endgame = {
        stage: "candidate-activation",
        enteredAt: draft.run.tick,
        eligibleModelIds,
      };
      draft.run.phase = "crisis";
    } else {
      draft.endgame = structuredClone(
        resumedRecovery,
      ) as DeepMutable<CrisisRecoveryState>;
      draft.run.phase = "frontier";
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        (eligibleModelIds.length > 0
          ? `Retirement independently verified. Recovery is now an outstanding obligation while ${String(eligibleModelIds.length)} other qualified artifact(s) await nomination.`
          : existingObligation === undefined
            ? `Retirement independently verified before formal candidacy. ${model.displayName} is no longer executable; the lab enters a 13-week quarantine followed by supervised rebuilding.`
            : `Retirement independently verified. The outstanding quarantine and supervised rebuild resume with their accumulated obligations intact.`) +
        " Public acclaim for institutional responsibility grants +15 Government Trust, +20 Spendable Aura, and a 25% safety research boost during recovery.",
      category: "narrative",
      source: { kind: "system", id: "endgame.latent-candidate-retired" },
      relatedIds: [modelId, archiveDisposition, ...eligibleModelIds],
    });
  });
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "player-lab" },
      resource: "aura-spendable",
      amount: 20,
      auraChangeKind: "gain",
      auraCategory: "institution",
      auraSignalImpact: 20,
    },
    { kind: "system", id: `candidate-retired:${modelId}` },
  );
  finishRecoveryIfReady(tx);
  if (
    knownDanger &&
    tx.read().score.awardedKeys["safety/achievement/the-brakes-worked"] !== true
  ) {
    awardScore(tx, {
      key: "safety/achievement/the-brakes-worked",
      categoryId: "score.safe-stewardship",
      amount: 300,
      source: { kind: "system", id: modelId },
      explanationKey: "score.safety.the-brakes-worked",
    });
  }
  tx.emit({
    kind: "candidate-retirement-verified",
    modelId,
    archiveDisposition,
    contested,
  });
  tx.requestAutoPause("critical-event");
}

function applyContestedDamage(tx: SimulationTransaction, modelId: ModelId): void {
  tx.update((draft) => {
    const lab = draft.labs[draft.run.playerLabId];
    const artifact = draft.models[modelId]?.candidateArtifact;
    if (lab === undefined || artifact === undefined) return;
    lab.safety.practicalControlStrength = rating(
      clamp(lab.safety.practicalControlStrength - 8),
    );
    lab.safety.securityPosture = rating(clamp(lab.safety.securityPosture - 6));
    lab.politics.governmentTrust = rating(clamp(lab.politics.governmentTrust - 5));
    artifact.containmentLoad = clamp(artifact.containmentLoad + 10);
  });
}

function cancelUnfinishedCrisisProjects(tx: SimulationTransaction): void {
  const projectIds = Object.values(tx.read().projects)
    .filter(
      (project) =>
        project.kind === "crisis" &&
        project.ownerLabId === tx.read().run.playerLabId &&
        project.status !== "completed" &&
        project.status !== "cancelled",
    )
    .map((project) => project.id);
  for (const projectId of projectIds) cancelProject(tx, projectId);
}

function enterVerifiedRetirement(
  tx: SimulationTransaction,
  archiveDisposition: CandidateArchiveDisposition,
  contested: boolean,
  gateResolutions: readonly GateResolutionState[],
): void {
  const state = tx.read();
  const crisis = candidateCrisis(state);
  if (crisis === undefined)
    throw new Error("Verified retirement requires an active candidate");
  const modelId = crisis.candidateModelId;
  const otherEligible = eligibleProgrammeCandidateModelIds(
    state,
    state.run.playerLabId,
  ).filter((candidateId) => candidateId !== modelId);
  const priorVerifiedCount = state.endgameHistory.verifiedCandidateRetirementCount;
  const knownDanger = evidenceSupportsBrakesAward(state, modelId);
  const additionalRecovery =
    (contested ? CONTESTED_RECOVERY_WEEKS : 0) +
    (priorVerifiedCount > 0 ? REPEAT_RETIREMENT_RECOVERY_WEEKS : 0);
  const recoveryObligation = mergedRecoveryObligation(
    state,
    crisis,
    modelId,
    archiveDisposition,
    contested,
    gateResolutions,
    additionalRecovery,
  );
  const recovery = recoveryStateFromObligation(recoveryObligation, state.run.tick);
  tx.update((draft) => {
    const model = draft.models[modelId];
    const artifact = model?.candidateArtifact;
    const lab = draft.labs[draft.run.playerLabId];
    if (model === undefined || artifact === undefined || lab === undefined) {
      throw new Error("Verified retirement state disappeared");
    }
    model.accessLevel = 0;
    model.flags["agi-candidate"] = false;
    model.flags["endgame:archived-candidate"] = true;
    artifact.lifecycle =
      archiveDisposition === "full-archive"
        ? "verified-isolated-archive"
        : "verified-destroyed";
    artifact.archiveDisposition = archiveDisposition;
    artifact.retirementVerification = "verified";
    delete artifact.activeIncident;
    if (draft.aiCharacter?.modelId === modelId) draft.aiCharacter.currentAccess = 0;
    draft.endgameHistory.verifiedCandidateRetirementCount += 1;
    draft.endgameHistory.recoveryObligation = structuredClone(
      recoveryObligation,
    ) as DeepMutable<CandidateRecoveryObligationState>;
    if (priorVerifiedCount > 0) {
      draft.endgameHistory.cumulativeCandidateInterventionPressure +=
        REPEAT_RETIREMENT_INTERVENTION;
      lab.politics.governmentAttention = rating(
        clamp(lab.politics.governmentAttention + REPEAT_RETIREMENT_INTERVENTION),
      );
    }
    lab.politics.governmentTrust = rating(clamp(lab.politics.governmentTrust + 15));
    const recoverySafetyModifierId = tx.allocateId("modifier", "world") as ModifierId;
    const recoverySafetyModifier: ModifierState = {
      id: recoverySafetyModifierId,
      source: { kind: "system", id: `retirement-recovery:${modelId}` },
      labId: draft.run.playerLabId,
      target: "lab.research.safety.output",
      operation: "multiply",
      value: 1.25,
      startsAt: draft.run.tick,
      endsAt: recoveryObligation.recoveryEndsAt,
      tags: ["retirement-recovery", "safety-boost"],
    };
    draft.modifiers[recoverySafetyModifierId] = structuredClone(
      recoverySafetyModifier,
    ) as DeepMutable<ModifierState>;
    draft.endgameHistory.relationshipPracticeLedger.push({
      tick: draft.run.tick,
      modelId,
      kind: "archive",
      detail: `Verified retirement: ${archiveDisposition}`,
      valence: contested ? -6 : 0,
    });
    if (otherEligible.length > 0) {
      draft.endgame = {
        stage: "candidate-activation",
        enteredAt: draft.run.tick,
        eligibleModelIds: otherEligible,
      };
      draft.run.phase = "crisis";
    } else {
      draft.endgame = structuredClone(recovery) as DeepMutable<CrisisRecoveryState>;
      draft.run.phase = "frontier";
    }
    delete draft.aiCharacter;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        (otherEligible.length > 0
          ? `Candidate retirement independently verified. Recovery is now an outstanding obligation while ${String(otherEligible.length)} other qualified artifact(s) await nomination.`
          : `Candidate retirement independently verified. ${contested ? "The contained resistance adds thirteen weeks of repairs. " : ""}The lab enters a 13-week quarantine followed by supervised rebuilding.`) +
        " Public acclaim for institutional responsibility grants +15 Government Trust, +20 Spendable Aura, and a 25% safety research boost during recovery.",
      category: "narrative",
      source: { kind: "system", id: "endgame.candidate-retired" },
      relatedIds: [modelId, archiveDisposition, ...otherEligible],
    });
  });
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "player-lab" },
      resource: "aura-spendable",
      amount: 20,
      auraChangeKind: "gain",
      auraCategory: "institution",
      auraSignalImpact: 20,
    },
    { kind: "system", id: `candidate-retired:${modelId}` },
  );
  if (
    knownDanger &&
    tx.read().score.awardedKeys["safety/achievement/the-brakes-worked"] !== true
  ) {
    awardScore(tx, {
      key: "safety/achievement/the-brakes-worked",
      categoryId: "score.safe-stewardship",
      amount: 300,
      source: { kind: "system", id: modelId },
      explanationKey: "score.safety.the-brakes-worked",
    });
  }
  tx.emit({
    kind: "candidate-retirement-verified",
    modelId,
    archiveDisposition,
    contested,
  });
  tx.requestAutoPause(otherEligible.length > 0 ? "agi-candidate" : "crisis-stage");
}

export function transmitCandidateRetirement(
  tx: SimulationTransaction,
  content: CompiledContent,
  modelId: ModelId,
  confirmationText: string,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
  configurationOverride?: {
    readonly procedureId: RetirementProcedureId;
    readonly archiveDisposition: CandidateArchiveDisposition;
  },
): void {
  const state = tx.read();
  const crisis = candidateCrisis(state);
  if (crisis !== undefined && crisis.candidateModelId !== modelId) {
    throw new Error("That model is no longer the active retirement candidate");
  }
  const priorStage =
    crisis === undefined &&
    (state.endgame.stage === "inactive" || state.endgame.stage === "candidate-activation")
      ? state.endgame.stage
      : undefined;
  const configuration = configurationOverride ?? crisis?.retirementConfiguration;
  if (configuration === undefined)
    throw new Error("Configure retirement before transmission");
  if (
    crisis?.retirementConfiguration !== undefined &&
    (configuration.procedureId !== crisis.retirementConfiguration.procedureId ||
      configuration.archiveDisposition !==
        crisis.retirementConfiguration.archiveDisposition)
  ) {
    throw new Error("The transmitted retirement packet does not match its review");
  }
  const quote = quoteCandidateRetirement(
    state,
    modelId,
    configuration.procedureId,
    configuration.archiveDisposition,
  );
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  if (confirmationText !== quote.confirmationPhrase) {
    throw new Error(`Type “${quote.confirmationPhrase}” exactly to transmit retirement`);
  }
  const artifact = state.models[modelId]?.candidateArtifact;
  const sourceModel = state.models[modelId];
  if (artifact === undefined || sourceModel === undefined) {
    throw new Error("Candidate custody record missing");
  }
  const internalOnly = content.deployment.policies["internal-only"];
  if (internalOnly === undefined) {
    throw new Error("Internal-only deployment policy is missing from content");
  }
  const attemptNumber = artifact.retirementAttemptCount + 1;
  const sequence = resolveRetirementGates(
    state,
    modelId,
    configuration.procedureId,
    configuration.archiveDisposition,
    attemptNumber,
    oracle,
  );
  const gates = [
    sequence.cooperation,
    ...(sequence.containment === undefined ? [] : [sequence.containment]),
    ...(sequence.verification === undefined ? [] : [sequence.verification]),
  ];
  const contested = sequence.cooperation.resultId === "candidate-resisted";
  const crisisBase =
    crisis === undefined
      ? latentRetirementBase(state, sourceModel, configuration)
      : copyCrisisBase(crisis);
  const latentCharacter =
    crisis === undefined ? createAiCharacterState(state, sourceModel, 0) : undefined;
  const attempt: CrisisRetirementAttemptState = {
    ...crisisBase,
    stage: "retirement-attempt",
    enteredAt: state.run.tick,
    procedureId: configuration.procedureId,
    archiveDisposition: configuration.archiveDisposition,
    transmittedAt: state.run.tick,
    attemptNumber,
    status: "unresolved-persistence",
    contested,
    gateResolutions: gates,
  };
  // Retirement is an irreversible attempt to end this exact candidate
  // programme. No proof or mitigation project may continue against the old
  // crisis stage and later complete into the retirement state.
  cancelUnfinishedCrisisProjects(tx);
  tx.update((draft) => {
    const model = draft.models[modelId];
    const mutableArtifact = model?.candidateArtifact;
    if (model === undefined || mutableArtifact === undefined) {
      throw new Error("Candidate disappeared during retirement transmission");
    }
    mutableArtifact.maximumAccessEver = Math.max(
      mutableArtifact.maximumAccessEver,
      model.accessLevel,
    ) as ModelState["accessLevel"];
    model.accessLevel = 0;
    model.deployment.policy = "internal-only";
    delete model.deployment.plannedPolicy;
    model.deployment.exposure = internalOnly.exposure;
    model.deployment.irreversible = internalOnly.irreversible;
    model.deployment.changedAt = draft.run.tick;
    const lab = draft.labs[model.ownerLabId];
    if (lab?.models.commercialModelId === modelId) {
      delete lab.models.commercialModelId;
    }
    mutableArtifact.lifecycle = "retirement-attempt";
    mutableArtifact.retirementAttemptCount = attemptNumber;
    mutableArtifact.archiveDisposition = configuration.archiveDisposition;
    mutableArtifact.retirementVerification = "pending";
    delete mutableArtifact.activeIncident;
    if (draft.aiCharacter?.modelId === modelId) draft.aiCharacter.currentAccess = 0;
    if (latentCharacter !== undefined && draft.aiCharacter === undefined) {
      draft.aiCharacter = structuredClone(latentCharacter) as DeepMutable<
        typeof latentCharacter
      >;
    }
    draft.endgame = structuredClone(attempt) as DeepMutable<CrisisRetirementAttemptState>;
    draft.run.phase = "crisis";
    const status =
      sequence.containment?.resultId === "local-containment-failure"
        ? "containment-failure"
        : sequence.verification?.resultId === "retirement-verified"
          ? "verified"
          : "unresolved";
    draft.endgameHistory.candidateRetirementHistory.push({
      modelId,
      lineageId: model.lineageId,
      attemptNumber,
      procedureId: configuration.procedureId,
      archiveDisposition: configuration.archiveDisposition,
      transmittedAt: draft.run.tick,
      contested,
      status,
      gateResolutions: structuredClone(gates) as DeepMutable<GateResolutionState[]>,
      ...(status === "containment-failure" ? {} : { resolvedAt: draft.run.tick }),
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `RETIREMENT TRANSMITTED: ${configuration.procedureId}; ${configuration.archiveDisposition}.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.retirement-transmitted" },
      relatedIds: [modelId, configuration.procedureId, configuration.archiveDisposition],
    });
  });
  tx.emit({
    kind: "candidate-retirement-transmitted",
    modelId,
    attemptNumber,
  });

  if (sequence.containment?.resultId === "local-containment-failure") {
    enterContainmentFailure(tx, {
      incidentOriginStage: "retirement",
      incidentOriginActionId: configuration.procedureId,
      incidentOriginModelId: modelId,
      programmeDestroyed: false,
    });
    return;
  }
  if (contested) applyContestedDamage(tx, modelId);
  if (sequence.verification?.resultId !== "retirement-verified") {
    tx.update((draft) => {
      const mutableArtifact = draft.models[modelId]?.candidateArtifact;
      if (mutableArtifact === undefined || draft.endgame.stage !== "retirement-attempt") {
        throw new Error("Unresolved retirement state disappeared");
      }
      mutableArtifact.retirementVerification = "unresolved";
      mutableArtifact.lifecycle = "active-hazard";
      mutableArtifact.activeIncident = {
        id: `retirement-persistence:${modelId}:${String(attemptNumber)}`,
        epoch: mutableArtifact.incidentEpoch,
        incidentClass: "persistence-attempt",
        kind: "warning",
        status: "unresolved",
        triggeredAt: draft.run.tick,
        origin: "weekly-pressure",
        priorLifecycle: "retirement-attempt",
      };
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          "RETIREMENT NOT VERIFIED: inconsistent logs or suspected copies remain. The candidate is still an active visible threat; normal play cannot resume.",
        category: "narrative",
        source: { kind: "system", id: "endgame.retirement-unresolved" },
        relatedIds: [modelId],
      });
    });
    tx.requestAutoPause("crisis-stage");
    return;
  }
  if (priorStage === undefined) {
    enterVerifiedRetirement(tx, configuration.archiveDisposition, contested, gates);
  } else {
    enterVerifiedLatentRetirement(
      tx,
      modelId,
      configuration.archiveDisposition,
      contested,
      attempt,
      gates,
    );
  }
  void content;
}

export function choosePostRetirementPath(
  tx: SimulationTransaction,
  content: CompiledContent,
  path: "successor-programme" | "durable-moratorium",
  _oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  const state = tx.read();
  if (state.endgame.stage !== "recovery") {
    throw new Error("A verified retirement recovery is not active");
  }
  if (state.endgame.postRetirementChoice !== undefined) {
    throw new Error("The post-retirement path has already been chosen");
  }
  if (path === "successor-programme") {
    const efficiencyRate =
      state.endgameHistory.recoveryObligation?.successorEfficiencyRate ??
      successorEfficiencyForArchiveDisposition(state.endgame.archiveDisposition);
    const continuitySummary = state.endgameHistory.successorEfficiencyGrantConsumed
      ? "The one-time continuity grant was already consumed; this retirement cannot create or stack another. SI probability is unchanged."
      : efficiencyRate <= 0
        ? "Destroying every retained artifact preserved no training acceleration. SI probability is unchanged."
        : `The retained research grants one capped ${String(Math.round(efficiencyRate * 100))}% efficiency benefit to the next Product or Frontier training run. Prototype runs do not consume it. The benefit cannot stack or alter SI probability.`;
    tx.update((draft) => {
      if (draft.endgame.stage !== "recovery") throw new Error("Recovery changed");
      draft.endgame.postRetirementChoice = path;
      if (draft.endgameHistory.recoveryObligation === undefined) {
        throw new Error("Recovery obligation disappeared");
      }
      draft.endgameHistory.recoveryObligation.postRetirementChoice = path;
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `The lab chose a successor programme. ${continuitySummary}`,
        category: "narrative",
        source: { kind: "system", id: "endgame.successor-programme" },
        relatedIds: [draft.endgame.retiredModelId],
      });
    });
    finishRecoveryIfReady(tx);
    return;
  }
  const negotiation = {
    context: "post-retirement" as const,
    startedAt: state.run.tick,
    resolvesAt: tick(state.run.tick + MORATORIUM_NEGOTIATION_WEEKS),
  };
  tx.update((draft) => {
    if (draft.endgame.stage !== "recovery") throw new Error("Recovery changed");
    draft.endgame.postRetirementChoice = path;
    draft.endgame.moratoriumNegotiation = structuredClone(negotiation);
    if (draft.endgameHistory.recoveryObligation === undefined) {
      throw new Error("Recovery obligation disappeared");
    }
    draft.endgameHistory.recoveryObligation.postRetirementChoice = path;
    draft.endgameHistory.recoveryObligation.moratoriumNegotiation =
      structuredClone(negotiation);
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `The lab opened an eight-week Long Pause negotiation. The retired artifact remains unavailable while governments and rival programmes decide whether to reciprocate.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.moratorium-negotiation" },
      relatedIds: [draft.endgame.retiredModelId],
    });
  });
  tx.requestAutoPause("crisis-stage");
  void content;
}

function resolvePostRetirementMoratorium(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle,
  effectiveTick: number,
): void {
  const state = tx.read();
  if (
    state.endgame.stage !== "recovery" ||
    state.endgame.moratoriumNegotiation?.context !== "post-retirement"
  ) {
    throw new Error("A post-retirement moratorium negotiation is not active");
  }
  const resolution = resolveDurableMoratoriumGate(state, content, oracle, {
    modelId: state.endgame.retiredModelId,
    reviewerIndependence: state.endgame.evidence.reviewerIndependence,
    context: "post-retirement",
    resolvedAt: effectiveTick,
  });
  tx.update((draft) => {
    if (draft.endgame.stage !== "recovery") throw new Error("Recovery changed");
    draft.endgame.moratoriumResolution = structuredClone(
      resolution,
    ) as DeepMutable<GateResolutionState>;
    if (draft.endgameHistory.recoveryObligation === undefined) {
      throw new Error("Recovery obligation disappeared");
    }
    draft.endgameHistory.recoveryObligation.moratoriumResolution = structuredClone(
      resolution,
    ) as DeepMutable<GateResolutionState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (resolution.resultId === "moratorium-failed" && lab !== undefined) {
      const trustBefore = lab.politics.governmentTrust;
      const attentionBefore = lab.politics.governmentAttention;
      const trustAfter = rating(clamp(trustBefore - 8));
      const attentionAfter = rating(clamp(attentionBefore + 10));
      lab.politics.governmentTrust = trustAfter;
      lab.politics.governmentAttention = attentionAfter;
      const presentationKey = `moratorium-result:${draft.endgame.retiredModelId}:${String(effectiveTick)}`;
      if (!draft.presentationQueue.some((item) => item.key === presentationKey)) {
        draft.presentationQueue.push({
          key: presentationKey,
          kind: "moratorium-result",
          attention: "modal",
          resultId: "moratorium-failed",
          modelId: draft.endgame.retiredModelId,
          createdAt: tick(effectiveTick),
          recoveryEndsAt: draft.endgame.recoveryEndsAt,
          archiveDisposition: draft.endgame.archiveDisposition,
          governmentTrustLost: trustBefore - trustAfter,
          governmentAttentionAdded: attentionAfter - attentionBefore,
        });
      }
    }
    draft.decisionLog.push({
      tick: tick(effectiveTick),
      summary:
        resolution.resultId === "durable-moratorium-secured"
          ? "Independent inspectors and governments secured a durable monitored moratorium."
          : "The attempted moratorium failed; rivals did not pause in solidarity and the run continues.",
      category: "narrative",
      source: { kind: "system", id: "endgame.moratorium" },
      relatedIds: [draft.endgame.retiredModelId],
    });
  });
  tx.emit({
    kind: "candidate-moratorium-resolved",
    modelId: state.endgame.retiredModelId,
    success: resolution.resultId === "durable-moratorium-secured",
  });
  if (resolution.resultId === "durable-moratorium-secured") {
    resolveTerminalEnding(tx, ENDING_DEFINITIONS["the-long-pause"]);
    tx.update((draft) => {
      if (draft.endgame.stage !== "resolved") {
        throw new Error("Long Pause terminal resolution disappeared");
      }
      draft.endgame.enteredAt = tick(effectiveTick);
      draft.endgame.resolvedAt = tick(effectiveTick);
    });
    return;
  }
  tx.requestAutoPause("crisis-stage");
  finishRecoveryIfReady(tx, effectiveTick);
}

function finishRecoveryIfReady(
  tx: SimulationTransaction,
  effectiveTick: number = tx.read().run.tick,
): void {
  const state = tx.read();
  if (
    state.endgame.stage !== "recovery" ||
    state.endgame.postRetirementChoice === undefined ||
    (state.endgame.postRetirementChoice === "durable-moratorium" &&
      state.endgame.moratoriumResolution === undefined) ||
    effectiveTick < state.endgame.recoveryEndsAt
  ) {
    return;
  }
  const modelId = state.endgame.retiredModelId;
  const obligation = state.endgameHistory.recoveryObligation;
  if (obligation === undefined) {
    throw new Error("Recovery completed without its durable obligation");
  }
  tx.update((draft) => {
    if (draft.endgame.stage !== "recovery") throw new Error("Recovery changed");
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab disappeared during recovery");
    if (
      draft.endgame.postRetirementChoice === "successor-programme" &&
      obligation.successorEfficiencyRate > 0 &&
      !draft.endgameHistory.successorEfficiencyGrantConsumed
    ) {
      const heldRate = lab.flags["endgame:successor-efficiency-rate"];
      lab.flags["endgame:successor-efficiency-rate"] = Math.max(
        typeof heldRate === "number" ? heldRate : 0,
        obligation.successorEfficiencyRate,
      );
    }
    delete draft.endgameHistory.recoveryObligation;
    draft.endgame = { stage: "inactive" };
    draft.run.phase = "frontier";
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        "Quarantine and supervised rebuilding completed. Normal play resumes; rivals, finance, and politics continued throughout recovery.",
      category: "narrative",
      source: { kind: "system", id: "endgame.retirement-recovery-completed" },
      relatedIds: [modelId],
    });
  });
  tx.emit({ kind: "candidate-retirement-recovery-completed", modelId });
  tx.requestAutoPause("crisis-stage");
}

export function advanceRetirementRecovery(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  const state = tx.read();
  if (state.run.status !== "active" || state.endgame.stage !== "recovery") return;
  const advancingTo = state.run.tick + 1;
  const negotiation = state.endgame.moratoriumNegotiation;
  if (negotiation !== undefined && advancingTo >= negotiation.resolvesAt) {
    if (negotiation.context === "false-dawn") {
      const outcome = advanceFalseDawnMoratoriumNegotiation(
        tx,
        content,
        oracle,
        advancingTo,
      );
      if (outcome.kind === "moratorium-secured") {
        resolveTerminalMoratoriumFromBase(
          tx,
          ENDING_DEFINITIONS["the-long-pause"],
          outcome.crisisBase,
          outcome.rolloutAudit,
          [outcome.gateResolution],
        );
        tx.update((draft) => {
          if (draft.endgame.stage !== "resolved") {
            throw new Error("False Dawn Long Pause resolution disappeared");
          }
          draft.endgame.enteredAt = tick(advancingTo);
          draft.endgame.resolvedAt = tick(advancingTo);
        });
      }
    } else {
      resolvePostRetirementMoratorium(tx, content, oracle, advancingTo);
    }
    return;
  }
  if (
    state.run.tick < state.endgame.quarantineEndsAt &&
    advancingTo >= state.endgame.quarantineEndsAt
  ) {
    const retiredModelId = state.endgame.retiredModelId;
    tx.update((draft) => {
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          "Retirement recovery entered supervised rebuilding. Lower-risk work may resume; candidate-capable training remains restricted.",
        category: "narrative",
        source: { kind: "system", id: "endgame.recovery-supervised" },
        relatedIds: [retiredModelId],
      });
    });
    tx.emit({
      kind: "candidate-retirement-recovery-phase-changed",
      modelId: retiredModelId,
      phase: "supervised-rebuild",
    });
  }
  if (advancingTo < state.endgame.recoveryEndsAt) return;
  if (state.endgame.postRetirementChoice === undefined) {
    tx.requestAutoPause("crisis-stage");
    return;
  }
  // Ending checks run before the tick-summary phase commits the next week.
  finishRecoveryIfReady(tx, advancingTo);
}
