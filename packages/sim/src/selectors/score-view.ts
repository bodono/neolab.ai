import type { GameState, ScoreCategoryId, ScoreLedgerEntry } from "../model/state.ts";

/**
 * Player-visible score projection (TDD section 18.5). Always safe to show:
 * it contains only ledger facts the player already knows. Penalties tied to
 * hidden truth are emitted during ending resolution, never mid-run.
 */
export interface ScoreView {
  readonly scoreVersion: string;
  /** Running sum floored at zero for display (GDD section 41.5). */
  readonly displayTotal: number;
  /** Unfloored running sum, for the ending screen's honesty. */
  readonly runningTotal: number;
  readonly categoryTotals: Readonly<Record<ScoreCategoryId, number>>;
  readonly entries: readonly ScoreLedgerEntry[];
}

const CATEGORY_IDS: readonly ScoreCategoryId[] = [
  "score.scientific-legacy",
  "score.safe-stewardship",
  "score.prosperity-impact",
  "score.institution-building",
  "score.race-operations",
  "score.endgame",
];

export function calculateScoreView(state: GameState): ScoreView {
  const categoryTotals = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<
    ScoreCategoryId,
    number
  >;
  let runningTotal = 0;
  for (const entry of state.score.entries) {
    runningTotal += entry.amount;
    categoryTotals[entry.categoryId] += entry.amount;
  }
  return {
    scoreVersion: state.score.scoreVersion,
    displayTotal: Math.floor(Math.max(0, runningTotal)),
    runningTotal,
    categoryTotals,
    entries: state.score.entries,
  };
}
