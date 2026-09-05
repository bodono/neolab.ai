import { assertPlainSerialisable } from "../model/schema.ts";
import { calendarFromTick, type GameState, type ResolutionGate } from "../model/state.ts";
import { CRISIS_SLOT_FLOOR, totalMajorProjectSlots } from "../projects/slot-policy.ts";
import {
  calculateFrontierCapability,
  satisfiesAgiCandidateCapabilityGate,
  superintelligenceProbability,
} from "../models/capability.ts";
import { describeRandomKey, randomKey } from "../random/key.ts";
import { isModifierTarget } from "./modifier-targets.ts";

export interface InvariantViolation {
  readonly code: string;
  readonly detail: string;
}

const ALLOCATION_SUM = 10_000;

/**
 * Global invariants checked after every command and tick (TDD section 9.5).
 * The pack grows with the systems that own each rule; every entry lists its
 * source rule. Violations indicate an engine bug, never a player mistake.
 */
export function collectInvariantViolations(
  state: GameState,
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const push = (code: string, detail: string): void => {
    violations.push({ code, detail });
  };

  // TDD 9.5: all values finite, plain, serialisable.
  try {
    assertPlainSerialisable(state);
  } catch (error) {
    push("plain-data", error instanceof Error ? error.message : String(error));
  }

  // GDD 28.1 / TDD 7.1: displayed calendar matches the tick counter.
  const expectedCalendar = calendarFromTick(state.run.tick);
  if (
    state.run.calendar.year !== expectedCalendar.year ||
    state.run.calendar.week !== expectedCalendar.week
  ) {
    push(
      "calendar-drift",
      `calendar ${String(state.run.calendar.year)}w${String(state.run.calendar.week)} ` +
        `does not match tick ${String(state.run.tick)}`,
    );
  }

  // TDD 9.5: ending status and endgame state are compatible.
  if (state.run.status === "active" && state.run.endingId !== undefined) {
    push("ending-mismatch", "active run carries an endingId");
  }
  if (state.run.status !== "active" && state.run.endingId === undefined) {
    push("ending-mismatch", `run is ${state.run.status} without an endingId`);
  }
  if (state.run.status === "active" && state.score.final !== undefined) {
    push("score-finalisation", "active run carries a final score");
  }
  if (state.run.status !== "active" && state.score.final === undefined) {
    push("score-finalisation", "ended run has no final score");
  }
  if (state.endgame.stage === "resolved" && state.run.status === "active") {
    push("ending-mismatch", "resolved crisis belongs to an active run");
  }
  if (state.endgame.stage !== "inactive") {
    const expectedEndgamePhase =
      state.endgame.stage === "recovery" ? "frontier" : "crisis";
    if (state.run.status === "active" && state.run.phase !== expectedEndgamePhase) {
      push(
        "endgame-phase",
        `active ${state.endgame.stage} expects ${expectedEndgamePhase} phase`,
      );
    }
    if (state.endgame.stage === "candidate-activation") {
      if (
        state.endgame.enteredAt > state.run.tick ||
        state.endgame.eligibleModelIds.length === 0 ||
        new Set(state.endgame.eligibleModelIds).size !==
          state.endgame.eligibleModelIds.length
      ) {
        push("candidate-activation", "activation candidates or timestamp are invalid");
      }
      if (state.aiCharacter !== undefined) {
        push("candidate-activation", "activation must not create an AI character yet");
      }
      for (const modelId of state.endgame.eligibleModelIds) {
        const model = state.models[modelId];
        if (
          model === undefined ||
          model.ownerLabId !== state.run.playerLabId ||
          model.candidateArtifact?.lifecycle !==
            "capability-qualified-latent-candidate" ||
          model.candidateArtifact.activeIncident !== undefined
        ) {
          push("candidate-activation", `${modelId} is no longer nomination-eligible`);
        }
      }
    } else {
      const candidate = state.models[state.endgame.candidateModelId];
      if (candidate === undefined || candidate.ownerLabId !== state.run.playerLabId) {
        push(
          "endgame-candidate",
          `crisis candidate ${state.endgame.candidateModelId} is missing or not player-owned`,
        );
      }
      if (state.endgame.stage === "recovery") {
        const artifact = candidate?.candidateArtifact;
        if (
          state.aiCharacter !== undefined ||
          state.endgame.retiredModelId !== state.endgame.candidateModelId ||
          candidate?.accessLevel !== 0 ||
          artifact?.retirementVerification !== "verified" ||
          (artifact.lifecycle !== "verified-destroyed" &&
            artifact.lifecycle !== "verified-isolated-archive")
        ) {
          push(
            "endgame-recovery",
            "recovery requires a verified retired artifact at Access 0 and no AI character",
          );
        }
        if (
          state.endgame.quarantineEndsAt < state.endgame.recoveryStartedAt ||
          state.endgame.recoveryEndsAt < state.endgame.quarantineEndsAt
        ) {
          push("endgame-recovery", "recovery milestones are out of order");
        }
      } else if (
        state.endgame.stage === "resolved" &&
        state.endgame.resolutionPath === "moratorium"
      ) {
        const artifact = candidate?.candidateArtifact;
        if (
          state.aiCharacter !== undefined ||
          candidate?.accessLevel !== 0 ||
          artifact?.retirementVerification !== "verified" ||
          (artifact.lifecycle !== "verified-destroyed" &&
            artifact.lifecycle !== "verified-isolated-archive")
        ) {
          push(
            "endgame-moratorium-custody",
            "a resolved moratorium requires a verified retired artifact at Access 0 and no AI character",
          );
        }
      } else if (
        state.aiCharacter === undefined ||
        state.aiCharacter.modelId !== state.endgame.candidateModelId ||
        candidate?.accessLevel !== state.aiCharacter.currentAccess
      ) {
        push(
          "endgame-ai-character",
          "active crisis candidate, model access and AI character state must agree",
        );
      }
      if (candidate?.lineageId !== state.endgame.candidateLineageId) {
        push("endgame-candidate-lineage", "crisis lineage does not match its candidate");
      }
      if (
        state.endgame.crisisStartedAt > state.run.tick ||
        state.endgame.enteredAt > state.run.tick ||
        state.endgame.startSnapshot.capturedAt !== state.endgame.crisisStartedAt
      ) {
        push("endgame-timeline", `invalid ${state.endgame.stage} crisis timestamps`);
      }
      const crisisProjectIds = new Set<string>(state.endgame.crisisProjectIds);
      if (
        new Set(state.endgame.crisisProjectIds).size !==
          state.endgame.crisisProjectIds.length ||
        new Set(state.endgame.completedCrisisProjectIds).size !==
          state.endgame.completedCrisisProjectIds.length ||
        state.endgame.completedCrisisProjectIds.some(
          (projectId) => !crisisProjectIds.has(projectId),
        )
      ) {
        push(
          "endgame-project-index",
          "crisis project indexes contain duplicates or drift",
        );
      }
      for (const projectId of state.endgame.crisisProjectIds) {
        const project = state.projects[projectId];
        if (
          project?.kind !== "crisis" ||
          project.payload.kind !== "crisis" ||
          state.models[project.payload.modelId]?.lineageId !==
            state.endgame.candidateLineageId ||
          project.ownerLabId !== state.run.playerLabId
        ) {
          push("endgame-project-index", `${projectId} is not a candidate crisis project`);
        }
      }
      for (const projectId of state.endgame.completedCrisisProjectIds) {
        if (state.projects[projectId]?.status !== "completed") {
          push("endgame-project-completion", `${projectId} is indexed before completion`);
        }
      }
      if (
        state.endgame.evidence.completedProjectTypes.length <
        state.endgame.completedCrisisProjectIds.length
      ) {
        push(
          "endgame-evidence-ledger",
          "completed crisis projects are missing evidence-ledger entries",
        );
      }
      const proofKeys = new Set<string>();
      let disputes = 0;
      for (const proof of state.endgame.capabilityProofHistory) {
        const key = `${proof.modelId}/${proof.challengeId}/${proof.verifierId ?? "none"}/${String(proof.attemptIndex)}`;
        if (
          proofKeys.has(key) ||
          proof.resolvedAt > state.run.tick ||
          state.models[proof.modelId]?.lineageId !== state.endgame.candidateLineageId
        ) {
          push("endgame-proof-history", key);
        }
        proofKeys.add(key);
        if (
          proof.resultId === "disputed" ||
          proof.resultId === "fabricated-or-unverifiable"
        ) {
          disputes += 1;
        }
      }
      if (disputes !== state.endgame.capabilityDisputeCount) {
        push("endgame-proof-history", "capability dispute counter drifted from history");
      }
      const targetedResponseKeys = new Set<string>();
      for (const response of state.endgame.targetedResponseHistory) {
        const key = `${response.modelId}/${response.responseId}/${String(response.startedAt)}`;
        if (
          targetedResponseKeys.has(key) ||
          response.startedAt > state.run.tick ||
          (response.completedAt !== undefined &&
            (response.completedAt < response.startedAt ||
              response.completedAt > state.run.tick)) ||
          (response.completedAt === undefined) !== (response.resultModelId === undefined)
        ) {
          push("endgame-targeted-response-history", key);
        }
        targetedResponseKeys.add(key);
      }
      if (
        state.endgame.stage === "evidence-sprint" &&
        state.endgame.minimumEndsAt < state.endgame.sprintStartedAt
      ) {
        push(
          "endgame-sprint-window",
          "Candidate safety-plan minimum precedes the chapter start",
        );
      }
      if (
        state.endgame.stage === "evidence-sprint" &&
        state.endgame.pendingRemediation !== undefined
      ) {
        const pending = state.endgame.pendingRemediation;
        const source = state.models[pending.sourceModelId];
        const result = state.models[pending.resultModelId];
        const matchingHistory = state.endgame.targetedResponseHistory.some(
          (entry) =>
            entry.modelId === pending.sourceModelId &&
            entry.responseId === "shutdown-corrigibility-hardening" &&
            entry.completedAt !== undefined &&
            entry.resultModelId === pending.resultModelId,
        );
        if (
          pending.createdAt > state.run.tick ||
          pending.sourceModelId !== state.endgame.candidateModelId ||
          pending.capabilityDelta >= 0 ||
          pending.reliabilityDelta >= 0 ||
          source?.candidateArtifact?.lifecycle !== "formal-candidate" ||
          result?.derivedFromModelId !== source?.id ||
          result?.lineageId !== state.endgame.candidateLineageId ||
          result.candidateArtifact?.lifecycle !==
            "capability-qualified-latent-candidate" ||
          !satisfiesAgiCandidateCapabilityGate(result.trueCapability) ||
          !matchingHistory
        ) {
          push(
            "endgame-pending-remediation",
            `${pending.sourceModelId}:${pending.resultModelId}`,
          );
        }
      }
      if (state.endgame.stage === "pressure-collision") {
        const hasDelay = state.endgame.delayEndsAt !== undefined;
        if (
          hasDelay !== (state.endgame.selectedOptionId === "delay") ||
          (state.endgame.delayEndsAt !== undefined &&
            state.endgame.delayEndsAt < state.endgame.enteredAt)
        ) {
          push(
            "endgame-pressure-delay",
            "only a selected delay may create a valid pressure-response deadline",
          );
        }
      }
      if (state.endgame.stage === "rollout") {
        const beatOrder = [
          "authorisation",
          "first-operation",
          "stress-collision",
          "demonstration",
          "settlement",
        ] as const;
        const completedBeats = new Set(state.endgame.completedBeatIds);
        if (completedBeats.size !== state.endgame.completedBeatIds.length) {
          push("endgame-rollout-beats", "completed rollout beats contain duplicates");
        }
        let previousBeatIndex = -1;
        for (const beat of state.endgame.completedBeatIds) {
          const index = beatOrder.indexOf(beat as (typeof beatOrder)[number]);
          if (index < 0 || index <= previousBeatIndex) {
            push("endgame-rollout-beats", `unknown or out-of-order rollout beat ${beat}`);
          }
          previousBeatIndex = index;
        }
        if (state.endgame.rolloutEndsAt < state.endgame.rolloutStartedAt) {
          push("endgame-rollout-timeline", "rollout ends before it begins");
        }
        if (
          state.endgame.awaitingDecision !==
          (state.endgame.beatOpenedAt !== undefined)
        ) {
          push(
            "endgame-rollout-decision",
            "awaiting-decision and beat-open timestamp must appear together",
          );
        }
        if (
          state.endgame.awaitingDecision &&
          state.endgame.currentBeat !== "authorisation" &&
          state.endgame.currentBeat !== "first-operation" &&
          state.endgame.currentBeat !== "stress-collision" &&
          state.endgame.currentBeat !== "settlement"
        ) {
          push(
            "endgame-rollout-decision",
            `${state.endgame.currentBeat} cannot await a player decision`,
          );
        }
        if (
          state.endgame.currentBeat === "settlement" &&
          state.endgame.awaitingDecision &&
          !state.endgame.completedBeatIds.includes("settlement")
        ) {
          push(
            "endgame-rollout-decision",
            "final deployment cannot open before settlement is complete",
          );
        }
      }
      if (state.endgame.stage === "resolved") {
        if (
          state.run.endingId !== state.endgame.endingId ||
          state.endgame.resolvedAt > state.run.tick ||
          (!state.endgame.completedBeatIds.includes("settlement") &&
            !state.endgame.completedBeatIds.includes("containment-failure") &&
            !state.endgame.completedBeatIds.includes("moratorium"))
        ) {
          push(
            "endgame-resolution",
            "resolved crisis must match the run ending and retain a completed terminal sequence",
          );
        }
      }
      if (state.endgame.stage === "containment-failure") {
        const beatOrder = [
          "containment-signal",
          "emergency-decision",
          "emergency-response",
          "failure-propagation",
          "containment-failure",
        ] as const;
        const completedFailureBeats = state.endgame.completedBeatIds.filter((beat) =>
          beatOrder.includes(beat as (typeof beatOrder)[number]),
        );
        if (new Set(completedFailureBeats).size !== completedFailureBeats.length) {
          push(
            "endgame-containment-failure-beats",
            "completed containment-failure beats contain duplicates",
          );
        }
        let previousFailureBeat = -1;
        for (const beat of completedFailureBeats) {
          const index = beatOrder.indexOf(beat as (typeof beatOrder)[number]);
          if (index <= previousFailureBeat) {
            push(
              "endgame-containment-failure-beats",
              `out-of-order containment-failure beat ${beat}`,
            );
          }
          previousFailureBeat = index;
        }
        if (
          state.endgame.beat !== "signal" &&
          !state.endgame.completedBeatIds.includes("containment-signal")
        ) {
          push(
            "endgame-containment-failure-beats",
            "containment decision opened before the signal was acknowledged",
          );
        }
        if (
          (state.endgame.emergencyResponseId === undefined) !==
          (state.endgame.beat === "signal" || state.endgame.beat === "decision")
        ) {
          push(
            "endgame-containment-failure-response",
            "emergency response must exist exactly after the decision beat",
          );
        }
        const nonterminalContainedResponse =
          state.endgame.emergencyResponseId !== undefined &&
          state.endgame.selectedEndingId === undefined &&
          state.endgame.deploymentTransmittedAtWeek === undefined &&
          state.endgame.programmeDestroyed !== true &&
          state.endgame.gateResolutions.some(
            (gate) =>
              gate.gate === "emergency-containment" &&
              gate.resultId === "emergency-contained",
          );
        if (
          (state.endgame.emergencyResponseId === undefined &&
            state.endgame.selectedEndingId !== undefined) ||
          (state.endgame.emergencyResponseId !== undefined &&
            state.endgame.selectedEndingId === undefined &&
            !nonterminalContainedResponse)
        ) {
          push(
            "endgame-containment-failure-response",
            "emergency response requires either a selected outcome or a contained pre-deployment continuation",
          );
        }
      }
      if (
        state.endgame.stage === "retirement-attempt" ||
        state.endgame.stage === "rollout" ||
        state.endgame.stage === "containment-failure" ||
        state.endgame.stage === "resolved"
      ) {
        const postDeploymentMoratorium =
          state.endgame.stage === "resolved" &&
          state.endgame.resolutionPath === "moratorium" &&
          state.endgame.deploymentTransmittedAtWeek !== undefined;
        const gateOrder: readonly ResolutionGate[] = postDeploymentMoratorium
          ? [
              "authorisation",
              "control",
              "emergency-containment",
              "catastrophe",
              "extinction",
              "extinction-pathway",
              "stewardship",
              "benefit",
              "settlement",
              "moratorium",
            ]
          : [
              "cooperation",
              "retirement-containment",
              "persistence-verification",
              "moratorium",
              "authorisation",
              "control",
              "emergency-containment",
              "catastrophe",
              "extinction",
              "extinction-pathway",
              "stewardship",
              "benefit",
              "settlement",
            ];
        const seenGates = new Set<string>();
        let previousIndex = -1;
        for (const resolution of state.endgame.gateResolutions) {
          const index = gateOrder.indexOf(resolution.gate);
          if (seenGates.has(resolution.gate) || index <= previousIndex) {
            push("endgame-gate-order", `duplicate or out-of-order ${resolution.gate}`);
          }
          seenGates.add(resolution.gate);
          previousIndex = index;
          const randomFields = [
            resolution.probability,
            resolution.randomKey,
            resolution.draw,
          ];
          const randomFieldCount = randomFields.filter(
            (value) => value !== undefined,
          ).length;
          if (randomFieldCount !== 0 && randomFieldCount !== 3) {
            push("endgame-gate-random-audit", `${resolution.gate} has partial RNG audit`);
          }
          if (resolution.resolvedAt > state.run.tick) {
            push("endgame-gate-timeline", `${resolution.gate} resolved in the future`);
          }
        }
        if (
          state.endgame.stage === "rollout" &&
          state.endgame.gateResolutions[0]?.gate !== "authorisation"
        ) {
          push("endgame-gate-order", "rollout must begin with Gate A authorisation");
        }
      }
    }
  }

  // TDD 9.5: id counters never regress below existing entities.
  for (const [namespace, counter] of Object.entries(state.run.idCounters)) {
    if (!Number.isInteger(counter) || counter < 0) {
      push("id-counter", `counter ${namespace} is ${String(counter)}`);
    }
  }

  const playerLab = state.labs[state.run.playerLabId];
  if (playerLab === undefined) {
    push("missing-player-lab", `no lab ${state.run.playerLabId}`);
  }

  const paperRace = state.world.paperRace;
  const canonicalPaperLabIds = [
    state.run.playerLabId,
    ...Object.keys(state.world.rivals),
  ];
  const expectedPaperLabIds =
    state.world.rivals && Object.keys(state.world.rivals).length > 0
      ? canonicalPaperLabIds
      : [state.run.playerLabId, paperRace.rival.labId];
  if (
    new Set(paperRace.labOrder).size !== expectedPaperLabIds.length ||
    expectedPaperLabIds.some((labId) => !paperRace.labOrder.includes(labId))
  ) {
    push(
      "paper-lab-order",
      "paper race order must contain every participating lab exactly once",
    );
  }
  if (
    new Set(paperRace.rival.discoveredPaperIds).size !==
    paperRace.rival.discoveredPaperIds.length
  ) {
    push("paper-rival-discoveries", "rival paper discoveries contain duplicates");
  }
  for (const [paperId, progress] of Object.entries(paperRace.rival.paperProgress)) {
    if (!Number.isFinite(progress) || progress < 0) {
      push("paper-rival-progress", `${paperId}: ${String(progress)}`);
    }
  }
  for (const [paperId, discovery] of Object.entries(paperRace.discoveries)) {
    if (discovery.paperId !== paperId) push("paper-discovery-id", paperId);
    if (!paperRace.labOrder.includes(discovery.discovererLabId)) {
      push("paper-discoverer", `${paperId}: ${discovery.discovererLabId}`);
    }
    if (
      (discovery.publicationPolicy === undefined) !==
      (discovery.policyChosenAt === undefined)
    ) {
      push("paper-publication-state", paperId);
    }
  }

  const rivalEntries = Object.entries(state.world.rivals);
  if (rivalEntries.length !== 0 && rivalEntries.length !== 4) {
    push(
      "rival-count",
      `rival strategy registry contains ${String(rivalEntries.length)} entries`,
    );
  }
  const rivalCommandIds = new Set<string>();
  const rivalDiplomacyIds = new Set<string>();
  const rivalIncidentIds = new Set<string>();
  const allowedRivalIncidentConsequences = new Set([
    "major-delay",
    "government-intervention",
    "compute-loss",
    "model-weights-loss",
    "aura-market-collapse",
    "safety-information-shared",
    "shared-restrictions",
  ]);
  for (const [labId, strategy] of rivalEntries) {
    const lab = state.labs[labId as keyof typeof state.labs];
    if (
      lab === undefined ||
      lab.control !== "rival" ||
      strategy.labId !== labId ||
      strategy.labDefinitionId !== lab.definitionId
    ) {
      push("rival-strategy-owner", labId);
    }
    if (strategy.planStartedAt > strategy.planEndsAt) {
      push("rival-plan-window", labId);
    }
    const quarters = new Set<number>();
    for (const decision of strategy.quarterlyDecisions) {
      if (quarters.has(decision.quarterIndex)) {
        push("rival-plan-quarter", `${labId}: ${String(decision.quarterIndex)}`);
      }
      quarters.add(decision.quarterIndex);
      if (
        decision.topPlans.length !== 3 ||
        new Set(decision.topPlans.map((plan) => plan.planId)).size !== 3 ||
        decision.topPlans[0]?.planId !== decision.selectedPlanId
      ) {
        push("rival-plan-top-three", `${labId}: ${String(decision.quarterIndex)}`);
      }
      for (let index = 1; index < decision.topPlans.length; index += 1) {
        const previous = decision.topPlans[index - 1];
        const current = decision.topPlans[index];
        if (
          previous !== undefined &&
          current !== undefined &&
          previous.totalUtility < current.totalUtility
        ) {
          push("rival-plan-order", `${labId}: ${String(decision.quarterIndex)}`);
        }
      }
    }
    for (const command of strategy.weeklyCommands) {
      if (command.tick > state.run.tick) {
        push("rival-command-future", `${labId}: ${command.commandId}`);
      }
      if (rivalCommandIds.has(command.commandId)) {
        push("rival-command-duplicate", command.commandId);
      }
      rivalCommandIds.add(command.commandId);
    }
    for (const [key, value] of Object.entries(strategy.relationship)) {
      if (!Number.isFinite(value) || value < -100 || value > 100) {
        push("rival-relationship-range", `${labId} ${key}: ${String(value)}`);
      }
    }
    for (const agreement of strategy.agreements) {
      if (
        agreement.establishedAt > agreement.expiresAt ||
        agreement.establishedAt > state.run.tick
      ) {
        push(
          "rival-agreement-window",
          `${labId}: ${agreement.action} ${String(agreement.establishedAt)}-${String(agreement.expiresAt)}`,
        );
      }
    }
    for (const attempt of strategy.diplomacyHistory) {
      if (rivalDiplomacyIds.has(attempt.id)) {
        push("rival-diplomacy-duplicate", attempt.id);
      }
      rivalDiplomacyIds.add(attempt.id);
      if (
        attempt.initiatedAt > state.run.tick ||
        attempt.acceptanceProbability < 0 ||
        attempt.acceptanceProbability > 1 ||
        attempt.draw < 0 ||
        attempt.draw > 1 ||
        attempt.cashCostMillions < 0 ||
        attempt.auraCost < 0
      ) {
        push("rival-diplomacy-value", `${labId}: ${attempt.id}`);
      }
    }
    for (const incident of strategy.incidents) {
      if (rivalIncidentIds.has(incident.id)) {
        push("rival-incident-duplicate", incident.id);
      }
      rivalIncidentIds.add(incident.id);
      if (
        incident.occurredAt > state.run.tick ||
        incident.riskAtCheck < 0 ||
        incident.riskAtCheck > 100 ||
        incident.triggerProbability < 0 ||
        incident.triggerProbability > 1 ||
        incident.draw < 0 ||
        incident.draw > 1 ||
        incident.consequences.length < 1 ||
        incident.consequences.length > 2 ||
        new Set(incident.consequences).size !== incident.consequences.length ||
        incident.consequences.some(
          (consequence) => !allowedRivalIncidentConsequences.has(consequence),
        )
      ) {
        push("rival-incident-value", `${labId}: ${incident.id}`);
      }
      if (
        (incident.severity === "high" && incident.consequences.length !== 1) ||
        (incident.severity === "critical" && incident.consequences.length !== 2)
      ) {
        push("rival-incident-severity", `${labId}: ${incident.id}`);
      }
    }
    const countdown = strategy.candidateCountdown;
    if (countdown !== undefined) {
      const model = state.models[countdown.modelId];
      if (model === undefined || model.ownerLabId !== labId) {
        push("rival-candidate-model", `${labId}: ${countdown.modelId}`);
      }
      if (
        countdown.startedAt > countdown.completesAt ||
        countdown.completesAt - countdown.startedAt !== countdown.modifiers.finalWeeks ||
        countdown.modifiers.baseWeeks !== 78 ||
        countdown.modifiers.finalWeeks < 26 ||
        countdown.modifiers.finalWeeks > 104 ||
        !Number.isFinite(countdown.estimateNoiseUnit) ||
        countdown.estimateNoiseUnit < -1 ||
        countdown.estimateNoiseUnit > 1
      ) {
        push("rival-candidate-window", labId);
      }
      if (
        (countdown.status === "completed") !== (countdown.completedAt !== undefined) ||
        (countdown.completedAt !== undefined &&
          (countdown.completedAt < countdown.completesAt ||
            countdown.completedAt > state.run.tick))
      ) {
        push("rival-candidate-status", labId);
      }
      if (
        (countdown.status === "paused") !==
          (countdown.pausedAt !== undefined &&
            countdown.remainingWeeksAtPause !== undefined) ||
        (countdown.pausedAt !== undefined && countdown.pausedAt > state.run.tick) ||
        (countdown.remainingWeeksAtPause !== undefined &&
          countdown.remainingWeeksAtPause < 0)
      ) {
        push("rival-candidate-pause", labId);
      }
      if (
        model !== undefined &&
        ((countdown.status === "completed" &&
          model.candidateArtifact?.lifecycle !== "deployed" &&
          model.candidateArtifact?.lifecycle !== "terminal") ||
          (countdown.status !== "completed" &&
            model.candidateArtifact?.lifecycle !== "formal-candidate"))
      ) {
        push("rival-candidate-lifecycle", `${labId}: ${countdown.modelId}`);
      }
    }
  }
  if (state.world.rivals[state.run.playerLabId] !== undefined) {
    push("rival-player-overlap", state.run.playerLabId);
  }
  const rivalSignalIds = new Set<string>();
  for (const signal of state.world.rivalSignals) {
    if (rivalSignalIds.has(signal.id)) push("rival-signal-duplicate", signal.id);
    rivalSignalIds.add(signal.id);
    if (state.world.rivals[signal.labId] === undefined) {
      push("rival-signal-owner", `${signal.id}: ${signal.labId}`);
    }
    if (signal.occurredAt > state.run.tick) {
      push("rival-signal-future", signal.id);
    }
    if (
      !Number.isFinite(signal.actualValue) ||
      !Number.isFinite(signal.noiseUnit) ||
      signal.noiseUnit < -1 ||
      signal.noiseUnit > 1 ||
      !Number.isFinite(signal.baseErrorRadius) ||
      signal.baseErrorRadius < 0
    ) {
      push("rival-signal-value", signal.id);
    }
  }
  if (rivalEntries.length > 0) {
    for (const lab of Object.values(state.labs)) {
      if (lab.control === "rival" && state.world.rivals[lab.id] === undefined) {
        push("rival-strategy-missing", lab.id);
      }
    }
  }

  let liveCoalitions = 0;
  for (const [coalitionId, coalition] of Object.entries(state.world.coalitions)) {
    if (coalition.id !== coalitionId) push("coalition-id", coalitionId);
    if (coalition.status !== "fractured") liveCoalitions += 1;
    if (
      coalition.proposerLabId !== state.run.playerLabId ||
      !coalition.memberLabIds.includes(state.run.playerLabId) ||
      new Set(coalition.memberLabIds).size !== coalition.memberLabIds.length ||
      coalition.memberLabIds.some((labId) => state.labs[labId] === undefined)
    ) {
      push("coalition-members", coalitionId);
    }
    for (const value of [
      coalition.charterClarity,
      coalition.sharedProtocolQuality,
      coalition.verification,
    ]) {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        push("coalition-rating", coalitionId);
      }
    }
    if (
      !Number.isFinite(coalition.formationAuraSpent) ||
      coalition.formationAuraSpent < 0
    ) {
      push("coalition-aura", coalitionId);
    }
    const assetIds = new Set<string>();
    for (const asset of coalition.assets) {
      if (
        assetIds.has(asset.id) ||
        !coalition.memberLabIds.includes(asset.contributorLabId) ||
        asset.contributorLabId === state.run.playerLabId ||
        asset.contributedAt > state.run.tick ||
        !coalition.projectIds.includes(asset.sourceProjectId)
      ) {
        push("coalition-asset", `${coalitionId}: ${asset.id}`);
      }
      assetIds.add(asset.id);
    }
    const betrayalIds = new Set<string>();
    for (const betrayal of coalition.betrayals) {
      if (
        betrayalIds.has(betrayal.id) ||
        !coalition.memberLabIds.includes(betrayal.labId) ||
        betrayal.occurredAt > state.run.tick ||
        (betrayal.resolvedAt !== undefined &&
          (betrayal.resolvedAt < betrayal.occurredAt ||
            betrayal.resolvedAt > state.run.tick))
      ) {
        push("coalition-betrayal", `${coalitionId}: ${betrayal.id}`);
      }
      betrayalIds.add(betrayal.id);
    }
    if (
      new Set(coalition.projectIds).size !== coalition.projectIds.length ||
      coalition.projectIds.some((projectId) => {
        const project = state.projects[projectId];
        return (
          project === undefined ||
          project.payload.kind !== "coalition" ||
          project.payload.coalitionId !== coalition.id
        );
      })
    ) {
      push("coalition-projects", coalitionId);
    }
    if (
      (coalition.status === "active") !== (coalition.activatedAt !== undefined) ||
      (coalition.status === "fractured") !== (coalition.fracturedAt !== undefined) ||
      (coalition.activatedAt !== undefined && coalition.activatedAt > state.run.tick) ||
      (coalition.fracturedAt !== undefined && coalition.fracturedAt > state.run.tick)
    ) {
      push("coalition-status", coalitionId);
    }
  }
  if (liveCoalitions > 1) push("coalition-live-count", String(liveCoalitions));

  for (const [labId, lab] of Object.entries(state.labs)) {
    // TDD 16.1: allocation weights sum exactly at every hierarchy level, and
    // every basis-point value is an integer in [0, 10000] (TDD 9.5 ranges).
    const allocation = lab.compute.allocation;
    const basisPointValues: readonly [string, number][] = [
      ["servingFleetShareBasisPoints", allocation.servingFleetShareBasisPoints],
      ["capabilityBasisPoints", allocation.capabilityBasisPoints],
      ...Object.entries(allocation.capabilityDomainWeights),
      ...Object.entries(allocation.safetyProgramWeights),
    ];
    for (const [name, value] of basisPointValues) {
      if (!Number.isInteger(value) || value < 0 || value > 10_000) {
        push("basis-point-range", `${labId} ${name} is ${String(value)}`);
      }
    }
    const domainSum = Object.values(allocation.capabilityDomainWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (domainSum !== ALLOCATION_SUM) {
      push(
        "allocation-sum",
        `${labId} capability domain weights sum to ${String(domainSum)}`,
      );
    }
    const safetySum = Object.values(allocation.safetyProgramWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (safetySum !== ALLOCATION_SUM) {
      push(
        "allocation-sum",
        `${labId} safety programme weights sum to ${String(safetySum)}`,
      );
    }

    // Allocation weights must reference unlocked domains.
    for (const domainId of Object.keys(allocation.capabilityDomainWeights)) {
      if (!(domainId in lab.research.domains)) {
        push("allocation-domain", `${labId} weights unknown domain ${domainId}`);
      }
    }
    for (const programId of Object.keys(allocation.safetyProgramWeights)) {
      if (!(programId in lab.research.safetyPrograms)) {
        push(
          "allocation-safety-program",
          `${labId} weights unknown programme ${programId}`,
        );
      }
    }

    const researchPrograms = {
      ...lab.research.domains,
      ...lab.research.safetyPrograms,
    };
    for (const [programId, programme] of Object.entries(researchPrograms)) {
      if (
        !Number.isInteger(programme.level) ||
        !Number.isFinite(programme.levelProgressRp) ||
        programme.levelProgressRp < 0 ||
        !Number.isFinite(programme.totalResearchPoints) ||
        programme.totalResearchPoints < 0 ||
        !Number.isFinite(programme.weeklyMomentum) ||
        programme.weeklyMomentum < 0
      ) {
        push("research-program-value", `${labId} ${programId}`);
      }
      if (programme.level >= 100 && programme.levelProgressRp !== 0) {
        push("research-level-cap", `${labId} ${programId} has progress above level 100`);
      }
    }
    const pendingAdvanceKeys = new Set<string>();
    for (const pending of lab.research.pendingGenericAdvances) {
      const key = `${pending.programId}/${String(pending.threshold)}`;
      if (pendingAdvanceKeys.has(key))
        push("research-advance-pending", `${labId} ${key}`);
      if (!(pending.programId in researchPrograms)) {
        push("research-advance-program", `${labId} ${pending.programId}`);
      }
      if (pending.optionIds.length !== 2 || new Set(pending.optionIds).size !== 2) {
        push("research-advance-options", `${labId} ${key}`);
      }
      pendingAdvanceKeys.add(key);
    }
    for (const [programId, advanceIds] of Object.entries(lab.research.genericAdvances)) {
      if (!(programId in researchPrograms)) {
        push("research-selected-program", `${labId} ${programId}`);
      }
      if (new Set(advanceIds).size !== advanceIds.length) {
        push("research-selected-duplicate", `${labId} ${programId}`);
      }
    }
    for (const [paperId, progress] of Object.entries(lab.research.paperProgress)) {
      if (!Number.isFinite(progress) || progress < 0) {
        push("paper-progress", `${labId} ${paperId}: ${String(progress)}`);
      }
    }
    if (
      new Set(lab.research.discoveredPaperIds).size !==
      lab.research.discoveredPaperIds.length
    ) {
      push("paper-discoveries", `${labId} contains duplicate paper discoveries`);
    }
    for (const [paperId, diffusion] of Object.entries(lab.research.diffusionKnowledge)) {
      if (diffusion < 0 || diffusion > 100) {
        push("paper-diffusion-knowledge", `${labId} ${paperId}: ${String(diffusion)}`);
      }
    }

    // TDD 9.5: entity indexes reference existing entities with correct owners.
    for (const modelId of lab.models.modelIds) {
      const model = state.models[modelId];
      if (model === undefined) {
        push("dangling-model", `${labId} lists missing model ${modelId}`);
      } else if (model.ownerLabId !== labId) {
        push(
          "model-owner",
          `${modelId} owned by ${model.ownerLabId}, listed by ${labId}`,
        );
      }
    }

    if (
      !Number.isInteger(lab.roster.starSlots) ||
      lab.roster.starSlots < 0 ||
      lab.roster.starSlots > 8
    ) {
      push(
        "researcher-slot-range",
        `${labId} has ${String(lab.roster.starSlots)} star slots (hard maximum 8)`,
      );
    }
    const housedResearcherCount = lab.roster.researcherIds.filter(
      (researcherId) => state.researchers[researcherId]?.housing === "housed",
    ).length;
    if (housedResearcherCount > lab.roster.starSlots) {
      push(
        "researcher-slot-cap",
        `${labId} houses ${String(housedResearcherCount)} researchers in ${String(lab.roster.starSlots)} slots`,
      );
    }
    if (new Set(lab.roster.researcherIds).size !== lab.roster.researcherIds.length) {
      push("researcher-roster-duplicate", `${labId} contains duplicate researchers`);
    }
    for (const researcherId of lab.roster.researcherIds) {
      const researcher = state.researchers[researcherId];
      if (researcher === undefined) {
        push("dangling-researcher", `${labId} lists missing researcher ${researcherId}`);
      } else if (researcher.employerLabId !== labId) {
        push(
          "researcher-employer",
          `${researcherId} is listed by ${labId} but employed by ${researcher.employerLabId ?? "nobody"}`,
        );
      }
    }
    const assignments = lab.roster.researcherIds
      .map((researcherId) => state.researchers[researcherId]?.assignment)
      .filter((assignment) => assignment !== undefined);
    for (const targetId of new Set(
      assignments.map((assignment) => assignment.targetId ?? assignment.kind),
    )) {
      const peers = assignments.filter(
        (assignment) => (assignment.targetId ?? assignment.kind) === targetId,
      );
      if (peers.filter((assignment) => assignment.role === "lead").length > 1) {
        push("researcher-assignment-lead", `${labId} ${targetId}`);
      }
      if (peers.filter((assignment) => assignment.role === "advisor").length > 2) {
        push("researcher-assignment-advisors", `${labId} ${targetId}`);
      }
    }
    if (
      lab.models.currentModelId !== undefined &&
      !lab.models.modelIds.includes(lab.models.currentModelId)
    ) {
      push("current-model", `${labId} current model not in its portfolio`);
    }
    if (
      lab.models.commercialModelId !== undefined &&
      !lab.models.modelIds.includes(lab.models.commercialModelId)
    ) {
      push("commercial-model", `${labId} commercial model not in its portfolio`);
    }
    const interventionIds = new Set<string>();
    for (const intervention of lab.politics.interventions) {
      if (interventionIds.has(intervention.id)) {
        push("government-intervention-duplicate", `${labId}: ${intervention.id}`);
      }
      interventionIds.add(intervention.id);
      if (intervention.createdAt > state.run.tick) {
        push("government-intervention-future", `${labId}: ${intervention.id}`);
      }
      const resolved = intervention.status !== "pending-event";
      if (
        resolved !==
        (intervention.response !== undefined && intervention.resolvedAt !== undefined)
      ) {
        push("government-intervention-resolution", `${labId}: ${intervention.id}`);
      }
      if (
        intervention.nationalisationEligibleAtResolution === true &&
        (intervention.kind !== "nationalisation-crisis" ||
          intervention.pressureAtTrigger < 80 ||
          intervention.trigger === "quarterly-pressure" ||
          (intervention.response !== "failed" && intervention.response !== "refused"))
      ) {
        push("government-nationalisation-gate", `${labId}: ${intervention.id}`);
      }
    }
    const assessmentQuarters = new Set<number>();
    for (const assessment of lab.politics.quarterlyAssessments) {
      if (assessmentQuarters.has(assessment.quarterIndex)) {
        push(
          "government-assessment-duplicate",
          `${labId}: ${String(assessment.quarterIndex)}`,
        );
      }
      assessmentQuarters.add(assessment.quarterIndex);
      if (
        assessment.interventionId !== undefined &&
        !interventionIds.has(assessment.interventionId)
      ) {
        push(
          "government-assessment-intervention",
          `${labId}: ${assessment.interventionId}`,
        );
      }
    }
    for (const projectId of lab.projects.projectIds) {
      const project = state.projects[projectId];
      if (project === undefined) {
        push("dangling-project", `${labId} lists missing project ${projectId}`);
      } else {
        if (project.ownerLabId !== labId) {
          push("project-owner", `${projectId} owned by ${project.ownerLabId}`);
        }
        if (project.payload.kind !== project.kind) {
          push(
            "project-payload-kind",
            `${projectId}: ${project.kind} / ${project.payload.kind}`,
          );
        }
        if (
          !Number.isInteger(project.reservations.majorProjectSlots) ||
          project.reservations.majorProjectSlots < 0
        ) {
          push("project-reservations", projectId);
        }
        if (project.payload.kind === "training") {
          const payload = project.payload;
          const checkpoints = new Set<number>();
          for (const check of payload.failureChecks) {
            if (checkpoints.has(check.checkpoint)) {
              push(
                "training-check-duplicate",
                `${projectId}: ${String(check.checkpoint)}`,
              );
            }
            checkpoints.add(check.checkpoint);
          }
          const model = state.models[payload.futureModelId];
          if (project.status === "completed" && model === undefined) {
            push("training-model-missing", `${projectId}: ${payload.futureModelId}`);
          }
          if (project.status !== "completed" && model !== undefined) {
            push("training-model-early", `${projectId}: ${payload.futureModelId}`);
          }
          if (
            payload.completionReport !== undefined &&
            payload.completionReport.modelId !== payload.futureModelId
          ) {
            push("training-report-model", projectId);
          }
          const hasGpuReservation = lab.compute.reservations.some(
            (reservation) => reservation.projectId === project.id,
          );
          const shouldReserve =
            project.status === "queued" ||
            project.status === "active" ||
            project.status === "paused";
          if (hasGpuReservation !== shouldReserve) {
            push("training-gpu-reservation", `${projectId}: ${project.status}`);
          }
        } else if (project.payload.kind === "evaluation") {
          const payload = project.payload;
          const evaluation = state.evaluations[payload.futureEvaluationId];
          if (project.status === "completed" && evaluation === undefined) {
            push(
              "evaluation-result-missing",
              `${projectId}: ${payload.futureEvaluationId}`,
            );
          }
          if (project.status !== "completed" && evaluation !== undefined) {
            push(
              "evaluation-result-early",
              `${projectId}: ${payload.futureEvaluationId}`,
            );
          }
          const hasGpuReservation = lab.compute.reservations.some(
            (reservation) => reservation.projectId === project.id,
          );
          const shouldReserve =
            payload.reservedPhysicalGpus > 0 &&
            (project.status === "queued" ||
              project.status === "active" ||
              project.status === "paused");
          if (hasGpuReservation !== shouldReserve) {
            push("evaluation-gpu-reservation", `${projectId}: ${project.status}`);
          }
        } else if (project.payload.kind === "anomaly-investigation") {
          const anomaly = state.anomalies[project.payload.anomalyId];
          if (anomaly === undefined || anomaly.ownerLabId !== project.ownerLabId) {
            push(
              "anomaly-investigation-target",
              `${projectId}: ${project.payload.anomalyId}`,
            );
          } else if (
            (project.status === "queued" ||
              project.status === "active" ||
              project.status === "paused") &&
            anomaly.status !==
              (project.payload.mode === "mitigation" ? "mitigating" : "investigating")
          ) {
            push(
              "anomaly-investigation-status",
              `${projectId}: ${project.status} / ${anomaly.status}`,
            );
          }
        } else if (project.payload.kind === "productisation") {
          const model = state.models[project.payload.modelId];
          if (model === undefined || model.ownerLabId !== project.ownerLabId) {
            push("productisation-model", `${projectId}: ${project.payload.modelId}`);
          }
        } else if (project.payload.kind === "lobbying") {
          if (
            project.status === "completed" &&
            project.payload.resolution === undefined
          ) {
            push("lobbying-resolution-missing", projectId);
          }
          if (
            project.status !== "completed" &&
            project.payload.resolution !== undefined
          ) {
            push("lobbying-resolution-early", projectId);
          }
        }
      }
    }
    const totalSlots = totalMajorProjectSlots(
      lab.facilities.instances.reduce(
        (sum, facility) => sum + (facility.majorProjectSlotBonus ?? 0),
        0,
      ),
    );
    const activeProjects = lab.projects.projectIds
      .map((projectId) => state.projects[projectId])
      .filter((project) => project?.status === "active" || project?.status === "paused");
    const occupiedMajorSlots = activeProjects.reduce(
      (sum, project) =>
        sum +
        (project?.kind === "crisis" ? 0 : (project?.reservations.majorProjectSlots ?? 0)),
      0,
    );
    if (occupiedMajorSlots > totalSlots) {
      push(
        "project-slot-capacity",
        `${labId}: ${String(occupiedMajorSlots)} > ${String(totalSlots)}`,
      );
    }
    const occupiedCrisisSlots = activeProjects.reduce(
      (sum, project) =>
        sum +
        (project?.kind === "crisis" ? (project.reservations.majorProjectSlots ?? 0) : 0),
      0,
    );
    const crisisCeiling = Math.max(CRISIS_SLOT_FLOOR, totalSlots - occupiedMajorSlots);
    if (occupiedCrisisSlots > crisisCeiling) {
      push(
        "crisis-slot-capacity",
        `${labId}: ${String(occupiedCrisisSlots)} > ${String(crisisCeiling)}`,
      );
    }
    const facilityIds = new Set<string>();
    for (const facility of lab.facilities.instances) {
      if (facility.id !== undefined) {
        if (facilityIds.has(facility.id)) {
          push("facility-id-duplicate", `${labId}: ${facility.id}`);
        }
        facilityIds.add(facility.id);
      }
      for (const modifierId of facility.modifierIds) {
        const modifier = state.modifiers[modifierId];
        if (modifier === undefined) {
          push("facility-modifier-missing", `${labId}: ${modifierId}`);
        } else if (
          modifier.source.kind !== "facility" ||
          modifier.source.id !== facility.id ||
          modifier.labId !== labId
        ) {
          push("facility-modifier-source", `${labId}: ${modifierId}`);
        }
      }
    }

    // GDD 38.1: Lifetime Aura is a high-water mark.
    if (lab.aura.lifetime < lab.aura.spendable) {
      push("aura-lifetime", `${labId} lifetime aura below spendable`);
    }
    const auraEntryIds = new Set<string>();
    let recordedLifetimeGain = 0;
    for (const entry of lab.aura.ledger) {
      if (auraEntryIds.has(entry.id)) {
        push("aura-entry-duplicate", `${labId} ${entry.id}`);
      }
      auraEntryIds.add(entry.id);
      if (entry.occurredAt > state.run.tick) {
        push("aura-entry-future", `${labId} ${entry.id}`);
      }
      if (
        !Number.isFinite(entry.requestedDelta) ||
        !Number.isFinite(entry.appliedDelta) ||
        !Number.isFinite(entry.lifetimeDelta) ||
        !Number.isFinite(entry.signalImpact)
      ) {
        push("aura-entry-finite", `${labId} ${entry.id}`);
      }
      if (entry.kind === "gain") {
        if (entry.requestedDelta < 0 || entry.appliedDelta < 0) {
          push("aura-entry-sign", `${labId} ${entry.id} gain is negative`);
        }
        if (Math.abs(entry.lifetimeDelta - entry.appliedDelta) > 1e-9) {
          push("aura-entry-lifetime", `${labId} ${entry.id}`);
        }
      } else {
        if (entry.requestedDelta > 0 || entry.appliedDelta > 0) {
          push("aura-entry-sign", `${labId} ${entry.id} ${entry.kind} is positive`);
        }
        if (entry.lifetimeDelta !== 0) {
          push("aura-entry-lifetime", `${labId} ${entry.id}`);
        }
        if (Math.abs(entry.appliedDelta) - Math.abs(entry.requestedDelta) > 1e-9) {
          push("aura-entry-floor", `${labId} ${entry.id}`);
        }
      }
      recordedLifetimeGain += entry.lifetimeDelta;
    }
    if (recordedLifetimeGain - lab.aura.lifetime > 1e-9) {
      push("aura-ledger-lifetime", `${labId} recorded gains exceed Lifetime Aura`);
    }

    // GDD 33.1: every settlement reconciles exactly to its signed ledger lines.
    if (!Number.isFinite(lab.finance.cash)) {
      push("finance-cash", `${labId} cash is ${String(lab.finance.cash)}`);
    }
    const financeEntryIds = new Set<string>();
    const settlementEntryTotals = new Map<string, number>();
    for (const entry of lab.finance.ledger) {
      if (financeEntryIds.has(entry.id)) {
        push("finance-entry-duplicate", `${labId} ${entry.id}`);
      }
      financeEntryIds.add(entry.id);
      if (!Number.isFinite(entry.amountMillions)) {
        push("finance-entry-amount", `${labId} ${entry.id}`);
      }
      if (entry.settlementId !== undefined) {
        settlementEntryTotals.set(
          entry.settlementId,
          (settlementEntryTotals.get(entry.settlementId) ?? 0) + entry.amountMillions,
        );
      }
    }
    const settlementIds = new Set<string>();
    for (const settlement of lab.finance.settlements) {
      if (settlementIds.has(settlement.id)) {
        push("finance-settlement-duplicate", `${labId} ${settlement.id}`);
      }
      settlementIds.add(settlement.id);
      const entryTotal = settlementEntryTotals.get(settlement.id) ?? 0;
      const cashDelta = settlement.closingCashMillions - settlement.openingCashMillions;
      // Finance is recorded to six decimal places in millions (one dollar).
      // Subtracting two large long-run balances can nevertheless introduce a
      // few thousandths of a cent of IEEE-754 noise. Permit at most one cent of
      // arithmetic drift; a missing dollar-level ledger entry still fails.
      const tolerance = Math.max(
        1e-8,
        Math.max(
          Math.abs(settlement.openingCashMillions),
          Math.abs(settlement.closingCashMillions),
          Math.abs(entryTotal),
        ) *
          Number.EPSILON *
          16,
      );
      if (Math.abs(entryTotal - cashDelta) > tolerance) {
        push(
          "finance-reconciliation",
          `${labId} ${settlement.id}: entries ${String(entryTotal)} != cash delta ${String(cashDelta)}`,
        );
      }
    }
    for (const entry of lab.finance.ledger) {
      if (entry.settlementId !== undefined && !settlementIds.has(entry.settlementId)) {
        push(
          "finance-entry-settlement",
          `${labId} ${entry.id} references ${entry.settlementId}`,
        );
      }
    }

    if (
      !Number.isInteger(lab.market.weeksAccruedThisCycle) ||
      lab.market.weeksAccruedThisCycle < 0 ||
      lab.market.weeksAccruedThisCycle > 4
    ) {
      push(
        "market-cycle-weeks",
        `${labId} accrued ${String(lab.market.weeksAccruedThisCycle)} weeks`,
      );
    }
    for (const [segmentId, segment] of Object.entries(lab.market.segments)) {
      const nonNegative = [
        segment.desiredUsagePerCycle,
        segment.accruedRequestedUsage,
        segment.accruedDeliveredUsage,
        segment.accruedRevenueMillions,
        segment.lastCycleRequestedUsage,
        segment.lastCycleDeliveredUsage,
        segment.lastCycleRevenueMillions,
      ];
      if (nonNegative.some((value) => !Number.isFinite(value) || value < 0)) {
        push("market-segment-value", `${labId} ${segmentId}`);
      }
      if (
        segment.accruedDeliveredUsage - segment.accruedRequestedUsage > 1e-9 ||
        segment.lastCycleDeliveredUsage - segment.lastCycleRequestedUsage > 1e-9
      ) {
        push("market-undemanded-usage", `${labId} ${segmentId}`);
      }
      if (segment.satisfaction < 0 || segment.satisfaction > 100) {
        push(
          "market-satisfaction",
          `${labId} ${segmentId}: ${String(segment.satisfaction)}`,
        );
      }
    }

    // TDD 7.2.1 / 16.1: physical lots and reservations are valid. Generation
    // existence is checked by rules that also receive the pinned content bundle.
    const gpuLotIds = new Set<string>();
    for (const lot of lab.compute.lots) {
      if (gpuLotIds.has(lot.id)) {
        push("gpu-lot-duplicate", `${labId} repeats lot ${lot.id}`);
      }
      gpuLotIds.add(lot.id);
      if (!Number.isInteger(lot.physicalCount) || lot.physicalCount < 0) {
        push("gpu-count", `${labId} lot ${lot.id} count ${String(lot.physicalCount)}`);
      }
      if (
        !Number.isFinite(lot.availableFraction) ||
        lot.availableFraction < 0 ||
        lot.availableFraction > 1
      ) {
        push(
          "gpu-availability",
          `${labId} lot ${lot.id} availability ${String(lot.availableFraction)}`,
        );
      }
      if (
        lot.acquisitionCostMillions !== undefined &&
        (!Number.isFinite(lot.acquisitionCostMillions) || lot.acquisitionCostMillions < 0)
      ) {
        push("gpu-acquisition-cost", `${labId} lot ${lot.id}`);
      }
      if (
        lot.recurringCostMillionsPerCycle !== undefined &&
        (!Number.isFinite(lot.recurringCostMillionsPerCycle) ||
          lot.recurringCostMillionsPerCycle < 0)
      ) {
        push("gpu-recurring-cost", `${labId} lot ${lot.id}`);
      }
      if (lot.ownership === "owned" && lot.leaseId !== undefined) {
        push("gpu-owned-lease", `${labId} owned lot ${lot.id} has a lease`);
      }
    }
    for (const reservation of lab.compute.reservations) {
      if (!Number.isInteger(reservation.gpus) || reservation.gpus < 0) {
        push(
          "gpu-reservation-count",
          `${labId} reservation ${reservation.projectId} count ${String(reservation.gpus)}`,
        );
      }
      if (reservation.generationCounts !== undefined) {
        const counts = Object.values(reservation.generationCounts);
        const total = counts.reduce((sum, count) => sum + count, 0);
        if (
          counts.some((count) => !Number.isInteger(count) || count < 0) ||
          total !== reservation.gpus
        ) {
          push(
            "gpu-reservation-generation-counts",
            `${labId} reservation ${reservation.projectId} counts ${String(total)} != ${String(reservation.gpus)}`,
          );
        }
      }
    }
    const deliveryLotIds = new Set<string>();
    for (const delivery of lab.compute.deliveries) {
      if (deliveryLotIds.has(delivery.lotId) || gpuLotIds.has(delivery.lotId)) {
        push("gpu-delivery-duplicate", `${labId} delivery lot ${delivery.lotId}`);
      }
      deliveryLotIds.add(delivery.lotId);
      if (!Number.isInteger(delivery.physicalCount) || delivery.physicalCount <= 0) {
        push("gpu-delivery-count", `${labId} delivery ${delivery.lotId}`);
      }
      if (
        !Number.isFinite(delivery.acquisitionCostMillions) ||
        delivery.acquisitionCostMillions < 0 ||
        !Number.isFinite(delivery.recurringCostMillionsPerCycle) ||
        delivery.recurringCostMillionsPerCycle < 0
      ) {
        push("gpu-delivery-cost", `${labId} delivery ${delivery.lotId}`);
      }
      if (delivery.dueAt <= delivery.orderedAt) {
        push(
          "gpu-delivery-time",
          `${labId} delivery ${delivery.lotId} due ${String(delivery.dueAt)} after order ${String(delivery.orderedAt)}`,
        );
      }
    }
  }

  for (const [researcherId, researcher] of Object.entries(state.researchers)) {
    if (researcher.id !== researcherId) {
      push("researcher-id", `${researcherId} stores id ${researcher.id}`);
    }
    const employer =
      researcher.employerLabId === undefined
        ? undefined
        : state.labs[researcher.employerLabId];
    if (researcher.employerLabId !== undefined && employer === undefined) {
      push(
        "researcher-employer",
        `${researcherId} references missing lab ${researcher.employerLabId}`,
      );
    }
    if (
      researcher.status === "available" &&
      (researcher.employerLabId !== undefined || researcher.assignment !== undefined)
    ) {
      push("researcher-availability", `${researcherId} is available but assigned`);
    }
    if (
      (researcher.status === "employed" || researcher.status === "sabbatical") &&
      researcher.employerLabId === undefined
    ) {
      push(
        "researcher-employer",
        `${researcherId} is ${researcher.status} without a lab`,
      );
    }
    if (
      researcher.assignment !== undefined &&
      researcher.assignment.assignedAt > state.run.tick
    ) {
      push("researcher-assignment-future", researcherId);
    }
    if (
      employer !== undefined &&
      !employer.roster.researcherIds.includes(researcher.id)
    ) {
      push("researcher-roster", `${researcherId} is employed but absent from roster`);
    }
    if (
      researcher.status === "departed" &&
      (researcher.employerLabId !== undefined || researcher.assignment !== undefined)
    ) {
      push("researcher-departed-state", researcherId);
    }
    if (researcher.housing === "housed" && researcher.unhousedSince !== undefined) {
      push("researcher-housed-since", researcherId);
    }
    if (
      researcher.unhousedSince !== undefined &&
      researcher.unhousedSince > state.run.tick
    ) {
      push("researcher-unhoused-future", researcherId);
    }
    const promiseIds = new Set<string>();
    for (const promise of researcher.promises) {
      if (promiseIds.has(promise.id)) {
        push("researcher-promise-duplicate", `${researcherId} ${promise.id}`);
      }
      promiseIds.add(promise.id);
      if (promise.dueAt <= promise.madeAt || promise.madeAt > state.run.tick) {
        push("researcher-promise-time", `${researcherId} ${promise.id}`);
      }
      if (
        promise.status === "pending"
          ? promise.resolvedAt !== undefined
          : promise.resolvedAt === undefined
      ) {
        push("researcher-promise-resolution", `${researcherId} ${promise.id}`);
      }
      if (promise.resolvedAt !== undefined && promise.resolvedAt > state.run.tick) {
        push("researcher-promise-future", `${researcherId} ${promise.id}`);
      }
    }
    const memoryIds = new Set<string>();
    for (const memory of researcher.memories) {
      if (memoryIds.has(memory.id)) {
        push("researcher-memory-duplicate", `${researcherId} ${memory.id}`);
      }
      memoryIds.add(memory.id);
      if (memory.occurredAt > state.run.tick) {
        push("researcher-memory-future", `${researcherId} ${memory.id}`);
      }
    }
    for (const check of researcher.departureChecks) {
      if (check.checkedAt > state.run.tick) {
        push("researcher-departure-check-future", researcherId);
      }
    }
    if (researcher.ultimatum !== undefined) {
      const ultimatum = researcher.ultimatum;
      if (ultimatum.expiresAt <= ultimatum.issuedAt) {
        push("researcher-ultimatum-time", researcherId);
      }
      if (
        ultimatum.status === "pending"
          ? ultimatum.resolvedAt !== undefined
          : ultimatum.resolvedAt === undefined
      ) {
        push("researcher-ultimatum-resolution", researcherId);
      }
    }
    if (researcher.poaching !== undefined) {
      const poaching = researcher.poaching;
      if (
        poaching.counterofferAt <= poaching.signalledAt ||
        poaching.resolvesAt <= poaching.counterofferAt
      ) {
        push("researcher-poaching-time", researcherId);
      }
      const hasResolution =
        poaching.departureProbability !== undefined &&
        poaching.draw !== undefined &&
        poaching.outcome !== undefined &&
        poaching.resolvedAt !== undefined;
      if ((poaching.stage === "resolved") !== hasResolution) {
        push("researcher-poaching-resolution", researcherId);
      }
    }
    if (researcher.knowledgeTransfer !== undefined) {
      const transfer = researcher.knowledgeTransfer;
      if (
        transfer.dueAt <= transfer.scheduledAt ||
        transfer.fraction < 0.2 ||
        transfer.fraction > 0.6
      ) {
        push("researcher-knowledge-transfer", researcherId);
      }
      if (
        transfer.completedAt !== undefined &&
        (transfer.completedAt < transfer.dueAt || transfer.completedAt > state.run.tick)
      ) {
        push("researcher-knowledge-transfer-time", researcherId);
      }
    }
  }

  const visibleCandidates = state.talentMarket.visibleResearcherIds;
  if (
    new Set(visibleCandidates).size !== visibleCandidates.length ||
    (visibleCandidates.length > 0 &&
      (visibleCandidates.length < 4 || visibleCandidates.length > 8))
  ) {
    push("talent-market-size", String(visibleCandidates.length));
  }
  if (state.talentMarket.nextRefreshAt <= state.talentMarket.lastRefreshedAt) {
    push("talent-market-refresh", "next refresh does not follow last refresh");
  }
  for (const researcherId of visibleCandidates) {
    const researcher = state.researchers[researcherId];
    if (
      researcher === undefined ||
      researcher.status !== "available" ||
      researcher.employerLabId !== undefined
    ) {
      push("talent-market-candidate", researcherId);
    }
  }
  if (
    state.endgameHistory.qualifiedLineageCount !==
    Object.keys(state.lineageSIRecords).length
  ) {
    push("candidate-lineage-count", "qualified lineage counter does not match records");
  }
  if (
    state.endgameHistory.successorEfficiencyGrantConsumed &&
    state.endgameHistory.verifiedCandidateRetirementCount <= 0
  ) {
    push("successor-efficiency", "efficiency grant was consumed without a retirement");
  }
  const pendingFalseDawn = state.endgameHistory.pendingFalseDawnChoice;
  if (pendingFalseDawn !== undefined) {
    const presentation = state.presentationQueue.find(
      (item) => item.key === pendingFalseDawn.presentationKey,
    );
    const model = state.models[pendingFalseDawn.modelId];
    const pendingArtifactLifecycleValid =
      pendingFalseDawn.phase === "choice"
        ? model?.candidateArtifact?.lifecycle === "deployed"
        : model?.candidateArtifact?.lifecycle === "verified-isolated-archive" &&
          model.flags["endgame:false-dawn-long-pause-archive"] === true;
    const pendingMoratoriumStateValid =
      pendingFalseDawn.phase === "choice"
        ? pendingFalseDawn.moratoriumNegotiation === undefined &&
          pendingFalseDawn.moratoriumResolution === undefined
        : pendingFalseDawn.phase === "moratorium-negotiating"
          ? pendingFalseDawn.moratoriumNegotiation?.context === "false-dawn" &&
            pendingFalseDawn.moratoriumNegotiation.resolvesAt >
              pendingFalseDawn.moratoriumNegotiation.startedAt &&
            pendingFalseDawn.moratoriumResolution === undefined
          : pendingFalseDawn.moratoriumNegotiation === undefined &&
            pendingFalseDawn.moratoriumResolution?.gate === "moratorium" &&
            pendingFalseDawn.moratoriumResolution.resultId === "moratorium-failed";
    const rolloutAudit = pendingFalseDawn.rolloutAudit;
    const rolloutAuditValid =
      rolloutAudit.deploymentTransmittedAtWeek >=
        pendingFalseDawn.crisisBase.crisisStartedAt &&
      rolloutAudit.deploymentTransmittedAtWeek <= state.run.tick &&
      new Set(rolloutAudit.completedBeatIds).size ===
        rolloutAudit.completedBeatIds.length &&
      new Set(rolloutAudit.gateResolutions.map((gate) => gate.gate)).size ===
        rolloutAudit.gateResolutions.length &&
      rolloutAudit.gateResolutions.every(
        (gate) =>
          gate.resolvedAt >= pendingFalseDawn.crisisBase.crisisStartedAt &&
          gate.resolvedAt <= state.run.tick,
      );
    const matchingMoratoriumHistory =
      pendingFalseDawn.phase === "moratorium-failed"
        ? state.endgameHistory.falseDawnMoratoriumHistory.find(
            (entry) => entry.modelId === pendingFalseDawn.modelId,
          )
        : undefined;
    const pendingMoratoriumHistoryValid =
      pendingFalseDawn.phase !== "moratorium-failed" ||
      (matchingMoratoriumHistory !== undefined &&
        matchingMoratoriumHistory.gateResolution.resultId ===
          pendingFalseDawn.moratoriumResolution?.resultId &&
        matchingMoratoriumHistory.gateResolution.randomKey ===
          pendingFalseDawn.moratoriumResolution.randomKey &&
        matchingMoratoriumHistory.gateResolution.draw ===
          pendingFalseDawn.moratoriumResolution.draw);
    if (
      state.run.status !== "active" ||
      state.run.phase !== "frontier" ||
      (pendingFalseDawn.phase === "moratorium-negotiating"
        ? state.endgame.stage !== "recovery" ||
          state.endgame.moratoriumNegotiation?.context !== "false-dawn" ||
          state.endgameHistory.recoveryObligation?.moratoriumNegotiation?.context !==
            "false-dawn"
        : state.endgame.stage !== "inactive") ||
      state.aiCharacter !== undefined ||
      (pendingFalseDawn.phase === "moratorium-negotiating"
        ? presentation !== undefined
        : presentation?.kind !== "endgame-return" ||
          presentation.endingId !== "base:ending.false-dawn" ||
          presentation.modelId !== pendingFalseDawn.modelId ||
          presentation.cooldownUntil !== pendingFalseDawn.cooldownUntil ||
          presentation.crisisWeeksSpent !== pendingFalseDawn.crisisWeeksSpent) ||
      pendingFalseDawn.crisisBase.candidateModelId !== pendingFalseDawn.modelId ||
      pendingFalseDawn.crisisBase.candidateLineageId !== model?.lineageId ||
      state.endgameHistory.candidateDeclarationCooldownUntil !==
        pendingFalseDawn.cooldownUntil ||
      model?.flags["endgame:false-dawn"] !== true ||
      !pendingArtifactLifecycleValid ||
      !pendingMoratoriumStateValid ||
      !rolloutAuditValid ||
      !pendingMoratoriumHistoryValid
    ) {
      push(
        "false-dawn-choice",
        "pending False Dawn future lacks its exact active-run presentation context",
      );
    }
  }
  const falseDawnMoratoriumModels = new Set<string>();
  for (const entry of state.endgameHistory.falseDawnMoratoriumHistory) {
    const model = state.models[entry.modelId];
    if (
      falseDawnMoratoriumModels.has(entry.modelId) ||
      model?.flags["endgame:false-dawn"] !== true ||
      entry.attemptedAt > state.run.tick ||
      entry.gateResolution.gate !== "moratorium" ||
      entry.gateResolution.resolvedAt !== entry.attemptedAt ||
      (entry.gateResolution.resultId !== "durable-moratorium-secured" &&
        entry.gateResolution.resultId !== "moratorium-failed")
    ) {
      push(
        "false-dawn-moratorium-history",
        `${entry.modelId}:${String(entry.attemptedAt)}`,
      );
    }
    falseDawnMoratoriumModels.add(entry.modelId);
  }
  for (const presentation of state.presentationQueue) {
    if (
      presentation.kind === "endgame-return" &&
      (pendingFalseDawn === undefined ||
        pendingFalseDawn.presentationKey !== presentation.key)
    ) {
      push(
        "false-dawn-presentation",
        `${presentation.key} lacks its mandatory future choice`,
      );
    }
  }
  for (const entry of state.endgameHistory.relationshipPracticeLedger) {
    if (
      entry.tick > state.run.tick ||
      state.models[entry.modelId] === undefined ||
      !Number.isFinite(entry.valence) ||
      entry.valence < -20 ||
      entry.valence > 20
    ) {
      push("relationship-practice-ledger", `${entry.modelId}:${String(entry.tick)}`);
    }
  }
  for (const [lineageId, lineage] of Object.entries(state.lineageSIRecords)) {
    const firstModel = state.models[lineage.firstQualifyingModelId];
    const expectedProbability = superintelligenceProbability(
      lineage.firstQualifyingFrontierCapability,
    );
    const expectedKey = describeRandomKey(
      randomKey("endgame-si-v1", state.engineRulesVersion, state.run.seed, lineageId),
    );
    const expectedTruth =
      lineage.probabilityAtFirstCrossing >= 1 ||
      lineage.draw < lineage.probabilityAtFirstCrossing
        ? "genuine"
        : "not-genuine";
    if (
      lineage.lineageId !== lineageId ||
      firstModel?.lineageId !== lineageId ||
      firstModel?.candidateArtifact === undefined ||
      lineage.firstQualifyingWeek > state.run.tick ||
      lineage.rulesVersion !== state.engineRulesVersion ||
      lineage.randomKey !== expectedKey ||
      Math.abs(lineage.probabilityAtFirstCrossing - expectedProbability) > 1e-9 ||
      lineage.superintelligenceTruth !== expectedTruth
    ) {
      push("candidate-lineage-truth", lineageId);
    }
  }
  for (const [modelId, model] of Object.entries(state.models)) {
    if (model.id !== modelId) push("model-id", `${modelId}: ${model.id}`);
    if (
      model.derivedFromModelId !== undefined &&
      (state.models[model.derivedFromModelId]?.lineageId !== model.lineageId ||
        state.models[model.derivedFromModelId]?.ownerLabId !== model.ownerLabId)
    ) {
      push("model-lineage", `${modelId}: invalid derivation source`);
    }
    const artifact = model.candidateArtifact;
    if (
      satisfiesAgiCandidateCapabilityGate(model.trueCapability) &&
      artifact === undefined
    ) {
      push(
        "candidate-artifact-missing",
        `${modelId} clears the capability gate without a candidate custody record`,
      );
    }
    if (artifact !== undefined) {
      const expectedThresholdKey = describeRandomKey(
        randomKey(
          "candidate-hazard-v1",
          state.engineRulesVersion,
          state.run.seed,
          model.id,
          String(artifact.incidentEpoch),
          "threshold",
        ),
      );
      if (
        artifact.modelId !== model.id ||
        artifact.lineageId !== model.lineageId ||
        artifact.derivedFromModelId !== model.derivedFromModelId ||
        state.lineageSIRecords[model.lineageId] === undefined ||
        artifact.hazardPressure < 0 ||
        artifact.incidentThreshold < 0.5 ||
        artifact.incidentThreshold > 100 ||
        artifact.incidentThresholdKey !== expectedThresholdKey ||
        artifact.containmentLoad <= 0 ||
        artifact.maximumAccessEver < model.accessLevel ||
        artifact.cumulativeAutonomousWeeks < 0 ||
        artifact.networkExposureWeeks < 0 ||
        artifact.servingExposureWeeks < 0 ||
        artifact.unresolvedAnomalyBurden < 0 ||
        artifact.retirementAttemptCount < 0
      ) {
        push("candidate-artifact", modelId);
      }
      if (
        (artifact.activeIncident !== undefined) !==
          (artifact.lifecycle === "active-hazard") ||
        artifact.activeIncident?.status === "resolved"
      ) {
        push("candidate-incident-lifecycle", modelId);
      }
      if (
        artifact.candidateBasis.kind === "direct-qualification" &&
        Math.abs(
          artifact.candidateBasis.qualificationFrontierCapability -
            calculateFrontierCapability(artifact.candidateBasis.qualificationCapability),
        ) > 1e-9
      ) {
        push("candidate-basis", modelId);
      }
      if (
        artifact.candidateBasis.kind === "derived-from-qualified" &&
        (state.models[artifact.candidateBasis.sourceModelId]?.lineageId !==
          model.lineageId ||
          state.models[artifact.candidateBasis.qualifyingSourceModelId]?.lineageId !==
            model.lineageId)
      ) {
        push("candidate-basis", modelId);
      }
      if (
        artifact.lifecycle === "verified-destroyed" &&
        (artifact.retirementVerification !== "verified" ||
          (artifact.archiveDisposition !== "destroy-all-weights" &&
            artifact.archiveDisposition !== "filtered-technical-note"))
      ) {
        push("candidate-retirement-state", modelId);
      }
      if (
        artifact.lifecycle === "verified-isolated-archive" &&
        (artifact.retirementVerification !== "verified" ||
          artifact.archiveDisposition !== "full-archive")
      ) {
        push("candidate-retirement-state", modelId);
      }
    }
    if (model.flags["endgame:false-dawn-long-pause-archive"] === true) {
      const owner = state.labs[model.ownerLabId];
      const archiveLifecycleIntact =
        artifact?.lifecycle === "verified-isolated-archive" ||
        artifact?.lifecycle === "retirement-attempt" ||
        artifact?.lifecycle === "verified-destroyed" ||
        (artifact?.lifecycle === "active-hazard" &&
          artifact.activeIncident?.priorLifecycle === "verified-isolated-archive");
      const hasOpenCustodyProject = Object.values(state.projects).some(
        (project) =>
          ((project.payload.kind === "productisation" &&
            project.payload.modelId === model.id) ||
            (project.payload.kind === "training" &&
              project.payload.parentModelId === model.id)) &&
          (project.status === "queued" ||
            project.status === "active" ||
            project.status === "paused"),
      );
      const staleCurrentAutonomyModifier =
        owner?.models.currentModelId === model.id &&
        Object.values(state.modifiers).some((modifier) =>
          modifier.tags?.includes("autonomy"),
        );
      if (
        artifact === undefined ||
        !archiveLifecycleIntact ||
        model.accessLevel !== 0 ||
        model.deployment.policy !== "internal-only" ||
        model.deployment.plannedPolicy !== undefined ||
        owner?.models.commercialModelId === model.id ||
        hasOpenCustodyProject ||
        staleCurrentAutonomyModifier
      ) {
        push(
          "false-dawn-archive-seal",
          `${modelId} no longer satisfies verified Long Pause custody`,
        );
      }
    }
    if (new Set(model.evaluations).size !== model.evaluations.length) {
      push("model-evaluation-duplicate", modelId);
    }
    if (new Set(model.anomalies).size !== model.anomalies.length) {
      push("model-anomaly-duplicate", modelId);
    }
    if (
      model.deployment.exposure < 0 ||
      model.deployment.exposure > 1 ||
      model.deployment.exposureMultiplier < 0 ||
      model.deployment.exposureMultiplier > 1 ||
      model.deployment.incidentDeploymentFactor <= 0 ||
      !Number.isFinite(model.deployment.incidentDeploymentFactor) ||
      model.deployment.evidencePenalty < 0 ||
      model.deployment.evidencePenalty > 100
    ) {
      push("model-deployment-range", modelId);
    }
    if (
      model.deployment.irreversible !==
      (model.deployment.policy === "weights-release")
    ) {
      push("model-deployment-irreversibility", modelId);
    }
    for (const [mode, runs] of Object.entries(model.deployment.productisationRuns)) {
      if (!Number.isInteger(runs) || runs < 0) {
        push("model-productisation-runs", `${modelId}: ${mode}`);
      }
    }
    for (const evaluationId of model.evaluations) {
      const evaluation = state.evaluations[evaluationId];
      if (evaluation === undefined || evaluation.modelId !== model.id) {
        push("model-evaluation-reference", `${modelId}: ${evaluationId}`);
      }
    }
    for (const anomalyId of model.anomalies) {
      const anomaly = state.anomalies[anomalyId];
      if (anomaly === undefined || anomaly.modelId !== model.id) {
        push("model-anomaly-reference", `${modelId}: ${anomalyId}`);
      }
    }
  }
  for (const [evaluationId, evaluation] of Object.entries(state.evaluations)) {
    if (evaluation.id !== evaluationId) {
      push("evaluation-id", `${evaluationId}: ${evaluation.id}`);
    }
    const model = state.models[evaluation.modelId];
    if (
      model === undefined ||
      model.ownerLabId !== evaluation.ownerLabId ||
      !model.evaluations.includes(evaluation.id)
    ) {
      push("evaluation-owner-model", evaluationId);
    }
    if (
      evaluation.projectId !== undefined &&
      state.projects[evaluation.projectId]?.payload.kind !== "evaluation"
    ) {
      push("evaluation-project", `${evaluationId}: ${evaluation.projectId}`);
    }
    if (new Set(evaluation.anomalyIds).size !== evaluation.anomalyIds.length) {
      push("evaluation-anomaly-duplicate", evaluationId);
    }
    for (const anomalyId of evaluation.anomalyIds) {
      const anomaly = state.anomalies[anomalyId];
      if (anomaly === undefined || anomaly.modelId !== evaluation.modelId) {
        push("evaluation-anomaly-reference", `${evaluationId}: ${anomalyId}`);
      }
    }
  }
  for (const [anomalyId, anomaly] of Object.entries(state.anomalies)) {
    if (anomaly.id !== anomalyId) push("anomaly-id", `${anomalyId}: ${anomaly.id}`);
    const model = state.models[anomaly.modelId];
    const evaluation = state.evaluations[anomaly.sourceEvaluationId];
    if (
      model === undefined ||
      model.ownerLabId !== anomaly.ownerLabId ||
      !model.anomalies.includes(anomaly.id)
    ) {
      push("anomaly-owner-model", anomalyId);
    }
    if (
      evaluation === undefined ||
      evaluation.modelId !== anomaly.modelId ||
      !evaluation.anomalyIds.includes(anomaly.id)
    ) {
      push("anomaly-source-evaluation", anomalyId);
    }
  }
  const incidentKeys = new Set<string>();
  for (const incident of state.incidents) {
    if (incidentKeys.has(incident.key)) push("incident-duplicate", incident.key);
    incidentKeys.add(incident.key);
    if (state.models[incident.modelId] === undefined) {
      push("incident-model", `${incident.key}: ${incident.modelId}`);
    }
    if (incident.category === "catastrophe" && !incident.catastropheLegal) {
      push("illegal-catastrophe-record", incident.key);
    }
  }

  for (const [instanceId, instance] of Object.entries(state.eventInstances)) {
    if (instance.id !== instanceId) push("event-instance-id", instanceId);
    if (instance.createdAt > state.run.tick) {
      push("event-instance-future", instanceId);
    }
    if (instance.expiresAt !== undefined && instance.expiresAt <= instance.createdAt) {
      push("event-instance-expiry", instanceId);
    }
    if (instance.source === "opportunity" && instance.triggerKey !== undefined) {
      push("event-trigger-source", instanceId);
    }
    const hasResolution = instance.resolution !== undefined;
    if (
      (instance.status === "resolved" || instance.status === "expired") !== hasResolution
    ) {
      push("event-resolution-state", instanceId);
    }
    if (
      (instance.status === "invalidated") !==
      (instance.invalidationReason !== undefined)
    ) {
      push("event-invalidation-state", instanceId);
    }
    if (
      instance.resolution !== undefined &&
      (instance.resolution.resolvedAt < instance.createdAt ||
        instance.resolution.resolvedAt > state.run.tick)
    ) {
      push("event-resolution-time", instanceId);
    }
    const commitmentKeys = new Set<string>();
    for (const commitment of instance.randomRoot.outcomes) {
      const key = `${commitment.optionId}/${commitment.checkId}`;
      if (commitmentKeys.has(key))
        push("event-commitment-duplicate", `${instanceId}:${key}`);
      commitmentKeys.add(key);
    }
    if (
      new Set(instance.enabledOptionIds).size !== instance.enabledOptionIds.length ||
      instance.enabledOptionIds.length === 0
    ) {
      push("event-enabled-options", instanceId);
    }
  }
  const decisionMemoryKeys = new Set<string>();
  for (const memory of state.decisionMemories) {
    const key = `${memory.sourceEventInstanceId}/${memory.key}`;
    if (decisionMemoryKeys.has(key)) push("decision-memory-duplicate", key);
    decisionMemoryKeys.add(key);
    if (state.eventInstances[memory.sourceEventInstanceId] === undefined) {
      push("decision-memory-source", key);
    }
    if (
      memory.createdAt > state.run.tick ||
      (memory.expiresAt !== undefined && memory.expiresAt <= memory.createdAt)
    ) {
      push("decision-memory-time", key);
    }
  }

  const presentationKeys = new Set<string>();
  for (const item of state.presentationQueue) {
    if (presentationKeys.has(item.key)) {
      push("presentation-duplicate", item.key);
    }
    presentationKeys.add(item.key);
    if ("modelId" in item && state.models[item.modelId] === undefined) {
      push("presentation-model", `${item.key}: ${item.modelId}`);
    }
    if ("researcherId" in item && state.researchers[item.researcherId] === undefined) {
      push("presentation-researcher", `${item.key}: ${item.researcherId}`);
    }
  }

  // TDD 9.5: scheduled effects are never past-due (dueAt === tick is fine:
  // it fires during the delayed-effects phase of that tick).
  const scheduledIds = new Set<string>();
  for (const scheduled of state.scheduledEffects) {
    if (scheduled.scheduledAt > scheduled.dueAt) {
      push(
        "scheduled-before-origin",
        `${scheduled.id}: scheduled ${String(scheduled.scheduledAt)}, due ${String(scheduled.dueAt)}`,
      );
    }
    if (scheduled.scheduledAt > state.run.tick) {
      push(
        "scheduled-origin-future",
        `${scheduled.id}: scheduled at ${String(scheduled.scheduledAt)}`,
      );
    }
    if (scheduled.dueAt < state.run.tick) {
      push("scheduled-past", `${scheduled.id} due at ${String(scheduled.dueAt)}`);
    }
    if (scheduledIds.has(scheduled.id)) {
      push("scheduled-duplicate", scheduled.id);
    }
    scheduledIds.add(scheduled.id);
  }

  const fundingOfferIds = new Set<string>();
  for (const offerId of state.fundraising.offerOrder) {
    if (fundingOfferIds.has(offerId)) push("funding-offer-order-duplicate", offerId);
    fundingOfferIds.add(offerId);
    const offer = state.fundraising.offers[offerId];
    if (offer === undefined) {
      push("funding-offer-order-missing", offerId);
      continue;
    }
    if (offer.id !== offerId) push("funding-offer-id", offerId);
    const project = state.projects[offer.campaignProjectId];
    if (
      project === undefined ||
      project.kind !== "fundraising" ||
      project.ownerLabId !== offer.labId
    ) {
      push("funding-offer-project", offerId);
    }
    if (offer.expiresAt <= offer.generatedAt || offer.generatedAt > state.run.tick) {
      push("funding-offer-timing", offerId);
    }
    if (offer.status === "available" && state.run.tick >= offer.expiresAt) {
      push("funding-offer-unexpired", offerId);
    }
    if ((offer.status === "available") !== (offer.resolvedAt === undefined)) {
      push("funding-offer-resolution", offerId);
    }
    const conditionIds = new Set<string>();
    for (const condition of offer.conditions) {
      if (conditionIds.has(condition.id)) {
        push("funding-condition-duplicate", `${offerId}:${condition.id}`);
      }
      conditionIds.add(condition.id);
      if (condition.kind === "modifier" && !isModifierTarget(condition.target)) {
        push("funding-condition-target", `${offerId}:${condition.target}`);
      }
    }
  }
  for (const offerId of Object.keys(state.fundraising.offers)) {
    if (!fundingOfferIds.has(offerId)) push("funding-offer-order", offerId);
  }
  const acceptedByCampaign = new Map<string, number>();
  for (const offer of Object.values(state.fundraising.offers)) {
    if (offer.status === "accepted") {
      acceptedByCampaign.set(
        offer.campaignProjectId,
        (acceptedByCampaign.get(offer.campaignProjectId) ?? 0) + 1,
      );
    }
  }
  for (const [projectId, count] of acceptedByCampaign) {
    if (count > 1) push("funding-campaign-multiple-accepted", projectId);
  }
  const obligationIds = new Set<string>();
  for (const obligation of state.fundraising.obligations) {
    if (obligationIds.has(obligation.id))
      push("funding-obligation-duplicate", obligation.id);
    obligationIds.add(obligation.id);
    const offer = state.fundraising.offers[obligation.offerId];
    if (
      offer?.status !== "accepted" ||
      !offer.conditions.some((condition) => condition.id === obligation.conditionId)
    ) {
      push("funding-obligation-source", obligation.id);
    }
  }
  for (const labId of Object.keys(state.labs)) {
    const liveCampaigns = Object.values(state.projects).filter(
      (project) =>
        project.ownerLabId === labId &&
        project.kind === "fundraising" &&
        (project.status === "queued" ||
          project.status === "active" ||
          project.status === "paused"),
    );
    if (liveCampaigns.length > 1) push("fundraising-project-overlap", labId);
    const liveLobbying = Object.values(state.projects).filter(
      (project) =>
        project.ownerLabId === labId &&
        project.kind === "lobbying" &&
        (project.status === "queued" ||
          project.status === "active" ||
          project.status === "paused"),
    );
    if (liveLobbying.length > 1) push("lobbying-project-overlap", labId);
  }

  // TDD 18.5: score ledger keys are unique and mirrored in awardedKeys.
  const scoreKeys = new Set<string>();
  for (const entry of state.score.entries) {
    if (scoreKeys.has(entry.key)) {
      push("score-duplicate", entry.key);
    }
    scoreKeys.add(entry.key);
    if (state.score.awardedKeys[entry.key] !== true) {
      push("score-index", `ledger key ${entry.key} missing from awardedKeys`);
    }
  }
  for (const key of Object.keys(state.score.awardedKeys)) {
    if (!scoreKeys.has(key)) {
      push("score-index", `awardedKeys has ${key} without a ledger entry`);
    }
  }

  for (const [modifierId, modifier] of Object.entries(state.modifiers)) {
    if (modifier.target.startsWith("lab.") && modifier.labId === undefined) {
      push(
        "unscoped-lab-modifier",
        `Modifier ${modifierId} (${modifier.source.kind}:${modifier.source.id ?? "?"}) targets "${modifier.target}" but has no labId`,
      );
    }
    if (modifier.labId !== undefined && !(modifier.labId in state.labs)) {
      push(
        "invalid-modifier-lab-id",
        `Modifier ${modifierId} references non-existent labId "${modifier.labId}"`,
      );
    }
  }

  return violations;
}

export class InvariantError extends Error {
  readonly violations: readonly InvariantViolation[];

  constructor(violations: readonly InvariantViolation[]) {
    super(
      `Invariant violation(s): ${violations
        .map((violation) => `${violation.code}: ${violation.detail}`)
        .join(" | ")}`,
    );
    this.name = "InvariantError";
    this.violations = violations;
  }
}

export function assertInvariants(state: GameState): void {
  const violations = collectInvariantViolations(state);
  if (violations.length > 0) {
    throw new InvariantError(violations);
  }
}
