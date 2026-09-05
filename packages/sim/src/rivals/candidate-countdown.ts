import { contentId } from "@neolab/content-schema";

import { calculateFrontierCapability } from "../models/capability.ts";
import { deceptiveActionPressure } from "../models/deception.ts";
import type { LabId, ModelId } from "../model/ids.ts";
import type {
  GameState,
  ModelState,
  RivalCandidateCountdownModifiersState,
  RivalCandidateCountdownState,
  RivalDeploymentCrisisStage,
} from "../model/state.ts";
import { fraction, rating, tick } from "../model/units.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";
import {
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";
import {
  isEligibleProgrammeCandidate,
  isValidFormalProgrammeCandidate,
} from "../endgame/candidate-programme.ts";
import { transitionCandidateArtifactLifecycle } from "../endgame/candidate-lifecycle.ts";
import { queueRivalCandidateSetback } from "./candidate-setback.ts";
import { recordRivalPublicSignal } from "./signals.ts";

// A credible rival candidate should create a race emergency, not an already
// decided game. One frontier training run plus the minimum evidence needed to
// enter the Deployment Crisis takes roughly 18–22 weeks, and a cautious crisis
// route can then require another 26–39 weeks of evidence, authorisation, and
// rollout. A 78-week baseline leaves a prepared player enough time to complete
// a careful crisis route, while a stagnant lab still loses the race in about
// eighteen months. Rival urgency, safety, politics, incidents, and shared standards
// continue to move the deadline.
export const RIVAL_CANDIDATE_BASE_WEEKS = 78;
export const RIVAL_ASCENDANCE_ENDING_ID = contentId("base:ending.rival-ascendance");
export const RIVAL_CATASTROPHE_ENDING_ID = contentId(
  "base:ending.the-door-opened-elsewhere",
);
const RIVAL_RESOLUTION_DELAY_WEEKS = 13;
// Rival deployment is the ordinary way to lose the race. Catastrophe remains
// a substantial risk for unsafe, rushed programmes, but is not the default
// consequence of another lab reaching the finish line first.
//
/**
 * This offset produces the raw loss pressure. The final branch calculation
 * below converts that into a share of TERMINAL outcomes after containment and
 * delay have taken their mass. Ordinary rival programmes are capped at a 35%
 * terminal catastrophe share, while the deliberately extreme tail can still
 * make catastrophe more likely than ascendance.
 */
const RIVAL_CATASTROPHE_RISK_OFFSET = 52;
const RIVAL_ORDINARY_MAX_TERMINAL_CATASTROPHE_SHARE = 0.35;
const RIVAL_EXTREME_CATASTROPHE_PRESSURE = 1.2;

export interface RivalCandidateResolutionProbabilities {
  readonly catastrophe: number;
  readonly contained: number;
  readonly delayed: number;
  readonly ascendance: number;
  readonly hiddenRisk: number;
  readonly institutionalDefence: number;
}

export interface RivalCandidateCountdownView {
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly modelName: string;
  readonly estimateRangeWeeks: readonly [number, number];
  readonly estimateLabel: string;
  readonly confidence: "low" | "medium" | "high";
  readonly urgency: "monitoring" | "urgent" | "imminent";
  readonly finalDeploymentWarningActive: boolean;
  readonly stage: RivalDeploymentCrisisStage;
  readonly stageLabel: string;
}

const MAX_CRISIS_ANNOUNCEMENTS = 64;

const RIVAL_DEPLOYMENT_CRISIS_STAGES: readonly {
  readonly stage: RivalDeploymentCrisisStage;
  readonly beginsAtFraction: number;
  readonly label: string;
}[] = [
  { stage: "confirmation", beginsAtFraction: 0, label: "Confirmation" },
  {
    stage: "containment-posture",
    beginsAtFraction: 0.15,
    label: "Containment posture",
  },
  { stage: "evidence-sprint", beginsAtFraction: 0.3, label: "Evidence sprint" },
  {
    stage: "pressure-collision",
    beginsAtFraction: 0.6,
    label: "Pressure collision",
  },
  { stage: "final-review", beginsAtFraction: 0.75, label: "Final review" },
  { stage: "rollout", beginsAtFraction: 0.85, label: "Rollout" },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Rival deployment uses the same underlying safety story as the player: intent,
 * hazardous capability, institutional defence, and the temptation to rush all
 * matter. These values are privileged simulation truth and are never projected
 * directly into the live rival-intelligence view.
 */
export function rivalCandidateResolutionProbabilities(
  state: Readonly<GameState>,
  labId: LabId,
  model: Readonly<ModelState>,
  resolutionAttemptCount = 0,
): RivalCandidateResolutionProbabilities {
  const lab = state.labs[labId];
  const strategy = state.world.rivals[labId];
  if (lab === undefined || strategy === undefined || model.ownerLabId !== labId) {
    throw new Error(`Unknown rival candidate owner ${labId}`);
  }
  const hiddenRisk =
    (100 - model.hiddenSafety.trueAlignment) * 0.3 +
    (100 - model.hiddenSafety.corrigibility) * 0.2 +
    deceptiveActionPressure(
      model.hiddenSafety.deceptiveCapability,
      model.hiddenSafety.deceptiveIntent,
    ) *
      0.2 +
    model.hiddenSafety.situationalAwareness * 0.15 +
    model.trueCapability.agency * 0.075 +
    model.trueCapability.toolUse * 0.075;
  // Use the same effective safety values as incidents, autonomy, and the
  // player's endgame. Raw lab fields omit the operational benefit of safety
  // research and made decades of rival investment irrelevant at resolution.
  const practicalControl = effectivePracticalControlStrength(state, labId);
  const securityPosture = effectiveSecurityPosture(state, labId);
  const evaluationQuality = effectiveEvaluationQuality(state, labId);
  const institutionalDefence =
    practicalControl * 0.25 +
    securityPosture * 0.25 +
    lab.safety.safetyCulture * 0.15 +
    evaluationQuality * 0.15 +
    lab.politics.governmentTrust * 0.1 +
    strategy.personality.safetyCommitment * 0.1;
  const recklessPressure =
    strategy.personality.raceUrgency * 0.6 +
    (100 - strategy.personality.safetyCommitment) * 0.4;
  // A rival handing the world to a system it cannot correct is never a remote
  // possibility, so the floor is the base share of terminal deployments; the
  // formula above it is what recklessness buys.
  const rawCatastrophePressure = clamp(
    (hiddenRisk -
      institutionalDefence +
      recklessPressure * 0.35 -
      RIVAL_CATASTROPHE_RISK_OFFSET) /
      100,
    0.12,
    0.7,
  );
  const contained = clamp(
    (Math.max(0, hiddenRisk - 35) / 100) *
      ((institutionalDefence + evaluationQuality) / 120),
    0,
    0.5,
  );
  const delayed =
    resolutionAttemptCount > 0
      ? 0
      : Math.min(
          0.18,
          0.04 +
            strategy.personality.safetyCommitment * 0.0008 +
            strategy.personality.politicalCooperation * 0.0003 +
            lab.politics.governmentTrust * 0.0003,
        );
  const lossPressure = hiddenRisk - institutionalDefence + recklessPressure * 0.35;
  const terminalCatastropheShare =
    lossPressure >= RIVAL_EXTREME_CATASTROPHE_PRESSURE * 100
      ? rawCatastrophePressure
      : Math.min(rawCatastrophePressure, RIVAL_ORDINARY_MAX_TERMINAL_CATASTROPHE_SHARE);
  const terminalMass = Math.max(0, 1 - contained - delayed);
  const catastrophe = terminalMass * terminalCatastropheShare;
  const ascendance = terminalMass - catastrophe;
  return {
    catastrophe,
    contained,
    delayed,
    ascendance,
    hiddenRisk,
    institutionalDefence,
  };
}

export function rivalDeploymentCrisisStageLabel(
  stage: RivalDeploymentCrisisStage,
): string {
  return (
    RIVAL_DEPLOYMENT_CRISIS_STAGES.find((candidate) => candidate.stage === stage)
      ?.label ?? stage
  );
}

export function rivalDeploymentCrisisStageAt(
  countdown: Readonly<RivalCandidateCountdownState>,
  atTick: number,
): RivalDeploymentCrisisStage {
  const duration = Math.max(1, countdown.completesAt - countdown.startedAt);
  const progress = clamp((atTick - countdown.startedAt) / duration, 0, 1);
  return (
    [...RIVAL_DEPLOYMENT_CRISIS_STAGES]
      .reverse()
      .find((candidate) => progress >= candidate.beginsAtFraction)?.stage ??
    "confirmation"
  );
}

function announceRivalCrisisStage(
  tx: SimulationTransaction,
  input: {
    readonly labId: LabId;
    readonly modelId: ModelId;
    readonly stage: RivalDeploymentCrisisStage;
    readonly previousStage?: RivalDeploymentCrisisStage;
    readonly kind: "entered" | "advanced" | "completed";
  },
): void {
  const announcement = {
    ...input,
    tick: tx.read().run.tick,
  } as const;
  const duplicate = tx
    .read()
    .world.rivalCrisisStageAnnouncements.some(
      (candidate) =>
        candidate.labId === announcement.labId &&
        candidate.modelId === announcement.modelId &&
        candidate.stage === announcement.stage &&
        candidate.kind === announcement.kind &&
        candidate.tick === announcement.tick,
    );
  if (duplicate) return;

  tx.update((draft) => {
    draft.world.rivalCrisisStageAnnouncements = [
      ...draft.world.rivalCrisisStageAnnouncements,
      announcement,
    ].slice(-MAX_CRISIS_ANNOUNCEMENTS);
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        input.kind === "entered"
          ? `Rival watch: ${input.labId} entered the ${rivalDeploymentCrisisStageLabel(input.stage)} stage of the Deployment Crisis.`
          : input.kind === "completed"
            ? `Rival watch: ${input.labId} completed the ${rivalDeploymentCrisisStageLabel(input.stage)} stage of the Deployment Crisis.`
            : `Rival watch: ${input.labId} completed ${rivalDeploymentCrisisStageLabel(input.previousStage ?? input.stage)} and entered ${rivalDeploymentCrisisStageLabel(input.stage)}.`,
      category: "narrative",
      source: {
        kind: "system",
        id: `rival-crisis-stage:${input.labId}:${input.modelId}:${input.stage}:${input.kind}`,
      },
      relatedIds: [input.labId, input.modelId],
    });
  });
  tx.emit({
    kind: "rival-deployment-crisis-stage",
    labId: input.labId,
    modelId: input.modelId,
    stage: input.stage,
    ...(input.previousStage === undefined ? {} : { previousStage: input.previousStage }),
    transition: input.kind,
  });
  tx.requestAutoPause("rival-crisis-stage");
}

/** Rival candidacy uses hidden rival truth plus the same four works as the player. */
export function isRivalAgiCandidate(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): boolean {
  return isEligibleProgrammeCandidate(state, model);
}

function strongestRivalCandidate(
  state: Readonly<GameState>,
  labId: LabId,
): Readonly<ModelState> | undefined {
  const lab = state.labs[labId];
  if (lab === undefined) return undefined;
  return lab.models.modelIds
    .map((modelId) => state.models[modelId])
    .filter(
      (model): model is ModelState =>
        model !== undefined && isRivalAgiCandidate(state, model),
    )
    .sort(
      (left, right) =>
        calculateFrontierCapability(right.trueCapability) -
          calculateFrontierCapability(left.trueCapability) ||
        right.generationIndex - left.generationIndex ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )[0];
}

export function calculateRivalCandidateDuration(
  state: Readonly<GameState>,
  labId: LabId,
): RivalCandidateCountdownModifiersState {
  const strategy = state.world.rivals[labId];
  const lab = state.labs[labId];
  if (strategy === undefined || lab === undefined || lab.control !== "rival") {
    throw new Error(`Unknown rival lab ${labId}`);
  }
  const safetyCommitmentWeeks = Math.round(
    (strategy.personality.safetyCommitment - 50) * 0.12,
  );
  const raceUrgencyWeeks = -Math.round((strategy.personality.raceUrgency - 50) * 0.12);
  const politicalProcessWeeks = Math.round(
    (strategy.personality.politicalCooperation - 50) * 0.08 +
      (lab.politics.governmentTrust - 50) * 0.06,
  );
  const incidentDelayWeeks = Math.min(
    10,
    strategy.incidents
      .filter((incident) => incident.occurredAt >= state.run.tick - 52)
      .reduce((sum, incident) => sum + (incident.severity === "critical" ? 5 : 2), 0),
  );
  const sharedStandardsWeeks = strategy.agreements.some(
    (agreement) =>
      agreement.action === "safety-standards" && agreement.expiresAt > state.run.tick,
  )
    ? 4
    : 0;
  return {
    baseWeeks: RIVAL_CANDIDATE_BASE_WEEKS,
    safetyCommitmentWeeks,
    raceUrgencyWeeks,
    politicalProcessWeeks,
    incidentDelayWeeks,
    sharedStandardsWeeks,
    finalWeeks: Math.round(
      clamp(
        RIVAL_CANDIDATE_BASE_WEEKS +
          safetyCommitmentWeeks +
          raceUrgencyWeeks +
          politicalProcessWeeks +
          incidentDelayWeeks +
          sharedStandardsWeeks,
        26,
        104,
      ),
    ),
  };
}

function startCountdown(
  tx: SimulationTransaction,
  labId: LabId,
  model: Readonly<ModelState>,
  random: RandomOracle,
): void {
  if (model.ownerLabId !== labId || !isRivalAgiCandidate(tx.read(), model)) return;
  const modifiers = calculateRivalCandidateDuration(tx.read(), labId);
  const startedAt = tx.read().run.tick;
  const estimateNoiseUnit =
    random.uniform(
      randomKey("rival-candidate", labId, model.id, String(startedAt), "estimate-noise"),
    ) *
      2 -
    1;
  transitionCandidateArtifactLifecycle(tx, model.id, "formal-candidate");
  tx.update((draft) => {
    const strategy = draft.world.rivals[labId];
    const mutableModel = draft.models[model.id];
    if (strategy === undefined || mutableModel === undefined) {
      throw new Error(`Missing rival candidate owner ${labId}`);
    }
    strategy.candidateCountdown = {
      modelId: model.id,
      startedAt,
      completesAt: tick(startedAt + modifiers.finalWeeks),
      status: "active",
      modifiers,
      estimateNoiseUnit,
      finalYearWarningIssued: false,
      resolutionAttemptCount: 0,
    };
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `rival-candidate:${labId}:${model.id}`,
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Race Emergency: credible evidence indicates ${labId} has an AGI candidate.`,
      category: "narrative",
      source: { kind: "system", id: `rival-candidate:${labId}:${model.id}` },
      relatedIds: [labId, model.id],
    });
  });
  recordRivalPublicSignal(tx, {
    labId,
    kind: "candidate",
    subjectId: model.id,
    actualValue: calculateFrontierCapability(model.trueCapability),
    baseErrorRadius: 6,
    summary: `${labId} is credibly reported to have trained an AGI candidate.`,
  });
  announceRivalCrisisStage(tx, {
    labId,
    modelId: model.id,
    stage: "confirmation",
    kind: "entered",
  });
  tx.emit({
    kind: "rival-candidate-countdown-started",
    labId,
    modelId: model.id,
  });
  tx.requestAutoPause("race-emergency");
}

/** Detects new rival candidates, warns in the final deployment window, and resolves the race. */
export function advanceRivalCandidateCountdowns(
  tx: SimulationTransaction,
  random: RandomOracle,
): void {
  if (tx.read().run.status !== "active") return;
  for (const labId of Object.keys(tx.read().world.rivals).sort() as LabId[]) {
    if (tx.read().run.status !== "active") break;
    const strategy = tx.read().world.rivals[labId];
    const countdownModelId = strategy?.candidateCountdown?.modelId;
    const model =
      countdownModelId === undefined
        ? strongestRivalCandidate(tx.read(), labId)
        : tx.read().models[countdownModelId];
    if (strategy === undefined) continue;
    if (
      countdownModelId !== undefined &&
      strategy.candidateCountdown?.status === "active" &&
      (model === undefined ||
        model.ownerLabId !== labId ||
        !isValidFormalProgrammeCandidate(tx.read(), model))
    ) {
      throw new Error(
        `Active rival countdown ${labId} does not reference a valid formal candidate`,
      );
    }
    if (model === undefined) continue;
    if (strategy.candidateCountdown === undefined) {
      // `strongestRivalCandidate` and the defensive check in `startCountdown`
      // both enforce capability plus all four Candidate Programme works.
      startCountdown(tx, labId, model, random);
    }
    const countdown = tx.read().world.rivals[labId]?.candidateCountdown;
    if (countdown === undefined || countdown.status !== "active") continue;
    const currentStage = rivalDeploymentCrisisStageAt(countdown, tx.read().run.tick);
    const previousStage = rivalDeploymentCrisisStageAt(
      countdown,
      Math.max(countdown.startedAt, tx.read().run.tick - 1),
    );
    if (currentStage !== previousStage) {
      announceRivalCrisisStage(tx, {
        labId,
        modelId: countdown.modelId,
        stage: currentStage,
        previousStage,
        kind: "advanced",
      });
    }
    const remainingWeeks = countdown.completesAt - tx.read().run.tick;
    if (remainingWeeks <= 13 && !countdown.finalYearWarningIssued) {
      tx.update((draft) => {
        const live = draft.world.rivals[labId]?.candidateCountdown;
        if (live !== undefined) live.finalYearWarningIssued = true;
      });
      tx.emit({
        kind: "rival-candidate-final-year",
        labId,
        modelId: countdown.modelId,
      });
      tx.requestAutoPause("rival-final-year");
    }
    if (remainingWeeks > 0 || tx.read().run.status !== "active") continue;
    const lineage = tx.read().lineageSIRecords[model.lineageId];
    if (lineage === undefined) {
      throw new Error(`Rival candidate ${model.id} has no lineage SI record`);
    }
    if (lineage.superintelligenceTruth === "not-genuine") {
      transitionCandidateArtifactLifecycle(tx, model.id, "deployed");
      transitionCandidateArtifactLifecycle(tx, model.id, "terminal");
      tx.update((draft) => {
        const live = draft.world.rivals[labId];
        if (live === undefined) throw new Error(`Missing rival strategy ${labId}`);
        delete live.candidateCountdown;
        draft.domainLog.push({
          tick: draft.run.tick,
          code: `rival-candidate-false-dawn:${labId}:${model.id}`,
        });
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `${labId}'s deployment failed to demonstrate general superintelligence. The rival race resumes.`,
          category: "narrative",
          source: { kind: "system", id: `rival-false-dawn:${labId}:${model.id}` },
          relatedIds: [labId, model.id],
        });
      });
      queueRivalCandidateSetback(tx, {
        outcome: "false-dawn",
        labId,
        modelId: model.id,
        countdownStartedAt: countdown.startedAt,
      });
      tx.emit({ kind: "rival-candidate-false-dawn", labId, modelId: model.id });
      tx.requestAutoPause("race-emergency");
      continue;
    }
    const resolutionAttemptCount = countdown.resolutionAttemptCount ?? 0;
    const probabilities = rivalCandidateResolutionProbabilities(
      tx.read(),
      labId,
      model,
      resolutionAttemptCount,
    );
    const resolutionKey = randomKey(
      "rival-candidate-resolution-v1",
      tx.read().engineRulesVersion,
      tx.read().run.seed,
      labId,
      model.id,
      String(resolutionAttemptCount),
    );
    const resolutionDraw = random.uniform(resolutionKey);
    if (resolutionDraw < probabilities.catastrophe) {
      announceRivalCrisisStage(tx, {
        labId,
        modelId: countdown.modelId,
        stage: "rollout",
        kind: "completed",
      });
      transitionCandidateArtifactLifecycle(tx, model.id, "deployed");
      transitionCandidateArtifactLifecycle(tx, model.id, "escaped");
      transitionCandidateArtifactLifecycle(tx, model.id, "terminal");
      tx.update((draft) => {
        const live = draft.world.rivals[labId]?.candidateCountdown;
        if (live === undefined) throw new Error(`Missing countdown for ${labId}`);
        live.status = "completed";
        live.completedAt = draft.run.tick;
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `${labId}'s genuine superintelligence escaped control during deployment. The frontier race ended in a global catastrophe, not a clean rival victory.`,
          category: "narrative",
          source: { kind: "ending", id: RIVAL_CATASTROPHE_ENDING_ID },
          relatedIds: [labId, model.id],
        });
      });
      recordRivalPublicSignal(tx, {
        labId,
        kind: "incident",
        subjectId: model.id,
        actualValue: probabilities.hiddenRisk,
        baseErrorRadius: 3,
        summary: `${labId}'s candidate deployment produced an uncontrolled global emergency.`,
      });
      tx.emit({
        kind: "rival-candidate-countdown-completed",
        labId,
        modelId: countdown.modelId,
      });
      applyEffect(
        tx,
        {
          kind: "end-run",
          result: "lost",
          endingId: RIVAL_CATASTROPHE_ENDING_ID,
        },
        { kind: "ending", id: RIVAL_CATASTROPHE_ENDING_ID },
      );
      continue;
    }
    if (resolutionDraw < probabilities.catastrophe + probabilities.contained) {
      transitionCandidateArtifactLifecycle(tx, model.id, "retirement-attempt");
      transitionCandidateArtifactLifecycle(tx, model.id, "verified-destroyed");
      tx.update((draft) => {
        const live = draft.world.rivals[labId];
        const artifact = draft.models[model.id]?.candidateArtifact;
        if (live === undefined || artifact === undefined) {
          throw new Error(`Missing rival containment state for ${labId}`);
        }
        delete live.candidateCountdown;
        artifact.archiveDisposition = "destroy-all-weights";
        artifact.retirementVerification = "verified";
        live.incidents.push({
          id: `rival-candidate-containment:${labId}:${model.id}:${String(draft.run.tick)}`,
          occurredAt: draft.run.tick,
          severity: "critical",
          consequences: ["model-weights-loss", "safety-information-shared"],
          riskAtCheck: rating(clamp(probabilities.hiddenRisk, 0, 100)),
          triggerProbability: fraction(probabilities.contained),
          draw: fraction(resolutionDraw),
        });
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `${labId} detected a control failure during final deployment and destroyed the candidate weights under emergency containment. The race remains active.`,
          category: "narrative",
          source: {
            kind: "system",
            id: `rival-candidate-contained:${labId}:${model.id}`,
          },
          relatedIds: [labId, model.id],
        });
      });
      queueRivalCandidateSetback(tx, {
        outcome: "emergency-containment",
        labId,
        modelId: model.id,
        countdownStartedAt: countdown.startedAt,
      });
      recordRivalPublicSignal(tx, {
        labId,
        kind: "incident",
        subjectId: model.id,
        actualValue: probabilities.hiddenRisk,
        baseErrorRadius: 8,
        summary: `${labId} halted its candidate deployment after a major containment incident.`,
      });
      tx.requestAutoPause("race-emergency");
      continue;
    }
    if (
      resolutionDraw <
      probabilities.catastrophe + probabilities.contained + probabilities.delayed
    ) {
      tx.update((draft) => {
        const live = draft.world.rivals[labId]?.candidateCountdown;
        if (live === undefined) throw new Error(`Missing countdown for ${labId}`);
        const delayedUntil = tick(draft.run.tick + RIVAL_RESOLUTION_DELAY_WEEKS);
        // Keep the countdown visibly in rollout while preserving a real delay
        // during which the player's finance, politics, and projects continue.
        const rolloutElapsed = Math.ceil(RIVAL_RESOLUTION_DELAY_WEEKS * (0.85 / 0.15));
        live.startedAt = tick(Math.max(0, draft.run.tick - rolloutElapsed));
        live.completesAt = delayedUntil;
        live.modifiers.finalWeeks = live.completesAt - live.startedAt;
        live.finalYearWarningIssued = false;
        live.resolutionAttemptCount = resolutionAttemptCount + 1;
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `${labId}'s final reviewers delayed deployment for ${String(RIVAL_RESOLUTION_DELAY_WEEKS)} weeks after its safety and governance case failed to close.`,
          category: "narrative",
          source: {
            kind: "system",
            id: `rival-candidate-delayed:${labId}:${model.id}:${String(resolutionAttemptCount + 1)}`,
          },
          relatedIds: [labId, model.id],
        });
      });
      recordRivalPublicSignal(tx, {
        labId,
        kind: "candidate",
        subjectId: model.id,
        actualValue: calculateFrontierCapability(model.trueCapability),
        baseErrorRadius: 5,
        summary: `${labId}'s candidate deployment has been delayed by an unresolved final review.`,
      });
      tx.requestAutoPause("race-emergency");
      continue;
    }
    announceRivalCrisisStage(tx, {
      labId,
      modelId: countdown.modelId,
      stage: "rollout",
      kind: "completed",
    });
    transitionCandidateArtifactLifecycle(tx, model.id, "deployed");
    const endingId = RIVAL_ASCENDANCE_ENDING_ID;
    tx.update((draft) => {
      const live = draft.world.rivals[labId]?.candidateCountdown;
      if (live === undefined) throw new Error(`Missing countdown for ${labId}`);
      live.status = "completed";
      live.completedAt = draft.run.tick;
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `${labId} completed its deployment process and won the frontier race.`,
        category: "narrative",
        source: { kind: "ending", id: endingId },
        relatedIds: [labId, countdown.modelId],
      });
    });
    tx.emit({
      kind: "rival-candidate-countdown-completed",
      labId,
      modelId: countdown.modelId,
    });
    applyEffect(
      tx,
      {
        kind: "end-run",
        result: "lost",
        endingId,
      },
      { kind: "ending", id: endingId },
    );
  }
}

function rangeLabel(range: readonly [number, number]): string {
  const [minimum, maximum] = range;
  if (maximum <= 2) return "possibly within two weeks";
  if (maximum <= 8) return `${String(minimum)}–${String(maximum)} weeks`;
  const minMonths = Math.max(1, Math.round(minimum / 4.33));
  const maxMonths = Math.max(minMonths, Math.round(maximum / 4.33));
  return `${String(minMonths)}–${String(maxMonths)} months`;
}

/** Player-safe countdown projection: exact dates and stored noise never cross this boundary. */
export function projectRivalCandidateCountdowns(
  state: Readonly<GameState>,
  intelligenceRatings: Readonly<Record<string, number>>,
): readonly RivalCandidateCountdownView[] {
  return (Object.keys(state.world.rivals).sort() as LabId[]).flatMap((labId) => {
    const countdown = state.world.rivals[labId]?.candidateCountdown;
    const model = countdown === undefined ? undefined : state.models[countdown.modelId];
    if (countdown === undefined || countdown.status !== "active" || model === undefined) {
      return [];
    }
    const intelligence = clamp(intelligenceRatings[labId] ?? 25, 0, 100);
    const radius = Math.max(2, Math.round(10 * (1 - intelligence * 0.008)));
    const actualRemaining = Math.max(0, countdown.completesAt - state.run.tick);
    const estimate = Math.max(0, actualRemaining + countdown.estimateNoiseUnit * radius);
    const range: readonly [number, number] = [
      Math.max(0, Math.round(estimate - radius)),
      Math.max(0, Math.round(estimate + radius)),
    ];
    return [
      {
        labId,
        modelId: model.id,
        modelName: model.displayName,
        estimateRangeWeeks: range,
        estimateLabel: rangeLabel(range),
        confidence: intelligence >= 75 ? "high" : intelligence >= 45 ? "medium" : "low",
        urgency: range[1] <= 4 ? "imminent" : range[0] <= 13 ? "urgent" : "monitoring",
        finalDeploymentWarningActive: countdown.finalYearWarningIssued,
        stage: rivalDeploymentCrisisStageAt(countdown, state.run.tick),
        stageLabel: rivalDeploymentCrisisStageLabel(
          rivalDeploymentCrisisStageAt(countdown, state.run.tick),
        ),
      },
    ];
  });
}
