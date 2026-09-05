import type { GameState } from "../model/state.ts";

export type EndgameClockStopReason =
  | "containment-failure"
  | "false-dawn-future"
  | "final-deployment-decision"
  | "recovery-path-decision"
  | "retirement-unresolved"
  | "world-waiting";

/**
 * A stage transition may auto-pause without stopping the crisis clock.
 * This predicate is reserved for decisions and sealed sequences where another
 * simulation tick would bypass the action that must resolve the state.
 */
export function endgameClockStopReason(
  state: Readonly<Pick<GameState, "endgame" | "endgameHistory" | "run">>,
): EndgameClockStopReason | undefined {
  const endgame = state.endgame;
  if (
    state.endgameHistory.pendingFalseDawnChoice !== undefined &&
    state.endgameHistory.pendingFalseDawnChoice.phase !== "moratorium-negotiating"
  ) {
    return "false-dawn-future";
  }
  if (endgame.stage === "world-waiting") return "world-waiting";
  if (endgame.stage === "containment-failure") return "containment-failure";
  if (endgame.stage === "retirement-attempt") return "retirement-unresolved";
  if (
    endgame.stage === "recovery" &&
    endgame.postRetirementChoice === undefined &&
    state.run.tick >= endgame.recoveryEndsAt
  ) {
    return "recovery-path-decision";
  }
  if (
    endgame.stage === "rollout" &&
    endgame.currentBeat === "settlement" &&
    endgame.awaitingDecision
  ) {
    return "final-deployment-decision";
  }
  return undefined;
}
