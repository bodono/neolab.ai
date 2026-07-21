import type { CompiledContent, ContentId } from "@neolab/content-schema";

import type { FinalScoreRecord, ScoreLedgerEntry } from "../model/state.ts";
import type { SimulationTransaction } from "./transaction.ts";

/**
 * Score ledger writes (TDD section 18.5, GDD section 41.5).
 *
 * Score is canonical, deterministic state with NO outgoing modifiers: no
 * economy, research, rival, event, or endgame system may read score to change
 * an outcome. That direction is enforced by lint (engine code cannot import
 * selectors) and by keeping reads in `selectors/score-view.ts`.
 *
 * Every award uses a stable semantic key, e.g.
 * `paper/world-first/paper.transformer`; duplicate keys are rejected so
 * milestones can never be farmed (anti-farming rules in content/scoring.yaml).
 */
export function awardScore(
  tx: SimulationTransaction,
  entry: Omit<ScoreLedgerEntry, "tick">,
): void {
  if (entry.key.trim().length === 0) {
    throw new Error("awardScore: empty semantic key");
  }
  if (!Number.isFinite(entry.amount)) {
    throw new Error(`awardScore(${entry.key}): non-finite amount`);
  }
  const current = tx.read();
  if (current.score.awardedKeys[entry.key] === true) {
    throw new Error(
      `awardScore: duplicate semantic key "${entry.key}" — milestones score once`,
    );
  }
  tx.update((draft) => {
    draft.score.entries.push({
      ...structuredClone(entry),
      tick: draft.run.tick,
    });
    draft.score.awardedKeys[entry.key] = true;
  });
}

/**
 * Ending-time finalisation (difficulty and victory-class multipliers, raw and
 * adjusted totals). Lands with the endgame in S7.8; the signature is frozen
 * now so callers compile against the real contract.
 */
export function finaliseScore(
  _tx: SimulationTransaction,
  _endingId: ContentId,
  _content: CompiledContent,
): FinalScoreRecord {
  throw new Error("finaliseScore: endgame not implemented (implementation-plan S7.8)");
}
