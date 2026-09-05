import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type {
  CandidateArchiveDisposition,
  CandidateRecoveryObligationState,
  CrisisRecoveryState,
  GameState,
  ModelState,
} from "../model/state.ts";
import { tick } from "../model/units.ts";

export type ArchiveRecoveryPhase = "containment" | "supervised-rebuild";

const SUCCESSOR_CONTINUITY_BY_DISPOSITION: Readonly<
  Record<CandidateArchiveDisposition, number>
> = {
  "destroy-all-weights": 0,
  "filtered-technical-note": 0.04,
  "full-archive": 0.08,
};

/**
 * Research continuity is an explicit retirement trade-off. Destroying every
 * executable artifact is safest but carries no acceleration; a filtered note
 * preserves half of the maximum benefit, while accepting the custody burden of
 * a sealed full archive preserves the original capped benefit.
 */
export function successorEfficiencyForArchiveDisposition(
  disposition: CandidateArchiveDisposition,
): number {
  return SUCCESSOR_CONTINUITY_BY_DISPOSITION[disposition];
}

export function recoveryStateFromObligation(
  obligation: Readonly<CandidateRecoveryObligationState>,
  enteredAt: number,
): CrisisRecoveryState {
  return {
    ...structuredClone(obligation.recoveryBase),
    stage: "recovery",
    enteredAt: tick(enteredAt),
    retiredModelId: obligation.retiredModelId,
    archiveDisposition: obligation.archiveDisposition,
    recoveryStartedAt: obligation.recoveryStartedAt,
    quarantineEndsAt: obligation.quarantineEndsAt,
    recoveryEndsAt: obligation.recoveryEndsAt,
    contested: obligation.contested,
    retirementGateResolutions: structuredClone(obligation.retirementGateResolutions),
    ...(obligation.postRetirementChoice === undefined
      ? {}
      : { postRetirementChoice: obligation.postRetirementChoice }),
    ...(obligation.moratoriumNegotiation === undefined
      ? {}
      : { moratoriumNegotiation: structuredClone(obligation.moratoriumNegotiation) }),
    ...(obligation.moratoriumResolution === undefined
      ? {}
      : { moratoriumResolution: structuredClone(obligation.moratoriumResolution) }),
  };
}

/** Restore a verified retirement after a temporary candidate-activation interruption. */
export function resumeInterruptedRetirementRecovery(tx: SimulationTransaction): boolean {
  const state = tx.read();
  const obligation = state.endgameHistory.recoveryObligation;
  if (obligation === undefined) return false;
  if (
    state.endgame.stage !== "inactive" &&
    state.endgame.stage !== "candidate-activation"
  ) {
    throw new Error(`Cannot resume retirement recovery from ${state.endgame.stage}`);
  }
  const recovery = recoveryStateFromObligation(obligation, state.run.tick);
  tx.update((draft) => {
    draft.endgame = structuredClone(recovery) as DeepMutable<CrisisRecoveryState>;
    draft.run.phase = "frontier";
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        "The candidate interruption has closed. The outstanding quarantine and supervised rebuild resume without resetting their clocks.",
      category: "narrative",
      source: { kind: "system", id: "endgame.retirement-recovery-resumed" },
      relatedIds: [obligation.retiredModelId],
    });
  });
  tx.requestAutoPause("crisis-stage");
  return true;
}

/**
 * Returns the active phase of a successful candidate archive.
 *
 * The first half is a hard containment and postmortem: no large training or
 * release work. The second half is a supervised rebuild: lower-scale training
 * may resume, while frontier-scale training stays locked. If an allowed run
 * nevertheless qualifies, its candidacy interrupts rather than erases the
 * outstanding recovery obligation.
 */
export function archiveRecoveryPhase(
  state: Readonly<GameState>,
): ArchiveRecoveryPhase | undefined {
  const obligation = state.endgameHistory.recoveryObligation;
  if (obligation === undefined) return undefined;
  return state.run.tick < obligation.quarantineEndsAt
    ? "containment"
    : "supervised-rebuild";
}

/**
 * Verified isolated archives continue to accumulate latent pressure during
 * recovery, but their stable threshold cannot become a new visible incident
 * until custody verification has finished. This defers rather than erases the
 * risk: the accumulated pressure is resolved by the normal hazard processor
 * after the recovery obligation is discharged.
 */
export function shouldDeferArchiveHazardCrossing(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): boolean {
  return (
    state.endgameHistory.recoveryObligation !== undefined &&
    model.ownerLabId === state.run.playerLabId &&
    model.candidateArtifact?.lifecycle === "verified-isolated-archive" &&
    model.candidateArtifact.retirementVerification === "verified"
  );
}
