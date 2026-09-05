import { describe, expect, it } from "vitest";

import type { HighScoreEntry } from "../high-scores.ts";
import {
  HIGH_SCORE_BOARD_LIMIT,
  MemoryHighScoreRepository,
  compareHighScores,
} from "../high-scores.ts";
import { seed128 } from "../../random/seed.ts";
import { contentId } from "@neolab/content-schema";

function score(
  runId: string,
  adjustedScore: number,
  options: {
    readonly victory?: boolean;
    readonly safety?: number;
    readonly prosperity?: number;
    readonly crisisWeeks?: number;
  } = {},
): HighScoreEntry {
  return {
    runId,
    labDefinitionId: contentId("base:lab.openbrain"),
    labName: "OpenBrain",
    leaderDefinitionId: contentId("base:leader.sam-altmann"),
    leaderName: "Stan Altmann",
    endingId: contentId("base:ending.false-dawn"),
    endingName: "False Dawn",
    seed: seed128("0123456789abcdef0123456789abcdef"),
    difficultyId: contentId("base:difficulty.standard"),
    scoreVersion: "score-v1",
    rawScore: adjustedScore,
    adjustedScore,
    categoryTotals: {
      "score.scientific-legacy": 0,
      "score.safe-stewardship": options.safety ?? 0,
      "score.prosperity-impact": options.prosperity ?? 0,
      "score.institution-building": 0,
      "score.race-operations": 0,
      "score.endgame": adjustedScore,
    },
    totalTicks: 100,
    weeksAfterCrisisStart: options.crisisWeeks ?? 10,
    contentHash: "a".repeat(64),
    engineRulesVersion: "0.1.0",
    victory: options.victory ?? true,
    leaderboardEligibility: options.victory === false ? "local-only" : "winning-run",
    recordedAtIso: "2026-07-22T12:00:00.000Z",
  };
}

describe("high-score repositories", () => {
  it("returns only the best 50 per board and replaces an existing run", async () => {
    const repository = new MemoryHighScoreRepository();
    for (let index = 0; index < 55; index += 1) {
      await repository.record(score(`run:${String(index).padStart(2, "0")}`, index));
    }
    const board = await repository.list("all-finished-runs");
    expect(board).toHaveLength(HIGH_SCORE_BOARD_LIMIT);
    expect(board[0]?.adjustedScore).toBe(54);
    expect(board.at(-1)?.adjustedScore).toBe(5);

    await repository.record(score("run:54", 2));
    expect(await repository.list("all-finished-runs")).not.toContainEqual(
      expect.objectContaining({ runId: "run:54" }),
    );
  });

  it("filters the winning board and applies every documented tie break", async () => {
    const repository = new MemoryHighScoreRepository();
    await repository.record(score("run:loss", 1000, { victory: false }));
    await repository.record(score("run:z", 500, { safety: 10, prosperity: 10 }));
    await repository.record(score("run:a", 500, { safety: 20, prosperity: 0 }));
    await repository.record(
      score("run:b", 500, { safety: 20, prosperity: 5, crisisWeeks: 9 }),
    );
    await repository.record(
      score("run:c", 500, { safety: 20, prosperity: 5, crisisWeeks: 8 }),
    );
    await repository.record(
      score("run:aa", 500, { safety: 20, prosperity: 5, crisisWeeks: 8 }),
    );

    expect((await repository.list("winning-runs")).map((entry) => entry.runId)).toEqual([
      "run:aa",
      "run:c",
      "run:b",
      "run:a",
      "run:z",
    ]);
    expect((await repository.list("all-finished-runs"))[0]?.runId).toBe("run:loss");
    expect(compareHighScores(score("run:a", 1), score("run:b", 1))).toBeLessThan(0);
  });
});
