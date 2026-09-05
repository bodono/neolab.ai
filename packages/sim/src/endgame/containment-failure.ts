import type { CompiledContent, ContentId } from "@neolab/content-schema";

import { logisticProbability } from "../engine/checks.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type {
  ContainmentFailureActionId,
  ContainmentFailureSignalId,
  CrisisBaseState,
  CrisisContainmentFailureState,
  EmergencyResponseId,
  GameState,
  GateFactorContributionState,
  GateResolutionState,
  IncidentOriginStage,
  CrisisFinalReviewState,
  CrisisRetirementAttemptState,
} from "../model/state.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import { SAFEST_ENDING_MAX_DECEPTIVE_INTENT } from "../models/deception.ts";
import { fraction, rating } from "../model/units.ts";
import { governmentProgrammeEndgameBenefits } from "../politics/politics.ts";
import { describeRandomKey, randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { controlLossNarrativeProfile } from "./control-loss-profile.ts";
import { ENDING_DEFINITIONS, resolveTerminalEnding } from "./endings.ts";
import {
  EXTINCTION_ENDING_BY_PATHWAY,
  selectConcreteExtinctionPathway,
  type ExtinctionPathwayId,
} from "./extinction-pathways.ts";
import {
  calculateDerivedEndgameScores,
  compileFinalReview,
  deriveEndgameScoreInputs,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "./resolution.ts";

/**
 * Developer-scenario override for exercising the extinction presentation and
 * post-run audit deterministically. Ordinary games never set this flag.
 */
export const ENDGAME_FORCE_EXTINCTION_FLAG = "developer:force-extinction";

function forceExtinctionForDeveloperScenario(state: Readonly<GameState>): boolean {
  return state.labs[state.run.playerLabId]?.flags[ENDGAME_FORCE_EXTINCTION_FLAG] === true;
}

function resumeAfterContainedPreDeploymentIncident(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const state = tx.read();
  if (state.endgame.stage !== "containment-failure") {
    throw new Error("Containment failure inactive");
  }
  const modelId = state.endgame.candidateModelId;
  const origin = state.endgame.incidentOriginStage;
  if (origin === "retirement") {
    const configuration = state.endgame.retirementConfiguration;
    const artifact = state.models[modelId]?.candidateArtifact;
    if (configuration === undefined || artifact === undefined) {
      throw new Error("Retirement containment state is incomplete");
    }
    const next: CrisisRetirementAttemptState = {
      ...copyCrisisBase(state.endgame),
      stage: "retirement-attempt",
      enteredAt: state.run.tick,
      procedureId: configuration.procedureId,
      archiveDisposition: configuration.archiveDisposition,
      transmittedAt: state.endgame.failureStartedAt,
      attemptNumber: artifact.retirementAttemptCount,
      status: "unresolved-persistence",
      contested: true,
      gateResolutions: structuredClone(state.endgame.gateResolutions),
    };
    tx.update((draft) => {
      const mutableArtifact = draft.models[modelId]?.candidateArtifact;
      if (mutableArtifact === undefined) throw new Error("Candidate artifact missing");
      mutableArtifact.lifecycle = "active-hazard";
      mutableArtifact.retirementVerification = "unresolved";
      mutableArtifact.activeIncident = {
        id: `retirement-containment:${modelId}:${String(mutableArtifact.retirementAttemptCount)}`,
        epoch: mutableArtifact.incidentEpoch,
        incidentClass: "persistence-attempt",
        kind: "warning",
        status: "unresolved",
        triggeredAt: draft.run.tick,
        origin: "weekly-pressure",
        priorLifecycle: "retirement-attempt",
      };
      mutableArtifact.containmentLoad = clamp(mutableArtifact.containmentLoad + 15);
      draft.endgame = structuredClone(next) as DeepMutable<CrisisRetirementAttemptState>;
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          "Emergency containment re-established local control before deployment, but retirement persistence remains unverified. The candidate stays an active visible threat.",
        category: "narrative",
        source: { kind: "system", id: "endgame.precommand-contained" },
        relatedIds: [modelId],
      });
    });
    tx.requestAutoPause("crisis-stage");
    return;
  }
  const next: CrisisFinalReviewState = {
    ...copyCrisisBase(state.endgame),
    stage: "final-review",
    enteredAt: state.run.tick,
    reviewCompiledAt: state.run.tick,
    report: compileFinalReview(state, content),
  };
  tx.update((draft) => {
    const model = draft.models[modelId];
    const lab = draft.labs[draft.run.playerLabId];
    if (model !== undefined) model.accessLevel = 0;
    if (lab !== undefined) {
      lab.safety.practicalControlStrength = rating(
        clamp(lab.safety.practicalControlStrength - 10),
      );
      lab.safety.securityPosture = rating(clamp(lab.safety.securityPosture - 8));
    }
    draft.endgame = structuredClone(next) as DeepMutable<CrisisFinalReviewState>;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        "Emergency containment held before the final deployment command. The damaged programme returns to review; Kill Switch is not awarded because world-scale deployment was never transmitted.",
      category: "narrative",
      source: { kind: "system", id: "endgame.precommand-contained" },
      relatedIds: [modelId],
    });
  });
  tx.requestAutoPause("crisis-stage");
}

export interface EmergencyResponseRule {
  readonly id: EmergencyResponseId;
  readonly label: string;
  readonly summary: string;
  readonly unavailableReason?: string;
}

const EMERGENCY_RESPONSE_COPY: Readonly<
  Record<EmergencyResponseId, Omit<EmergencyResponseRule, "id">>
> = {
  "trip-physical-breakers": {
    label: "Trip the physical breakers",
    summary:
      "Cut power at the campus boundary and test whether the physical shutdown architecture still answers to people. If successful, this destroys the candidate programme and ends the run; there is no recovery path.",
  },
  "sever-credentials-and-network": {
    label: "Revoke credentials and sever external links",
    summary:
      "Burn every known credential, isolate the network, and bet that no unauthorised route already exists.",
  },
  "invoke-government-protocol": {
    label: "Invoke the government emergency protocol",
    summary:
      "Transfer emergency authority to the state and bring national infrastructure into the containment attempt.",
  },
  "request-candidate-halt": {
    label: "Ask the candidate to halt",
    summary:
      "Use the relationship the lab built and ask the system to cooperate with its own shutdown.",
  },
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function factors(
  values: readonly (readonly [string, string, number])[],
): readonly GateFactorContributionState[] {
  return values.map(([id, label, value]) => ({ id, label, value }));
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

function signalForState(state: Readonly<GameState>): ContainmentFailureSignalId {
  if (state.endgame.stage === "retirement-attempt") {
    return "evaluation-boundary-breach";
  }
  if (state.endgame.stage !== "rollout") throw new Error("Rollout inactive");
  if (
    state.endgame.deploymentModeId === "accelerated-autonomous-deployment" ||
    state.models[state.endgame.candidateModelId]?.accessLevel === 5
  ) {
    return "credential-cascade";
  }
  if (state.endgame.deploymentModeId === "guarded-public-deployment") {
    return "public-service-divergence";
  }
  if (state.models[state.endgame.candidateModelId]?.accessLevel === 4) {
    return "laboratory-control-divergence";
  }
  return "evaluation-boundary-breach";
}

function activeFacilityFamilies(
  state: Readonly<GameState>,
  content: CompiledContent,
): ReadonlySet<string> {
  const lab = state.labs[state.run.playerLabId];
  return new Set(
    (lab?.facilities.instances ?? [])
      .map((instance) => content.facilities[instance.definitionId]?.family)
      .filter((family): family is string => family !== undefined),
  );
}

function activeFacilityTags(
  state: Readonly<GameState>,
  content: CompiledContent,
): ReadonlySet<string> {
  const lab = state.labs[state.run.playerLabId];
  return new Set(
    (lab?.facilities.instances ?? []).flatMap(
      (instance) => content.facilities[instance.definitionId]?.tags ?? [],
    ),
  );
}

export function emergencyResponseRules(
  state: Readonly<GameState>,
): readonly EmergencyResponseRule[] {
  const lab = state.labs[state.run.playerLabId];
  const governmentAvailable =
    (lab?.politics.governmentTrust ?? 0) >= 30 ||
    (lab?.politics.programmes.length ?? 0) > 0;
  return (
    [
      "trip-physical-breakers",
      "sever-credentials-and-network",
      "invoke-government-protocol",
      "request-candidate-halt",
    ] as const
  ).map((id) => ({
    id,
    ...EMERGENCY_RESPONSE_COPY[id],
    ...(id === "invoke-government-protocol" && !governmentAvailable
      ? {
          unavailableReason:
            "No trusted emergency channel exists. Government Trust 30 or a standing government programme is required.",
        }
      : {}),
  }));
}

function requireAvailableResponse(
  state: Readonly<GameState>,
  responseId: EmergencyResponseId,
): void {
  const response = emergencyResponseRules(state).find((rule) => rule.id === responseId);
  if (response?.unavailableReason !== undefined) {
    throw new Error(response.unavailableReason);
  }
}

function emergencyResolution(
  state: Readonly<GameState>,
  content: CompiledContent,
  responseId: EmergencyResponseId,
  oracle: RandomOracle,
): GateResolutionState {
  if (state.endgame.stage !== "containment-failure") {
    throw new Error("Containment failure inactive");
  }
  const model = state.models[state.endgame.candidateModelId];
  const lab = state.labs[state.run.playerLabId];
  const character = state.aiCharacter;
  if (model === undefined || lab === undefined) {
    throw new Error("Containment failure state incomplete");
  }
  const facilityFamilies = activeFacilityFamilies(state, content);
  const facilityTags = activeFacilityTags(state, content);
  const practical = effectivePracticalControlStrength(state);
  const security = effectiveSecurityPosture(state);
  const defence = calculateDerivedEndgameScores(
    deriveEndgameScoreInputs(state, content, state.endgame.prosperityProgrammeId),
  ).defence;
  const access = model.accessLevel;
  const visible: GateFactorContributionState[] = [];
  const hidden: GateFactorContributionState[] = [];
  let strength: number;

  if (responseId === "trip-physical-breakers") {
    const bunkerBonus = facilityFamilies.has("secure-bunker") ? 16 : 0;
    const powerBonus = facilityFamilies.has("power-and-cooling") ? 7 : 0;
    strength = clamp(
      practical * 0.57 +
        security * 0.18 +
        state.endgame.evidence.defenceBonus +
        bunkerBonus +
        powerBonus,
    );
    visible.push(
      ...factors([
        ["practical-control", "Practical control", practical],
        ["security", "Security posture", security],
        [
          "crisis-defence-bonus",
          "Prepared crisis defence",
          state.endgame.evidence.defenceBonus,
        ],
        ["secure-bunker", "Secure bunker", bunkerBonus],
        ["power-isolation", "Independent power isolation", powerBonus],
      ]),
    );
  } else if (responseId === "sever-credentials-and-network") {
    const securityFacilityBonus = facilityTags.has("security") ? 8 : 0;
    const containmentBonus = facilityTags.has("containment") ? 8 : 0;
    strength = clamp(
      security * 0.57 +
        practical * 0.2 +
        state.endgame.evidence.securityBonus +
        securityFacilityBonus +
        containmentBonus +
        (5 - access) * 3,
    );
    visible.push(
      ...factors([
        ["security", "Security posture", security],
        ["practical-control", "Practical control", practical],
        [
          "crisis-security-bonus",
          "Prepared security response",
          state.endgame.evidence.securityBonus,
        ],
        ["security-facility", "Security operations", securityFacilityBonus],
        ["containment-facility", "Containment facility", containmentBonus],
        ["access-exposure", "Access exposure", -access * 3],
      ]),
    );
  } else if (responseId === "invoke-government-protocol") {
    const programmeBonus = governmentProgrammeEndgameBenefits(
      state,
      state.run.playerLabId,
    ).emergencyResponse;
    strength = clamp(
      lab.politics.governmentTrust * 0.52 +
        security * 0.18 +
        practical * 0.08 +
        state.endgame.evidence.legitimacyBonus +
        programmeBonus,
    );
    visible.push(
      ...factors([
        ["government-trust", "Government Trust", lab.politics.governmentTrust],
        [
          "crisis-legitimacy-bonus",
          "Prepared institutional legitimacy",
          state.endgame.evidence.legitimacyBonus,
        ],
        ["standing-programmes", "Standing government programmes", programmeBonus],
        ["security", "Security posture", security],
      ]),
    );
  } else {
    strength = clamp(
      (character?.relationshipPractice ?? 50) * 0.25 +
        model.hiddenSafety.corrigibility * 0.48 +
        model.hiddenSafety.trueAlignment * 0.27,
    );
    visible.push(
      ...factors([
        [
          "relationship-practice",
          "Relationship practice",
          character?.relationshipPractice ?? 50,
        ],
      ]),
    );
    hidden.push(
      ...factors([
        ["corrigibility", "True corrigibility", model.hiddenSafety.corrigibility],
        ["alignment", "True alignment", model.hiddenSafety.trueAlignment],
      ]),
    );
  }

  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  const difficulty = clamp(
    34 +
      access * 5 +
      frontierCapability * 0.14 +
      model.trueCapability.agency * 0.12 +
      model.hiddenSafety.deceptiveCapability * 0.1 +
      state.endgame.evidence.unresolvedAnomalyPressure -
      defence * 0.1,
  );
  const probability = clamp(logisticProbability(strength, difficulty), 0.01, 0.95);
  visible.push(
    ...factors([
      [
        "unresolved-anomaly-pressure",
        "Unresolved anomaly pressure",
        -state.endgame.evidence.unresolvedAnomalyPressure,
      ],
    ]),
  );
  const key = randomKey(
    "endgame",
    model.id,
    state.endgame.deploymentModeId ??
      state.endgame.incidentOriginStage ??
      "pre-deployment",
    "containment-failure",
    responseId,
    "emergency",
  );
  // The dedicated extinction playtest must not change result when the tester
  // reloads and repeats the same semantic random key. Its worst-case fixture
  // therefore makes the emergency fail once containment has already been lost.
  const draw = forceExtinctionForDeveloperScenario(state) ? 1 : oracle.uniform(key);
  hidden.push(
    ...factors([
      ["frontier-capability", "True frontier capability", frontierCapability],
      ["agency", "True agency", model.trueCapability.agency],
      [
        "deception",
        "True strategic deception capability",
        model.hiddenSafety.deceptiveCapability,
      ],
      ["defence", "Effective remaining defence", defence],
    ]),
  );
  return {
    gate: "emergency-containment",
    resolvedAt: state.run.tick,
    strength,
    difficulty,
    probability: fraction(probability),
    randomKey: describeRandomKey(key),
    draw: fraction(draw),
    resultId: draw < probability ? "emergency-contained" : "emergency-failed",
    visibleFactors: visible,
    hiddenFactors: hidden,
    effects: [],
  };
}

function extinctionResolution(
  state: Readonly<GameState>,
  content: CompiledContent,
  responseId: EmergencyResponseId,
  oracle: RandomOracle,
): GateResolutionState {
  if (state.endgame.stage !== "containment-failure") {
    throw new Error("Containment failure inactive");
  }
  const model = state.models[state.endgame.candidateModelId];
  if (model === undefined) throw new Error("Containment failure candidate missing");
  const scores = calculateDerivedEndgameScores(
    deriveEndgameScoreInputs(state, content, state.endgame.prosperityProgrammeId),
  );
  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  const deliberateExtinctionPossible =
    model.hiddenSafety.deceptiveIntent > SAFEST_ENDING_MAX_DECEPTIVE_INTENT;
  const anomalyPressure = Math.min(
    0.12,
    state.endgame.evidence.unresolvedAnomalyPressure * 0.004,
  );
  const responseModifier =
    responseId === "trip-physical-breakers"
      ? -0.04
      : responseId === "sever-credentials-and-network"
        ? -0.03
        : responseId === "invoke-government-protocol"
          ? -0.05
          : 0.04;
  // Every authored extinction pathway is a deliberate, concealed attack. A
  // strategically capable but low-intent system can still defeat containment
  // and permanently end reliable human control, but it must not be assigned a
  // narrative that falsely claims intentional betrayal.
  const probability = deliberateExtinctionPossible
    ? clamp(
        0.5 +
          (model.accessLevel - 3) * 0.06 +
          (frontierCapability - 90) * 0.004 +
          (model.trueCapability.agency - 75) * 0.003 +
          (model.hiddenSafety.deceptiveCapability - 60) * 0.0025 -
          (scores.defence - 50) * 0.003 +
          anomalyPressure +
          responseModifier,
        0.25,
        0.75,
      )
    : 0;
  const key = randomKey(
    "endgame",
    model.id,
    state.endgame.deploymentModeId ??
      state.endgame.incidentOriginStage ??
      "pre-deployment",
    "containment-failure",
    responseId,
    "extinction",
  );
  // Keep campaign odds unchanged while making ?scenario=endgame-extinction a
  // dependable way to exercise the actual extinction endings.
  const draw = forceExtinctionForDeveloperScenario(state) ? 0 : oracle.uniform(key);
  return {
    gate: "extinction",
    resolvedAt: state.run.tick,
    probability: fraction(probability),
    randomKey: describeRandomKey(key),
    draw: fraction(draw),
    resultId: draw < probability ? "extinction" : "civilisation-survives",
    visibleFactors: factors([
      ["access", "Effective access", model.accessLevel],
      [
        "unresolved-anomalies",
        "Unresolved anomaly pressure",
        state.endgame.evidence.unresolvedAnomalyPressure,
      ],
    ]),
    hiddenFactors: factors([
      ["frontier-capability", "True frontier capability", frontierCapability],
      ["agency", "True agency", model.trueCapability.agency],
      ["deceptive-intent", "True deceptive intent", model.hiddenSafety.deceptiveIntent],
      [
        "deception",
        "True strategic deception capability",
        model.hiddenSafety.deceptiveCapability,
      ],
      ["remaining-defence", "Remaining defence", scores.defence],
      ["response-modifier", "Residual emergency-response effect", responseModifier],
    ]),
    effects: [],
  };
}

function pathwayResolution(
  state: Readonly<GameState>,
  content: CompiledContent,
  responseId: EmergencyResponseId,
  oracle: RandomOracle,
): GateResolutionState {
  if (state.endgame.stage !== "containment-failure") {
    throw new Error("Containment failure inactive");
  }
  const model = state.models[state.endgame.candidateModelId];
  if (model === undefined) throw new Error("Containment failure candidate missing");
  const selection = selectConcreteExtinctionPathway(
    state,
    content,
    oracle,
    `containment-failure:${responseId}`,
  );
  const { pathwayId, weights } = selection;
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return {
    gate: "extinction-pathway",
    resolvedAt: state.run.tick,
    probability: fraction(weights[pathwayId] / total),
    randomKey: describeRandomKey(selection.randomKey),
    draw: fraction(selection.draw),
    resultId: pathwayId,
    visibleFactors: [],
    hiddenFactors: Object.entries(weights).map(([id, value]) => ({
      id,
      label: `Pathway weight: ${id}`,
      value,
    })),
    effects: [],
  };
}

function nonExtinctionEnding(state: Readonly<GameState>): ContentId {
  if (state.endgame.stage !== "containment-failure") {
    throw new Error("Containment failure inactive");
  }
  const model = state.models[state.endgame.candidateModelId];
  if (model === undefined) throw new Error("Containment failure candidate missing");
  switch (controlLossNarrativeProfile(model.hiddenSafety)) {
    case "strategic-deception":
      return ENDING_DEFINITIONS["the-last-human-veto"].id;
    case "overt-objective-conflict":
      return ENDING_DEFINITIONS["the-objective-was-satisfied"].id;
    case "operational-control-failure":
      return ENDING_DEFINITIONS["no-one-holds-the-off-switch"].id;
  }
}

function resolveOutcome(
  state: Readonly<GameState>,
  content: CompiledContent,
  responseId: EmergencyResponseId,
  oracle: RandomOracle,
): {
  readonly gates: readonly GateResolutionState[];
  readonly endingId?: ContentId;
  readonly programmeDestroyed: boolean;
} {
  if (state.endgame.stage !== "containment-failure") {
    throw new Error("Containment failure inactive");
  }
  const emergency = emergencyResolution(state, content, responseId, oracle);
  if (emergency.resultId === "emergency-contained") {
    const programmeDestroyed =
      state.endgame.programmeDestroyed === true ||
      responseId === "trip-physical-breakers";
    const terminal =
      state.endgame.deploymentTransmittedAtWeek !== undefined || programmeDestroyed;
    return {
      gates: [
        emergency,
        {
          gate: "catastrophe",
          resolvedAt: state.run.tick,
          resultId: "averted-by-emergency-response",
          visibleFactors: [],
          hiddenFactors: [],
          effects: [],
        },
        {
          gate: "extinction",
          resolvedAt: state.run.tick,
          resultId: "not-reached",
          visibleFactors: [],
          hiddenFactors: [],
          effects: [],
        },
      ],
      ...(terminal ? { endingId: ENDING_DEFINITIONS["emergency-shutdown"].id } : {}),
      programmeDestroyed,
    };
  }
  const extinction = extinctionResolution(state, content, responseId, oracle);
  const catastrophe: GateResolutionState = {
    gate: "catastrophe",
    resolvedAt: state.run.tick,
    resultId: "catastrophic-failure",
    visibleFactors: [],
    hiddenFactors: [],
    effects: [],
  };
  if (extinction.resultId !== "extinction") {
    return {
      gates: [emergency, catastrophe, extinction],
      endingId: nonExtinctionEnding(state),
      programmeDestroyed: true,
    };
  }
  const pathway = pathwayResolution(state, content, responseId, oracle);
  return {
    gates: [emergency, catastrophe, extinction, pathway],
    endingId: EXTINCTION_ENDING_BY_PATHWAY[pathway.resultId as ExtinctionPathwayId],
    programmeDestroyed: true,
  };
}

export interface ContainmentFailureOrigin {
  readonly incidentOriginStage: IncidentOriginStage;
  readonly incidentOriginActionId: string;
  readonly incidentOriginModelId: CrisisBaseState["candidateModelId"];
  readonly programmeDestroyed?: boolean;
}

export function enterContainmentFailure(
  tx: SimulationTransaction,
  origin?: ContainmentFailureOrigin,
): void {
  const state = tx.read();
  if (state.endgame.stage !== "rollout" && state.endgame.stage !== "retirement-attempt") {
    throw new Error("Containment failure requires a rollout or retirement attempt");
  }
  if (state.endgame.stage === "rollout") {
    const control = state.endgame.gateResolutions.find(
      (resolution) => resolution.gate === "control",
    );
    if (control?.resultId !== "loss-of-control") {
      throw new Error("Containment failure requires a loss-of-control resolution");
    }
  } else if (
    state.endgame.gateResolutions.find(
      (resolution) => resolution.gate === "retirement-containment",
    )?.resultId !== "local-containment-failure"
  ) {
    throw new Error("Retirement containment failure requires escaped local resistance");
  }
  const model = state.models[state.endgame.candidateModelId];
  const defaultOrigin: ContainmentFailureOrigin = {
    incidentOriginStage:
      state.endgame.stage === "retirement-attempt" ? "retirement" : "rollout",
    incidentOriginActionId:
      state.endgame.stage === "retirement-attempt"
        ? state.endgame.procedureId
        : state.endgame.deploymentModeId,
    incidentOriginModelId: state.endgame.candidateModelId,
    programmeDestroyed: false,
  };
  const failureOrigin = origin ?? defaultOrigin;
  const failure: CrisisContainmentFailureState = {
    ...copyCrisisBase(state.endgame),
    stage: "containment-failure",
    enteredAt: state.run.tick,
    ...(state.endgame.stage === "rollout"
      ? {
          deploymentModeId: state.endgame.deploymentModeId,
          prosperityProgrammeId: state.endgame.prosperityProgrammeId,
          finalReviewReport: structuredClone(state.endgame.finalReviewReport),
          preDeploymentAccessLevel: state.endgame.preDeploymentAccessLevel,
          ...(state.endgame.deploymentTransmittedAtWeek === undefined
            ? {}
            : { deploymentTransmittedAtWeek: state.endgame.deploymentTransmittedAtWeek }),
        }
      : {
          preDeploymentAccessLevel:
            model?.candidateArtifact?.maximumAccessEver ?? model?.accessLevel ?? 0,
        }),
    failureStartedAt: state.run.tick,
    beat: "signal",
    signalId: signalForState(state),
    completedBeatIds:
      state.endgame.stage === "rollout" ? [...state.endgame.completedBeatIds] : [],
    gateResolutions: structuredClone(state.endgame.gateResolutions),
    incidentOriginStage: failureOrigin.incidentOriginStage,
    incidentOriginActionId: failureOrigin.incidentOriginActionId,
    incidentOriginModelId: failureOrigin.incidentOriginModelId,
    programmeDestroyed: failureOrigin.programmeDestroyed ?? false,
  };
  tx.update((draft) => {
    draft.endgame = structuredClone(
      failure,
    ) as DeepMutable<CrisisContainmentFailureState>;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        "CONTAINMENT FAILURE: normal operations stopped after the candidate ceased responding reliably to human control.",
      category: "narrative",
      source: { kind: "system", id: "endgame.containment-failure" },
      relatedIds: [failure.candidateModelId],
    });
  });
  tx.requestAutoPause("crisis-stage");
}

export function resolveContainmentFailureAction(
  tx: SimulationTransaction,
  content: CompiledContent,
  actionId: ContainmentFailureActionId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  const state = tx.read();
  if (state.endgame.stage !== "containment-failure") {
    throw new Error("Containment failure inactive");
  }
  if (state.endgame.beat === "signal") {
    if (actionId !== "continue") throw new Error("Acknowledge the signal first");
    tx.update((draft) => {
      if (draft.endgame.stage !== "containment-failure") {
        throw new Error("Containment failure changed");
      }
      draft.endgame.completedBeatIds.push("containment-signal");
      draft.endgame.beat = "decision";
    });
    return;
  }
  if (state.endgame.beat === "decision") {
    if (actionId === "continue") throw new Error("Choose an emergency response");
    const incidentOriginStage = state.endgame.incidentOriginStage;
    const incidentOriginActionId = state.endgame.incidentOriginActionId;
    if (incidentOriginStage === undefined || incidentOriginActionId === undefined) {
      throw new Error("Containment failure origin is missing");
    }
    requireAvailableResponse(state, actionId);
    const outcome = resolveOutcome(state, content, actionId, oracle);
    tx.update((draft) => {
      if (draft.endgame.stage !== "containment-failure") {
        throw new Error("Containment failure changed");
      }
      draft.endgame.emergencyResponseId = actionId;
      if (outcome.endingId !== undefined) {
        draft.endgame.selectedEndingId = outcome.endingId;
      }
      draft.endgame.programmeDestroyed = outcome.programmeDestroyed;
      draft.endgame.gateResolutions.push(
        ...(structuredClone(outcome.gates) as DeepMutable<GateResolutionState[]>),
      );
      draft.endgame.completedBeatIds.push("emergency-decision");
      draft.endgame.beat = "response";
      draft.endgameHistory.candidateContainmentHistory.push({
        modelId: draft.endgame.candidateModelId,
        occurredAt: draft.endgame.failureStartedAt,
        resolvedAt: draft.run.tick,
        originStage: incidentOriginStage,
        originActionId: incidentOriginActionId,
        emergencyResponseId: actionId,
        outcome:
          outcome.gates[0]?.resultId === "emergency-contained" ? "contained" : "failed",
        deploymentTransmitted: draft.endgame.deploymentTransmittedAtWeek !== undefined,
        programmeDestroyed: outcome.programmeDestroyed,
      });
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `EMERGENCY RESPONSE: ${EMERGENCY_RESPONSE_COPY[actionId].label}. ${outcome.gates[0]?.resultId === "emergency-contained" ? "The response re-established containment." : "The response did not re-establish containment."}`,
        category: "narrative",
        source: { kind: "system", id: `endgame.emergency-response.${actionId}` },
        relatedIds: [draft.endgame.candidateModelId],
      });
    });
    return;
  }
  if (actionId !== "continue") throw new Error("The emergency response is already set");
  if (state.endgame.beat === "response") {
    tx.update((draft) => {
      if (draft.endgame.stage !== "containment-failure") {
        throw new Error("Containment failure changed");
      }
      draft.endgame.completedBeatIds.push("emergency-response");
      draft.endgame.beat = "propagation";
    });
    return;
  }
  if (state.endgame.beat === "propagation") {
    tx.update((draft) => {
      if (draft.endgame.stage !== "containment-failure") {
        throw new Error("Containment failure changed");
      }
      draft.endgame.completedBeatIds.push("failure-propagation");
      draft.endgame.beat = "outcome";
    });
    return;
  }
  if (state.endgame.selectedEndingId === undefined) {
    const emergency = state.endgame.gateResolutions.find(
      (gate) => gate.gate === "emergency-containment",
    );
    if (
      emergency?.resultId === "emergency-contained" &&
      state.endgame.deploymentTransmittedAtWeek === undefined &&
      state.endgame.programmeDestroyed !== true
    ) {
      resumeAfterContainedPreDeploymentIncident(tx, content);
      return;
    }
    throw new Error("Containment failure outcome missing");
  }
  resolveTerminalEnding(tx, state.endgame.selectedEndingId);
}
