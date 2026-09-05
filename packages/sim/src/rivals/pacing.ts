import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import type { GameState } from "../model/state.ts";

/**
 * Rivals need a small structural head start for the race to remain live once
 * a competent player reaches the frontier. Authored difficulty modifiers are
 * deliberately relative to this baseline, leaving Standard as the neutral
 * difficulty definition rather than materialising a modifier in every save.
 */
export const RIVAL_BASELINE_PROGRESS_MULTIPLIER = 1.08;

export function calculateRivalProgressMultiplier(state: Readonly<GameState>): number {
  return (
    RIVAL_BASELINE_PROGRESS_MULTIPLIER *
    resolveModifierValue(state, "world.rival.progress", 1).final
  );
}
