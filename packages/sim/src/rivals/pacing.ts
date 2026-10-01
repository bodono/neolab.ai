import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import type { GameState } from "../model/state.ts";

/**
 * Baseline rival research, AGI-works and construction pace. Authored difficulty
 * modifiers are relative to this baseline, leaving Standard as the neutral
 * difficulty definition rather than materialising a modifier in every save.
 *
 * Was 1.08, a structural head start. Cut to 1 on 2026-10-01 to slow the race a
 * little: rivals already gain up to 3x from their off-screen organisation by
 * week 520. Over 30 seeds the rival finish moved from week 938 to 970 and the
 * first rival countdown from week 828 to 853.
 */
export const RIVAL_BASELINE_PROGRESS_MULTIPLIER = 1;

export function calculateRivalProgressMultiplier(state: Readonly<GameState>): number {
  return (
    RIVAL_BASELINE_PROGRESS_MULTIPLIER *
    resolveModifierValue(state, "world.rival.progress", 1).final
  );
}
