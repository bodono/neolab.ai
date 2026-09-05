import type { CompiledContent, ContentId } from "@neolab/content-schema";

import type { GameCommand } from "../commands/types.ts";
import { getEndingDefinition } from "../endgame/endings.ts";
import type { GameState, ScoreCategoryId } from "../model/state.ts";
import type { Seed128 } from "../random/seed.ts";

export type HighScoreBoard = "all-finished-runs" | "winning-runs";

/** Durable, content-independent summary retained after its save is deleted. */
export interface HighScoreEntry {
  readonly runId: string;
  readonly labDefinitionId: ContentId;
  readonly labName: string;
  readonly leaderDefinitionId: ContentId;
  readonly leaderName: string;
  readonly endingId: ContentId;
  readonly endingName: string;
  readonly seed: Seed128;
  readonly difficultyId: ContentId;
  readonly scoreVersion: string;
  readonly rawScore: number;
  readonly adjustedScore: number;
  readonly categoryTotals: Readonly<Record<ScoreCategoryId, number>>;
  readonly totalTicks: number;
  readonly weeksAfterCrisisStart: number;
  readonly contentHash: string;
  readonly engineRulesVersion: string;
  readonly victory: boolean;
  readonly leaderboardEligibility: "winning-run" | "local-only" | "ineligible";
  /** Caller-injected wall time; never enters canonical simulation state. */
  readonly recordedAtIso: string;
}

/** Command-log shape reserved for a future replay-verifying service. */
export interface LoggedCommand {
  readonly sequence: number;
  readonly tick: number;
  readonly command: GameCommand;
}

/**
 * Future wire contract only. No repository or browser code performs network
 * submission in the launch build (TDD §24.7).
 */
export interface LeaderboardSubmissionV1 {
  readonly runId: string;
  readonly playerAlias: string;
  readonly seed: Seed128;
  readonly difficultyId: ContentId;
  readonly scoreVersion: string;
  readonly contentHash: string;
  readonly engineRulesVersion: string;
  readonly commandLog: readonly LoggedCommand[];
  readonly claimedFinalStateHash: string;
  readonly claimedAdjustedScore: number;
}

export interface HighScoreRepository {
  list(board: HighScoreBoard): Promise<HighScoreEntry[]>;
  record(entry: HighScoreEntry): Promise<void>;
  delete(runId: string): Promise<void>;
}

export const HIGH_SCORE_BOARD_LIMIT = 50;

/** Canonical tie-break order from GDD §41.5. */
export function compareHighScores(left: HighScoreEntry, right: HighScoreEntry): number {
  return (
    right.adjustedScore - left.adjustedScore ||
    right.categoryTotals["score.safe-stewardship"] -
      left.categoryTotals["score.safe-stewardship"] ||
    right.categoryTotals["score.prosperity-impact"] -
      left.categoryTotals["score.prosperity-impact"] ||
    left.weeksAfterCrisisStart - right.weeksAfterCrisisStart ||
    (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0)
  );
}

export function entriesForBoard(
  entries: readonly HighScoreEntry[],
  board: HighScoreBoard,
): HighScoreEntry[] {
  return entries
    .filter((entry) => board === "all-finished-runs" || entry.victory)
    .sort(compareHighScores)
    .slice(0, HIGH_SCORE_BOARD_LIMIT)
    .map((entry) => structuredClone(entry));
}

export function createHighScoreEntry(
  state: Readonly<GameState>,
  content: CompiledContent,
  recordedAtIso: string,
): HighScoreEntry {
  const final = state.score.final;
  const endingId = state.run.endingId;
  if (state.run.status === "active" || final === undefined || endingId === undefined) {
    throw new Error("High scores can be created only from a finalised run");
  }
  const lab = state.labs[state.run.playerLabId];
  const labDefinition = lab === undefined ? undefined : content.labs[lab.definitionId];
  if (lab === undefined || labDefinition === undefined) {
    throw new Error("High-score player lab is missing from content");
  }
  const leader = content.leaders[labDefinition.leaderId];
  if (leader === undefined)
    throw new Error(`High-score leader ${labDefinition.leaderId} missing`);
  const ending = getEndingDefinition(endingId);
  return {
    runId: state.run.runId,
    labDefinitionId: labDefinition.id,
    labName: labDefinition.displayName,
    leaderDefinitionId: leader.id,
    leaderName: leader.displayName,
    endingId,
    endingName: ending.displayName,
    seed: state.run.seed,
    difficultyId: state.run.difficultyId,
    scoreVersion: state.score.scoreVersion,
    rawScore: final.rawScore,
    adjustedScore: final.adjustedScore,
    categoryTotals: structuredClone(final.categoryTotals),
    totalTicks: state.run.tick,
    weeksAfterCrisisStart:
      state.endgame.stage === "inactive" || state.endgame.stage === "candidate-activation"
        ? 0
        : Math.max(0, state.run.tick - state.endgame.crisisStartedAt),
    contentHash: content.manifest.bundleHash,
    engineRulesVersion: state.engineRulesVersion,
    victory: state.run.status === "won",
    leaderboardEligibility: final.leaderboardEligibility,
    recordedAtIso,
  };
}

/** In-memory implementation for deterministic runtime and repository tests. */
export class MemoryHighScoreRepository implements HighScoreRepository {
  readonly #entries = new Map<string, HighScoreEntry>();

  list(board: HighScoreBoard): Promise<HighScoreEntry[]> {
    return Promise.resolve(entriesForBoard([...this.#entries.values()], board));
  }

  record(entry: HighScoreEntry): Promise<void> {
    this.#entries.set(entry.runId, structuredClone(entry));
    return Promise.resolve();
  }

  delete(runId: string): Promise<void> {
    this.#entries.delete(runId);
    return Promise.resolve();
  }
}
