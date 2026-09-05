import { contentId, type CompiledContent, type ContentId } from "@neolab/content-schema";

import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { ModelId } from "../model/ids.ts";
import type {
  CrisisBaseState,
  CrisisRolloutState,
  CandidateRecoveryObligationState,
  CrisisWorldWaitingState,
  CrisisRecoveryState,
  FalseDawnRolloutAuditState,
  GameState,
  GateResolutionState,
} from "../model/state.ts";
import { rating, tick } from "../model/units.ts";
import { reconcileAutonomyModifiers } from "../models/autonomy.ts";
import { cancelProject } from "../projects/project-framework.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { FALSE_DAWN_CANDIDATE_COOLDOWN_WEEKS } from "./candidate-programme.ts";
import { transitionCandidateArtifactLifecycle } from "./candidate-lifecycle.ts";
import { recoveryStateFromObligation } from "./archive-recovery.ts";
import {
  MORATORIUM_NEGOTIATION_WEEKS,
  resolveDurableMoratoriumGate,
} from "./moratorium.ts";

export const FALSE_DAWN_ENDING_ID = contentId("base:ending.false-dawn");

export type FalseDawnPath = "successor-programme" | "durable-moratorium";

export type FalseDawnPathResolution =
  { readonly kind: "race-resumed" } | { readonly kind: "moratorium-negotiating" };

export type FalseDawnMoratoriumResolution =
  | { readonly kind: "moratorium-failed" }
  | {
      readonly kind: "moratorium-secured";
      readonly crisisBase: CrisisBaseState;
      readonly rolloutAudit: FalseDawnRolloutAuditState;
      readonly gateResolution: GateResolutionState;
    };

/**
 * A durable Long Pause requires the lab to place every executable copy under
 * verified custody. Once weights have been irreversibly released, describing
 * them as a sealed archive would be false: copies outside the lab still exist.
 */
export function falseDawnMoratoriumBlocker(
  state: Readonly<GameState>,
  modelId: ModelId,
): string | undefined {
  const model = state.models[modelId];
  if (model === undefined) return "The candidate artifact is no longer available";
  if (model.deployment.irreversible) {
    return "These weights have already been released outside the lab. External copies cannot be sealed into a verified Long Pause archive.";
  }
  return undefined;
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

function presentationKeyForFalseDawn(
  endingId: ContentId,
  modelId: ModelId,
  createdAt: number,
): string {
  return `endgame-return:${endingId}:${modelId}:${String(createdAt)}`;
}

function copyFalseDawnRolloutAudit(
  state: Readonly<CrisisRolloutState | CrisisWorldWaitingState>,
): FalseDawnRolloutAuditState {
  const deploymentTransmittedAtWeek = state.deploymentTransmittedAtWeek;
  if (deploymentTransmittedAtWeek === undefined) {
    throw new Error("False Dawn requires a transmitted public deployment record");
  }
  return {
    deploymentModeId: state.deploymentModeId,
    prosperityProgrammeId: state.prosperityProgrammeId,
    deploymentTransmittedAtWeek,
    completedBeatIds: [...state.completedBeatIds],
    gateResolutions: structuredClone(state.gateResolutions),
    finalReviewReport: structuredClone(state.finalReviewReport),
  };
}

/**
 * Persist the handoff back to normal play. False Dawn closes the Deployment
 * Crisis without ending the run, so a transient domain event is not enough:
 * the player must still receive the explanation after a reload.
 */
export function queueNonTerminalOutcomePresentation(
  tx: SimulationTransaction,
  endingId: ContentId,
  modelId: ModelId,
  cooldownUntil: number,
  crisisWeeksSpent: number,
): void {
  tx.update((draft) => {
    const key = presentationKeyForFalseDawn(endingId, modelId, draft.run.tick);
    if (draft.presentationQueue.some((item) => item.key === key)) return;
    draft.presentationQueue.push({
      key,
      kind: "endgame-return",
      attention: "modal",
      endingId,
      modelId,
      createdAt: draft.run.tick,
      cooldownUntil: tick(cooldownUntil),
      crisisWeeksSpent,
    });
  });
}

/**
 * Resolve a public False Dawn as a setback rather than an ending. The exact
 * artifact awaits a mandatory disposition choice. Returning to the race ends
 * its candidacy while leaving the model current, deployable, productisable,
 * evaluable, and useful for ordinary RSI at its pre-nomination access level.
 */
export function resolveNonterminalFalseDawn(tx: SimulationTransaction): void {
  const state = tx.read();
  if (state.endgame.stage !== "rollout" && state.endgame.stage !== "world-waiting") {
    throw new Error("False Dawn requires a completed deployment sequence");
  }
  if (state.run.status !== "active") throw new Error("Run already ended");

  const candidateId = state.endgame.candidateModelId;
  const candidate = state.models[candidateId];
  if (candidate === undefined)
    throw new Error(`False Dawn candidate ${candidateId} missing`);
  if (candidate.candidateArtifact === undefined) {
    throw new Error(`False Dawn candidate ${candidateId} has no custody record`);
  }

  const existingCooldown = state.endgameHistory.candidateDeclarationCooldownUntil ?? 0;
  const cooldownUntil = Math.max(
    existingCooldown,
    state.run.tick + FALSE_DAWN_CANDIDATE_COOLDOWN_WEEKS,
  );
  const crisisWeeksSpent = Math.max(0, state.run.tick - state.endgame.crisisStartedAt);
  const restoredAccess = state.endgame.startSnapshot.candidate.accessLevel;
  const presentationKey = presentationKeyForFalseDawn(
    FALSE_DAWN_ENDING_ID,
    candidateId,
    state.run.tick,
  );
  const crisisBase = copyCrisisBase(state.endgame);
  const rolloutAudit = copyFalseDawnRolloutAudit(state.endgame);

  // Older direct rollout resolution can reach this point before transmission
  // marks the artifact deployed. False Dawn was nevertheless established by a
  // completed public demonstration, so normalize that legal lifecycle first.
  // The mandatory follow-up choice, not this reveal, determines whether these
  // exact weights become an ordinary terminal artifact or a verified archive.
  if (candidate.candidateArtifact.lifecycle !== "deployed") {
    transitionCandidateArtifactLifecycle(tx, candidateId, "deployed");
  }

  tx.update((draft) => {
    const mutableCandidate = draft.models[candidateId];
    if (mutableCandidate === undefined) throw new Error("False Dawn candidate vanished");
    mutableCandidate.flags["agi-candidate"] = false;
    mutableCandidate.flags["near-agi"] = true;
    mutableCandidate.flags["endgame:false-dawn"] = true;
    mutableCandidate.productQuality = rating(
      Math.min(100, mutableCandidate.productQuality + 8),
    );
    mutableCandidate.accessLevel = restoredAccess;

    draft.endgameHistory.candidateDeclarationCooldownUntil = tick(cooldownUntil);
    draft.endgameHistory.pendingFalseDawnChoice = {
      presentationKey,
      phase: "choice",
      crisisBase: structuredClone(crisisBase) as DeepMutable<CrisisBaseState>,
      rolloutAudit: structuredClone(
        rolloutAudit,
      ) as DeepMutable<FalseDawnRolloutAuditState>,
      modelId: candidateId,
      cooldownUntil: tick(cooldownUntil),
      crisisWeeksSpent,
    };
    draft.endgame = { stage: "inactive" };
    draft.run.phase = "frontier";
    delete draft.aiCharacter;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        `FALSE DAWN: ${mutableCandidate.displayName} was not superintelligence. ` +
        `Its exact future now requires a lab decision, and no new candidate may be announced ` +
        `for ${String(FALSE_DAWN_CANDIDATE_COOLDOWN_WEEKS)} weeks.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.false-dawn-return" },
      relatedIds: [candidateId, FALSE_DAWN_ENDING_ID],
    });
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `endgame:false-dawn:${candidateId}:cooldown-until:${String(cooldownUntil)}`,
    });
  });

  queueNonTerminalOutcomePresentation(
    tx,
    FALSE_DAWN_ENDING_ID,
    candidateId,
    cooldownUntil,
    crisisWeeksSpent,
  );
  tx.requestAutoPause("crisis-stage");
}

/** Resolve the mandatory future choice shown after a public False Dawn. */
export function chooseFalseDawnPath(
  tx: SimulationTransaction,
  content: CompiledContent,
  presentationKey: string,
  path: FalseDawnPath,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): FalseDawnPathResolution {
  const state = tx.read();
  const pending = state.endgameHistory.pendingFalseDawnChoice;
  if (state.run.status !== "active" || state.endgame.stage !== "inactive") {
    throw new Error("False Dawn follow-up requires an active lab outside the crisis");
  }
  if (pending === undefined || pending.presentationKey !== presentationKey) {
    throw new Error("False Dawn follow-up is missing or stale");
  }
  const presentation = state.presentationQueue.find(
    (item) => item.key === presentationKey,
  );
  if (
    presentation?.kind !== "endgame-return" ||
    presentation.endingId !== FALSE_DAWN_ENDING_ID
  ) {
    throw new Error("False Dawn outcome presentation is missing or stale");
  }

  if (path === "durable-moratorium") {
    const blocker = falseDawnMoratoriumBlocker(state, pending.modelId);
    if (blocker !== undefined) throw new Error(blocker);
  }

  if (path === "successor-programme") {
    if (pending.phase === "choice") {
      transitionCandidateArtifactLifecycle(tx, pending.modelId, "terminal");
    }
    tx.update((draft) => {
      draft.presentationQueue = draft.presentationQueue.filter(
        (item) => item.key !== presentationKey,
      );
      delete draft.endgameHistory.pendingFalseDawnChoice;
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          pending.phase === "moratorium-failed"
            ? "The attempted Long Pause failed. The surrendered archive remains sealed while the lab returns to the race under the public 52-week candidacy pause."
            : "After False Dawn, the lab returned to the race. Training may begin immediately; the public 52-week candidacy pause remains in force.",
        category: "narrative",
        source: { kind: "system", id: "endgame.false-dawn-successor-programme" },
        relatedIds: [pending.modelId],
      });
    });
    return { kind: "race-resumed" };
  }

  if (pending.phase === "moratorium-failed") {
    throw new Error(
      "The Long Pause has already failed; acknowledge it to resume the race",
    );
  }

  const internalOnly = content.deployment.policies["internal-only"];
  if (internalOnly === undefined) {
    throw new Error("Internal-only deployment policy is missing from content");
  }
  const replacementCurrentModelId = tx
    .read()
    .labs[tx.read().run.playerLabId]?.models.modelIds.map(
      (modelId) => tx.read().models[modelId],
    )
    .filter(
      (model): model is NonNullable<typeof model> =>
        model !== undefined &&
        model.id !== pending.modelId &&
        model.flags["endgame:false-dawn-long-pause-archive"] !== true &&
        model.candidateArtifact?.lifecycle !== "verified-destroyed" &&
        model.candidateArtifact?.lifecycle !== "verified-isolated-archive" &&
        model.candidateArtifact?.lifecycle !== "retirement-attempt" &&
        model.candidateArtifact?.lifecycle !== "escaped",
    )
    .sort(
      (left, right) =>
        right.trainedAt - left.trainedAt ||
        right.generationIndex - left.generationIndex ||
        (left.id < right.id ? 1 : -1),
    )[0]?.id;
  const custodyProjectIds = Object.values(tx.read().projects)
    .filter(
      (project) =>
        ((project.payload.kind === "productisation" &&
          project.payload.modelId === pending.modelId) ||
          (project.payload.kind === "training" &&
            project.payload.parentModelId === pending.modelId)) &&
        (project.status === "queued" ||
          project.status === "active" ||
          project.status === "paused"),
    )
    .map((project) => project.id);
  for (const projectId of custodyProjectIds) cancelProject(tx, projectId);
  transitionCandidateArtifactLifecycle(tx, pending.modelId, "verified-isolated-archive");
  tx.update((draft) => {
    draft.presentationQueue = draft.presentationQueue.filter(
      (item) => !(item.kind === "autonomy-unlock" && item.modelId === pending.modelId),
    );
    const lab = draft.labs[draft.run.playerLabId];
    const model = draft.models[pending.modelId];
    const artifact = model?.candidateArtifact;
    if (lab === undefined || model === undefined || artifact === undefined) {
      throw new Error("False Dawn archive custody disappeared");
    }
    // The Long Pause is a real stop, not a political lottery with a free
    // fallback. Selecting it seals the weights before negotiations; the
    // archive remains sealed even when rivals refuse the moratorium.
    artifact.maximumAccessEver = Math.max(
      artifact.maximumAccessEver,
      model.accessLevel,
    ) as typeof model.accessLevel;
    model.accessLevel = 0;
    model.deployment.policy = "internal-only";
    delete model.deployment.plannedPolicy;
    model.deployment.exposure = internalOnly.exposure;
    // The preflight blocker proves no external release exists. Keep the
    // archive explicitly reversible rather than pretending a public release
    // was recalled after the fact.
    model.deployment.irreversible = false;
    model.deployment.changedAt = draft.run.tick;
    model.flags["endgame:archived-candidate"] = true;
    model.flags["endgame:false-dawn-long-pause-archive"] = true;
    artifact.archiveDisposition = "full-archive";
    artifact.retirementVerification = "verified";
    delete artifact.activeIncident;
    if (lab.models.commercialModelId === pending.modelId) {
      delete lab.models.commercialModelId;
    }
    if (lab.models.currentModelId === pending.modelId) {
      if (replacementCurrentModelId === undefined) {
        delete lab.models.currentModelId;
      } else {
        lab.models.currentModelId = replacementCurrentModelId;
      }
    }
    if (draft.aiCharacter?.modelId === pending.modelId) delete draft.aiCharacter;
    draft.endgameHistory.relationshipPracticeLedger.push({
      tick: draft.run.tick,
      modelId: pending.modelId,
      kind: "archive",
      detail: "False Dawn Long Pause: sealed full archive",
      valence: 2,
    });
  });
  // The standing Autonomy Programme installs lab-wide research modifiers. The
  // archive cut must revoke those before diplomacy rather than leaving even a
  // transient benefit from weights already surrendered at Access 0.
  reconcileAutonomyModifiers(tx, state.run.playerLabId);

  const negotiation = {
    context: "false-dawn" as const,
    startedAt: tx.read().run.tick,
    resolvesAt: tick(tx.read().run.tick + MORATORIUM_NEGOTIATION_WEEKS),
  };
  const obligation: CandidateRecoveryObligationState = {
    recoveryBase: structuredClone(pending.crisisBase),
    retiredModelId: pending.modelId,
    archiveDisposition: "full-archive",
    recoveryStartedAt: tx.read().run.tick,
    quarantineEndsAt: tx.read().run.tick,
    recoveryEndsAt: tx.read().run.tick,
    contested: false,
    successorEfficiencyRate: 0,
    retirementGateResolutions: [],
    postRetirementChoice: "durable-moratorium",
    moratoriumNegotiation: negotiation,
  };
  const recovery = recoveryStateFromObligation(obligation, tx.read().run.tick);
  tx.update((draft) => {
    const mutablePending = draft.endgameHistory.pendingFalseDawnChoice;
    if (mutablePending === undefined) {
      throw new Error("False Dawn choice disappeared during moratorium setup");
    }
    mutablePending.phase = "moratorium-negotiating";
    mutablePending.moratoriumNegotiation = structuredClone(negotiation);
    draft.presentationQueue = draft.presentationQueue.filter(
      (item) => item.key !== presentationKey,
    );
    draft.endgameHistory.recoveryObligation = structuredClone(
      obligation,
    ) as DeepMutable<CandidateRecoveryObligationState>;
    draft.endgame = structuredClone(recovery) as DeepMutable<CrisisRecoveryState>;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        "After False Dawn, the lab surrendered the candidate and opened an eight-week Long Pause negotiation. Rival, financial, and political clocks continue.",
      category: "narrative",
      source: { kind: "system", id: "endgame.false-dawn-moratorium-negotiation" },
      relatedIds: [pending.modelId],
    });
  });
  tx.requestAutoPause("crisis-stage");
  void content;
  void oracle;
  return { kind: "moratorium-negotiating" };
}

/** Resolve the eight-week diplomatic campaign opened after a False Dawn. */
export function advanceFalseDawnMoratoriumNegotiation(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle,
  effectiveTick: number,
): FalseDawnMoratoriumResolution {
  const state = tx.read();
  const pending = state.endgameHistory.pendingFalseDawnChoice;
  if (
    state.endgame.stage !== "recovery" ||
    state.endgame.moratoriumNegotiation?.context !== "false-dawn" ||
    pending?.phase !== "moratorium-negotiating"
  ) {
    throw new Error("A False Dawn moratorium negotiation is not active");
  }
  const resolution = resolveDurableMoratoriumGate(state, content, oracle, {
    modelId: pending.modelId,
    reviewerIndependence: pending.crisisBase.evidence.reviewerIndependence,
    context: "false-dawn",
    resolvedAt: effectiveTick,
  });
  const failurePresentationKey = presentationKeyForFalseDawn(
    FALSE_DAWN_ENDING_ID,
    pending.modelId,
    effectiveTick,
  );
  tx.update((draft) => {
    const mutablePending = draft.endgameHistory.pendingFalseDawnChoice;
    const lab = draft.labs[draft.run.playerLabId];
    if (mutablePending === undefined || lab === undefined) {
      throw new Error("False Dawn negotiation state disappeared");
    }
    draft.endgameHistory.falseDawnMoratoriumHistory.push({
      modelId: pending.modelId,
      attemptedAt: tick(effectiveTick),
      gateResolution: structuredClone(resolution) as DeepMutable<GateResolutionState>,
    });
    if (resolution.resultId === "durable-moratorium-secured") {
      delete draft.endgameHistory.pendingFalseDawnChoice;
      delete draft.endgameHistory.recoveryObligation;
    } else {
      mutablePending.presentationKey = failurePresentationKey;
      mutablePending.phase = "moratorium-failed";
      delete mutablePending.moratoriumNegotiation;
      mutablePending.moratoriumResolution = structuredClone(
        resolution,
      ) as DeepMutable<GateResolutionState>;
      lab.politics.governmentTrust = rating(
        Math.max(0, lab.politics.governmentTrust - 8),
      );
      lab.politics.governmentAttention = rating(
        Math.min(100, lab.politics.governmentAttention + 10),
      );
      draft.presentationQueue.push({
        key: failurePresentationKey,
        kind: "endgame-return",
        attention: "modal",
        endingId: FALSE_DAWN_ENDING_ID,
        modelId: pending.modelId,
        createdAt: tick(effectiveTick),
        cooldownUntil: pending.cooldownUntil,
        crisisWeeksSpent: pending.crisisWeeksSpent,
      });
      delete draft.endgameHistory.recoveryObligation;
      draft.endgame = { stage: "inactive" };
      draft.run.phase = "frontier";
    }
    draft.decisionLog.push({
      tick: tick(effectiveTick),
      summary:
        resolution.resultId === "durable-moratorium-secured"
          ? "After False Dawn, independent inspectors and governments secured a durable monitored moratorium."
          : "The post-False-Dawn moratorium failed; rivals did not pause in solidarity, and the lab returns to the race under the existing candidacy cooldown.",
      category: "narrative",
      source: { kind: "system", id: "endgame.false-dawn-moratorium" },
      relatedIds: [pending.modelId],
    });
  });
  tx.emit({
    kind: "candidate-moratorium-resolved",
    modelId: pending.modelId,
    success: resolution.resultId === "durable-moratorium-secured",
  });
  tx.requestAutoPause("crisis-stage");
  if (resolution.resultId === "durable-moratorium-secured") {
    return {
      kind: "moratorium-secured",
      crisisBase: structuredClone(pending.crisisBase),
      rolloutAudit: structuredClone(pending.rolloutAudit),
      gateResolution: structuredClone(resolution),
    };
  }
  return { kind: "moratorium-failed" };
}
