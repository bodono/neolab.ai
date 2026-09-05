import type { GameView } from "../runtime/index.ts";

/**
 * Identifies a crisis decision that should interrupt the ordinary dashboard.
 *
 * Confirmation attempts deliberately include their history length: a disputed
 * attempt returns to the same stage, but is a new decision and must not inherit
 * a previous "decide later" dismissal. Once a proof has been committed, its
 * progress belongs in the crisis command room rather than a blocking overlay.
 */
export function crisisDecisionKey(view: GameView): string | undefined {
  if (!view.endgame.active) return undefined;
  const actions = view.endgame.stageActions;
  const prefix = `${view.endgame.candidate?.modelId ?? "candidate-activation"}:${String(view.endgame.crisisStartedAtTick)}`;
  if (actions.kind === "confirmation") {
    if (actions.committed) return undefined;
    return `${prefix}:confirmation:${String(actions.history.length)}`;
  }
  if (actions.kind === "pressure-collision") {
    return `${prefix}:pressure-collision`;
  }
  if (actions.kind === "final-review") {
    return `${prefix}:final-review`;
  }
  if (
    actions.kind === "rollout" &&
    actions.awaitingDecision &&
    actions.currentBeat !== "settlement"
  ) {
    const optionKey = actions.options.map((option) => option.id).join(",");
    return `${prefix}:rollout:${actions.currentBeat}:${optionKey}`;
  }
  return undefined;
}
