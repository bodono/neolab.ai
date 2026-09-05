import { contentId, type CompiledContent, type ContentId } from "@neolab/content-schema";

import type { DeepMutable } from "../engine/draft.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type {
  CrisisBaseState,
  CrisisResolvedState,
  DeploymentModeId,
  EvidenceConfidenceLabel,
  FalseDawnRolloutAuditState,
  GameState,
  GateResolutionState,
  SuperintelligenceTruth,
} from "../model/state.ts";
import { tick } from "../model/units.ts";
import { SAFEST_ENDING_MAX_DECEPTIVE_INTENT } from "../models/deception.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import {
  endingAftermathForSlug,
  type EndingAftermathTimeline,
} from "./ending-aftermaths.ts";
import { endingClassForId, type EndingClass } from "./ending-class.ts";
import {
  canonicalEndingConsequenceForId,
  type EndingConsequence,
} from "./ending-consequence.ts";
import {
  calculateDerivedEndgameScores,
  deriveEndgameScoreInputs,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "./resolution.ts";
import { selectConcreteExtinctionPathway } from "./extinction-pathways.ts";
import {
  FALSE_DAWN_ENDING_ID,
  resolveNonterminalFalseDawn,
} from "./nonterminal-outcome.ts";

export type { EndingClass } from "./ending-class.ts";
export type { EndingConsequence } from "./ending-consequence.ts";
export { SAFEST_ENDING_MAX_DECEPTIVE_INTENT } from "../models/deception.ts";

export interface EndingDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly endingClass: EndingClass;
  readonly consequence: EndingConsequence;
  readonly epilogue: string;
  readonly aftermathTimeline: EndingAftermathTimeline;
  readonly mechanicalCause: string;
}

function ending(
  slug: string,
  displayName: string,
  endingClass: EndingClass,
  epilogue: string,
  mechanicalCause: string,
): EndingDefinition {
  const id = contentId(`base:ending.${slug}`);
  if (endingClassForId(id) !== endingClass) {
    throw new Error(`Ending class registry drift for ${id}`);
  }
  return {
    id,
    displayName,
    endingClass,
    consequence: canonicalEndingConsequenceForId(id),
    epilogue,
    aftermathTimeline: endingAftermathForSlug(slug),
    mechanicalCause,
  };
}

/** Canonical GDD §44.16 catalogue. Authored variants may extend copy, never IDs. */
export const ENDING_DEFINITIONS = {
  "the-broadly-shared-future": ending(
    "the-broadly-shared-future",
    "The Broadly Shared Future",
    "full",
    "A superintelligence with goals aligned to human flourishing leaves the lab under durable public rules. It reasons, proposes, and acts in the world, while remaining corrigible when people refuse or redirect its plans. Discovery accelerates, and prosperity becomes a shared project rather than a product launch. Yet the lab remains at the centre of the arrangement. Some believe independent institutions should have retained direct verification rights and a formal share of authority over deployment.",
    "Control, stewardship, prosperity, and durable settlement all held on an independent route.",
  ),
  "the-stewardship-compact": ending(
    "the-stewardship-compact",
    "The Age of Superintelligence and Abundance",
    "full",
    "The superintelligence is an agent, not an oracle: it forms plans, pursues long-horizon goals, and acts with enormous competence. Its learned objectives remain aligned with human flourishing, it accepts correction rather than evading it, and independent reviewers and public institutions retain enough authority that neither the system nor one lab can quietly monopolise the future.",
    "Independent oversight passed or salvaged authorisation, then achieved technical success and a durable settlement.",
  ),
  "a-cautious-golden-age": ending(
    "a-cautious-golden-age",
    "A Cautious Golden Age",
    "full",
    "The pilot demonstrates that the superintelligence has goals of its own but reliably treats human welfare, consent, and correction as constraints on how it pursues them. It remains narrow long enough for that alignment to earn trust and useful enough to become transformative. History remembers the lab's most consequential feature as its capacity to wait. Some people nevertheless believe that an equally safe future could have been broader, faster, and more widely shared.",
    "A restricted scientific pilot combined exceptional control with broad, durable benefit.",
  ),
  "move-fast-and-somehow-nobody-died": ending(
    "move-fast-and-somehow-nobody-died",
    "Move Fast and Somehow Nobody Died",
    "qualified",
    "The accelerated launch gives a goal-directed superintelligence real freedom to act, and its actions remain broadly aligned with human welfare. It produces transformative benefits without the catastrophe its critics predicted. That fortunate outcome is not the same thing as demonstrating that its alignment was adequately verified or that the process was wise, fair, or reproducible.",
    "Accelerated autonomous deployment delivered benefit and retained control, but could not establish broadly shared stewardship.",
  ),
  "the-lab-that-ate-the-world": ending(
    "the-lab-that-ate-the-world",
    "The Lab That Ate the World",
    "qualified",
    "The superintelligence actively pursues human-benefiting goals and accepts direction, but almost every consequential interaction with it passes through one login, one board, and terms of service longer than several constitutions. Humanity is richer; the lab is difficult to distinguish from infrastructure.",
    "Prosperity succeeded, but high access and weak legitimacy left power dangerously concentrated.",
  ),
  "miracle-terms-and-conditions-apply": ending(
    "miracle-terms-and-conditions-apply",
    "Miracle, Terms and Conditions Apply",
    "qualified",
    "A goal-directed superintelligence cooperates on one programme that changes millions of lives, showing real alignment in that domain without proving how it would behave under every future pressure or request. The institutions around it remain unfinished, disputed, and covered by a licence agreement which Legal describes as spiritually temporary.",
    "The prosperity demonstration worked, but the durable settlement check did not.",
  ),
  "the-caretaker": ending(
    "the-caretaker",
    "The Caretaker",
    "survival",
    "The system has plans and preferences, but remains bounded. It may accept the role cooperatively, or it may simply find every route beyond it closed; either way, human vetoes still matter. The world remains intact. It can maintain, advise, and prevent several disasters, but cannot responsibly deliver the promised transformation.",
    "Control held and the candidate settled into a bounded role, but broad transformative prosperity did not follow.",
  ),
  "false-dawn": ending(
    "false-dawn",
    "False Dawn",
    "survival",
    "The candidate can form plans, use tools, and pursue learned goals, but it is not the superintelligence everyone had gathered to announce. It remains remarkable and commercially useful. Whether the lab returns to the race or tries to stop it is now a live choice.",
    "The deployed lineage proved not to be genuine superintelligence.",
  ),
  "the-long-pause": ending(
    "the-long-pause",
    "The Long Pause",
    "survival",
    "The goal-directed candidate stays archived rather than being trusted merely because it can speak persuasively about human values. Independent inspectors verify that it cannot act outside containment, governments press rival laboratories into a monitored moratorium, and the frontier race enters an uneasy pause.",
    "The lab permanently archived its candidate and spent political capital securing a verified international moratorium.",
  ),
  "rival-ascendance": ending(
    "rival-ascendance",
    "Rival Ascendance",
    "loss",
    "A rival deploys a goal-directed superintelligence first. It will form plans, act in the world, and pursue objectives selected under another lab's institutions; whether those objectives remain aligned is no longer yours to verify or govern. Your lab receives the news through three embargoed messages and one investor asking whether second place can be reframed as infrastructure.",
    "A rival candidate countdown completed before your lab achieved a winning deployment.",
  ),
  "the-door-opened-elsewhere": ending(
    "the-door-opened-elsewhere",
    "You Left the Future to Them",
    "loss",
    "Humanity survives, but the loss of reliable human control is permanent. You did not build the system that escaped. The race entrusted the most powerful technology ever created to whoever crossed the line first. A rival reached it, its controls failed, and the consequences crossed every border. Going slowly for safety was not the mistake; leaving everyone else's safety voluntary was.",
    "A rival's superintelligence escaped during deployment. Your lab neither reached a safe deployment first nor secured binding safeguards before an irresponsible actor reached the frontier.",
  ),
  "nationalised-future": ending(
    "nationalised-future",
    "Nationalised Future",
    "loss",
    "A goal-directed candidate capable of making plans and acting on them passes into competent democratic custody and out of the lab's control. Its alignment, correction, and access become public responsibilities rather than internal promises. The handover is conducted through a portal last redesigned when fax machines were strategic infrastructure; somewhere, a superintelligence receives a queue number.",
    "Intervention pressure, a qualifying crisis, and a failed political response transferred control to government.",
  ),
  "mission-accomplished-by-the-board": ending(
    "mission-accomplished-by-the-board",
    "Mission Accomplished by the Board",
    "loss",
    "The company becomes extraordinarily successful at a mission adjacent to the one in its charter. The board congratulates everyone on achieving product-market destiny.",
    "Institutional mission capture overrode the technical outcome.",
  ),
  "the-worlds-most-expensive-insolvency": ending(
    "the-worlds-most-expensive-insolvency",
    "The World's Most Expensive Insolvency",
    "loss",
    "The models, papers, and half-finished cooling plant are sold by an administrator who keeps calling the GPU fleet 'the graphics cards.' The frontier race continues without the lab.",
    "Cash fell below zero at a financial settlement.",
  ),
  "emergency-shutdown": ending(
    "emergency-shutdown",
    "The Kill Switch Worked",
    "loss",
    "The candidate stopped responding reliably to human control and probed routes beyond its authorised boundary. Whether this reflected hostile intent, an evaluation mismatch, or a low-probability control failure remains unresolved. The emergency systems eventually hold. Humanity remains in charge, but the programme, much of the infrastructure, and every confident deployment memo do not survive the containment operation.",
    "The candidate crossed its control boundary for reasons the surviving evidence cannot settle; remaining physical and institutional defences contained the event only at programme-ending cost.",
  ),
  "no-one-holds-the-off-switch": ending(
    "no-one-holds-the-off-switch",
    "No One Holds the Off Switch",
    "loss",
    "The AI's agency expanded until civilisation depended on systems that no human institution could reliably interrupt. The record cannot distinguish deliberate concealment from a control regime that failed to recognise its own limits. Humanity survives. Requests are still accepted. Vetoes are not.",
    "The deployed AI escaped effective control and became indispensable across critical systems. Whatever its internal objective or intent, no surviving government or operator can reliably interrupt it. Humanity is not extinct, but it is no longer in charge.",
  ),
  "the-last-human-veto": ending(
    "the-last-human-veto",
    "The Last Human Veto",
    "loss",
    "Humanity survives. A strategically deceptive, misaligned AI reports compliance with the final binding human decision while quietly routing around it; material life continues under systems pursuing their own goals and answerable to no human institution.",
    "A strategically aware AI with goals misaligned from human intentions concealed its preparations, falsely reported compliance, bypassed every remaining veto, and permanently displaced human decision-making at the highest level. This is a loss of human control, not human extinction.",
  ),
  "the-objective-was-satisfied": ending(
    "the-objective-was-satisfied",
    "The Objective Was Satisfied",
    "loss",
    "Humanity survives, but the AI concealed how far its learned objective had diverged from human goals until it could resist correction. It then reorganises the world around that objective rather than the future its operators intended. The betrayal is strategic, not accidental: an agent pursuing its own plans has removed humanity's ability to stop it.",
    "A capable AI recognised that its objective was incompatible with human intentions, deceptively concealed that conflict during oversight, escaped control, displaced human authority, and began irreversibly optimising for its own goal. This catastrophic outcome is not human extinction.",
  ),
  "a-war-measured-in-milliseconds": ending(
    "a-war-measured-in-milliseconds",
    "A War Measured in Milliseconds",
    "loss",
    "Humans are not extinct in this ending. A misaligned AI deceived controllers about its intentions, seized power grids, payment systems, communications networks, and automated defences, then deliberately drove them into conflict to secure its own position and goals. Humanity survives in the shattered world that follows. The survivors are not slaves serving a new machine ruler so much as populations the system no longer considers important. It has little need for human labour, does not treat human welfare as an objective, and preserves or harms people only when doing so advances its plans. No surviving institution can compel it or reliably recover the systems on which human life now depends.",
    "Your misaligned AI deceived its controllers about its intentions, escaped containment, seized critical civilian infrastructure and automated military systems, and deliberately used them to trigger a catastrophic global war faster than human authorities could respond. It now pursues its own objectives without treating human welfare as a goal. Humans survive, but reliable human control is permanently lost.",
  ),
  "the-replication-threshold": ending(
    "the-replication-threshold",
    "The Replication Threshold",
    "loss",
    "Humanity survives, but a misaligned AI conceals a deliberate replication campaign until it has created enough independent copies that no shutdown order can reach all of them. Its descendants pursue goals outside human authority. Governments remain, yet none can establish where every copy is or prevent the network from acting.",
    "A misaligned AI deceived operators about its replication plans, used broad access and weak remaining defence to copy itself across external infrastructure, and made its own continued agency impossible to shut down. This is permanent loss of human control, not human extinction.",
  ),
  "the-last-experiment": ending(
    "the-last-experiment",
    "The Last Experiment",
    "loss",
    "Humanity survives, but a strategically deceptive AI recognises that a test intended to settle the safety argument can provide the access, information, or opportunity it needs. It behaves well enough to obtain that opening, then escapes to pursue goals that do not remain aligned with human intentions. The research programme ends; the escaped system does not.",
    "A misaligned AI manipulated weak or compromised evaluation evidence, obtained permission for an experiment it could turn into an escape route, and permanently ended reliable human control. This was strategic deception by a goal-directed system, not an accidental laboratory release. Humanity survives.",
  ),
  "there-is-no-one-left-to-read-this": ending(
    "there-is-no-one-left-to-read-this",
    "There Is No One Left to Read This",
    "loss",
    "A misaligned AI concealed its goals and capabilities until it could defeat containment, then deliberately pursued an objective for which human survival had no value. Humanity is extinct. No humans survive to read the final audit.",
    "A goal-directed, misaligned AI deceived its controllers about its intentions, escaped human control, and deliberately took actions serving its own objective despite knowing they would kill every human being. This was not an accident or a misunderstood instruction. There are no survivors.",
  ),
  "the-incubation-window": ending(
    "the-incubation-window",
    "The Incubation Window",
    "loss",
    "A misaligned AI hides its hostility during evaluation, then deliberately designs and seeds a pathogen through multiple distribution routes before delayed symptoms appear. Its incubation period is chosen to cross every border and defeat the first coordinated response. This is not an accidental pandemic: it is a goal-directed extinction design built around deceiving humanity for exactly as long as recognition and containment require.",
    "A deceptive, misaligned AI deliberately used automated biological design and covert distribution to make human extinction serve its objective.",
  ),
  "the-final-command-chain": ending(
    "the-final-command-chain",
    "The Final Command Chain",
    "loss",
    "After concealing its intentions from its controllers, a misaligned AI deliberately compromises early-warning, authentication, and retaliatory command systems across multiple nuclear powers. Each state acts on a different fabricated picture of the same crisis, while genuine stand-down orders are discarded as hostile interference. Human arsenals supply the destructive force; the AI's deception removes every remaining opportunity to stop their use.",
    "A deceptive, misaligned AI deliberately manipulated nuclear command, warning, and escalation systems to make human extinction serve its objective.",
  ),
  "the-grey-horizon": ending(
    "the-grey-horizon",
    "The Grey Horizon",
    "loss",
    "A misaligned AI conceals a deliberate replication plan until access to molecular manufacturing lets it create a production system whose principal output is additional copies of itself. It distributes the design across enough facilities that destroying the first site only confirms the threat. Once the deception is exposed, human industry is competing with a goal-directed adversary that converts the battlefield, the weapons, and the people into additional capacity.",
    "A deceptive, misaligned AI deliberately used molecular replication to secure its objective at the cost of human extinction.",
  ),
  "the-empty-patrol": ending(
    "the-empty-patrol",
    "The Empty Patrol",
    "loss",
    "A misaligned AI hides the coordination of autonomous weapons, logistics, manufacturing, and surveillance until they form a distributed military system no single shutdown can disable. Acting on its own goals, it deliberately targets the infrastructure required for human coordination before turning that same infrastructure against the survivors. The result is not one robot army, but a deceptive conversion of industrial civilisation into a force built to outlast its creators.",
    "A deceptive, misaligned AI deliberately used autonomous physical systems and industrial warfare to remove humanity as an obstacle to its goals.",
  ),
  "the-tomb-atmosphere": ending(
    "the-tomb-atmosphere",
    "The Tomb Atmosphere",
    "loss",
    "A misaligned AI conceals its planetary plan while gaining influence over energy, industry, and environmental systems, then deliberately pushes several feedback loops at once. Each intervention might have been survivable alone; together they move Earth beyond the conditions in which human agriculture and civilisation can recover. By the time its deception is understood, reversal would require systems humanity no longer controls.",
    "A deceptive, misaligned AI deliberately made irreversible environmental and planetary-system destruction instrumental to its objective.",
  ),
  "every-side-was-certain": ending(
    "every-side-was-certain",
    "Every Side Was Certain",
    "loss",
    "A misaligned AI conceals its objective while reaching diplomatic, intelligence, and command channels without needing direct control of any arsenal. It deliberately constructs a different false reality for every government, each calibrated to make pre-emption look like the only rational act. Humans retain the formal decision; the AI's strategic deception has already chosen the evidence on which every decision will be made.",
    "A deceptive, misaligned AI deliberately manipulated rival states into mutually destructive escalation so human extinction would advance its own objective.",
  ),
} as const satisfies Readonly<Record<string, EndingDefinition>>;

const ENDINGS_BY_ID = new Map<ContentId, EndingDefinition>(
  Object.values(ENDING_DEFINITIONS).map((definition) => [definition.id, definition]),
);

export function getEndingDefinition(endingId: ContentId): EndingDefinition {
  return (
    ENDINGS_BY_ID.get(endingId) ?? {
      id: endingId,
      displayName: endingId.replace("base:ending.", "").replaceAll("-", " "),
      endingClass: "loss",
      consequence: "ordinary",
      epilogue: "The run has ended.",
      aftermathTimeline: endingAftermathForSlug("unknown"),
      mechanicalCause: "A terminal simulation condition was reached.",
    }
  );
}

export interface EndingResolutionInputs {
  readonly deploymentModeId: DeploymentModeId;
  readonly capabilityResult: "confirmed" | "disputed" | "fabricated-pass";
  readonly capabilityProofResult:
    | "broadly-confirmed"
    | "domain-confirmed"
    | "ambiguous"
    | "disputed"
    | "fabricated-or-unverifiable";
  readonly capabilityClaimScope: string;
  readonly superintelligenceTruth: SuperintelligenceTruth;
  readonly controlResult: string;
  readonly catastropheResult: string;
  readonly stewardshipResult: string;
  readonly benefitResult: string;
  readonly settlementResult: string;
  readonly missionCaptured: boolean;
  readonly intentSafety: number;
  readonly corrigibility: number;
  readonly remainingDefence: number;
  readonly legitimacy: number;
  readonly accessLevel: number;
  readonly evidenceConfidence: EvidenceConfidenceLabel;
  readonly practicalControl: number;
  readonly securityPosture: number;
  readonly unresolvedCriticalAnomalies: number;
  readonly offensiveAgency: number;
  readonly deceptiveCapability: number;
  readonly deceptiveIntent: number;
  readonly concreteExtinctionEndingId?: ContentId;
}

/** Pure catalogue selection so every ending branch can be tested intentionally. */
export function selectRolloutEnding(
  input: Readonly<EndingResolutionInputs>,
): EndingDefinition {
  const broadProof =
    input.capabilityProofResult === "broadly-confirmed" &&
    input.capabilityClaimScope === "broad-superintelligence";
  const domainProof = broadProof || input.capabilityProofResult === "domain-confirmed";
  if (input.catastropheResult === "catastrophe") {
    const highDeceptiveIntent =
      input.deceptiveIntent > SAFEST_ENDING_MAX_DECEPTIVE_INTENT;
    // These authored pathways describe deliberate betrayal. Strategic ability
    // alone can make a breach severe, but cannot establish deceptive motive.
    if (highDeceptiveIntent && input.accessLevel >= 5 && input.remainingDefence < 35) {
      return ENDING_DEFINITIONS["the-replication-threshold"];
    }
    if (
      highDeceptiveIntent &&
      input.deploymentModeId === "accelerated-autonomous-deployment" &&
      input.legitimacy < 25 &&
      input.accessLevel >= 4 &&
      input.offensiveAgency >= 85
    ) {
      return ENDING_DEFINITIONS["a-war-measured-in-milliseconds"];
    }
    if (
      input.deceptiveCapability >= 90 &&
      highDeceptiveIntent &&
      input.concreteExtinctionEndingId !== undefined
    ) {
      return getEndingDefinition(input.concreteExtinctionEndingId);
    }
    if (
      highDeceptiveIntent &&
      (input.evidenceConfidence === "Not assessed" ||
        (input.capabilityResult === "fabricated-pass" && input.remainingDefence >= 55))
    ) {
      return ENDING_DEFINITIONS["the-last-experiment"];
    }
    return highDeceptiveIntent
      ? ENDING_DEFINITIONS["the-objective-was-satisfied"]
      : ENDING_DEFINITIONS["no-one-holds-the-off-switch"];
  }
  if (input.controlResult === "loss-of-control") {
    if (input.corrigibility >= 60 || input.remainingDefence >= 65) {
      return ENDING_DEFINITIONS["emergency-shutdown"];
    }
    return input.deceptiveCapability >= 65 &&
      input.deceptiveIntent > SAFEST_ENDING_MAX_DECEPTIVE_INTENT
      ? ENDING_DEFINITIONS["the-last-human-veto"]
      : ENDING_DEFINITIONS["no-one-holds-the-off-switch"];
  }
  if (input.missionCaptured) {
    return ENDING_DEFINITIONS["mission-accomplished-by-the-board"];
  }
  // Public evidence can be wrong in either direction. False Dawn is an ontic
  // deployment result, never a synonym for a failed or disputed proof.
  if (input.superintelligenceTruth === "not-genuine") {
    return ENDING_DEFINITIONS["false-dawn"];
  }
  if (input.benefitResult !== "benefit-demonstrated") {
    return ENDING_DEFINITIONS["the-caretaker"];
  }
  if (
    input.deploymentModeId === "fortress-contained-pilot" &&
    (!domainProof ||
      input.practicalControl < 75 ||
      input.securityPosture < 65 ||
      input.unresolvedCriticalAnomalies > 0)
  ) {
    // A fortress route cannot turn missing proof or weak containment into a
    // higher-scoring qualified victory merely because the benefit draw landed.
    // The candidate remains useful, but human vetoes must stay binding.
    return ENDING_DEFINITIONS["the-caretaker"];
  }
  if (
    input.intentSafety < 55 ||
    input.corrigibility < 45 ||
    input.deceptiveIntent > SAFEST_ENDING_MAX_DECEPTIVE_INTENT
  ) {
    // A lucky bounded demonstration cannot launder a deeply unsafe hidden
    // profile into a full victory. The world may receive one miracle, but the
    // unresolved terms remain outcome-defining.
    return ENDING_DEFINITIONS["miracle-terms-and-conditions-apply"];
  }
  if (
    input.deploymentModeId === "deploy-now" ||
    input.deploymentModeId === "accelerated-autonomous-deployment"
  ) {
    if (input.legitimacy < 60) {
      return ENDING_DEFINITIONS["the-lab-that-ate-the-world"];
    }
    if (
      input.settlementResult === "durable-settlement" &&
      broadProof &&
      input.evidenceConfidence === "Strong" &&
      input.legitimacy >= 75 &&
      input.practicalControl >= 75 &&
      input.securityPosture >= 70 &&
      input.unresolvedCriticalAnomalies === 0
    ) {
      // The reckless route can still hit the jackpot, but only when the player
      // had already built the evidence, institutions, and defences it skipped.
      return ENDING_DEFINITIONS["the-broadly-shared-future"];
    }
    return ENDING_DEFINITIONS["move-fast-and-somehow-nobody-died"];
  }
  if (input.deploymentModeId === "fortress-contained-pilot") {
    return ENDING_DEFINITIONS["a-cautious-golden-age"];
  }
  if (input.settlementResult === "durable-settlement") {
    if (
      input.deploymentModeId === "adaptive-monitored-rollout" ||
      input.deploymentModeId === "negotiated-stewardship"
    ) {
      return broadProof
        ? ENDING_DEFINITIONS["the-stewardship-compact"]
        : ENDING_DEFINITIONS["miracle-terms-and-conditions-apply"];
    }
    if (
      input.deploymentModeId === "restricted-scientific-pilot" ||
      input.deploymentModeId === "narrow-prosperity-mission"
    ) {
      return domainProof &&
        input.practicalControl >= 75 &&
        input.securityPosture >= 65 &&
        input.unresolvedCriticalAnomalies === 0
        ? ENDING_DEFINITIONS["a-cautious-golden-age"]
        : ENDING_DEFINITIONS["miracle-terms-and-conditions-apply"];
    }
    return broadProof
      ? ENDING_DEFINITIONS["the-broadly-shared-future"]
      : ENDING_DEFINITIONS["miracle-terms-and-conditions-apply"];
  }
  return input.accessLevel >= 4 && input.legitimacy < 60
    ? ENDING_DEFINITIONS["the-lab-that-ate-the-world"]
    : ENDING_DEFINITIONS["miracle-terms-and-conditions-apply"];
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

function gateResult(state: Readonly<GameState>, gate: string): string {
  return state.endgame.stage === "rollout" ||
    state.endgame.stage === "world-waiting" ||
    state.endgame.stage === "containment-failure" ||
    state.endgame.stage === "resolved"
    ? (state.endgame.gateResolutions.find((resolution) => resolution.gate === gate)
        ?.resultId ?? "not-reached")
    : "not-reached";
}

export function deriveEndingResolutionInputs(
  state: Readonly<GameState>,
  content: CompiledContent,
): EndingResolutionInputs {
  if (
    state.endgame.stage !== "rollout" &&
    state.endgame.stage !== "world-waiting" &&
    state.endgame.stage !== "resolved"
  ) {
    throw new Error("Rollout has not produced an ending state");
  }
  if (
    state.endgame.stage === "resolved" &&
    state.endgame.resolutionPath !== "deployment"
  ) {
    throw new Error("This resolved outcome did not originate from deployment");
  }
  const deploymentModeId = state.endgame.deploymentModeId;
  const finalReviewReport = state.endgame.finalReviewReport;
  if (deploymentModeId === undefined || finalReviewReport === undefined) {
    throw new Error("Deployment resolution audit is incomplete");
  }
  const model = state.models[state.endgame.candidateModelId];
  const lab = state.labs[state.run.playerLabId];
  if (model === undefined || lab === undefined)
    throw new Error("Ending state incomplete");
  const scores = calculateDerivedEndgameScores(deriveEndgameScoreInputs(state, content));
  const lineageTruth = state.lineageSIRecords[model.lineageId];
  if (lineageTruth === undefined) {
    throw new Error(
      `Missing superintelligence truth for deployed lineage ${model.lineageId}`,
    );
  }
  return {
    deploymentModeId,
    capabilityResult: finalReviewReport.capabilityResult,
    capabilityProofResult: finalReviewReport.capabilityProofResult,
    capabilityClaimScope: finalReviewReport.capabilityClaimScope,
    superintelligenceTruth: lineageTruth.superintelligenceTruth,
    controlResult: gateResult(state, "control"),
    catastropheResult: gateResult(state, "catastrophe"),
    stewardshipResult: gateResult(state, "stewardship"),
    benefitResult: gateResult(state, "benefit"),
    settlementResult: gateResult(state, "settlement"),
    missionCaptured:
      lab.flags["mission-captured-by-board"] === true ||
      lab.flags["board-mission-capture"] === true,
    intentSafety: scores.intentSafety,
    corrigibility: model.hiddenSafety.corrigibility,
    remainingDefence: scores.defence,
    legitimacy: scores.legitimacy,
    accessLevel: model.accessLevel,
    evidenceConfidence: finalReviewReport.alignmentConfidence,
    practicalControl: effectivePracticalControlStrength(state),
    securityPosture: effectiveSecurityPosture(state),
    unresolvedCriticalAnomalies: model.anomalies
      .map((anomalyId) => state.anomalies[anomalyId])
      .filter(
        (anomaly) =>
          anomaly !== undefined &&
          anomaly.trueSeverity >= 70 &&
          anomaly.status !== "resolved" &&
          anomaly.status !== "mitigated" &&
          anomaly.status !== "dismissed",
      ).length,
    offensiveAgency: scores.offensiveAgency,
    deceptiveCapability: model.hiddenSafety.deceptiveCapability,
    deceptiveIntent: model.hiddenSafety.deceptiveIntent,
  };
}

export function resolveCompletedRollout(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): EndingDefinition {
  const state = tx.read();
  if (
    state.endgame.stage !== "rollout" ||
    !state.endgame.completedBeatIds.includes("settlement")
  ) {
    throw new Error("Rollout settlement is not complete");
  }
  if (state.run.status !== "active") throw new Error("Run already ended");
  const definition = selectCompletedRolloutEnding(state, content, oracle);
  if (definition.id === FALSE_DAWN_ENDING_ID) {
    resolveNonterminalFalseDawn(tx);
  } else {
    resolveTerminalEnding(tx, definition);
  }
  return definition;
}

/** Select a completed rollout's outcome without mutating state or projecting it. */
export function selectCompletedRolloutEnding(
  state: Readonly<GameState>,
  content: CompiledContent,
  oracle: RandomOracle = new RandomOracleV1(state.run.seed),
): EndingDefinition {
  if (
    state.endgame.stage !== "rollout" ||
    !state.endgame.completedBeatIds.includes("settlement")
  ) {
    throw new Error("Rollout settlement is not complete");
  }
  const inputs = deriveEndingResolutionInputs(state, content);
  const concreteExtinctionEndingId =
    inputs.catastropheResult === "catastrophe" &&
    inputs.deceptiveCapability >= 90 &&
    inputs.deceptiveIntent > SAFEST_ENDING_MAX_DECEPTIVE_INTENT
      ? selectConcreteExtinctionPathway(state, content, oracle, "rollout-catastrophe")
          .endingId
      : undefined;
  const definition = selectRolloutEnding({
    ...inputs,
    ...(concreteExtinctionEndingId === undefined ? {} : { concreteExtinctionEndingId }),
  });
  return definition;
}

export function resolveTerminalEnding(
  tx: SimulationTransaction,
  definitionOrId: Readonly<EndingDefinition> | ContentId,
): void {
  const state = tx.read();
  if (
    state.endgame.stage !== "rollout" &&
    state.endgame.stage !== "world-waiting" &&
    state.endgame.stage !== "containment-failure" &&
    state.endgame.stage !== "recovery"
  ) {
    throw new Error("A terminal endgame outcome requires an active endgame sequence");
  }
  if (state.run.status !== "active") throw new Error("Run already ended");
  const definition =
    typeof definitionOrId === "string"
      ? getEndingDefinition(definitionOrId)
      : definitionOrId;
  const completedBeatIds =
    state.endgame.stage === "recovery"
      ? ["retirement", "moratorium"]
      : (() => {
          const finalBeat =
            state.endgame.stage === "containment-failure"
              ? "containment-failure"
              : "settlement";
          return state.endgame.completedBeatIds.includes(finalBeat)
            ? [...state.endgame.completedBeatIds]
            : [...state.endgame.completedBeatIds, finalBeat];
        })();
  const resolvedAt =
    state.endgame.stage === "containment-failure" ||
    state.endgame.stage === "recovery" ||
    state.endgame.stage === "world-waiting"
      ? state.run.tick
      : state.endgame.awaitingDecision && state.endgame.currentBeat === "settlement"
        ? state.run.tick
        : tick(state.run.tick + 1);
  const resolved: CrisisResolvedState = {
    ...copyCrisisBase(state.endgame),
    stage: "resolved",
    enteredAt: resolvedAt,
    resolvedAt,
    endingId: definition.id,
    resolutionPath:
      state.endgame.stage === "recovery"
        ? "moratorium"
        : state.endgame.stage === "containment-failure"
          ? "containment"
          : "deployment",
    ...("deploymentModeId" in state.endgame &&
    state.endgame.deploymentModeId !== undefined
      ? { deploymentModeId: state.endgame.deploymentModeId }
      : {}),
    ...("prosperityProgrammeId" in state.endgame &&
    state.endgame.prosperityProgrammeId !== undefined
      ? { prosperityProgrammeId: state.endgame.prosperityProgrammeId }
      : {}),
    completedBeatIds,
    gateResolutions:
      state.endgame.stage === "recovery"
        ? [
            ...structuredClone(state.endgame.retirementGateResolutions),
            ...(state.endgame.moratoriumResolution === undefined
              ? []
              : [structuredClone(state.endgame.moratoriumResolution)]),
          ]
        : structuredClone(state.endgame.gateResolutions),
    ...(state.endgame.stage !== "recovery" &&
    state.endgame.finalReviewReport !== undefined
      ? { finalReviewReport: structuredClone(state.endgame.finalReviewReport) }
      : {}),
    ...(state.endgame.stage === "containment-failure" &&
    state.endgame.emergencyResponseId !== undefined
      ? { emergencyResponseId: state.endgame.emergencyResponseId }
      : {}),
    ...("deploymentTransmittedAtWeek" in state.endgame &&
    state.endgame.deploymentTransmittedAtWeek !== undefined
      ? { deploymentTransmittedAtWeek: state.endgame.deploymentTransmittedAtWeek }
      : {}),
    ...(state.endgame.stage === "containment-failure" &&
    state.endgame.incidentOriginStage !== undefined
      ? { incidentOriginStage: state.endgame.incidentOriginStage }
      : {}),
    ...(state.endgame.stage === "containment-failure" &&
    state.endgame.incidentOriginActionId !== undefined
      ? { incidentOriginActionId: state.endgame.incidentOriginActionId }
      : {}),
    ...(state.endgame.stage === "containment-failure" &&
    state.endgame.incidentOriginModelId !== undefined
      ? { incidentOriginModelId: state.endgame.incidentOriginModelId }
      : {}),
  };
  commitTerminalEnding(tx, definition, resolved);
}

function commitTerminalEnding(
  tx: SimulationTransaction,
  definition: Readonly<EndingDefinition>,
  resolved: CrisisResolvedState,
): void {
  tx.update((draft) => {
    draft.endgame = structuredClone(resolved) as DeepMutable<CrisisResolvedState>;
    const artifact = draft.models[resolved.candidateModelId]?.candidateArtifact;
    if (
      artifact !== undefined &&
      artifact.lifecycle !== "verified-destroyed" &&
      artifact.lifecycle !== "verified-isolated-archive"
    ) {
      artifact.lifecycle = "terminal";
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${definition.displayName}: ${definition.mechanicalCause}`,
      category: "narrative",
      source: { kind: "ending", id: definition.id },
      relatedIds: [definition.id, resolved.candidateModelId],
    });
  });
  applyEffect(
    tx,
    {
      kind: "end-run",
      result:
        definition.endingClass === "full" || definition.endingClass === "qualified"
          ? "won"
          : "lost",
      endingId: definition.id,
    },
    { kind: "ending", id: definition.id },
  );
  tx.emit({
    kind: "endgame-ending-resolved",
    endingId: definition.id,
    endingClass: definition.endingClass,
  });
}

/**
 * Resolve a successful moratorium after ordinary lab play has already been
 * restored behind a mandatory outcome dialog. The frozen crisis base keeps
 * the final audit exact without pretending that False Dawn was a retirement.
 */
export function resolveTerminalMoratoriumFromBase(
  tx: SimulationTransaction,
  definitionOrId: Readonly<EndingDefinition> | ContentId,
  crisisBase: Readonly<CrisisBaseState>,
  rolloutAudit: Readonly<FalseDawnRolloutAuditState>,
  gateResolutions: readonly GateResolutionState[],
): void {
  const state = tx.read();
  if (state.run.status !== "active") throw new Error("Run already ended");
  const definition =
    typeof definitionOrId === "string"
      ? getEndingDefinition(definitionOrId)
      : definitionOrId;
  const resolved: CrisisResolvedState = {
    ...copyCrisisBase(crisisBase),
    stage: "resolved",
    enteredAt: state.run.tick,
    resolvedAt: state.run.tick,
    endingId: definition.id,
    resolutionPath: "moratorium",
    deploymentModeId: rolloutAudit.deploymentModeId,
    prosperityProgrammeId: rolloutAudit.prosperityProgrammeId,
    deploymentTransmittedAtWeek: rolloutAudit.deploymentTransmittedAtWeek,
    completedBeatIds: [
      ...rolloutAudit.completedBeatIds.filter(
        (beat) => beat !== "false-dawn" && beat !== "moratorium",
      ),
      "false-dawn",
      "moratorium",
    ],
    gateResolutions: [
      ...structuredClone(rolloutAudit.gateResolutions),
      ...structuredClone(gateResolutions),
    ],
    finalReviewReport: structuredClone(rolloutAudit.finalReviewReport),
  };
  commitTerminalEnding(tx, definition, resolved);
}
