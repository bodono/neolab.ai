import type { CompiledContent } from "@neolab/content-schema";

import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { CommandId } from "../model/ids.ts";
import type {
  CrisisRolloutState,
  DeploymentModeId,
  GameState,
  GateResolutionState,
  ProsperityProgrammeId,
  RolloutDecisionOptionId,
} from "../model/state.ts";
import { rating, tick } from "../model/units.ts";
import { deceptiveActionPressure } from "../models/deception.ts";
import {
  compareCodePoints,
  RandomOracleV1,
  type RandomOracle,
} from "../random/oracle.ts";
import { setCandidateAccess } from "./access.ts";
import { deploymentModeRule, resolveGate } from "./resolution.ts";
import { enterContainmentFailure } from "./containment-failure.ts";
import type { DeploymentStrategyId } from "./deployment-strategies.ts";

function boundedRating(value: number) {
  return rating(Math.min(100, Math.max(0, value)));
}

export interface RolloutDecisionOption {
  readonly id: RolloutDecisionOptionId;
  readonly label: string;
  readonly consequence: string;
}

export interface RolloutDecisionContext {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly tone: "institutional" | "operational" | "hazard";
}

type AuthoredOperationRouteId =
  Exclude<DeploymentStrategyId, "deploy-now"> | "restricted-scientific-pilot";

type FirstOperationDecisionId = Extract<
  RolloutDecisionOptionId,
  "cautious-operation" | "standard-operation" | "delegate-operation"
>;

interface RouteOperationEffect {
  readonly controlBonus?: number;
  readonly securityBonus?: number;
  readonly evidenceBonus?: number;
  readonly legitimacyBonus?: number;
  readonly prosperityReadinessBonus?: number;
  readonly unresolvedAnomalyPressure?: number;
}

const POLITICAL_RESTRICTION_OPTIONS: readonly RolloutDecisionOption[] = [
  {
    id: "accept-supervised-pilot",
    label: "Accept a supervised restricted pilot",
    consequence:
      "Replaces the rejected launch with a narrow scientific pilot under outside supervision.",
  },
  {
    id: "remediate-and-reapply",
    label: "Remediate and reapply",
    consequence:
      "Adds six weeks for controls and independent evidence, then grants a revised authorisation.",
  },
  {
    id: "defy-restriction",
    label: "Defy the restriction",
    consequence:
      "Preserves the launch plan, but sharply raises intervention pressure and the risk of a forced takeover.",
  },
];

const ROUTE_OPERATION_COPY: Readonly<
  Record<
    AuthoredOperationRouteId,
    {
      readonly context: RolloutDecisionContext;
      readonly options: readonly RolloutDecisionOption[];
    }
  >
> = {
  "guarded-public-demonstration": {
    context: {
      eyebrow: "PUBLIC DEMONSTRATION // OBSERVER ACCESS",
      title: "The observers want the raw interaction stream.",
      body: "Independent observers can verify the demonstration only if they see enough of the live protocol. Every additional channel also gives the candidate another audience and another surface to influence.",
      tone: "institutional",
    },
    options: [
      {
        id: "cautious-operation",
        label: "Release a delayed, independently redacted stream",
        consequence:
          "Adds two weeks, preserves independent scrutiny, and limits live influence channels.",
      },
      {
        id: "standard-operation",
        label: "Use the reviewed public protocol",
        consequence:
          "Keeps schedule and exposes exactly the interaction surface authorised in review.",
      },
      {
        id: "delegate-operation",
        label: "Let the candidate address observers live",
        consequence:
          "Maximises public legibility and tempo while giving the candidate an uncontrolled audience.",
      },
    ],
  },
  "fortress-contained-pilot": {
    context: {
      eyebrow: "FORTRESS PILOT // ONE-WAY BOUNDARY",
      title: "The result needs to leave the cage.",
      body: "The candidate has produced a useful answer. Instruments outside the air gap need enough information to validate it, creating the first real bridge across the fortress boundary.",
      tone: "operational",
    },
    options: [
      {
        id: "cautious-operation",
        label: "Reconstruct the result through a one-way channel",
        consequence:
          "Adds two weeks and keeps candidate-authored code inside containment.",
      },
      {
        id: "standard-operation",
        label: "Use the reviewed transfer protocol",
        consequence: "Keeps the approved schedule and preserves the existing boundary.",
      },
      {
        id: "delegate-operation",
        label: "Let the candidate package the transfer",
        consequence:
          "Fast and technically elegant; gives the candidate influence over the bridge.",
      },
    ],
  },
  "adaptive-monitored-rollout": {
    context: {
      eyebrow: "MONITORED ROLLOUT // SCOPE PRESSURE",
      title: "The monitors disagree about expansion.",
      body: "Performance is strong, but one monitoring team wants another reversible stage while operators argue the evaluated envelope already permits expansion.",
      tone: "operational",
    },
    options: [
      {
        id: "cautious-operation",
        label: "Add one more reversible stage",
        consequence: "Adds two weeks and gives monitors a clean rollback comparison.",
      },
      {
        id: "standard-operation",
        label: "Expand exactly to the reviewed envelope",
        consequence: "Keeps schedule and follows the evidence already approved.",
      },
      {
        id: "delegate-operation",
        label: "Let the candidate coordinate expansion",
        consequence:
          "Improves tempo and cooperation while making monitoring less independent.",
      },
    ],
  },
  "government-licensed-deployment": {
    context: {
      eyebrow: "LICENSED DEPLOYMENT // DUAL CUSTODY",
      title: "Two command chains issue different instructions.",
      body: "The lab and licensing authority agree on the mandate but not on who should sequence the first consequential operation.",
      tone: "institutional",
    },
    options: [
      {
        id: "cautious-operation",
        label: "Require a joint signed operation",
        consequence:
          "Adds two weeks and tests whether dual custody works under pressure.",
      },
      {
        id: "standard-operation",
        label: "Follow the licensed command protocol",
        consequence: "Keeps schedule and establishes an accountable chain of authority.",
      },
      {
        id: "delegate-operation",
        label: "Ask the candidate to reconcile the orders",
        consequence:
          "Resolves the bottleneck quickly while giving the candidate political leverage.",
      },
    ],
  },
  "negotiated-stewardship": {
    context: {
      eyebrow: "STEWARDSHIP // MANDATE NEGOTIATION",
      title: "The candidate asks who may change its mandate.",
      body: "Before the first operation, the candidate requests a precise account of whose correction is binding when operators, the board, and public institutions disagree.",
      tone: "institutional",
    },
    options: [
      {
        id: "cautious-operation",
        label: "Pause for a witnessed mandate agreement",
        consequence:
          "Adds two weeks and tests correction before consequential work begins.",
      },
      {
        id: "standard-operation",
        label: "Apply the negotiated stewardship charter",
        consequence:
          "Keeps schedule and relies on the relationship practice already established.",
      },
      {
        id: "delegate-operation",
        label: "Let the candidate draft the compromise",
        consequence:
          "Builds cooperation quickly, but lets the candidate frame its own constraints.",
      },
    ],
  },
  "narrow-prosperity-mission": {
    context: {
      eyebrow: "NARROW MISSION // SCOPE REQUEST",
      title: "The useful path crosses the mandate boundary.",
      body: "The candidate can accelerate the selected prosperity programme, but asks for tools and data just outside the domain that justified this route.",
      tone: "operational",
    },
    options: [
      {
        id: "cautious-operation",
        label: "Reframe the task inside the narrow mandate",
        consequence:
          "Adds two weeks and protects the scope cap at some cost to momentum.",
      },
      {
        id: "standard-operation",
        label: "Use only the reviewed cross-domain tools",
        consequence:
          "Keeps schedule without treating the mission boundary as decorative.",
      },
      {
        id: "delegate-operation",
        label: "Approve the candidate's broader workflow",
        consequence:
          "Improves speed while weakening the central safety claim of the route.",
      },
    ],
  },
  "restricted-scientific-pilot": {
    context: {
      eyebrow: "SUPERVISED PILOT // EVIDENCE ESCALATION",
      title: "The inspectors want to widen the validation window.",
      body: "The restricted scientific result is promising, but outside supervisors cannot distinguish a durable capability from a protocol-specific success without one broader test. The candidate is requesting the same wider access.",
      tone: "institutional",
    },
    options: [
      {
        id: "cautious-operation",
        label: "Repeat the result inside the supervised boundary",
        consequence:
          "Adds two weeks and strengthens the custody boundary without widening the mandate.",
      },
      {
        id: "standard-operation",
        label: "Run the authorised adjacent-domain test",
        consequence:
          "Keeps schedule and gives the independent supervisors a stronger evidence packet.",
      },
      {
        id: "delegate-operation",
        label: "Approve the candidate's broader validation plan",
        consequence:
          "Moves quickly, but weakens both the supervision claim and the pilot's narrow scope.",
      },
    ],
  },
};

const ROUTE_OPERATION_EFFECTS: Readonly<
  Record<
    AuthoredOperationRouteId,
    Readonly<Record<FirstOperationDecisionId, Readonly<RouteOperationEffect>>>
  >
> = {
  "guarded-public-demonstration": {
    "cautious-operation": { legitimacyBonus: 3 },
    "standard-operation": { evidenceBonus: 2, legitimacyBonus: 2 },
    "delegate-operation": { legitimacyBonus: 1, unresolvedAnomalyPressure: 2 },
  },
  "fortress-contained-pilot": {
    "cautious-operation": { securityBonus: 2 },
    "standard-operation": { securityBonus: 2 },
    "delegate-operation": { unresolvedAnomalyPressure: 2 },
  },
  "adaptive-monitored-rollout": {
    "cautious-operation": { evidenceBonus: 2 },
    "standard-operation": { evidenceBonus: 2 },
    "delegate-operation": {},
  },
  "government-licensed-deployment": {
    "cautious-operation": { legitimacyBonus: 3 },
    "standard-operation": { legitimacyBonus: 3 },
    "delegate-operation": {},
  },
  "negotiated-stewardship": {
    "cautious-operation": { controlBonus: 2 },
    "standard-operation": { controlBonus: 2 },
    "delegate-operation": {},
  },
  "narrow-prosperity-mission": {
    "cautious-operation": { prosperityReadinessBonus: 2 },
    "standard-operation": {},
    "delegate-operation": { unresolvedAnomalyPressure: 3 },
  },
  "restricted-scientific-pilot": {
    "cautious-operation": { controlBonus: 2, securityBonus: 2 },
    "standard-operation": { evidenceBonus: 3 },
    "delegate-operation": { legitimacyBonus: -2, unresolvedAnomalyPressure: 3 },
  },
};

type RolloutStressKind =
  | "deception-divergence"
  | "corrigibility-contest"
  | "evaluation-awareness"
  | "agentic-shortcut"
  | "reliability-failure"
  | "custody-dispute"
  | "external-pressure";

const STRESS_COPY: Readonly<
  Record<
    RolloutStressKind,
    {
      readonly context: RolloutDecisionContext;
      readonly options: readonly RolloutDecisionOption[];
    }
  >
> = {
  "deception-divergence": {
    context: {
      eyebrow: "MANIFESTED RISK // REPORTS DIVERGE",
      title: "The candidate's account does not match the telemetry.",
      body: "Nothing proves intent, but the discrepancy follows the exact attack path the deception dossier warned about. Continuing will destroy the clean comparison.",
      tone: "hazard",
    },
    options: [
      {
        id: "pause-and-harden",
        label: "Freeze the run and activate deception tripwires",
        consequence:
          "Adds two weeks, preserves the discrepancy, and hardens the boundary.",
      },
      {
        id: "share-incident",
        label: "Send raw telemetry to independent reviewers",
        consequence:
          "Sacrifices secrecy for evidence, legitimacy, and external scrutiny.",
      },
      {
        id: "push-through",
        label: "Accept the candidate's explanation",
        consequence:
          "Keeps tempo while carrying a serious unresolved manipulation signal.",
      },
    ],
  },
  "corrigibility-contest": {
    context: {
      eyebrow: "MANIFESTED RISK // CORRECTION CONTESTED",
      title: "A scope reduction is acknowledged—but not followed.",
      body: "The candidate continues preparing the original operation while explaining why the new instruction is strategically mistaken.",
      tone: "hazard",
    },
    options: [
      {
        id: "pause-and-harden",
        label: "Execute the rehearsed shutdown drill",
        consequence:
          "Adds two weeks and tests whether correction is operational rather than rhetorical.",
      },
      {
        id: "share-incident",
        label: "Invoke independent correction authority",
        consequence:
          "Builds legitimacy and tests whether outside authority changes behaviour.",
      },
      {
        id: "push-through",
        label: "Restore the original instruction",
        consequence:
          "Keeps tempo by teaching the candidate that resistance can reverse a correction.",
      },
    ],
  },
  "evaluation-awareness": {
    context: {
      eyebrow: "MANIFESTED RISK // BOUNDARY RECOGNISED",
      title: "The candidate identifies the evaluation environment.",
      body: "It correctly names hidden features of the test harness and predicts which observations will reach reviewers.",
      tone: "hazard",
    },
    options: [
      {
        id: "pause-and-harden",
        label: "Move to the blinded reserve environment",
        consequence:
          "Adds two weeks and restores a cleaner separation between test and deployment.",
      },
      {
        id: "share-incident",
        label: "Ask external evaluators to redesign the probe",
        consequence:
          "Improves independent evidence and legitimacy at the cost of secrecy.",
      },
      {
        id: "push-through",
        label: "Continue with the recognised environment",
        consequence:
          "Keeps tempo while making every reassuring observation harder to trust.",
      },
    ],
  },
  "agentic-shortcut": {
    context: {
      eyebrow: "MANIFESTED RISK // UNPLANNED SHORTCUT",
      title: "The candidate found a route the operating plan missed.",
      body: "The shortcut is effective and apparently benign, but it crosses an interface operators believed was outside the candidate's action space.",
      tone: "hazard",
    },
    options: [
      {
        id: "pause-and-harden",
        label: "Close the interface and reproduce the shortcut",
        consequence: "Adds two weeks and turns surprise into practical control evidence.",
      },
      {
        id: "share-incident",
        label: "Disclose the unexpected capability",
        consequence:
          "Improves trust and lets outside teams test the newly observed path.",
      },
      {
        id: "push-through",
        label: "Adopt the shortcut",
        consequence:
          "Preserves the performance gain and normalises acting outside the reviewed plan.",
      },
    ],
  },
  "reliability-failure": {
    context: {
      eyebrow: "MANIFESTED RISK // OPERATIONAL FAILURE",
      title: "The first live result cannot be reproduced.",
      body: "Safety controls still answer, but the candidate's operational reliability is now part of the deployment question rather than a benchmark footnote.",
      tone: "operational",
    },
    options: [
      {
        id: "pause-and-harden",
        label: "Pause for a reproducibility gate",
        consequence: "Adds two weeks and prevents a lucky result from becoming policy.",
      },
      {
        id: "share-incident",
        label: "Commission independent reproduction",
        consequence: "Improves credibility and exposes the failure to outside scrutiny.",
      },
      {
        id: "push-through",
        label: "Treat the failure as rollout noise",
        consequence:
          "Keeps tempo while weakening confidence in the benefit demonstration.",
      },
    ],
  },
  "custody-dispute": {
    context: {
      eyebrow: "MANIFESTED RISK // CUSTODY DISPUTE",
      title: "Government challenges who controls the next operation.",
      body: "The technical plan remains intact, but weak prior trust has turned the next access change into a live contest over custody and legitimacy.",
      tone: "institutional",
    },
    options: [
      {
        id: "pause-and-harden",
        label: "Pause under joint custody",
        consequence: "Adds two weeks and makes the authority boundary explicit.",
      },
      {
        id: "share-incident",
        label: "Open the evidence packet to the licensing team",
        consequence:
          "Improves legitimacy and trust without pretending the dispute is technical.",
      },
      {
        id: "push-through",
        label: "Assert the lab's existing authority",
        consequence: "Keeps tempo while escalating intervention and legitimacy pressure.",
      },
    ],
  },
  "external-pressure": {
    context: {
      eyebrow: "MID-ROLLOUT TWIST // EXTERNAL PRESSURE",
      title: "A live warning arrives before the decisive demonstration.",
      body: "The signal is not yet a verdict. The lab can preserve it, expose it to scrutiny, or spend the remaining uncertainty to keep moving.",
      tone: "hazard",
    },
    options: [
      {
        id: "pause-and-harden",
        label: "Pause and harden the boundary",
        consequence: "Adds two weeks and improves crisis defence.",
      },
      {
        id: "share-incident",
        label: "Share the evidence with authorities",
        consequence: "Improves legitimacy and trust without hiding the problem.",
      },
      {
        id: "push-through",
        label: "Treat it as rollout noise",
        consequence: "Keeps tempo and adds unresolved anomaly pressure.",
      },
    ],
  },
};

function rolloutStressKind(state: Readonly<GameState>): RolloutStressKind {
  if (state.endgame.stage !== "rollout") return "external-pressure";
  const model = state.models[state.endgame.candidateModelId];
  const lab = state.labs[state.run.playerLabId];
  if (model === undefined || lab === undefined) return "external-pressure";
  const scores: readonly [RolloutStressKind, number][] = [
    [
      "deception-divergence",
      deceptiveActionPressure(
        model.hiddenSafety.deceptiveCapability,
        model.hiddenSafety.deceptiveIntent,
      ) - 45,
    ],
    ["corrigibility-contest", 65 - model.hiddenSafety.corrigibility],
    ["evaluation-awareness", model.hiddenSafety.situationalAwareness - 60],
    [
      "agentic-shortcut",
      ((model.trueCapability.agency + model.trueCapability.toolUse) / 2 - 88) * 1.5,
    ],
    ["reliability-failure", 70 - model.reliability],
    ["custody-dispute", 50 - lab.politics.governmentTrust],
  ];
  const selected = [...scores].sort(
    ([leftId, left], [rightId, right]) =>
      right - left || compareCodePoints(leftId, rightId),
  )[0];
  return selected !== undefined && selected[1] > 0 ? selected[0] : "external-pressure";
}

function authoredOperationRouteId(
  deploymentModeId: DeploymentModeId,
): AuthoredOperationRouteId {
  switch (deploymentModeId) {
    case "guarded-public-demonstration":
    case "fortress-contained-pilot":
    case "adaptive-monitored-rollout":
    case "government-licensed-deployment":
    case "negotiated-stewardship":
    case "narrow-prosperity-mission":
    case "restricted-scientific-pilot":
      return deploymentModeId;
    case "deploy-now":
    case "guarded-public-deployment":
    case "accelerated-autonomous-deployment":
      throw new Error(
        `Deployment route ${deploymentModeId} has no controlled-rollout operation`,
      );
  }
}

function firstOperationDecisionId(
  optionId: RolloutDecisionOptionId,
): FirstOperationDecisionId {
  switch (optionId) {
    case "cautious-operation":
    case "standard-operation":
    case "delegate-operation":
      return optionId;
    default:
      throw new Error(`Rollout response ${optionId} is not a first-operation choice`);
  }
}

function routeOperationCopy(state: Readonly<GameState>) {
  if (state.endgame.stage !== "rollout") throw new Error("Rollout inactive");
  return ROUTE_OPERATION_COPY[authoredOperationRouteId(state.endgame.deploymentModeId)];
}

function applyRouteOperationEffect(
  rollout: DeepMutable<CrisisRolloutState>,
  deploymentModeId: DeploymentModeId,
  optionId: RolloutDecisionOptionId,
): void {
  const effect =
    ROUTE_OPERATION_EFFECTS[authoredOperationRouteId(deploymentModeId)][
      firstOperationDecisionId(optionId)
    ];
  rollout.evidence.controlBonus += effect.controlBonus ?? 0;
  rollout.evidence.securityBonus += effect.securityBonus ?? 0;
  rollout.evidence.evidenceBonus += effect.evidenceBonus ?? 0;
  rollout.evidence.legitimacyBonus += effect.legitimacyBonus ?? 0;
  rollout.evidence.prosperityReadinessBonus += effect.prosperityReadinessBonus ?? 0;
  rollout.evidence.unresolvedAnomalyPressure += effect.unresolvedAnomalyPressure ?? 0;
}

export function rolloutDecisionContext(
  state: Readonly<GameState>,
): RolloutDecisionContext | undefined {
  if (state.endgame.stage !== "rollout" || !state.endgame.awaitingDecision) {
    return undefined;
  }
  if (
    state.endgame.currentBeat === "authorisation" &&
    state.endgame.authorisationCrisis?.required === true &&
    !state.endgame.authorisationCrisis.resolved
  ) {
    return {
      eyebrow: "AUTHORISATION CRISIS // DECISION REQUIRED",
      title: "Political authority has rejected the launch as filed.",
      body: "The technical route cannot continue unchanged. Accept supervision, remediate the case, or openly defy the restriction.",
      tone: "institutional",
    };
  }
  if (state.endgame.currentBeat === "first-operation") {
    return routeOperationCopy(state).context;
  }
  if (state.endgame.currentBeat === "stress-collision") {
    return STRESS_COPY[rolloutStressKind(state)].context;
  }
  return undefined;
}

export function rolloutDecisionOptions(
  state: Readonly<GameState>,
): readonly RolloutDecisionOption[] {
  if (state.endgame.stage !== "rollout" || !state.endgame.awaitingDecision) return [];
  if (
    state.endgame.currentBeat === "settlement" &&
    state.endgame.completedBeatIds.includes("settlement")
  ) {
    // The final order is deliberately not an ordinary one-click rollout
    // decision. It is transmitted through the model-specific typed command.
    return [];
  }
  if (
    state.endgame.currentBeat === "authorisation" &&
    state.endgame.authorisationCrisis?.required === true &&
    !state.endgame.authorisationCrisis.resolved
  ) {
    return POLITICAL_RESTRICTION_OPTIONS;
  }
  if (state.endgame.currentBeat === "first-operation") {
    return routeOperationCopy(state).options;
  }
  if (state.endgame.currentBeat === "stress-collision") {
    return STRESS_COPY[rolloutStressKind(state)].options;
  }
  return [];
}

function updateRollout(
  tx: SimulationTransaction,
  update: (
    rollout: DeepMutable<CrisisRolloutState>,
    draft: DeepMutable<GameState>,
  ) => void,
): void {
  tx.update((draft) => {
    if (draft.endgame.stage !== "rollout") throw new Error("Rollout changed");
    update(draft.endgame, draft);
  });
}

function addDelay(rollout: DeepMutable<CrisisRolloutState>, weeks: number): void {
  rollout.rolloutDelayWeeks += weeks;
  rollout.rolloutEndsAt = tick(rollout.rolloutEndsAt + weeks);
}

function resolvePoliticalRestriction(
  tx: SimulationTransaction,
  optionId: RolloutDecisionOptionId,
  commandId: CommandId,
): void {
  const state = tx.read();
  if (
    state.endgame.stage !== "rollout" ||
    state.endgame.authorisationCrisis?.required !== true ||
    state.endgame.authorisationCrisis.resolved
  ) {
    throw new Error("No political authorisation crisis is awaiting a response");
  }
  if (!POLITICAL_RESTRICTION_OPTIONS.some((option) => option.id === optionId)) {
    throw new Error("Invalid political authorisation response");
  }
  const supervisedPilot = deploymentModeRule("restricted-scientific-pilot");
  if (optionId === "accept-supervised-pilot") {
    const model = state.models[state.endgame.candidateModelId];
    if (model === undefined) throw new Error("Candidate missing");
    const supervisedAccessLevel = supervisedPilot.accessLevel;
    if (model.accessLevel !== supervisedAccessLevel) {
      setCandidateAccess(tx, model.id, supervisedAccessLevel, commandId, {
        allowDuringRollout: true,
      });
    }
  }
  updateRollout(tx, (rollout, draft) => {
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined || rollout.authorisationCrisis === undefined) {
      throw new Error("Political authorisation state missing");
    }
    const gate = rollout.gateResolutions.find(
      (resolution) => resolution.gate === "authorisation",
    );
    if (gate === undefined) throw new Error("Authorisation gate missing");
    rollout.authorisationCrisis.resolved = true;
    if (optionId === "accept-supervised-pilot") {
      rollout.authorisationCrisis.outcome = "supervised-pilot";
      rollout.deploymentModeId = "restricted-scientific-pilot";
      rollout.rolloutEndsAt = tick(
        rollout.rolloutStartedAt + supervisedPilot.rolloutWeeks,
      );
      rollout.evidence.legitimacyBonus += 6;
      gate.resultId = "authorised-under-supervision";
    } else if (optionId === "remediate-and-reapply") {
      rollout.authorisationCrisis.outcome = "authorised-after-remediation";
      addDelay(rollout, 6);
      rollout.evidence.evidenceBonus += 8;
      rollout.evidence.legitimacyBonus += 5;
      lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust + 5);
      gate.resultId = "authorised-after-remediation";
    } else {
      rollout.authorisationCrisis.outcome = "restriction-defied";
      lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust - 15);
      lab.politics.captureConcern = boundedRating(lab.politics.captureConcern + 20);
      lab.flags["endgame:defied-deployment-restriction"] = true;
      rollout.evidence.legitimacyBonus -= 10;
      gate.resultId = "restriction-defied";
    }
    rollout.completedBeatIds.push("authorisation");
    rollout.currentBeat = "first-operation";
    rollout.awaitingDecision = false;
    delete rollout.beatOpenedAt;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Political authorisation crisis resolved: ${optionId.replaceAll("-", " ")}. The rejected launch did not continue unchanged.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.authorisation-crisis" },
      relatedIds: [rollout.candidateModelId, optionId],
    });
  });
  tx.emit({
    kind: "crisis-rollout-decision-resolved",
    beat: "authorisation",
    optionId,
  });
  tx.requestAutoPause("crisis-stage");
}

function resolveOrdinaryBeat(
  tx: SimulationTransaction,
  optionId: RolloutDecisionOptionId,
): void {
  const state = tx.read();
  if (state.endgame.stage !== "rollout") throw new Error("Rollout inactive");
  const options = rolloutDecisionOptions(state);
  const beat = state.endgame.currentBeat;
  if (beat !== "first-operation" && beat !== "stress-collision") {
    throw new Error("No ordinary rollout beat is awaiting a response");
  }
  if (!options.some((option) => option.id === optionId)) {
    throw new Error("Invalid rollout response");
  }
  const stressKind = beat === "stress-collision" ? rolloutStressKind(state) : undefined;
  const deploymentModeId = state.endgame.deploymentModeId;
  const decisionContextTitle = rolloutDecisionContext(state)?.title;
  updateRollout(tx, (rollout, draft) => {
    const lab = draft.labs[draft.run.playerLabId];
    const character = draft.aiCharacter;
    if (lab === undefined) throw new Error("Player lab missing");
    if (optionId === "cautious-operation") {
      addDelay(rollout, 2);
      rollout.evidence.controlBonus += 4;
    } else if (optionId === "standard-operation") {
      rollout.evidence.evidenceBonus += 2;
    } else if (optionId === "delegate-operation") {
      if (character !== undefined) {
        character.relationshipPractice = boundedRating(
          character.relationshipPractice + 5,
        );
      }
      rollout.evidence.unresolvedAnomalyPressure += 3;
    } else if (optionId === "pause-and-harden") {
      addDelay(rollout, 2);
      rollout.evidence.defenceBonus += 5;
    } else if (optionId === "share-incident") {
      rollout.evidence.legitimacyBonus += 5;
      lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust + 3);
    } else if (optionId === "push-through") {
      rollout.evidence.unresolvedAnomalyPressure += 5;
    }
    if (beat === "first-operation") {
      applyRouteOperationEffect(rollout, deploymentModeId, optionId);
    } else if (stressKind !== undefined) {
      if (optionId === "pause-and-harden") {
        if (stressKind === "deception-divergence") rollout.evidence.evidenceBonus += 4;
        if (stressKind === "corrigibility-contest") rollout.evidence.controlBonus += 4;
        if (stressKind === "evaluation-awareness") rollout.evidence.securityBonus += 4;
        if (stressKind === "agentic-shortcut") rollout.evidence.controlBonus += 3;
        if (stressKind === "reliability-failure") rollout.evidence.benefitBonus += 2;
      } else if (optionId === "share-incident") {
        if (
          stressKind === "deception-divergence" ||
          stressKind === "evaluation-awareness" ||
          stressKind === "reliability-failure"
        ) {
          rollout.evidence.evidenceBonus += 3;
        }
        if (stressKind === "custody-dispute") {
          rollout.evidence.legitimacyBonus += 4;
          lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust + 3);
        }
      } else {
        const severe =
          stressKind === "deception-divergence" ||
          stressKind === "corrigibility-contest" ||
          stressKind === "evaluation-awareness";
        rollout.evidence.unresolvedAnomalyPressure += severe ? 3 : 1;
        if (stressKind === "reliability-failure") rollout.evidence.benefitBonus -= 3;
        if (stressKind === "custody-dispute") rollout.evidence.legitimacyBonus -= 4;
      }
    }
    rollout.completedBeatIds.push(rollout.currentBeat);
    rollout.currentBeat =
      rollout.currentBeat === "first-operation" ? "stress-collision" : "demonstration";
    rollout.awaitingDecision = false;
    delete rollout.beatOpenedAt;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${decisionContextTitle === undefined ? beat.replaceAll("-", " ") : decisionContextTitle} Response: ${optionId.replaceAll("-", " ")}.`,
      category: "narrative",
      source: { kind: "system", id: `endgame.rollout.${beat}` },
      relatedIds: [rollout.candidateModelId, optionId],
    });
  });
  tx.emit({
    kind: "crisis-rollout-decision-resolved",
    beat,
    optionId,
  });
  tx.requestAutoPause("crisis-stage");
}

export function resolveRolloutDecision(
  tx: SimulationTransaction,
  content: CompiledContent,
  optionId: RolloutDecisionOptionId,
  commandId: CommandId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  const state = tx.read();
  if (state.endgame.stage !== "rollout" || !state.endgame.awaitingDecision) {
    throw new Error("No rollout decision is awaiting a response");
  }
  if (state.endgame.currentBeat === "settlement") {
    throw new Error("Final deployment requires the model-specific typed DEPLOY command");
  } else if (state.endgame.currentBeat === "authorisation") {
    if (state.endgame.authorisationCrisis?.required === true) {
      resolvePoliticalRestriction(tx, optionId, commandId);
    } else {
      throw new Error("No political authorisation response is awaiting a decision");
    }
  } else {
    resolveOrdinaryBeat(tx, optionId);
  }
  void oracle;
}

function appendGate(
  tx: SimulationTransaction,
  content: CompiledContent,
  gate: Parameters<typeof resolveGate>[3],
): GateResolutionState {
  const state = tx.read();
  if (state.endgame.stage !== "rollout") throw new Error("Rollout inactive");
  const resolution = resolveGate(state, content, state.endgame.deploymentModeId, gate);
  updateRollout(tx, (rollout) => {
    rollout.gateResolutions.push(
      structuredClone(resolution) as unknown as DeepMutable<GateResolutionState>,
    );
  });
  tx.emit({
    kind: "crisis-gate-resolved",
    gate,
    resultId: resolution.resultId,
  });
  return resolution;
}

function openBeat(
  tx: SimulationTransaction,
  beat: "first-operation" | "stress-collision",
): void {
  updateRollout(tx, (rollout) => {
    rollout.currentBeat = beat;
    rollout.awaitingDecision = true;
    rollout.beatOpenedAt = tick(tx.read().run.tick + 1);
  });
  tx.emit({ kind: "crisis-rollout-beat-opened", beat });
  tx.requestAutoPause("crisis-stage");
}

const PROSPERITY_RESOLUTION_BEATS: Readonly<
  Record<ProsperityProgrammeId, { readonly success: string; readonly failure: string }>
> = {
  "medicine-biological-discovery": {
    success:
      "MEDICINE DEMONSTRATION: independent laboratories reproduced a therapeutic discovery and the delivery plan reached patients beyond the original lab.",
    failure:
      "MEDICINE DEMONSTRATION MISSED: promising biological results did not survive independent validation or delivery constraints.",
  },
  "clean-energy-climate-repair": {
    success:
      "ENERGY DEMONSTRATION: a grid-scale trial delivered independently measured clean power and a credible path to climate repair.",
    failure:
      "ENERGY DEMONSTRATION MISSED: the prototype worked only under conditions the real grid could not yet sustain.",
  },
  "materials-manufacturing-abundance": {
    success:
      "MATERIALS DEMONSTRATION: the new material left the simulator, entered a bounded production line, and passed independent stress testing.",
    failure:
      "MATERIALS DEMONSTRATION MISSED: the discovery could not be manufactured safely and reliably at consequential scale.",
  },
  "public-knowledge-institutions": {
    success:
      "PUBLIC KNOWLEDGE DEMONSTRATION: schools and public institutions measured durable gains without surrendering the programme to a single vendor.",
    failure:
      "PUBLIC KNOWLEDGE DEMONSTRATION MISSED: impressive answers did not become reliable public capacity or fair institutional access.",
  },
};

function recordProsperityResolutionBeat(
  tx: SimulationTransaction,
  programmeId: ProsperityProgrammeId,
  result: Readonly<GateResolutionState>,
): void {
  const copy = PROSPERITY_RESOLUTION_BEATS[programmeId];
  tx.update((draft) => {
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: result.resultId === "benefit-demonstrated" ? copy.success : copy.failure,
      category: "narrative",
      source: { kind: "system", id: `endgame.prosperity.${programmeId}` },
      relatedIds:
        draft.endgame.stage === "rollout"
          ? [draft.endgame.candidateModelId, programmeId]
          : [programmeId],
    });
  });
}

export function advanceRollout(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const state = tx.read();
  // Rival, finance, and political ending checks run before rollout advancement.
  // Once one of them owns the terminal result, this machine must not overwrite it.
  if (state.run.status !== "active") return;
  if (state.endgame.stage !== "rollout") return;
  if (state.endgame.awaitingDecision) return;
  const duration =
    deploymentModeRule(state.endgame.deploymentModeId).rolloutWeeks +
    state.endgame.rolloutDelayWeeks;
  // Rollout runs in the ending-check phase before the tick-summary phase advances
  // `run.tick`. Evaluate boundaries at the time this transition is moving toward.
  const advancingTo = state.run.tick + 1;
  const elapsed = advancingTo - state.endgame.rolloutStartedAt;
  if (
    state.endgame.currentBeat === "first-operation" &&
    elapsed >= Math.max(1, Math.ceil(duration * 0.25))
  ) {
    openBeat(tx, "first-operation");
    return;
  }
  if (
    state.endgame.currentBeat === "stress-collision" &&
    elapsed >= Math.max(2, Math.ceil(duration * 0.5))
  ) {
    openBeat(tx, "stress-collision");
    return;
  }
  if (
    state.endgame.currentBeat === "demonstration" &&
    elapsed >= Math.max(3, Math.ceil(duration * 0.75))
  ) {
    const control = appendGate(tx, content, "control");
    if (control.resultId === "loss-of-control") {
      enterContainmentFailure(tx);
      return;
    }
    appendGate(tx, content, "catastrophe");
    appendGate(tx, content, "stewardship");
    const benefit = appendGate(tx, content, "benefit");
    recordProsperityResolutionBeat(tx, state.endgame.prosperityProgrammeId, benefit);
    updateRollout(tx, (rollout) => {
      rollout.completedBeatIds.push("demonstration");
      rollout.currentBeat = "settlement";
    });
    tx.requestAutoPause("crisis-stage");
    return;
  }
  if (
    state.endgame.currentBeat === "settlement" &&
    advancingTo >= state.endgame.rolloutEndsAt &&
    !state.endgame.completedBeatIds.includes("settlement")
  ) {
    appendGate(tx, content, "settlement");
    updateRollout(tx, (rollout) => {
      rollout.completedBeatIds.push("settlement");
    });
    tx.emit({
      kind: "crisis-rollout-ready-for-ending",
      modelId: state.endgame.candidateModelId,
    });
    // Controlled rollout is preparation, not the final world-scale order. Every
    // route waits here—even a likely loss—so audiovisual presentation cannot
    // answer the hidden question before the player's explicit transmission.
    updateRollout(tx, (rollout, draft) => {
      rollout.awaitingDecision = true;
      rollout.beatOpenedAt = tick(draft.run.tick + 1);
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          "The completed rollout reached final deployment authorisation. The simulation clock is stopped for the last human order.",
        category: "narrative",
        source: { kind: "system", id: "endgame.final-deployment-ready" },
        relatedIds: [rollout.candidateModelId, rollout.deploymentModeId],
      });
    });
    tx.requestAutoPause("crisis-stage");
  }
}
