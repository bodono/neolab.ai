import type { ModelId } from "../model/ids.ts";
import type {
  CrisisConfirmationState,
  CrisisStartSnapshotState,
  GameState,
  ModelState,
} from "../model/state.ts";
import type { Tick } from "../model/units.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { DeepMutable } from "../engine/draft.ts";
import { createAiCharacterState } from "./dialogue-registry.ts";
import {
  eligibleProgrammeCandidateModelIds,
  isEligibleProgrammeCandidate,
  isValidFormalProgrammeCandidate,
} from "./candidate-programme.ts";
import { transitionCandidateArtifactLifecycle } from "./candidate-lifecycle.ts";
import { inFlightOrdinaryTrainingProjectIds } from "./training-commitment.ts";

export interface EndgameTrigger {
  readonly kind: "player-agi-candidate";
  readonly modelId: ModelId;
}

function retireStandingAutonomyPrompts(draft: DeepMutable<GameState>): void {
  // Candidate activation replaces the standing Autonomy Programme with the
  // crisis access ladder. Remove legally dead requests at that first phase
  // boundary so they cannot obscure the exact-artifact nomination screen.
  draft.presentationQueue = draft.presentationQueue.filter(
    (item) => item.kind !== "autonomy-unlock",
  );
}

function playerCandidate(
  state: Readonly<GameState>,
  modelId: ModelId,
): Readonly<ModelState> {
  const model = state.models[modelId];
  if (model === undefined || model.ownerLabId !== state.run.playerLabId) {
    throw new Error(`Endgame candidate ${modelId} is not owned by the player`);
  }
  if (
    model.measuredCapability === undefined ||
    !isValidFormalProgrammeCandidate(state, model)
  ) {
    throw new Error(`Endgame candidate ${modelId} lacks confirmed candidate evidence`);
  }
  return model;
}

/** Pure trigger detection. A rival candidate never starts the player's crisis. */
export function detectEndgameTrigger(
  state: Readonly<GameState>,
  effectiveTick: Tick = state.run.tick,
): EndgameTrigger | null {
  if (
    state.run.status !== "active" ||
    (state.endgame.stage !== "inactive" && state.endgame.stage !== "recovery")
  ) {
    return null;
  }
  const modelId = eligibleProgrammeCandidateModelIds(
    state,
    state.run.playerLabId,
    effectiveTick,
  )[0];
  return modelId === undefined ? null : { kind: "player-agi-candidate", modelId };
}

function enterCandidateActivation(
  tx: SimulationTransaction,
  effectiveTick: Tick = tx.read().run.tick,
): void {
  const state = tx.read();
  if (
    state.run.status !== "active" ||
    (state.endgame.stage !== "inactive" && state.endgame.stage !== "recovery")
  ) {
    return;
  }
  if (
    state.endgame.stage === "recovery" &&
    state.endgameHistory.recoveryObligation === undefined
  ) {
    throw new Error("Recovery cannot be interrupted without a durable obligation");
  }
  const eligibleModelIds = eligibleProgrammeCandidateModelIds(
    state,
    state.run.playerLabId,
    effectiveTick,
  );
  if (eligibleModelIds.length === 0) return;
  tx.update((draft) => {
    draft.endgame = {
      stage: "candidate-activation",
      enteredAt: effectiveTick,
      eligibleModelIds: [...eligibleModelIds],
    };
    draft.run.phase = "crisis";
    retireStandingAutonomyPrompts(draft);
    draft.domainLog.push({
      tick: effectiveTick,
      code: `endgame:candidate-activation:${eligibleModelIds.join(",")}`,
    });
  });
  for (const modelId of eligibleModelIds) {
    tx.emit({ kind: "agi-candidate-detected", modelId });
  }
  tx.requestAutoPause("agi-candidate");
}

function createCrisisSnapshot(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
  accessLevel: ModelState["accessLevel"],
): CrisisStartSnapshotState {
  const lab = state.labs[state.run.playerLabId];
  const evidence = model.measuredCapability;
  const artifact = model.candidateArtifact;
  if (lab === undefined || evidence === undefined || artifact === undefined) {
    throw new Error("Cannot snapshot Deployment Crisis without player lab and evidence");
  }
  return {
    capturedAt: state.run.tick,
    candidate: {
      modelId: model.id,
      displayName: model.displayName,
      accessLevel,
      measuredFrontierCapability: evidence.frontierCapability,
      exposure: {
        maximumAccessEver: Math.max(
          artifact.maximumAccessEver,
          accessLevel,
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

export function enterCrisisConfirmation(
  tx: SimulationTransaction,
  trigger: EndgameTrigger,
): void {
  const endgame = tx.read().endgame;
  if (endgame.stage !== "candidate-activation") {
    throw new Error(`Cannot enter Deployment Crisis from ${endgame.stage}`);
  }
  if (!endgame.eligibleModelIds.includes(trigger.modelId)) {
    throw new Error(`Candidate ${trigger.modelId} was not offered for activation`);
  }
  const model = playerCandidate(tx.read(), trigger.modelId);
  // Nomination changes legal status, not systems access. Training leaves a
  // non-zero exposure history, but the crisis must not silently grant the
  // candidate new permissions; a chosen proof, posture, or rollout does that
  // explicitly and records the resulting high-water mark.
  const initialAccess = model.accessLevel;
  const enteredAt = tx.read().run.tick;
  const next: CrisisConfirmationState = {
    stage: "confirmation",
    candidateModelId: model.id,
    candidateLineageId: model.lineageId,
    crisisStartedAt: enteredAt,
    enteredAt,
    startSnapshot: createCrisisSnapshot(tx.read(), model, initialAccess),
    crisisProjectIds: [],
    completedCrisisProjectIds: [],
    capabilityProofHistory: [],
    targetedResponseHistory: [],
    capabilityDisputeCount: 0,
    evidence: {
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
    },
  };
  const aiCharacter = createAiCharacterState(tx.read(), model, initialAccess);
  tx.update((draft) => {
    draft.endgame = structuredClone(next) as DeepMutable<CrisisConfirmationState>;
    draft.run.phase = "crisis";
    // Defensive cleanup for directly constructed activation states and future
    // callers: a formal candidate must never inherit a standing access prompt.
    retireStandingAutonomyPrompts(draft);
    const mutableModel = draft.models[model.id];
    if (mutableModel === undefined)
      throw new Error(`Missing crisis candidate ${model.id}`);
    mutableModel.accessLevel = initialAccess;
    if (mutableModel.candidateArtifact !== undefined) {
      mutableModel.candidateArtifact.maximumAccessEver = Math.max(
        mutableModel.candidateArtifact.maximumAccessEver,
        initialAccess,
      ) as ModelState["accessLevel"];
    }
    draft.aiCharacter = structuredClone(aiCharacter) as DeepMutable<typeof aiCharacter>;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        `${model.displayName} meets the apparent AGI-candidate threshold. ` +
        "Deployment Crisis procedures are now active.",
      category: "narrative",
      source: { kind: "system", id: "endgame.crisis-start" },
      relatedIds: [model.id],
    });
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `endgame:crisis-start:${model.id}`,
    });
  });
  tx.emit({
    kind: "endgame-crisis-started",
    modelId: model.id,
    checkpointTick: enteredAt,
  });
  tx.requestAutoPause("crisis-stage");
}

/** Nominate one currently eligible artifact; nomination and formalisation are atomic. */
export function nominateCandidate(tx: SimulationTransaction, modelId: ModelId): void {
  if (tx.read().endgame.stage === "inactive" || tx.read().endgame.stage === "recovery") {
    enterCandidateActivation(tx);
  }
  const state = tx.read();
  if (state.endgame.stage !== "candidate-activation") {
    throw new Error(`Cannot nominate a candidate from ${state.endgame.stage}`);
  }
  if (!state.endgame.eligibleModelIds.includes(modelId)) {
    throw new Error(`Candidate ${modelId} is not in the activation set`);
  }
  if (inFlightOrdinaryTrainingProjectIds(state, state.run.playerLabId).length > 0) {
    throw new Error(
      "Finish or explicitly abandon the lab's current training programme before formal nomination",
    );
  }
  const model = state.models[modelId];
  if (
    model === undefined ||
    model.ownerLabId !== state.run.playerLabId ||
    !isEligibleProgrammeCandidate(state, model)
  ) {
    throw new Error(`Candidate ${modelId} is no longer eligible for nomination`);
  }
  transitionCandidateArtifactLifecycle(tx, modelId, "formal-candidate");
  enterCrisisConfirmation(tx, { kind: "player-agi-candidate", modelId });
}

export function detectAndEnterDeploymentCrisis(
  tx: SimulationTransaction,
  effectiveTick: Tick = tx.read().run.tick,
): void {
  if (detectEndgameTrigger(tx.read(), effectiveTick) !== null) {
    enterCandidateActivation(tx, effectiveTick);
  }
}
