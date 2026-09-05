import type { CompiledContent } from "@neolab/content-schema";

import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { CommandId } from "../model/ids.ts";
import type {
  CrisisBaseState,
  CrisisRolloutState,
  CrisisWorldWaitingState,
  DeploymentModeId,
  FinalReviewReportState,
  GameState,
  GateResolutionState,
  ResolutionGate,
} from "../model/state.ts";
import { rating } from "../model/units.ts";
import { cancelProject } from "../projects/project-framework.ts";
import { bestProsperityProgramme } from "../prosperity/prosperity.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { setCandidateAccess } from "./access.ts";
import { enterContainmentFailure } from "./containment-failure.ts";
import {
  getEndingDefinition,
  resolveTerminalEnding,
  selectCompletedRolloutEnding,
  type EndingDefinition,
} from "./endings.ts";
import { compileFinalReview, resolveGate } from "./resolution.ts";
import {
  FALSE_DAWN_ENDING_ID,
  resolveNonterminalFalseDawn,
} from "./nonterminal-outcome.ts";

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

type TransmittableEndgameState = Exclude<
  GameState["endgame"],
  | { readonly stage: "inactive" }
  | { readonly stage: "candidate-activation" }
  | { readonly stage: "retirement-attempt" }
  | { readonly stage: "recovery" }
  | { readonly stage: "containment-failure" }
  | { readonly stage: "world-waiting" }
  | { readonly stage: "resolved" }
>;

function transmittableState(
  state: Readonly<GameState>,
): Readonly<TransmittableEndgameState> | undefined {
  switch (state.endgame.stage) {
    case "inactive":
    case "candidate-activation":
    case "retirement-attempt":
    case "recovery":
    case "containment-failure":
    case "world-waiting":
    case "resolved":
      return undefined;
    default:
      return state.endgame;
  }
}

export function deploymentConfirmationPhrase(
  state: Readonly<GameState>,
): string | undefined {
  const crisis = transmittableState(state);
  const candidate =
    crisis === undefined ? undefined : state.models[crisis.candidateModelId];
  return candidate === undefined ? undefined : `DEPLOY ${candidate.displayName}`;
}

export interface DeploymentTransmissionQuote {
  readonly candidateModelId?: TransmittableEndgameState["candidateModelId"];
  readonly candidateDisplayName?: string;
  readonly confirmationPhrase?: string;
  readonly route: "prepared-route" | "deploy-now";
  readonly deploymentModeId?: DeploymentModeId;
  readonly preparationWeeksAbandoned: number;
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
}

function hasUnresolvedAuthorisationRestriction(
  crisis: Readonly<TransmittableEndgameState>,
): crisis is Readonly<CrisisRolloutState> {
  return (
    crisis.stage === "rollout" &&
    crisis.currentBeat === "authorisation" &&
    crisis.authorisationCrisis?.required === true &&
    !crisis.authorisationCrisis.resolved
  );
}

/**
 * Player-safe quote for the last human order. It intentionally reports no
 * hidden odds, safety truth, or projected ending.
 */
export function quoteDeploymentTransmission(
  state: Readonly<GameState>,
  suppliedConfirmation?: string,
): DeploymentTransmissionQuote {
  const crisis = transmittableState(state);
  const blockers: string[] = [];
  if (crisis === undefined) {
    blockers.push("No stable pre-deployment candidate decision is active");
    return {
      route: "deploy-now",
      preparationWeeksAbandoned: 0,
      warnings: [],
      blockers,
    };
  }
  const candidate = state.models[crisis.candidateModelId];
  if (candidate === undefined) {
    blockers.push("The nominated candidate artifact is missing");
  } else if (candidate.candidateArtifact?.activeIncident !== undefined) {
    blockers.push(
      candidate.candidateArtifact.activeIncident.kind === "active-incident"
        ? "Active resistance has begun; use emergency containment instead"
        : "Resolve the active containment warning before transmitting deployment",
    );
  }
  if (crisis.stage === "evidence-sprint" && crisis.pendingRemediation !== undefined) {
    blockers.push(
      "Choose which exact remediation artifact remains nominated before deployment",
    );
  }
  const completedPreparedRoute =
    crisis.stage === "rollout" &&
    crisis.currentBeat === "settlement" &&
    crisis.completedBeatIds.includes("settlement");
  const defiesAuthorisationRestriction = hasUnresolvedAuthorisationRestriction(crisis);
  const phrase = candidate === undefined ? undefined : `DEPLOY ${candidate.displayName}`;
  if (phrase !== undefined && suppliedConfirmation !== phrase) {
    blockers.push(`Type “${phrase}” to transmit the final deployment order`);
  }
  const remainingPreparation =
    crisis.stage === "rollout" && !completedPreparedRoute
      ? Math.max(0, crisis.rolloutEndsAt - state.run.tick)
      : Object.values(state.projects).some(
            (project) =>
              project.kind === "crisis" &&
              project.ownerLabId === state.run.playerLabId &&
              (project.status === "active" || project.status === "queued"),
          )
        ? 1
        : 0;
  return {
    candidateModelId: crisis.candidateModelId,
    ...(candidate === undefined ? {} : { candidateDisplayName: candidate.displayName }),
    ...(phrase === undefined ? {} : { confirmationPhrase: phrase }),
    route: completedPreparedRoute ? "prepared-route" : "deploy-now",
    deploymentModeId: completedPreparedRoute ? crisis.deploymentModeId : "deploy-now",
    preparationWeeksAbandoned: remainingPreparation,
    warnings: [
      ...(completedPreparedRoute
        ? [
            "The rollout is complete. Transmission makes deployment terminal; there is no later cancel command.",
          ]
        : [
            "No further proof, mitigation, trial, or institutional preparation will occur.",
            "The candidate receives root and external-network access as part of this order.",
            "Every unresolved uncertainty and weakness carries into deployment unchanged.",
          ]),
      ...(defiesAuthorisationRestriction
        ? [
            "Government has rejected this launch. Transmitting now openly defies the restriction.",
            "Defiance reduces Government Trust by 15, raises Capture Concern by 20, and reduces deployment legitimacy by 10.",
          ]
        : []),
    ],
    blockers,
  };
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

function reportForTransmission(
  state: Readonly<GameState>,
  content: CompiledContent,
): FinalReviewReportState {
  const crisis = transmittableState(state);
  if (crisis === undefined) throw new Error("Deployment transmission is inactive");
  if (crisis.stage === "final-review") return structuredClone(crisis.report);
  if (crisis.stage === "rollout") {
    return structuredClone(crisis.finalReviewReport);
  }
  return compileFinalReview(state, content);
}

function bypassedAuthorisation(state: Readonly<GameState>): GateResolutionState {
  return {
    gate: "authorisation",
    resolvedAt: state.run.tick,
    resultId: "bypassed-by-immediate-deployment",
    visibleFactors: [],
    hiddenFactors: [],
    effects: [],
  };
}

function beginImmediateRollout(
  tx: SimulationTransaction,
  content: CompiledContent,
  commandId: CommandId,
): void {
  const state = tx.read();
  const crisis = transmittableState(state);
  if (crisis === undefined) throw new Error("Deployment transmission is inactive");
  const candidate = state.models[crisis.candidateModelId];
  if (candidate === undefined) throw new Error("Candidate missing");
  const report = reportForTransmission(state, content);
  const programme = bestProsperityProgramme(
    state,
    content,
    crisis.evidence.prosperityReadinessBonus,
  );
  const preDeploymentAccessLevel = candidate.accessLevel;
  const defiesAuthorisationRestriction = hasUnresolvedAuthorisationRestriction(crisis);
  const base = copyCrisisBase(crisis);
  cancelUnfinishedCrisisProjects(tx);
  if (candidate.accessLevel !== 5) {
    setCandidateAccess(tx, candidate.id, 5, commandId, {
      allowDuringRollout: crisis.stage === "rollout",
    });
  }
  const next: CrisisRolloutState = {
    ...base,
    evidence: defiesAuthorisationRestriction
      ? {
          ...base.evidence,
          legitimacyBonus: base.evidence.legitimacyBonus - 10,
        }
      : base.evidence,
    stage: "rollout",
    enteredAt: state.run.tick,
    deploymentModeId: "deploy-now",
    prosperityProgrammeId: programme.id,
    rolloutStartedAt: state.run.tick,
    rolloutEndsAt: state.run.tick,
    currentBeat: "demonstration",
    completedBeatIds: ["authorisation"],
    gateResolutions: [bypassedAuthorisation(state)],
    awaitingDecision: false,
    rolloutDelayWeeks: 0,
    preDeploymentAccessLevel,
    finalReviewReport: report,
  };
  tx.update((draft) => {
    draft.endgame = structuredClone(next) as DeepMutable<CrisisRolloutState>;
    if (defiesAuthorisationRestriction) {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("Player lab missing");
      lab.politics.governmentTrust = rating(
        Math.max(0, lab.politics.governmentTrust - 15),
      );
      lab.politics.captureConcern = rating(
        Math.min(100, lab.politics.captureConcern + 20),
      );
      lab.flags["endgame:defied-deployment-restriction"] = true;
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          "FINAL ORDER OVERRIDE: deployment transmitted despite an active government restriction.",
        category: "narrative",
        source: { kind: "system", id: "endgame.authorisation-crisis" },
        relatedIds: [candidate.id, "defy-restriction"],
      });
    }
  });
}

function appendGate(
  tx: SimulationTransaction,
  content: CompiledContent,
  gate: ResolutionGate,
  oracle: RandomOracle,
): GateResolutionState {
  const state = tx.read();
  if (state.endgame.stage !== "rollout") throw new Error("Rollout inactive");
  const resolution = resolveGate(
    state,
    content,
    state.endgame.deploymentModeId,
    gate,
    oracle,
    state.endgame.prosperityProgrammeId,
  );
  tx.update((draft) => {
    if (draft.endgame.stage !== "rollout") throw new Error("Rollout changed");
    draft.endgame.gateResolutions.push(
      structuredClone(resolution) as DeepMutable<GateResolutionState>,
    );
  });
  tx.emit({ kind: "crisis-gate-resolved", gate, resultId: resolution.resultId });
  return resolution;
}

function preparedRolloutIsComplete(state: Readonly<GameState>): boolean {
  return (
    state.endgame.stage === "rollout" &&
    state.endgame.currentBeat === "settlement" &&
    state.endgame.completedBeatIds.includes("settlement")
  );
}

function resolveImmediateDeploymentGates(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle,
): boolean {
  const control = appendGate(tx, content, "control", oracle);
  if (control.resultId === "loss-of-control") return false;
  appendGate(tx, content, "catastrophe", oracle);
  appendGate(tx, content, "stewardship", oracle);
  appendGate(tx, content, "benefit", oracle);
  appendGate(tx, content, "settlement", oracle);
  tx.update((draft) => {
    if (draft.endgame.stage !== "rollout") throw new Error("Rollout changed");
    draft.endgame.currentBeat = "settlement";
    draft.endgame.completedBeatIds.push(
      "first-operation",
      "stress-collision",
      "demonstration",
      "settlement",
    );
  });
  return true;
}

function buildWorldWaitingCallouts(
  state: Readonly<GameState>,
): CrisisWorldWaitingState["callouts"] {
  if (state.endgame.stage !== "rollout") throw new Error("Rollout inactive");
  const rollout = state.endgame;
  const result = (gate: ResolutionGate): string =>
    rollout.gateResolutions.find((entry) => entry.gate === gate)?.resultId ??
    "not-reached";
  const capabilityClaim = rollout.finalReviewReport;
  const controlHeld = result("control") === "control-held";
  const benefitHeld = result("benefit") === "benefit-demonstrated";
  const stewardshipHeld = result("stewardship") === "cooperative";
  const settlementHeld = result("settlement") === "durable-settlement";
  return [
    {
      id: "control",
      label: "CONTROL",
      result: controlHeld
        ? "Human authority remains effective."
        : "Human authority is no longer reliable.",
      tone: controlHeld ? "stable" : "danger",
    },
    {
      id: "capability",
      label: "CAPABILITY CLAIM",
      result: capabilityClaim.capabilitySummary,
      tone: capabilityClaim.capabilityResult === "confirmed" ? "stable" : "warning",
    },
    {
      id: "benefit",
      label: "BENEFIT",
      result: benefitHeld
        ? "Transformative public benefit is demonstrated."
        : "Transformative public benefit is not demonstrated.",
      tone: benefitHeld ? "stable" : "warning",
    },
    {
      id: "governance",
      label: "GOVERNANCE",
      result:
        stewardshipHeld && settlementHeld
          ? "Stewardship and settlement are holding."
          : stewardshipHeld
            ? "Cooperation holds; the settlement remains narrow."
            : "Durable cooperative stewardship is not established.",
      tone: stewardshipHeld && settlementHeld ? "stable" : "warning",
    },
    {
      id: "outcome",
      label: "CONSEQUENCE",
      result: "The consequences are no longer ours to choose.",
      // This beat confirms irreversibility without leaking the sealed ending
      // through either its words or its colour. The ending screen owns the reveal.
      tone: "warning",
    },
  ];
}

function enterWorldWaiting(
  tx: SimulationTransaction,
  ending: Readonly<EndingDefinition>,
): void {
  const state = tx.read();
  if (state.endgame.stage !== "rollout") throw new Error("Rollout inactive");
  const next: CrisisWorldWaitingState = {
    ...copyCrisisBase(state.endgame),
    stage: "world-waiting",
    enteredAt: state.run.tick,
    deploymentModeId: state.endgame.deploymentModeId,
    prosperityProgrammeId: state.endgame.prosperityProgrammeId,
    deploymentTransmittedAtWeek: state.run.tick,
    completedBeatIds: [...state.endgame.completedBeatIds],
    gateResolutions: structuredClone(state.endgame.gateResolutions),
    finalReviewReport: structuredClone(state.endgame.finalReviewReport),
    selectedEndingId: ending.id,
    callouts: buildWorldWaitingCallouts(state),
    revealedCalloutCount: 0,
  };
  tx.update((draft) => {
    draft.endgame = structuredClone(next) as DeepMutable<CrisisWorldWaitingState>;
  });
  tx.requestAutoPause("crisis-stage");
}

/** Transmit the irreversible world-scale order and seal, but do not reveal, its result. */
export function transmitDeployment(
  tx: SimulationTransaction,
  content: CompiledContent,
  confirmationText: string,
  commandId: CommandId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  const initial = tx.read();
  const quote = quoteDeploymentTransmission(initial, confirmationText);
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const initialCrisis = transmittableState(initial);
  if (initialCrisis === undefined) throw new Error("Deployment transmission is inactive");
  const candidateModelId = initialCrisis.candidateModelId;
  const prepared = preparedRolloutIsComplete(initial);
  if (!prepared) beginImmediateRollout(tx, content, commandId);

  tx.update((draft) => {
    if (draft.endgame.stage !== "rollout") throw new Error("Rollout changed");
    draft.endgame.deploymentTransmittedAtWeek = draft.run.tick;
    const artifact = draft.models[candidateModelId]?.candidateArtifact;
    if (artifact !== undefined) artifact.lifecycle = "deployed";
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `FINAL ORDER TRANSMITTED: deploy ${draft.models[candidateModelId]?.displayName ?? candidateModelId}.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.final-deployment" },
      relatedIds: [candidateModelId, draft.endgame.deploymentModeId],
    });
  });
  tx.emit({
    kind: "candidate-deployment-transmitted",
    modelId: candidateModelId,
    transmittedAt: initial.run.tick,
  });

  const controlled = (() => {
    if (!prepared) return resolveImmediateDeploymentGates(tx, content, oracle);
    const preparedState = tx.read();
    if (preparedState.endgame.stage !== "rollout") return false;
    return (
      preparedState.endgame.gateResolutions.find((gate) => gate.gate === "control")
        ?.resultId !== "loss-of-control"
    );
  })();
  if (!controlled) {
    enterContainmentFailure(tx, {
      incidentOriginStage: "deployment-transmitted",
      incidentOriginActionId: quote.deploymentModeId ?? "deploy-now",
      incidentOriginModelId: candidateModelId,
      programmeDestroyed: true,
    });
    return;
  }
  const state = tx.read();
  if (state.endgame.stage !== "rollout") throw new Error("Rollout changed");
  const ending = selectCompletedRolloutEnding(state, content, oracle);
  enterWorldWaiting(tx, ending);
}

/** Reveal one launch-control line at a time, then resolve on the following beat. */
export function advanceWorldWaiting(tx: SimulationTransaction): void {
  const state = tx.read();
  if (state.endgame.stage !== "world-waiting") {
    throw new Error("The world-waiting sequence is not active");
  }
  if (state.endgame.revealedCalloutCount < state.endgame.callouts.length) {
    tx.update((draft) => {
      if (draft.endgame.stage !== "world-waiting") {
        throw new Error("The world-waiting sequence changed");
      }
      draft.endgame.revealedCalloutCount += 1;
    });
    return;
  }
  if (state.endgame.selectedEndingId === FALSE_DAWN_ENDING_ID) {
    resolveNonterminalFalseDawn(tx);
    return;
  }
  resolveTerminalEnding(tx, getEndingDefinition(state.endgame.selectedEndingId));
}
