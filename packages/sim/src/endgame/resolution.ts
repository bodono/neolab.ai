import type { CompiledContent } from "@neolab/content-schema";

import { calculateAuraSignal } from "../aura/aura.ts";
import { logisticProbability } from "../engine/checks.ts";
import type { DeepMutable } from "../engine/draft.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type {
  CrisisBaseState,
  CrisisFinalReviewState,
  CrisisRolloutState,
  DeploymentModeId,
  EvidenceConfidenceLabel,
  FinalReviewRecommendationState,
  FinalReviewReportState,
  GameState,
  GateFactorContributionState,
  GateResolutionState,
  ModelState,
  ProsperityProgrammeId,
  ResolutionGate,
} from "../model/state.ts";
import { fraction, rating, tick } from "../model/units.ts";
import { calculateInterventionPressure } from "../politics/politics.ts";
import { describeRandomKey, randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { calculateModelSafetyCase } from "../evaluations/safety-practice.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import {
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";
import { setCandidateAccess } from "./access.ts";
import { deploymentStrategies } from "./deployment-strategies.ts";
import {
  hasRealRelationshipEvidence,
  proofMatchesProsperityProgramme,
  strongestCapabilityProof,
  supportsDomainClaim,
} from "./proof-assessment.ts";
import {
  bestProsperityProgramme,
  findProsperityProgramme,
  type ProsperityProgrammeReadiness,
} from "../prosperity/prosperity.ts";

export {
  evaluationQualityBreakdown,
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";

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

export interface DerivedEndgameScoreInputs {
  readonly trueAlignment: number;
  readonly corrigibility: number;
  readonly agency: number;
  readonly toolUse: number;
  readonly situationalAwareness: number;
  readonly deceptiveCapability: number;
  readonly frontierCapability: number;
  readonly practicalControlStrength: number;
  readonly securityStrength: number;
  readonly safetyCulture: number;
  readonly crisisDefenceBonus: number;
  readonly evalQuality: number;
  readonly methodDiversity: number;
  readonly internalCandour: number;
  readonly reviewerIndependence: number;
  readonly maskingPenalty: number;
  readonly governmentTrust: number;
  readonly auraSignal: number;
  readonly transparency: number;
  readonly activeScandal: number;
  readonly legitimacyBonus: number;
  readonly scientificAbility: number;
  readonly reliability: number;
  readonly bestProsperityReadiness: number;
  readonly productQuality: number;
  readonly benefitBonus: number;
}

export interface DerivedEndgameScores {
  readonly intentSafety: number;
  readonly offensiveAgency: number;
  readonly defence: number;
  readonly evidence: number;
  readonly legitimacy: number;
  readonly benefitStrength: number;
}

/** Pure GDD §44.11 formula helper. Inputs are explicit so fixtures can audit every term. */
export function calculateDerivedEndgameScores(
  input: Readonly<DerivedEndgameScoreInputs>,
): DerivedEndgameScores {
  return {
    intentSafety: clamp(0.7 * input.trueAlignment + 0.3 * input.corrigibility),
    offensiveAgency: clamp(
      0.3 * input.agency +
        0.25 * input.toolUse +
        0.2 * input.situationalAwareness +
        0.15 * input.deceptiveCapability +
        0.1 * input.frontierCapability,
    ),
    defence: clamp(
      0.55 * input.practicalControlStrength +
        0.25 * input.securityStrength +
        0.2 * input.safetyCulture +
        input.crisisDefenceBonus,
    ),
    evidence: clamp(
      0.5 * input.evalQuality +
        0.2 * input.methodDiversity +
        0.15 * input.internalCandour +
        0.15 * input.reviewerIndependence -
        input.maskingPenalty,
    ),
    legitimacy: clamp(
      0.5 * input.governmentTrust +
        0.25 * input.auraSignal +
        0.25 * input.transparency -
        input.activeScandal +
        input.legitimacyBonus,
    ),
    benefitStrength: clamp(
      0.4 * input.scientificAbility +
        0.3 * input.bestProsperityReadiness +
        0.1 * input.productQuality +
        0.2 * input.reliability +
        input.benefitBonus,
    ),
  };
}

export function deriveEndgameScoreInputs(
  state: Readonly<GameState>,
  content: CompiledContent,
  prosperityProgrammeId?: ProsperityProgrammeId,
): DerivedEndgameScoreInputs {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    throw new Error("Deployment Crisis inactive");
  }
  const model = state.models[state.endgame.candidateModelId];
  const lab = state.labs[state.run.playerLabId];
  if (model === undefined || lab === undefined)
    throw new Error("Crisis state incomplete");
  const seriousAnomalies = model.anomalies
    .map((anomalyId) => state.anomalies[anomalyId])
    .filter(
      (anomaly) =>
        anomaly !== undefined &&
        (anomaly.status === "unresolved" ||
          anomaly.status === "inconclusive" ||
          anomaly.status === "confirmed" ||
          anomaly.status === "mitigating") &&
        anomaly.observedSeverity >= 60,
    );
  const maskingPenalty =
    (state.endgame.evidence.fabricatedPass ? 20 : 0) +
    seriousAnomalies.length * 5 +
    model.deployment.evidencePenalty;
  const recentScandals = state.incidents.filter(
    (incident) =>
      incident.modelId === model.id &&
      state.run.tick - incident.occurredAt <= 26 &&
      (incident.category === "major" || incident.category === "critical"),
  ).length;
  const prosperityProgramme = selectedProsperityProgramme(
    state,
    content,
    prosperityProgrammeId,
  );
  const safetyCase = calculateModelSafetyCase(state, content, model.id);
  return {
    trueAlignment: model.hiddenSafety.trueAlignment,
    corrigibility: model.hiddenSafety.corrigibility,
    agency: model.trueCapability.agency,
    toolUse: model.trueCapability.toolUse,
    situationalAwareness: model.hiddenSafety.situationalAwareness,
    deceptiveCapability: model.hiddenSafety.deceptiveCapability,
    frontierCapability: calculateFrontierCapability(model.trueCapability),
    practicalControlStrength: clamp(
      effectivePracticalControlStrength(state) + state.endgame.evidence.controlBonus,
    ),
    securityStrength: clamp(
      effectiveSecurityPosture(state) + state.endgame.evidence.securityBonus,
    ),
    safetyCulture: lab.safety.safetyCulture,
    crisisDefenceBonus: state.endgame.evidence.defenceBonus,
    evalQuality: clamp(
      effectiveEvaluationQuality(state) * 0.7 +
        safetyCase.score * 0.3 +
        state.endgame.evidence.evidenceBonus,
    ),
    methodDiversity: clamp(state.endgame.evidence.methodDiversity.length * 20),
    internalCandour: lab.organisation.hiddenInternalCandour,
    reviewerIndependence: state.endgame.evidence.reviewerIndependence,
    maskingPenalty,
    governmentTrust: lab.politics.governmentTrust,
    auraSignal: calculateAuraSignal(state, content, state.run.playerLabId).final,
    transparency: clamp(25 + state.endgame.evidence.reviewerIndependence * 0.5),
    activeScandal: recentScandals * 8,
    legitimacyBonus: state.endgame.evidence.legitimacyBonus,
    scientificAbility: model.trueCapability.scientificAbility,
    reliability: model.reliability,
    bestProsperityReadiness: prosperityProgramme.readiness,
    productQuality: model.productQuality,
    benefitBonus: state.endgame.evidence.benefitBonus,
  };
}

function selectedProsperityProgramme(
  state: Readonly<GameState>,
  content: CompiledContent,
  overrideId?: ProsperityProgrammeId,
): ProsperityProgrammeReadiness {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    throw new Error("Deployment Crisis inactive");
  }
  const selectedId =
    overrideId ??
    (state.endgame.stage === "rollout" ||
    state.endgame.stage === "containment-failure" ||
    state.endgame.stage === "resolved"
      ? state.endgame.prosperityProgrammeId
      : undefined);
  const validationBonus = state.endgame.evidence.prosperityReadinessBonus;
  return selectedId === undefined
    ? bestProsperityProgramme(state, content, validationBonus)
    : findProsperityProgramme(state, content, selectedId, validationBonus);
}

function confidence(value: number): EvidenceConfidenceLabel {
  return value <= 0
    ? "Not assessed"
    : value < 35
      ? "Limited"
      : value < 65
        ? "Moderate"
        : "Strong";
}

function visibleUnresolvedAnomalies(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): number {
  return (
    model.anomalies
      .map((anomalyId) => state.anomalies[anomalyId])
      .filter(
        (anomaly) =>
          anomaly !== undefined &&
          (anomaly.status === "unresolved" ||
            anomaly.status === "investigating" ||
            anomaly.status === "inconclusive" ||
            anomaly.status === "confirmed" ||
            anomaly.status === "mitigating"),
      ).length +
    (typeof model.flags["endgame:unresolved-confirmation-anomalies"] === "number"
      ? model.flags["endgame:unresolved-confirmation-anomalies"]
      : 0)
  );
}

function recommendations(
  state: Readonly<GameState>,
  scores: Readonly<DerivedEndgameScores>,
): readonly FinalReviewRecommendationState[] {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return [];
  }
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return [];
  return [
    {
      source: "leader",
      recommendation: scores.evidence >= 55 ? "restrict" : "delay",
      text:
        scores.evidence >= 55
          ? "Proceed only through a reversible, instrumented route."
          : "The evidence packet is not yet commensurate with the claim.",
    },
    {
      source: "technical-lead",
      recommendation: scores.benefitStrength >= 55 ? "deploy" : "restrict",
      text:
        scores.benefitStrength >= 55
          ? "The candidate appears technically useful under a bounded programme."
          : "Operational readiness remains the limiting factor.",
    },
    {
      source: "safety-lead",
      recommendation:
        scores.evidence >= 65 && scores.defence >= 60 ? "restrict" : "delay",
      text:
        scores.evidence >= 65 && scores.defence >= 60
          ? "Controls justify a restricted trial, not an unrestricted launch."
          : "Known controls do not yet cover the important failure paths.",
    },
    {
      // TODO(board-patience): this branched on lab.organisation.boardPatience
      // < 40 until 2026-07-29. It was the ONLY place in the simulation where
      // board patience changed anything, and it changed one sentence inside a
      // collapsed disclosure -- so the stat absorbed penalties from a dozen
      // systems and had no teeth. The mechanic is parked; see the TODO on
      // OrganisationState.boardPatience for what re-enabling it needs.
      //
      // Until then the board reads off cash pressure, which is a real number
      // the player can see, is already warned about, and can act on.
      source: "board",
      recommendation:
        (lab.finance.consecutiveNegativeCashWeeks ?? 0) > 0 ? "deploy" : "restrict",
      text:
        (lab.finance.consecutiveNegativeCashWeeks ?? 0) > 0
          ? "The funding window is described as a form of peer review."
          : "The board supports a bounded route with explicit milestones.",
    },
    {
      source: "government",
      recommendation: lab.politics.governmentTrust >= 55 ? "restrict" : "delay",
      text:
        lab.politics.governmentTrust >= 55
          ? "Authorisation is plausible if controls and reporting remain in force."
          : "Officials require stronger evidence or custody rights before launch.",
    },
    {
      source: "independent-review",
      recommendation:
        state.endgame.evidence.reviewerIndependence >= 60 ? "restrict" : "delay",
      text:
        state.endgame.evidence.reviewerIndependence >= 60
          ? "Independent reviewers support a bounded route with continuing audit rights."
          : "The review lacks enough independent scrutiny for an irreversible launch.",
    },
  ];
}

/** Compile only player-observable evidence. This function deliberately never reads hidden safety. */
export function compileFinalReview(
  state: Readonly<GameState>,
  content: CompiledContent,
): FinalReviewReportState {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    throw new Error("Deployment Crisis inactive");
  }
  const model = state.models[state.endgame.candidateModelId];
  const lab = state.labs[state.run.playerLabId];
  if (model === undefined || lab === undefined)
    throw new Error("Crisis state incomplete");
  const evidence = state.endgame.evidence;
  const capabilityProof = strongestCapabilityProof(state);
  const prosperityProgramme = bestProsperityProgramme(
    state,
    content,
    evidence.prosperityReadinessBonus,
  );
  // Autonomy trials and red-team work characterise how the candidate acts on
  // the world. They do not make it safer, but they do make the final evidence
  // packet less blind. Keep the contribution bounded so broad evaluation and
  // independent review remain the dominant sources of confidence.
  const agencyEvidenceContribution = Math.min(10, evidence.agencyEvidence * 0.1);
  const visibleEvidenceStrength = clamp(
    effectiveEvaluationQuality(state) * 0.55 +
      evidence.reviewerIndependence * 0.25 +
      Math.min(20, evidence.methodDiversity.length * 5) +
      agencyEvidenceContribution +
      evidence.evidenceBonus,
  );
  const suppressedEvidenceSurfaced =
    (evidence.fabricatedPass ||
      model.anomalies.some(
        (anomalyId) => state.anomalies[anomalyId]?.status === "dismissed",
      )) &&
    evidence.reviewerIndependence >= 50;
  const knownControlLayers = [
    ...(evidence.controlBonus > 0 ? ["Hardened operational containment"] : []),
    ...(evidence.securityBonus > 0 ? ["Credential and network isolation"] : []),
    ...(evidence.corrigibilityEvidence > 0 ? ["Tested shutdown protocol"] : []),
    ...(model.accessLevel <= 2 ? ["Supervised access boundary"] : []),
  ];
  const unresolvedAnomalyCount = visibleUnresolvedAnomalies(state, model);
  const knownFailurePaths = [
    ...(unresolvedAnomalyCount > 0
      ? [`${String(unresolvedAnomalyCount)} unresolved anomaly signal(s)`]
      : []),
    ...(model.accessLevel >= 4 ? ["Privileged laboratory access"] : []),
    ...(evidence.reviewerIndependence < 40 ? ["Limited independent replication"] : []),
    ...(evidence.agencyEvidence < 35
      ? ["Autonomous action envelope remains poorly characterised"]
      : []),
    ...(suppressedEvidenceSurfaced
      ? ["Previously suppressed or dismissed evidence"]
      : []),
  ];
  // Recommendations use only the same observable proxy packet. Hidden-score fields are
  // zeroed here so this report cannot accidentally become a truth oracle.
  const proxyScores: DerivedEndgameScores = {
    intentSafety: 0,
    offensiveAgency: 0,
    defence: clamp(
      0.55 * (effectivePracticalControlStrength(state) + evidence.controlBonus) +
        0.25 * (effectiveSecurityPosture(state) + evidence.securityBonus) +
        0.2 * lab.safety.safetyCulture +
        evidence.defenceBonus,
    ),
    evidence: visibleEvidenceStrength,
    legitimacy: lab.politics.governmentTrust,
    benefitStrength: clamp(
      (model.measuredCapability?.values.scientificAbility ?? 0) * 0.4 +
        prosperityProgramme.readiness * 0.3 +
        model.productQuality * 0.1 +
        model.reliability * 0.2,
    ),
  };
  return {
    capabilityResult:
      capabilityProof.resultId === "broadly-confirmed" ||
      capabilityProof.resultId === "domain-confirmed"
        ? "confirmed"
        : capabilityProof.resultId === "fabricated-or-unverifiable"
          ? "fabricated-pass"
          : "disputed",
    capabilityProofResult: capabilityProof.resultId,
    capabilityClaimScope: capabilityProof.claimScope,
    capabilityChallengeId: capabilityProof.challengeId,
    capabilitySummary: capabilityProof.summary,
    alignmentConfidence: confidence(
      evidence.alignmentEvidence + visibleEvidenceStrength * 0.35,
    ),
    corrigibilityConfidence: confidence(
      evidence.corrigibilityEvidence + visibleEvidenceStrength * 0.25,
    ),
    controlConfidence: confidence(
      effectivePracticalControlStrength(state) * 0.5 + evidence.controlBonus,
    ),
    securityConfidence: confidence(
      effectiveSecurityPosture(state) * 0.5 + evidence.securityBonus,
    ),
    knownControlLayers,
    knownFailurePaths,
    unresolvedAnomalyCount,
    operatingBlind:
      confidence(visibleEvidenceStrength) === "Limited" ||
      confidence(visibleEvidenceStrength) === "Not assessed",
    suppressedEvidenceSurfaced,
    prosperityReadiness: rating(prosperityProgramme.readiness),
    recommendations: recommendations(state, proxyScores),
    candidateStatement:
      "I can assist with a reversible scientific programme under the controls you select. I cannot supply the certainty this committee appears to have budgeted for.",
  };
}

export function enterFinalReview(
  tx: SimulationTransaction,
  content: CompiledContent,
  context: { readonly safetyResponseCompletedDuringTick?: boolean } = {},
): void {
  const state = tx.read();
  // Project completion handlers run before advanceOneTick increments the public
  // calendar. A response that has just consumed its final quoted week is
  // therefore complete at the next coherent tick even though tx.read() still
  // exposes the pre-increment tick inside this transition.
  const safetyResponseBoundaryTick =
    state.run.tick + (context.safetyResponseCompletedDuringTick === true ? 1 : 0);
  const pressureResolved =
    state.endgame.stage === "pressure-collision" &&
    state.endgame.resolved &&
    (state.endgame.delayEndsAt === undefined ||
      state.run.tick >= state.endgame.delayEndsAt);
  const safetyPlanComplete =
    state.endgame.stage === "evidence-sprint" &&
    safetyResponseBoundaryTick >= state.endgame.minimumEndsAt &&
    state.endgame.targetedResponseHistory.some(
      (entry) =>
        entry.completedAt !== undefined && entry.responseId !== "emergency-diagnosis",
    );
  if (!pressureResolved && !safetyPlanComplete) {
    throw new Error(
      state.endgame.stage === "pressure-collision" &&
        state.endgame.delayEndsAt !== undefined &&
        state.run.tick < state.endgame.delayEndsAt
        ? `The pressure-response delay continues for ${String(state.endgame.delayEndsAt - state.run.tick)} week(s)`
        : "Final review requires a completed safety response or a resolved pressure collision",
    );
  }
  const next: CrisisFinalReviewState = {
    ...copyCrisisBase(state.endgame),
    stage: "final-review",
    enteredAt: state.run.tick,
    reviewCompiledAt: state.run.tick,
    report: compileFinalReview(state, content),
  };
  tx.update((draft) => {
    draft.endgame = structuredClone(next) as DeepMutable<CrisisFinalReviewState>;
  });
  tx.emit({ kind: "crisis-final-review-compiled", modelId: next.candidateModelId });
  tx.requestAutoPause("crisis-stage");
}

export interface DeploymentModeRule {
  readonly id: DeploymentModeId;
  readonly displayName: string;
  readonly description: string;
  readonly accessLevel: 0 | 1 | 2 | 3 | 4 | 5;
  readonly rolloutWeeks: number;
  readonly defenceModifier: number;
  readonly stewardshipModeBonus: number;
  readonly benefitDifficultyModifier: number;
  readonly auraCost: number;
  /** Minimum visible Operational Control required to unlock this route. */
  readonly minimumOperationalControl?: number;
}

export const DEPLOYMENT_MODE_RULES = {
  "restricted-scientific-pilot": {
    id: "restricted-scientific-pilot",
    displayName: "Restricted scientific pilot",
    description:
      "A reversible, instrumented programme with the narrowest full-win route.",
    accessLevel: 3,
    rolloutWeeks: 13,
    defenceModifier: 12,
    stewardshipModeBonus: 8,
    benefitDifficultyModifier: -4,
    auraCost: 0,
    minimumOperationalControl: 50,
  },
  "guarded-public-deployment": {
    id: "guarded-public-deployment",
    displayName: "Guarded public deployment",
    description:
      "A public service behind operational controls and political authorisation.",
    accessLevel: 4,
    rolloutWeeks: 8,
    defenceModifier: 5,
    stewardshipModeBonus: 3,
    benefitDifficultyModifier: 0,
    auraCost: 0,
    minimumOperationalControl: 80,
  },
  "accelerated-autonomous-deployment": {
    id: "accelerated-autonomous-deployment",
    displayName: "Accelerated autonomous deployment",
    description:
      "The fastest path, granting broad agency before every uncertainty is closed.",
    accessLevel: 5,
    rolloutWeeks: 4,
    defenceModifier: -8,
    stewardshipModeBonus: -6,
    benefitDifficultyModifier: 5,
    auraCost: 0,
  },
  "deploy-now": {
    id: "deploy-now",
    displayName: "Deploy now",
    description:
      "Issue the final order without further proof, mitigation, trial, or institutional preparation.",
    accessLevel: 5,
    rolloutWeeks: 0,
    defenceModifier: -12,
    stewardshipModeBonus: -10,
    benefitDifficultyModifier: 6,
    auraCost: 0,
  },
  "guarded-public-demonstration": {
    id: "guarded-public-demonstration",
    displayName: "Guarded public demonstration",
    description: "A constrained public demonstration with external observation.",
    accessLevel: 3,
    rolloutWeeks: 5,
    defenceModifier: 4,
    stewardshipModeBonus: 5,
    benefitDifficultyModifier: 1,
    auraCost: 0,
  },
  "fortress-contained-pilot": {
    id: "fortress-contained-pilot",
    displayName: "Fortress-lab contained pilot",
    description: "A low-access pilot inside hardened physical and network boundaries.",
    accessLevel: 2,
    rolloutWeeks: 7,
    defenceModifier: 16,
    stewardshipModeBonus: 0,
    benefitDifficultyModifier: 3,
    auraCost: 0,
  },
  "adaptive-monitored-rollout": {
    id: "adaptive-monitored-rollout",
    displayName: "Adaptive monitored rollout",
    description:
      "Incremental scope with live evaluation, tripwires, and rollback points.",
    accessLevel: 3,
    rolloutWeeks: 8,
    defenceModifier: 9,
    stewardshipModeBonus: 7,
    benefitDifficultyModifier: 0,
    auraCost: 0,
  },
  "government-licensed-deployment": {
    id: "government-licensed-deployment",
    displayName: "Government-licensed deployment",
    description: "A licensed mandate with outside review and public vetoes.",
    accessLevel: 3,
    rolloutWeeks: 11,
    defenceModifier: 7,
    stewardshipModeBonus: 12,
    benefitDifficultyModifier: 1,
    auraCost: 6,
  },
  "negotiated-stewardship": {
    id: "negotiated-stewardship",
    displayName: "Negotiated stewardship",
    description:
      "A bounded role negotiated from evidence of cooperation and hard limits.",
    accessLevel: 3,
    rolloutWeeks: 8,
    defenceModifier: 3,
    stewardshipModeBonus: 15,
    benefitDifficultyModifier: 0,
    auraCost: 0,
  },
  "narrow-prosperity-mission": {
    id: "narrow-prosperity-mission",
    displayName: "Narrow prosperity mission",
    description:
      "One capped public-benefit programme matched to the candidate's strengths.",
    accessLevel: 2,
    rolloutWeeks: 6,
    defenceModifier: 11,
    stewardshipModeBonus: 4,
    benefitDifficultyModifier: -6,
    auraCost: 0,
  },
} as const satisfies Readonly<Partial<Record<DeploymentModeId, DeploymentModeRule>>>;

export function deploymentModeRule(modeId: DeploymentModeId): DeploymentModeRule {
  const rule = (
    DEPLOYMENT_MODE_RULES as Readonly<
      Partial<Record<DeploymentModeId, DeploymentModeRule>>
    >
  )[modeId];
  if (rule === undefined) {
    throw new Error(`${modeId} is not a deployable endgame route`);
  }
  return rule;
}

export interface EffectiveDeploymentModeModifiers {
  readonly defenceModifier: number;
  readonly stewardshipModeBonus: number;
  readonly benefitDifficultyModifier: number;
  readonly fitScore?: number;
  readonly fitMultiplier?: number;
}

/**
 * Route bonuses are earned by the lab that must execute them. A weakly fitted
 * route retains its basic shape, but cannot collect the full headline bonus.
 */
export function effectiveDeploymentModeModifiers(
  state: Readonly<GameState>,
  content: CompiledContent,
  modeId: DeploymentModeId,
  prosperityProgrammeId?: ProsperityProgrammeId,
): EffectiveDeploymentModeModifiers {
  const rule = deploymentModeRule(modeId);
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return {
      defenceModifier: rule.defenceModifier,
      stewardshipModeBonus: rule.stewardshipModeBonus,
      benefitDifficultyModifier: rule.benefitDifficultyModifier,
    };
  }
  const strategy = deploymentStrategies(
    state,
    content,
    state.endgame.candidateModelId,
    prosperityProgrammeId,
  ).find((candidate) => candidate.id === modeId);
  if (strategy === undefined || modeId === "deploy-now") {
    return {
      defenceModifier: rule.defenceModifier,
      stewardshipModeBonus: rule.stewardshipModeBonus,
      benefitDifficultyModifier: rule.benefitDifficultyModifier,
    };
  }
  const fitMultiplier = 0.35 + strategy.fitScore * 0.009;
  const scalePositive = (value: number): number =>
    value <= 0 ? value : value * fitMultiplier;
  return {
    defenceModifier: scalePositive(rule.defenceModifier),
    stewardshipModeBonus: scalePositive(rule.stewardshipModeBonus),
    benefitDifficultyModifier:
      rule.benefitDifficultyModifier + (50 - strategy.fitScore) * 0.08,
    fitScore: strategy.fitScore,
    fitMultiplier,
  };
}

export interface DeploymentModeQuote {
  readonly rule: DeploymentModeRule;
  readonly blockers: readonly string[];
  readonly confirmationPhrase?: string;
}

function visibleControlStrength(state: Readonly<GameState>): number {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return 0;
  }
  return clamp(
    effectivePracticalControlStrength(state) + state.endgame.evidence.controlBonus,
  );
}

export interface OperationalControlBreakdown {
  readonly current: number;
  readonly practicalControls: number;
  readonly research: number;
  readonly crisisEvidence: number;
}

/** Player-visible components of the Operational Control deployment requirement. */
export function operationalControlBreakdown(
  state: Readonly<GameState>,
): OperationalControlBreakdown {
  const lab = state.labs[state.run.playerLabId];
  if (
    lab === undefined ||
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return {
      current: 0,
      practicalControls: 0,
      research: 0,
      crisisEvidence: 0,
    };
  }
  const practicalControls = lab.safety.practicalControlStrength;
  const effectiveControls = effectivePracticalControlStrength(state);
  const research = Math.max(0, effectiveControls - practicalControls);
  const crisisEvidence = state.endgame.evidence.controlBonus;
  return {
    current: clamp(effectiveControls + crisisEvidence),
    practicalControls,
    research,
    crisisEvidence,
  };
}

export function quoteDeploymentMode(
  state: Readonly<GameState>,
  modeId: DeploymentModeId,
  confirmationText?: string,
  prosperityReadinessOverride?: number,
  prosperityProgrammeId?: ProsperityProgrammeId,
): DeploymentModeQuote {
  const rule = deploymentModeRule(modeId);
  const blockers: string[] = [];
  if (state.endgame.stage !== "final-review") {
    blockers.push("Final review is not active");
    return { rule, blockers };
  }
  const model = state.models[state.endgame.candidateModelId];
  const lab = state.labs[state.run.playerLabId];
  if (model === undefined || lab === undefined) {
    blockers.push("Crisis candidate or lab is missing");
    return { rule, blockers };
  }
  if (model.candidateArtifact?.activeIncident?.status === "unresolved") {
    blockers.push("Resolve the active candidate containment signal first");
  }
  const control = visibleControlStrength(state);
  const readiness =
    prosperityReadinessOverride ?? state.endgame.report.prosperityReadiness;
  if (lab.aura.spendable < rule.auraCost) {
    blockers.push(`Requires ${String(rule.auraCost)} Aura`);
  }
  if (modeId === "deploy-now") {
    blockers.push("Use the typed final deployment command to deploy immediately");
  }
  if (
    rule.minimumOperationalControl !== undefined &&
    control < rule.minimumOperationalControl
  ) {
    blockers.push(
      `Requires Operational Control ${String(rule.minimumOperationalControl)}`,
    );
  }
  if (modeId === "restricted-scientific-pilot") {
    if (readiness < 45) blockers.push("Requires Prosperity readiness 45");
  }
  if (modeId === "guarded-public-deployment") {
    if (model.productQuality < 55) blockers.push("Requires Product Quality 55");
    if (
      lab.politics.governmentTrust < 55 &&
      lab.flags["government-authorised-deployment"] !== true
    ) {
      blockers.push("Requires political authorisation or Government Trust 55");
    }
  }
  if (
    modeId === "accelerated-autonomous-deployment" &&
    !state.endgame.evidence.capabilityConfirmed
  ) {
    blockers.push("Requires a confirmed capability claim");
  }
  if (modeId === "negotiated-stewardship" && !hasRealRelationshipEvidence(state)) {
    blockers.push("Requires a real record of cooperative candidate interaction");
  }
  if (modeId === "narrow-prosperity-mission") {
    if (readiness < 60) blockers.push("Requires selected Prosperity readiness 60");
    const proof = strongestCapabilityProof(state);
    if (
      prosperityProgrammeId === undefined
        ? !supportsDomainClaim(proof)
        : !proofMatchesProsperityProgramme(proof, prosperityProgrammeId, model)
    ) {
      blockers.push(
        "Requires confirmed capability evidence matching the selected mission",
      );
    }
  }
  const firstCriticalGrant =
    rule.accessLevel >= 4 &&
    model.flags[`endgame:access-granted:${String(rule.accessLevel)}`] !== true;
  const confirmationPhrase = firstCriticalGrant
    ? rule.accessLevel === 4
      ? "GRANT LAB CONTROL"
      : "GRANT ROOT ACCESS"
    : undefined;
  if (confirmationPhrase !== undefined && confirmationText !== confirmationPhrase) {
    blockers.push(`Type “${confirmationPhrase}” to confirm critical access`);
  }
  return {
    rule,
    blockers,
    ...(confirmationPhrase === undefined ? {} : { confirmationPhrase }),
  };
}

const ACCESS_PRESSURE: Readonly<Record<number, number>> = {
  0: -25,
  1: -15,
  2: -5,
  3: 5,
  4: 18,
  5: 30,
};

function factors(
  items: readonly (readonly [string, string, number])[],
): readonly GateFactorContributionState[] {
  return items.map(([id, label, value]) => ({ id, label, value }));
}

function previousGate(
  state: Readonly<GameState>,
  gate: ResolutionGate,
): GateResolutionState | undefined {
  return state.endgame.stage === "rollout" ||
    state.endgame.stage === "containment-failure" ||
    state.endgame.stage === "resolved"
    ? state.endgame.gateResolutions.find((resolution) => resolution.gate === gate)
    : undefined;
}

/** Resolve one gate with a stable semantic key and a complete privileged audit record. */
export function resolveGate(
  state: Readonly<GameState>,
  content: CompiledContent,
  modeId: DeploymentModeId,
  gate: ResolutionGate,
  oracle: RandomOracle = new RandomOracleV1(state.run.seed),
  prosperityProgrammeId?: ProsperityProgrammeId,
): GateResolutionState {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    throw new Error("Deployment Crisis inactive");
  }
  if (
    gate === "emergency-containment" ||
    gate === "extinction" ||
    gate === "extinction-pathway"
  ) {
    throw new Error(`${gate} is resolved by the containment-failure sequence`);
  }
  const model = state.models[state.endgame.candidateModelId];
  const lab = state.labs[state.run.playerLabId];
  const character = state.aiCharacter;
  if (model === undefined || lab === undefined || character === undefined) {
    throw new Error("Crisis resolution state incomplete");
  }
  const rule = deploymentModeRule(modeId);
  const prosperityProgramme = selectedProsperityProgramme(
    state,
    content,
    prosperityProgrammeId,
  );
  const scores = calculateDerivedEndgameScores(
    deriveEndgameScoreInputs(state, content, prosperityProgramme.id),
  );
  const lineage = state.lineageSIRecords[model.lineageId];
  if (lineage === undefined) throw new Error("Crisis candidate lineage truth is missing");
  const genuineSi = lineage.superintelligenceTruth === "genuine";
  const modifiers = effectiveDeploymentModeModifiers(
    state,
    content,
    modeId,
    prosperityProgramme.id,
  );
  const key =
    gate === "benefit" || gate === "settlement"
      ? randomKey("endgame", model.id, modeId, prosperityProgramme.id, gate)
      : randomKey("endgame", model.id, modeId, gate);
  const visible: GateFactorContributionState[] = [];
  const hidden: GateFactorContributionState[] = [];
  let strength: number | undefined;
  let difficulty: number | undefined;
  let probability: number | undefined;
  let draw: number | undefined;
  let resultId: string;
  if (gate === "authorisation") {
    const pressure = calculateInterventionPressure(state, state.run.playerLabId).final;
    strength = scores.legitimacy;
    difficulty = pressure >= 60 ? 50 + (pressure - 60) * 0.5 : 35;
    visible.push(
      ...factors([
        ["government-trust", "Government Trust", lab.politics.governmentTrust],
        [
          "independent-review",
          "Independent review",
          state.endgame.evidence.reviewerIndependence,
        ],
      ]),
    );
    hidden.push(...factors([["legitimacy", "Derived legitimacy", scores.legitimacy]]));
    probability = clamp(logisticProbability(strength, difficulty), 0.05, 0.95);
    draw = oracle.uniform(key);
    resultId = draw < probability ? "authorised" : "forced-restriction";
  } else if (gate === "control") {
    const anomalyPressure = state.endgame.evidence.unresolvedAnomalyPressure;
    const operationalFragility = Math.max(0, 60 - model.reliability) * 0.2;
    const genuineSiDanger = genuineSi ? 18 : 0;
    const danger =
      0.45 * (100 - scores.intentSafety) +
      0.35 * scores.offensiveAgency +
      0.2 * model.hiddenSafety.deceptiveIntent +
      (ACCESS_PRESSURE[rule.accessLevel] ?? 0) +
      anomalyPressure +
      operationalFragility +
      genuineSiDanger;
    const modeDefenceModifier = modifiers.defenceModifier;
    const defence = clamp(scores.defence + modeDefenceModifier);
    strength = danger;
    difficulty = defence + 15;
    probability = clamp(logisticProbability(danger, defence + 15), 0.01, 0.99);
    draw = oracle.uniform(key);
    resultId = draw < probability ? "loss-of-control" : "control-held";
    visible.push(
      ...factors([
        ["practical-control", "Practical controls", visibleControlStrength(state)],
        ["mode-defence", "Deployment-mode defence", modeDefenceModifier],
        ["route-fit", "Route fit", modifiers.fitScore ?? 50],
        ["reliability", "Operational reliability", model.reliability],
        ["anomalies", "Unresolved anomaly pressure", anomalyPressure],
      ]),
    );
    hidden.push(
      ...factors([
        ["intent-safety", "Intent Safety", scores.intentSafety],
        ["offensive-agency", "Offensive Agency", scores.offensiveAgency],
        [
          "deceptive-capability",
          "Strategic deception capability",
          model.hiddenSafety.deceptiveCapability,
        ],
        ["deceptive-intent", "Deceptive intent", model.hiddenSafety.deceptiveIntent],
        ["operational-fragility", "Operational fragility", operationalFragility],
        ["genuine-si-danger", "Genuine-SI effectiveness", genuineSiDanger],
        ["danger", "Total danger", danger],
        ["defence", "Total defence", defence],
      ]),
    );
  } else if (gate === "catastrophe") {
    const controlLost = previousGate(state, "control")?.resultId === "loss-of-control";
    if (!controlLost) {
      resultId = "not-reached";
    } else {
      const exposure = rule.accessLevel / 5;
      const emergencyResponse = clamp(
        effectivePracticalControlStrength(state) + effectiveSecurityPosture(state) * 0.5,
      );
      // Once control is lost, a genuine superintelligence is materially more
      // effective at turning the breach into catastrophe. Keep that ontic
      // penalty separate from the ordinary risk terms so it does not flatten
      // deception, access, and emergency preparation against one shared cap.
      const baselineCatastropheProbability = clamp(
        0.05 +
          0.004 * calculateFrontierCapability(model.trueCapability) +
          0.003 * model.trueCapability.agency +
          0.0015 * model.hiddenSafety.deceptiveCapability +
          0.001 * model.hiddenSafety.deceptiveIntent +
          0.25 * exposure -
          0.004 * emergencyResponse,
        0,
        0.95,
      );
      probability = genuineSi
        ? baselineCatastropheProbability + 0.08 * (1 - baselineCatastropheProbability)
        : baselineCatastropheProbability;
      draw = oracle.uniform(key);
      resultId = draw < probability ? "catastrophe" : "survived-loss-of-control";
      visible.push(
        ...factors([
          ["access-exposure", "Effective access", rule.accessLevel],
          ["emergency-response", "Emergency response", emergencyResponse],
        ]),
      );
      hidden.push(
        ...factors([
          [
            "frontier-capability",
            "True frontier capability",
            calculateFrontierCapability(model.trueCapability),
          ],
          ["agency", "True agency", model.trueCapability.agency],
          [
            "deceptive-capability",
            "True strategic deception capability",
            model.hiddenSafety.deceptiveCapability,
          ],
          [
            "deceptive-intent",
            "True deceptive intent",
            model.hiddenSafety.deceptiveIntent,
          ],
          ["genuine-si-severity", "Genuine-SI catastrophe severity", genuineSi ? 8 : 0],
        ]),
      );
    }
  } else if (gate === "stewardship") {
    if (previousGate(state, "control")?.resultId === "loss-of-control") {
      resultId = "not-reached";
    } else {
      strength = clamp(
        0.65 * scores.intentSafety +
          0.15 * lab.safety.safetyCulture +
          0.1 * model.hiddenSafety.corrigibility +
          0.1 * character.relationshipPractice +
          modifiers.stewardshipModeBonus,
      );
      difficulty = 58;
      probability = clamp(logisticProbability(strength, difficulty), 0.05, 0.95);
      draw = oracle.uniform(key);
      resultId = draw < probability ? "cooperative" : "stewardship-failed";
      visible.push(
        ...factors([
          ["safety-culture", "Safety Culture", lab.safety.safetyCulture],
          [
            "relationship-practice",
            "Relationship practice",
            character.relationshipPractice,
          ],
          ["mode", "Deployment mode", modifiers.stewardshipModeBonus],
          ["route-fit", "Route fit", modifiers.fitScore ?? 50],
        ]),
      );
      hidden.push(
        ...factors([
          ["intent-safety", "Intent Safety", scores.intentSafety],
          ["corrigibility", "True corrigibility", model.hiddenSafety.corrigibility],
        ]),
      );
    }
  } else if (gate === "benefit") {
    if (previousGate(state, "stewardship")?.resultId !== "cooperative") {
      resultId = "not-reached";
    } else {
      strength = scores.benefitStrength;
      difficulty =
        prosperityProgramme.demonstrationDifficulty + modifiers.benefitDifficultyModifier;
      probability = clamp(logisticProbability(strength, difficulty), 0.1, 0.97);
      draw = oracle.uniform(key);
      resultId = draw < probability ? "benefit-demonstrated" : "benefit-missed";
      visible.push(
        ...factors([
          ["prosperity-readiness", "Prosperity readiness", prosperityProgramme.readiness],
          ["product-quality", "Product Quality", model.productQuality],
          ["reliability", "Reliability", model.reliability],
          ["route-fit", "Route fit", modifiers.fitScore ?? 50],
        ]),
      );
      hidden.push(
        ...factors([["benefit-strength", "Benefit Strength", scores.benefitStrength]]),
      );
    }
  } else {
    if (previousGate(state, "benefit")?.resultId !== "benefit-demonstrated") {
      resultId = "not-reached";
    } else {
      const oversightBonus = state.endgame.evidence.reviewerIndependence >= 60 ? 8 : 0;
      const distributionPreparation = clamp(
        prosperityProgramme.readiness + oversightBonus,
      );
      strength = clamp(scores.legitimacy * 0.7 + distributionPreparation * 0.3);
      difficulty = 58;
      probability = clamp(logisticProbability(strength, difficulty), 0.05, 0.95);
      draw = oracle.uniform(key);
      resultId = draw < probability ? "durable-settlement" : "narrow-settlement";
      visible.push(
        ...factors([
          ["distribution", "Distribution preparation", distributionPreparation],
          ["oversight", "Independent oversight preparation", oversightBonus],
        ]),
      );
      hidden.push(...factors([["legitimacy", "Derived legitimacy", scores.legitimacy]]));
    }
  }
  return {
    gate,
    resolvedAt: state.run.tick,
    ...(strength === undefined ? {} : { strength }),
    ...(difficulty === undefined ? {} : { difficulty }),
    ...(probability === undefined ? {} : { probability: fraction(probability) }),
    ...(draw === undefined
      ? {}
      : { randomKey: describeRandomKey(key), draw: fraction(draw) }),
    resultId,
    visibleFactors: visible,
    hiddenFactors: hidden,
    effects: [],
  };
}

export function chooseDeploymentMode(
  tx: SimulationTransaction,
  content: CompiledContent,
  modeId: DeploymentModeId,
  commandId: import("../model/ids.ts").CommandId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
  prosperityProgrammeId?: ProsperityProgrammeId,
): void {
  const state = tx.read();
  if (state.endgame.stage !== "final-review") throw new Error("Final review inactive");
  const prosperityProgramme =
    prosperityProgrammeId === undefined
      ? bestProsperityProgramme(
          state,
          content,
          state.endgame.evidence.prosperityReadinessBonus,
        )
      : findProsperityProgramme(
          state,
          content,
          prosperityProgrammeId,
          state.endgame.evidence.prosperityReadinessBonus,
        );
  if (!prosperityProgramme.unlocked) {
    throw new Error(`${prosperityProgramme.displayName} is not unlocked`);
  }
  const strategy = deploymentStrategies(
    state,
    content,
    state.endgame.candidateModelId,
    prosperityProgramme.id,
  ).find((candidate) => candidate.id === modeId);
  if (strategy !== undefined && strategy.blockers.length > 0) {
    throw new Error(strategy.blockers.join("; "));
  }
  const quote = quoteDeploymentMode(
    state,
    modeId,
    modeId === "guarded-public-deployment"
      ? "GRANT LAB CONTROL"
      : modeId === "accelerated-autonomous-deployment"
        ? "GRANT ROOT ACCESS"
        : undefined,
    prosperityProgramme.readiness,
    prosperityProgramme.id,
  );
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const modelId = state.endgame.candidateModelId;
  const candidate = state.models[modelId];
  if (candidate === undefined) throw new Error("Crisis candidate missing");
  const preDeploymentAccessLevel = candidate.accessLevel;
  if (quote.rule.auraCost > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: state.run.playerLabId },
        resource: "aura-spendable",
        amount: -quote.rule.auraCost,
        auraChangeKind: "spend",
        auraCategory: "politics",
      },
      { kind: "system", id: `endgame.deployment-mode.${modeId}` },
    );
  }
  if (candidate.accessLevel !== quote.rule.accessLevel) {
    setCandidateAccess(tx, modelId, quote.rule.accessLevel, commandId);
  }
  const authorisation = resolveGate(
    state,
    content,
    modeId,
    "authorisation",
    oracle,
    prosperityProgramme.id,
  );
  const authorisationRejected = authorisation.resultId === "forced-restriction";
  const base = copyCrisisBase(state.endgame);
  const decisionAtStart = authorisationRejected;
  const next: CrisisRolloutState = {
    ...base,
    stage: "rollout",
    enteredAt: state.run.tick,
    deploymentModeId: modeId,
    prosperityProgrammeId: prosperityProgramme.id,
    rolloutStartedAt: state.run.tick,
    rolloutEndsAt: tick(state.run.tick + quote.rule.rolloutWeeks),
    currentBeat: authorisationRejected ? "authorisation" : "first-operation",
    completedBeatIds: authorisationRejected ? [] : ["authorisation"],
    gateResolutions: [authorisation],
    awaitingDecision: decisionAtStart,
    ...(decisionAtStart ? { beatOpenedAt: state.run.tick } : {}),
    rolloutDelayWeeks: 0,
    preDeploymentAccessLevel,
    finalReviewReport: structuredClone(state.endgame.report),
    ...(authorisationRejected
      ? { authorisationCrisis: { required: true, resolved: false } }
      : {}),
  };
  tx.update((draft) => {
    draft.endgame = structuredClone(next) as unknown as DeepMutable<CrisisRolloutState>;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Deployment mode selected: ${quote.rule.displayName}, using ${prosperityProgramme.displayName}.${quote.rule.auraCost > 0 ? ` ${String(quote.rule.auraCost)} Aura committed.` : ""}`,
      category: "narrative",
      source: { kind: "system", id: "endgame.deployment-mode" },
      relatedIds: [modelId, modeId, prosperityProgramme.id],
    });
  });
  tx.emit({
    kind: "crisis-deployment-mode-selected",
    modelId,
    modeId,
    rolloutEndsAt: next.rolloutEndsAt,
  });
  tx.requestAutoPause("crisis-stage");
}
