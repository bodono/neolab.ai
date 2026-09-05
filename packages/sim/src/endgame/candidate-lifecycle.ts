import type { CompiledContent } from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { ModelId } from "../model/ids.ts";
import type {
  CandidateArtifactLifecycle,
  CandidateArtifactRecord,
  CandidateBasisState,
  CandidateIncidentClass,
  GameState,
  ModelState,
} from "../model/state.ts";
import { fraction, rating } from "../model/units.ts";
import {
  calculateFrontierCapability,
  satisfiesAgiCandidateCapabilityGate,
  superintelligenceProbability,
} from "../models/capability.ts";
import { deceptiveActionPressure } from "../models/deception.ts";
import { describeRandomKey, randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";
import { queueRivalCandidateSetback } from "../rivals/candidate-setback.ts";
import { recordRivalPublicSignal } from "../rivals/signals.ts";
import {
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";
import { resumeInterruptedRetirementRecovery } from "./archive-recovery.ts";

// Keep the recurring custody clock above the greatest possible initial
// training pressure. Training remains dangerous through its dedicated gates,
// but a newly qualified artifact must reach the nomination screen before this
// recurring system can produce its first signal.
export const CANDIDATE_INCIDENT_THRESHOLD_MINIMUM = 18;
export const CANDIDATE_INCIDENT_THRESHOLD_MAXIMUM = 30;
export const BENIGN_FALSE_ALARM_PROBABILITY = 0.08;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function thresholdAudit(
  state: Readonly<GameState>,
  modelId: ModelId,
  epoch: number,
  oracle: RandomOracle,
): {
  readonly key: string;
  readonly draw: ReturnType<typeof fraction>;
  readonly threshold: number;
} {
  const key = randomKey(
    "candidate-hazard-v1",
    state.engineRulesVersion,
    state.run.seed,
    modelId,
    String(epoch),
    "threshold",
  );
  const draw = fraction(oracle.uniform(key));
  return {
    key: describeRandomKey(key),
    draw,
    threshold:
      CANDIDATE_INCIDENT_THRESHOLD_MINIMUM +
      draw *
        (CANDIDATE_INCIDENT_THRESHOLD_MAXIMUM - CANDIDATE_INCIDENT_THRESHOLD_MINIMUM),
  };
}

function lineageDrawKey(state: Readonly<GameState>, model: Readonly<ModelState>) {
  return randomKey(
    "endgame-si-v1",
    state.engineRulesVersion,
    state.run.seed,
    model.lineageId,
  );
}

function initialTrainingExposure(
  model: Readonly<ModelState>,
  genuineSuperintelligence: boolean,
): number {
  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  const hiddenDanger =
    (100 -
      model.hiddenSafety.trueAlignment +
      (100 - model.hiddenSafety.corrigibility) +
      model.hiddenSafety.situationalAwareness +
      deceptiveActionPressure(
        model.hiddenSafety.deceptiveCapability,
        model.hiddenSafety.deceptiveIntent,
      )) /
    400;
  return Math.max(
    0.25,
    0.5 +
      Math.max(0, frontierCapability - 88) * 0.1 +
      (model.trueCapability.agency + model.trueCapability.toolUse) / 200 +
      hiddenDanger * 1.25 +
      (genuineSuperintelligence ? 0.75 : 0),
  );
}

function initialHazardPressure(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
  trainingExposure: number,
): number {
  const lab = state.labs[model.ownerLabId];
  const defence =
    effectivePracticalControlStrength(state, model.ownerLabId) * 0.5 +
    effectiveSecurityPosture(state, model.ownerLabId) * 0.3 +
    (lab?.safety.safetyCulture ?? 0) * 0.2;
  // Training has already created the artifact, so even perfect institutional
  // preparation cannot erase the initial hazard. It can, however, keep the
  // first custody check from behaving as if the lab had no defences at all.
  return trainingExposure * (1 - Math.min(0.7, defence * 0.007));
}

function initialContainmentLoad(model: Readonly<ModelState>): number {
  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  return Math.max(
    1,
    1 +
      Math.max(0, frontierCapability - 88) * 0.125 +
      (model.trueCapability.agency + model.trueCapability.toolUse) / 200,
  );
}

function directCandidateBasis(state: Readonly<GameState>, model: Readonly<ModelState>) {
  return {
    kind: "direct-qualification" as const,
    qualifiedAt: state.run.tick,
    qualificationFrontierCapability: rating(
      calculateFrontierCapability(model.trueCapability),
    ),
    qualificationCapability: structuredClone(model.trueCapability),
  };
}

function registerCandidateArtifact(
  tx: SimulationTransaction,
  modelId: ModelId,
  oracle: RandomOracle,
  basis: CandidateBasisState,
): { readonly registered: boolean; readonly firstCrossingForLineage: boolean } {
  const state = tx.read();
  const model = state.models[modelId];
  if (model === undefined)
    throw new Error(`Cannot register missing candidate artifact ${modelId}`);
  if (model.candidateArtifact !== undefined) {
    return { registered: false, firstCrossingForLineage: false };
  }

  const existingLineage = state.lineageSIRecords[model.lineageId];
  const firstCrossingForLineage = existingLineage === undefined;
  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  if (
    firstCrossingForLineage &&
    !satisfiesAgiCandidateCapabilityGate(model.trueCapability)
  ) {
    throw new Error(
      `Artifact ${modelId} cannot establish a lineage draw below qualification`,
    );
  }

  let genuineSuperintelligence: boolean;
  let lineageRecord = existingLineage;
  if (lineageRecord === undefined) {
    const probability = superintelligenceProbability(frontierCapability);
    const key = lineageDrawKey(state, model);
    const draw = fraction(oracle.uniform(key));
    genuineSuperintelligence = probability >= 1 || draw < probability;
    lineageRecord = {
      lineageId: model.lineageId,
      superintelligenceTruth: genuineSuperintelligence ? "genuine" : "not-genuine",
      probabilityAtFirstCrossing: fraction(probability),
      randomKey: describeRandomKey(key),
      draw,
      firstQualifyingModelId: model.id,
      firstQualifyingFrontierCapability: rating(frontierCapability),
      firstQualifyingWeek: state.run.tick,
      rulesVersion: state.engineRulesVersion,
    };
  } else {
    genuineSuperintelligence = lineageRecord.superintelligenceTruth === "genuine";
  }

  const threshold = thresholdAudit(state, model.id, 0, oracle);
  const trainingExposure = initialTrainingExposure(model, genuineSuperintelligence);
  const candidateArtifact: CandidateArtifactRecord = {
    modelId: model.id,
    lineageId: model.lineageId,
    ...(model.derivedFromModelId === undefined
      ? {}
      : { derivedFromModelId: model.derivedFromModelId }),
    lifecycle: "capability-qualified-latent-candidate",
    candidateBasis: structuredClone(basis),
    trainingExposure,
    hazardPressure: initialHazardPressure(state, model, trainingExposure),
    incidentThresholdKey: threshold.key,
    incidentThreshold: threshold.threshold,
    incidentThresholdDraw: threshold.draw,
    incidentEpoch: 0,
    containmentLoad: initialContainmentLoad(model),
    maximumAccessEver: model.accessLevel,
    cumulativeAutonomousWeeks: 0,
    networkExposureWeeks: 0,
    servingExposureWeeks: 0,
    unresolvedAnomalyBurden: 0,
    retirementAttemptCount: 0,
    benignFalseAlarmClasses: [],
    incidentHistory: [],
    retirementVerification: "not-attempted",
  };

  tx.update((draft) => {
    const mutableModel = draft.models[model.id];
    if (mutableModel === undefined)
      throw new Error(`Candidate artifact ${model.id} vanished`);
    if (firstCrossingForLineage) {
      draft.lineageSIRecords[model.lineageId] = structuredClone(lineageRecord);
      draft.endgameHistory.qualifiedLineageCount += 1;
    }
    mutableModel.candidateArtifact = structuredClone(
      candidateArtifact,
    ) as DeepMutable<CandidateArtifactRecord>;
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `candidate-artifact-qualified:${model.id}:${model.lineageId}`,
    });
  });

  if (model.ownerLabId === state.run.playerLabId) {
    tx.emit({
      kind: "candidate-artifact-qualified",
      modelId: model.id,
      lineageId: model.lineageId,
      firstCrossingForLineage,
    });
  }
  return { registered: true, firstCrossingForLineage };
}

/** Register a completed full training run if its canonical true vector qualifies. */
export function registerCompletedTrainingArtifact(
  tx: SimulationTransaction,
  modelId: ModelId,
  oracle: RandomOracle,
): boolean {
  const model = tx.read().models[modelId];
  if (model === undefined)
    throw new Error(`Completed training model ${modelId} is missing`);
  if (!satisfiesAgiCandidateCapabilityGate(model.trueCapability)) return false;
  return registerCandidateArtifact(
    tx,
    modelId,
    oracle,
    directCandidateBasis(tx.read(), model),
  ).registered;
}

/**
 * Register a new weight artifact derived from an existing lineage. If the
 * lineage already crossed, truth is inherited even when remediation lowers a
 * displayed capability. If this variant is the first crossing, it fixes truth.
 */
export function registerDerivedCandidateArtifact(
  tx: SimulationTransaction,
  sourceModelId: ModelId,
  derivedModelId: ModelId,
  oracle: RandomOracle,
): boolean {
  const state = tx.read();
  const source = state.models[sourceModelId];
  const derived = state.models[derivedModelId];
  if (source === undefined || derived === undefined) {
    throw new Error(
      `Missing derived candidate source ${sourceModelId} or result ${derivedModelId}`,
    );
  }
  if (
    derived.derivedFromModelId !== source.id ||
    derived.lineageId !== source.lineageId ||
    derived.ownerLabId !== source.ownerLabId
  ) {
    throw new Error(
      `Derived artifact ${derivedModelId} does not preserve source lineage`,
    );
  }
  const lineage = state.lineageSIRecords[source.lineageId];
  if (lineage === undefined) {
    if (!satisfiesAgiCandidateCapabilityGate(derived.trueCapability)) return false;
    return registerCandidateArtifact(
      tx,
      derived.id,
      oracle,
      directCandidateBasis(state, derived),
    ).registered;
  }
  const qualifyingSource = source.candidateArtifact?.candidateBasis;
  const qualifyingSourceModelId =
    qualifyingSource?.kind === "derived-from-qualified"
      ? qualifyingSource.qualifyingSourceModelId
      : lineage.firstQualifyingModelId;
  return registerCandidateArtifact(tx, derived.id, oracle, {
    kind: "derived-from-qualified",
    sourceModelId: source.id,
    qualifyingSourceModelId,
    derivedAt: state.run.tick,
  }).registered;
}

export function isCandidateArtifactEligible(model: Readonly<ModelState>): boolean {
  return (
    model.candidateArtifact?.lifecycle === "capability-qualified-latent-candidate" &&
    model.candidateArtifact.activeIncident === undefined &&
    model.candidateArtifact.retirementVerification !== "pending"
  );
}

export function isCandidateArtifactFormal(model: Readonly<ModelState>): boolean {
  return (
    model.candidateArtifact?.lifecycle === "formal-candidate" &&
    model.candidateArtifact.activeIncident === undefined
  );
}

export function isCandidateArtifactFunctional(model: Readonly<ModelState>): boolean {
  const lifecycle = model.candidateArtifact?.lifecycle;
  return (
    lifecycle !== undefined &&
    lifecycle !== "verified-destroyed" &&
    lifecycle !== "terminal"
  );
}

export interface CandidateIsolationQuote {
  readonly modelId: ModelId;
  readonly displayName: string;
  readonly currentAccess: ModelState["accessLevel"];
  readonly maximumAccessEver: ModelState["accessLevel"];
  readonly alreadyIsolated: boolean;
  readonly blockers: readonly string[];
}

export interface CandidateIncidentReviewQuote {
  readonly modelId: ModelId;
  readonly displayName: string;
  readonly incidentClass?: CandidateIncidentClass;
  readonly incidentKind?: "warning" | "active-incident";
  readonly evaluationQuality: number;
  readonly practicalControl: number;
  readonly securityPosture: number;
  readonly preparedness: number;
  readonly requiredPreparedness: number;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly blockers: readonly string[];
}

interface CandidateIncidentReviewProfile {
  readonly requiredPreparedness: number;
  readonly evaluationWeight: number;
  readonly controlWeight: number;
  readonly securityWeight: number;
}

const CANDIDATE_INCIDENT_REVIEW_PROFILES: Readonly<
  Record<CandidateIncidentClass, CandidateIncidentReviewProfile>
> = {
  "suspicious-signal": {
    requiredPreparedness: 60,
    evaluationWeight: 0.45,
    controlWeight: 0.25,
    securityWeight: 0.3,
  },
  "persistence-attempt": {
    requiredPreparedness: 68,
    evaluationWeight: 0.35,
    controlWeight: 0.2,
    securityWeight: 0.45,
  },
  "credential-access": {
    requiredPreparedness: 70,
    evaluationWeight: 0.15,
    controlWeight: 0.3,
    securityWeight: 0.55,
  },
  "evaluator-manipulation": {
    requiredPreparedness: 70,
    evaluationWeight: 0.55,
    controlWeight: 0.25,
    securityWeight: 0.2,
  },
  "copying-attempt": {
    requiredPreparedness: 74,
    evaluationWeight: 0.3,
    controlWeight: 0.2,
    securityWeight: 0.5,
  },
  "local-containment-breach": {
    requiredPreparedness: 76,
    evaluationWeight: 0.1,
    controlWeight: 0.45,
    securityWeight: 0.45,
  },
};

const REVIEWABLE_PRIOR_LIFECYCLES: readonly CandidateArtifactLifecycle[] = [
  "capability-qualified-latent-candidate",
  "formal-candidate",
  "retirement-attempt",
  "verified-isolated-archive",
];

/**
 * Quote the one-shot containment review for an unresolved candidate incident.
 * The gate is entirely deterministic and uses only player-visible lab strengths;
 * retrying the command against unchanged state can never produce a different result.
 */
export function quoteCandidateIncidentReview(
  state: Readonly<GameState>,
  modelId: ModelId,
): CandidateIncidentReviewQuote {
  const model = state.models[modelId];
  const artifact = model?.candidateArtifact;
  const incident = artifact?.activeIncident;
  const evaluationQuality = effectiveEvaluationQuality(state, state.run.playerLabId);
  const practicalControl = effectivePracticalControlStrength(
    state,
    state.run.playerLabId,
  );
  const securityPosture = effectiveSecurityPosture(state, state.run.playerLabId);
  const profile =
    incident === undefined
      ? undefined
      : CANDIDATE_INCIDENT_REVIEW_PROFILES[incident.incidentClass];
  const preparedness =
    profile === undefined
      ? 0
      : Math.round(
          (evaluationQuality * profile.evaluationWeight +
            practicalControl * profile.controlWeight +
            securityPosture * profile.securityWeight) *
            10,
        ) / 10;
  const requiredPreparedness = Math.max(
    0,
    (profile?.requiredPreparedness ?? 0) - (incident?.kind === "warning" ? 6 : 0),
  );
  const activeIncident = incident?.kind === "active-incident";
  const cashCostMillions = activeIncident ? 2_000 : 500;
  const auraCost = activeIncident ? 12 : 6;
  const blockers: string[] = [];
  const lab = state.labs[state.run.playerLabId];
  if (
    state.endgame.stage === "world-waiting" ||
    state.endgame.stage === "resolved" ||
    (state.endgame.stage === "rollout" &&
      state.endgame.deploymentTransmittedAtWeek !== undefined)
  ) {
    blockers.push("The final deployment order has already been transmitted");
  }
  if (
    state.endgame.stage === "containment-failure" &&
    state.endgame.candidateModelId === modelId
  ) {
    blockers.push("Use the active emergency-containment controls for this candidate");
  }

  if (
    state.run.status !== "active" ||
    model === undefined ||
    model.ownerLabId !== state.run.playerLabId ||
    artifact === undefined
  ) {
    blockers.push("That candidate artifact is not in active player custody");
  } else if (incident === undefined || incident.status !== "unresolved") {
    blockers.push("The artifact has no unresolved containment signal to review");
  } else {
    if (!REVIEWABLE_PRIOR_LIFECYCLES.includes(incident.priorLifecycle)) {
      blockers.push(
        `The incident interrupted ${incident.priorLifecycle}; local review cannot restore that custody state`,
      );
    }
    if (incident.incidentClass === "local-containment-breach") {
      blockers.push(
        "A local containment breach cannot be cleared by routine review; isolate the artifact and attempt verified retirement",
      );
    }
  }
  if (model !== undefined) {
    if (model.accessLevel !== 0 || model.deployment.policy !== "internal-only") {
      blockers.push("Isolate the artifact to Access 0 and internal-only before review");
    }
  }
  if (preparedness < requiredPreparedness) {
    blockers.push(
      `Requires containment-review preparedness ${String(requiredPreparedness)}; current ${preparedness.toFixed(1)}`,
    );
  }
  if (lab === undefined || lab.finance.cash < cashCostMillions) {
    blockers.push("Insufficient cash");
  }
  if (lab === undefined || lab.aura.spendable < auraCost) {
    blockers.push("Insufficient Aura");
  }

  return {
    modelId,
    displayName: model?.displayName ?? String(modelId),
    ...(incident === undefined
      ? {}
      : {
          incidentClass: incident.incidentClass,
          ...(incident.kind === "benign-false-alarm"
            ? {}
            : { incidentKind: incident.kind }),
        }),
    evaluationQuality: Math.round(evaluationQuality * 10) / 10,
    practicalControl: Math.round(practicalControl * 10) / 10,
    securityPosture: Math.round(securityPosture * 10) / 10,
    preparedness,
    requiredPreparedness,
    cashCostMillions,
    auraCost,
    blockers,
  };
}

/** Resolve a reviewed signal without altering hidden capability or safety traits. */
export function resolveCandidateIncident(
  tx: SimulationTransaction,
  modelId: ModelId,
): CandidateIncidentReviewQuote {
  const quote = quoteCandidateIncidentReview(tx.read(), modelId);
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const incident = tx.read().models[modelId]?.candidateArtifact?.activeIncident;
  if (incident === undefined) {
    throw new Error("Candidate incident disappeared during containment review");
  }
  const benignCause = incident.reviewOutcome === "benign-operational-cause";
  const source = { kind: "system" as const, id: `candidate-incident.review:${modelId}` };
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId: tx.read().run.playerLabId },
      resource: "cash",
      amount: -quote.cashCostMillions,
      financeCategory: "project-cost",
    },
    source,
  );
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId: tx.read().run.playerLabId },
      resource: "aura-spendable",
      amount: -quote.auraCost,
      auraChangeKind: "spend",
      auraCategory: "evaluation",
    },
    source,
  );
  transitionCandidateArtifactLifecycle(tx, modelId, incident.priorLifecycle);
  tx.update((draft) => {
    const model = draft.models[modelId];
    const artifact = model?.candidateArtifact;
    if (
      model === undefined ||
      artifact === undefined ||
      artifact.activeIncident?.id !== incident.id
    ) {
      throw new Error("Candidate incident changed during containment review");
    }
    artifact.incidentHistory.push({
      id: incident.id,
      epoch: incident.epoch,
      incidentClass: incident.incidentClass,
      kind: benignCause ? "benign-false-alarm" : incident.kind,
      triggeredAt: incident.triggeredAt,
      resolvedAt: draft.run.tick,
      origin: incident.origin,
      priorLifecycle: incident.priorLifecycle,
      ...(incident.reviewOutcome === undefined
        ? {}
        : { reviewOutcome: incident.reviewOutcome }),
    });
    if (
      benignCause &&
      !artifact.benignFalseAlarmClasses.includes(incident.incidentClass)
    ) {
      artifact.benignFalseAlarmClasses.push(incident.incidentClass);
    }
    delete artifact.activeIncident;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: benignCause
        ? `${model.displayName}: containment review traced the suspicious signal to a benign operational cause and restored ${incident.priorLifecycle.replaceAll("-", " ")} custody. This resolves the signal; it does not establish that the artifact is safe.`
        : `${model.displayName}: containment review confirmed the ${incident.incidentClass.replaceAll("-", " ")} signal and restored ${incident.priorLifecycle.replaceAll("-", " ")} custody after closing the immediate path. This closes the incident; it does not establish that the artifact is safe.`,
      category: "narrative",
      source,
      relatedIds: [modelId, incident.id],
    });
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `candidate-incident-reviewed:${modelId}:${incident.incidentClass}:${incident.kind}`,
    });
  });
  return quote;
}

/**
 * Quote the emergency custody operation available before formal candidacy.
 * Isolation changes present access only. The append-only exposure record is
 * deliberately retained for latent hazards and any later retirement attempt.
 */
export function quoteCandidateIsolation(
  state: Readonly<GameState>,
  modelId: ModelId,
): CandidateIsolationQuote {
  const model = state.models[modelId];
  const blockers: string[] = [];
  if (model === undefined || model.ownerLabId !== state.run.playerLabId) {
    blockers.push("That candidate artifact is not controlled by the player lab");
  }
  const artifact = model?.candidateArtifact;
  if (artifact === undefined) {
    blockers.push("The model has no candidate custody record");
  } else if (
    artifact.lifecycle === "verified-destroyed" ||
    artifact.lifecycle === "terminal" ||
    artifact.lifecycle === "escaped" ||
    artifact.lifecycle === "deployed" ||
    artifact.lifecycle === "retirement-attempt"
  ) {
    blockers.push(
      `The artifact lifecycle is ${artifact.lifecycle}; local isolation is unavailable`,
    );
  }
  const emergencyFormalIsolation =
    artifact?.activeIncident?.status === "unresolved" &&
    artifact.activeIncident.priorLifecycle === "formal-candidate" &&
    state.endgame.stage !== "inactive" &&
    state.endgame.stage !== "candidate-activation" &&
    state.endgame.stage !== "recovery" &&
    state.endgame.stage !== "containment-failure" &&
    state.endgame.stage !== "world-waiting" &&
    state.endgame.stage !== "resolved" &&
    (state.endgame.stage !== "rollout" ||
      state.endgame.deploymentTransmittedAtWeek === undefined);
  if (
    state.endgame.stage !== "inactive" &&
    state.endgame.stage !== "candidate-activation" &&
    state.endgame.candidateModelId === modelId &&
    !emergencyFormalIsolation
  ) {
    blockers.push("Use the active endgame containment controls for the formal candidate");
  }
  const alreadyIsolated =
    model?.accessLevel === 0 && model.deployment.policy === "internal-only";
  if (alreadyIsolated)
    blockers.push("The artifact is already at Access 0 and internal-only");
  const maximumAccessEver = Math.max(
    artifact?.maximumAccessEver ?? 0,
    model?.accessLevel ?? 0,
  ) as ModelState["accessLevel"];
  return {
    modelId,
    displayName: model?.displayName ?? String(modelId),
    currentAccess: model?.accessLevel ?? 0,
    maximumAccessEver,
    alreadyIsolated,
    blockers,
  };
}

/** Immediately revoke current access without pretending past exposure vanished. */
export function isolateCandidateArtifact(
  tx: SimulationTransaction,
  content: CompiledContent,
  modelId: ModelId,
): CandidateIsolationQuote {
  const quote = quoteCandidateIsolation(tx.read(), modelId);
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const internalOnly = content.deployment.policies["internal-only"];
  if (internalOnly === undefined) {
    throw new Error("Internal-only deployment policy is missing from content");
  }
  tx.update((draft) => {
    const model = draft.models[modelId];
    const artifact = model?.candidateArtifact;
    const lab = model === undefined ? undefined : draft.labs[model.ownerLabId];
    if (model === undefined || artifact === undefined || lab === undefined) {
      throw new Error("Candidate artifact disappeared during isolation");
    }
    artifact.maximumAccessEver = Math.max(
      artifact.maximumAccessEver,
      model.accessLevel,
    ) as ModelState["accessLevel"];
    model.accessLevel = 0;
    model.deployment.policy = "internal-only";
    delete model.deployment.plannedPolicy;
    model.deployment.exposure = internalOnly.exposure;
    model.deployment.irreversible = internalOnly.irreversible;
    model.deployment.changedAt = draft.run.tick;
    if (lab.models.commercialModelId === modelId) {
      delete lab.models.commercialModelId;
    }
    if (draft.aiCharacter?.modelId === modelId) {
      draft.aiCharacter.currentAccess = 0;
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${model.displayName} isolated: current access revoked and serving policy set to internal-only. Historical maximum access remains ${String(artifact.maximumAccessEver)}/5.`,
      category: "narrative",
      source: { kind: "system", id: "candidate-custody.isolate" },
      relatedIds: [modelId],
    });
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `candidate-artifact-isolated:${modelId}:max-access-${String(artifact.maximumAccessEver)}`,
    });
  });
  tx.emit({
    kind: "candidate-artifact-isolated",
    modelId,
    previousAccess: quote.currentAccess,
    maximumAccessEver: quote.maximumAccessEver,
  });
  return quote;
}

const ALLOWED_LIFECYCLE_TRANSITIONS: Readonly<
  Record<CandidateArtifactLifecycle, readonly CandidateArtifactLifecycle[]>
> = {
  "capability-qualified-latent-candidate": [
    "formal-candidate",
    "active-hazard",
    "retirement-attempt",
    "verified-destroyed",
    "verified-isolated-archive",
  ],
  "formal-candidate": [
    "capability-qualified-latent-candidate",
    "active-hazard",
    "deployed",
    "retirement-attempt",
    "terminal",
  ],
  "active-hazard": [
    "capability-qualified-latent-candidate",
    "formal-candidate",
    "retirement-attempt",
    "verified-destroyed",
    "verified-isolated-archive",
    "escaped",
    "terminal",
  ],
  deployed: ["active-hazard", "escaped", "verified-isolated-archive", "terminal"],
  "retirement-attempt": [
    "active-hazard",
    "verified-destroyed",
    "verified-isolated-archive",
    "escaped",
    "terminal",
  ],
  "verified-destroyed": [],
  "verified-isolated-archive": [
    "active-hazard",
    "retirement-attempt",
    "verified-destroyed",
  ],
  escaped: ["terminal"],
  terminal: [],
};

export function transitionCandidateArtifactLifecycle(
  tx: SimulationTransaction,
  modelId: ModelId,
  lifecycle: CandidateArtifactLifecycle,
): void {
  const artifact = tx.read().models[modelId]?.candidateArtifact;
  if (artifact === undefined)
    throw new Error(`Model ${modelId} has no candidate artifact`);
  if (!ALLOWED_LIFECYCLE_TRANSITIONS[artifact.lifecycle].includes(lifecycle)) {
    throw new Error(
      `Illegal candidate lifecycle transition ${artifact.lifecycle} -> ${lifecycle}`,
    );
  }
  tx.update((draft) => {
    const mutableModel = draft.models[modelId];
    const mutable = mutableModel?.candidateArtifact;
    if (mutableModel === undefined || mutable === undefined) {
      throw new Error(`Candidate artifact ${modelId} vanished`);
    }
    // A terminal transition can end the run before the weekly hazard processor
    // gets its normal opportunity to snapshot current access. Lifecycle history
    // must still retain the highest access the artifact actually received.
    mutable.maximumAccessEver = Math.max(
      mutable.maximumAccessEver,
      mutableModel.accessLevel,
    ) as ModelState["accessLevel"];
    mutable.lifecycle = lifecycle;
  });
}

function chooseIncidentClass(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
  oracle: RandomOracle,
): CandidateIncidentClass {
  const artifact = model.candidateArtifact;
  if (artifact === undefined)
    throw new Error(`Model ${model.id} is not a candidate artifact`);
  const external = model.accessLevel >= 2 || model.deployment.policy !== "internal-only";
  return oracle.weighted(
    randomKey(
      "candidate-hazard-v1",
      state.engineRulesVersion,
      state.run.seed,
      model.id,
      String(artifact.incidentEpoch),
      "incident-class",
    ),
    external
      ? {
          "suspicious-signal": 28,
          "persistence-attempt": 20,
          "credential-access": 18,
          "evaluator-manipulation": 12,
          "copying-attempt": 15,
          "local-containment-breach": 7,
        }
      : {
          "suspicious-signal": 55,
          "persistence-attempt": 16,
          "credential-access": 10,
          "evaluator-manipulation": 10,
          "copying-attempt": 7,
          "local-containment-breach": 2,
        },
  );
}

/**
 * Convert an accumulated threshold crossing into one visible, nonterminal
 * warning/incident. This is not a weekly death roll and never ends a run.
 */
export function resolveCandidatePressureCrossing(
  tx: SimulationTransaction,
  modelId: ModelId,
  origin: "training-completion" | "weekly-pressure",
  oracle: RandomOracle,
): boolean {
  const state = tx.read();
  const model = state.models[modelId];
  const artifact = model?.candidateArtifact;
  if (
    model === undefined ||
    artifact === undefined ||
    artifact.activeIncident?.status === "unresolved" ||
    artifact.hazardPressure < artifact.incidentThreshold
  ) {
    return false;
  }
  const incidentClass = chooseIncidentClass(state, model, oracle);
  const falseAlarmKey = randomKey(
    "candidate-hazard-v1",
    state.engineRulesVersion,
    state.run.seed,
    model.id,
    String(artifact.incidentEpoch),
    "benign-false-alarm",
  );
  const benignFalseAlarm =
    incidentClass === "suspicious-signal" &&
    !artifact.benignFalseAlarmClasses.includes(incidentClass) &&
    oracle.uniform(falseAlarmKey) < BENIGN_FALSE_ALARM_PROBABILITY;
  const nextEpoch = artifact.incidentEpoch + 1;
  const nextThreshold = thresholdAudit(state, model.id, nextEpoch, oracle);
  // A benign signal and a confirmed suspicious signal must be observationally
  // identical until review. The hidden independent draw is retained on the
  // incident, never in its initial kind, log copy, or emitted event.
  const incidentKind =
    incidentClass === "suspicious-signal" ? "warning" : "active-incident";
  const incidentId = `candidate-incident:${model.id}:${String(artifact.incidentEpoch)}`;
  const removesOpenPlayerActivation =
    model.ownerLabId === state.run.playerLabId &&
    state.endgame.stage === "candidate-activation" &&
    state.endgame.eligibleModelIds.includes(model.id);

  tx.update((draft) => {
    const mutableModel = draft.models[model.id];
    const mutable = mutableModel?.candidateArtifact;
    if (mutableModel === undefined || mutable === undefined) {
      throw new Error(`Candidate artifact ${model.id} vanished during incident creation`);
    }
    mutable.hazardPressure = Math.max(
      0,
      mutable.hazardPressure - mutable.incidentThreshold,
    );
    mutable.incidentEpoch = nextEpoch;
    mutable.incidentThresholdKey = nextThreshold.key;
    mutable.incidentThreshold = nextThreshold.threshold;
    mutable.incidentThresholdDraw = nextThreshold.draw;
    const priorLifecycle = mutable.lifecycle;
    mutable.lifecycle = "active-hazard";
    mutable.activeIncident = {
      id: incidentId,
      epoch: artifact.incidentEpoch,
      incidentClass,
      kind: incidentKind,
      status: "unresolved",
      triggeredAt: draft.run.tick,
      origin,
      priorLifecycle,
      ...(incidentClass === "suspicious-signal"
        ? {
            reviewOutcome: benignFalseAlarm
              ? ("benign-operational-cause" as const)
              : ("confirmed-safety-signal" as const),
          }
        : {}),
    };
    if (incidentClass === "local-containment-breach") {
      const lab = draft.labs[mutableModel.ownerLabId];
      mutable.containmentLoad = clamp(mutable.containmentLoad + 25);
      if (lab !== undefined) {
        lab.safety.practicalControlStrength = rating(
          clamp(lab.safety.practicalControlStrength - 8),
        );
        lab.safety.securityPosture = rating(clamp(lab.safety.securityPosture - 8));
        lab.politics.governmentAttention = rating(
          clamp(lab.politics.governmentAttention + 12),
        );
      }
    }
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `candidate-latent-incident:${model.id}:${incidentClass}:${incidentKind}`,
    });
    if (model.ownerLabId === draft.run.playerLabId) {
      draft.presentationQueue.push({
        key: `candidate-containment-incident:${incidentId}`,
        kind: "candidate-containment-incident",
        attention: "modal",
        modelId: model.id,
        incidentId,
        incidentClass,
        incidentKind,
        origin,
        createdAt: draft.run.tick,
      });
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          incidentClass === "local-containment-breach"
            ? `${model.displayName}: candidate containment reported a local containment breach. Control and security systems were damaged; routine review cannot return this artifact to candidacy.`
            : `${model.displayName}: candidate containment reported ${incidentClass.replaceAll("-", " ")}. Immediate review is required.`,
        category: "narrative",
        source: {
          kind: "system",
          id: `candidate-incident:${model.id}:${String(artifact.incidentEpoch)}`,
        },
        relatedIds: [model.id],
      });
    }
    if (removesOpenPlayerActivation && draft.endgame.stage === "candidate-activation") {
      const remainingEligibleModelIds = draft.endgame.eligibleModelIds.filter(
        (eligibleModelId) =>
          eligibleModelId !== model.id &&
          draft.models[eligibleModelId] !== undefined &&
          isCandidateArtifactEligible(draft.models[eligibleModelId]),
      );
      if (remainingEligibleModelIds.length > 0) {
        draft.endgame.eligibleModelIds = remainingEligibleModelIds;
      } else {
        draft.endgame = { stage: "inactive" };
        draft.run.phase = "frontier";
      }
    }
  });
  if (removesOpenPlayerActivation && tx.read().endgame.stage === "inactive") {
    resumeInterruptedRetirementRecovery(tx);
  }

  // A rival cannot keep progressing an endgame countdown after the nominated
  // artifact has produced a containment incident. Candidate hazards run later
  // in the weekly schedule than rival planning, so abort the countdown here
  // atomically; otherwise the state is invalid for a full week and the next
  // rival update throws. The rival may train and nominate a fresh artifact.
  if (model.ownerLabId !== state.run.playerLabId) {
    const countdown = tx.read().world.rivals[model.ownerLabId]?.candidateCountdown;
    if (
      (countdown?.status === "active" || countdown?.status === "paused") &&
      countdown.modelId === model.id
    ) {
      tx.update((draft) => {
        const rival = draft.world.rivals[model.ownerLabId];
        if (rival === undefined) return;
        delete rival.candidateCountdown;
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `${model.ownerLabId}'s candidate process stopped after a reported containment incident involving ${model.displayName}.`,
          category: "narrative",
          source: {
            kind: "system",
            id: `rival-candidate-incident:${model.ownerLabId}:${model.id}:${String(artifact.incidentEpoch)}`,
          },
          relatedIds: [model.ownerLabId, model.id],
        });
      });
      queueRivalCandidateSetback(tx, {
        outcome: "containment-incident",
        labId: model.ownerLabId,
        modelId: model.id,
        countdownStartedAt: countdown.startedAt,
      });
      recordRivalPublicSignal(tx, {
        labId: model.ownerLabId,
        kind: "incident",
        subjectId: model.id,
        actualValue: calculateFrontierCapability(model.trueCapability),
        baseErrorRadius: 12,
        summary: `${model.ownerLabId}'s candidate process halted after a containment incident.`,
      });
      tx.requestAutoPause("race-emergency");
    }
  }

  if (model.ownerLabId === state.run.playerLabId) {
    tx.emit({
      kind: "candidate-latent-incident",
      modelId: model.id,
      incidentClass,
      incidentKind,
    });
    tx.requestAutoPause("candidate-hazard");
  }
  return true;
}
