import type { loadCompiledContent } from "@neolab/content";
import { createNewGame, seed128, type NewGameConfig } from "@neolab/sim/public";

export function finalisedState(
  content: ReturnType<typeof loadCompiledContent>,
  input: {
    readonly seed: string;
    readonly difficultyId: NewGameConfig["difficultyId"];
    readonly endingId: string;
    readonly status: "won" | "lost";
  },
): ReturnType<typeof createNewGame> {
  const leaderId = Object.keys(content.leaders)[0] as NewGameConfig["leaderId"];
  const mandateId = Object.keys(content.mandates)[0] as NewGameConfig["mandateId"];
  const state = structuredClone(
    createNewGame(
      {
        seed: seed128(input.seed),
        difficultyId: input.difficultyId,
        leaderId,
        mandateId,
      },
      content,
    ),
  );
  const finished: ReturnType<typeof createNewGame> = {
    ...state,
    run: {
      ...state.run,
      status: input.status,
      endingId: input.endingId as NonNullable<typeof state.run.endingId>,
    },
    score: {
      ...state.score,
      entries: [
        {
          key: "fixture",
          tick: state.run.tick,
          categoryId: "score.endgame",
          amount: 100,
          source: { kind: "ending", id: input.endingId },
          explanationKey: "score.fixture",
        },
      ],
      awardedKeys: { fixture: true },
      final: {
        rawScore: 100,
        adjustedScore: 100,
        categoryTotals: {
          "score.scientific-legacy": 0,
          "score.safe-stewardship": 0,
          "score.prosperity-impact": 0,
          "score.institution-building": 0,
          "score.race-operations": 0,
          "score.endgame": 100,
        },
        difficultyMultiplier: 1,
        victoryClassMultiplier: 1,
        leaderboardEligibility: input.status === "won" ? "winning-run" : "local-only",
      },
    },
  };
  return finished;
}
