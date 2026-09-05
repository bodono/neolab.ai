import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import type { DeepMutable } from "../draft.ts";
import type { GameState } from "../../model/state.ts";
import { seed128 } from "../../random/seed.ts";
import { calculateScoreView } from "../../selectors/score-view.ts";
import { loadSaveEnvelope, createSaveEnvelope } from "../../persistence/envelope.ts";
import { stateHash } from "../../persistence/hash.ts";
import { advanceOneTick } from "../advance-tick.ts";
import { createNewGame } from "../create-new-game.ts";
import { awardScore, finaliseEndedRun, finaliseScore } from "../score.ts";
import { createTransaction } from "../transaction.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.sam-altmann"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

describe("score rules content", () => {
  it("compiles the canonical categories, multipliers, and ending points", () => {
    expect(content.scoreRules.scoreVersion).toBe("score-v1");
    expect(content.scoreRules.categories).toHaveLength(6);
    expect(content.scoreRules.difficultyMultiplier).toEqual({
      fellowship: 0.75,
      standard: 1.0,
      frontier: 1.25,
      "unhinged-scaling": 1.5,
    });
    expect(content.scoreRules.victoryClassMultiplier).toEqual({
      full: 1.25,
      qualified: 1.1,
      survival: 1.0,
      loss: 1.0,
    });
    expect(
      content.scoreRules.endingBasePoints["base:ending.the-stewardship-compact"],
    ).toBe(11_500);
    expect(
      content.scoreRules.endingBasePoints["base:ending.the-broadly-shared-future"],
    ).toBe(10_000);
    expect(content.scoreRules.endingBasePoints["base:ending.rival-ascendance"]).toBe(0);
  });

  it("new runs carry the content score version", () => {
    expect(newState().score.scoreVersion).toBe("score-v1");
  });
});

describe("awardScore", () => {
  it("appends entries with the current tick and indexes the key", () => {
    const state = newState();
    const tx = createTransaction(state);
    awardScore(tx, {
      key: "paper/world-first/paper.test",
      categoryId: "score.scientific-legacy",
      amount: 800,
      source: { kind: "system", id: "papers" },
      explanationKey: "score.paper.world-first",
    });
    const result = tx.commit({ description: "score" });
    expect(result.state.score.entries).toHaveLength(1);
    expect(result.state.score.entries[0]).toMatchObject({
      key: "paper/world-first/paper.test",
      tick: 0,
      amount: 800,
    });
    expect(result.state.score.awardedKeys["paper/world-first/paper.test"]).toBe(true);
  });

  it("rejects duplicate semantic keys — within one transaction and across saves", () => {
    const state = newState();
    const tx = createTransaction(state);
    const entry = {
      key: "facility/first/facility.data-centre-1",
      categoryId: "score.institution-building" as const,
      amount: 250,
      source: { kind: "system" as const, id: "facilities" },
      explanationKey: "score.facility.first",
    };
    awardScore(tx, entry);
    expect(() => awardScore(tx, entry)).toThrow(/duplicate semantic key/);
    const committed = tx.commit({ description: "score" }).state;

    const later = createTransaction(committed);
    expect(() => awardScore(later, entry)).toThrow(/duplicate semantic key/);
  });

  it("rejects empty keys and non-finite amounts", () => {
    const tx = createTransaction(newState());
    expect(() =>
      awardScore(tx, {
        key: "  ",
        categoryId: "score.endgame",
        amount: 1,
        source: { kind: "system" },
        explanationKey: "x",
      }),
    ).toThrow(/empty semantic key/);
    expect(() =>
      awardScore(tx, {
        key: "ok/key",
        categoryId: "score.endgame",
        amount: Number.NaN,
        source: { kind: "system" },
        explanationKey: "x",
      }),
    ).toThrow(/non-finite/);
  });
});

describe("calculateScoreView", () => {
  it("sums per category, floors the display total, and keeps the raw sum", () => {
    const tx = createTransaction(newState());
    awardScore(tx, {
      key: "a",
      categoryId: "score.scientific-legacy",
      amount: 300,
      source: { kind: "system" },
      explanationKey: "x",
    });
    awardScore(tx, {
      key: "b",
      categoryId: "score.safe-stewardship",
      amount: -2000,
      source: { kind: "ending" },
      explanationKey: "x",
    });
    const state = tx.commit({ description: "score" }).state;
    const view = calculateScoreView(state);
    expect(view.runningTotal).toBe(-1700);
    expect(view.displayTotal).toBe(0);
    expect(view.categoryTotals["score.scientific-legacy"]).toBe(300);
    expect(view.categoryTotals["score.safe-stewardship"]).toBe(-2000);
    expect(view.categoryTotals["score.endgame"]).toBe(0);
    expect(view.scoreVersion).toBe("score-v1");
  });

  it("labels capability-tier awards from their tier instead of the model id", () => {
    const tx = createTransaction(newState());
    awardScore(tx, {
      key: "race/capability-tier-first/1",
      categoryId: "score.race-operations",
      amount: 100,
      source: { kind: "system", id: "run:model:player:0017" },
      explanationKey: "score.capability-tier.first-reached",
    });
    const state = tx.commit({ description: "capability tier score" }).state;

    expect(calculateScoreView(state, content).entries[0]?.explanation).toBe(
      "Reached Tier 1 · Narrow Specialist",
    );
  });
});

describe("score ledger durability and determinism", () => {
  it("survives save round-trip and replays identically", () => {
    const tx = createTransaction(newState());
    awardScore(tx, {
      key: "race/tier-first/1",
      categoryId: "score.race-operations",
      amount: 100,
      source: { kind: "system", id: "tiers" },
      explanationKey: "score.tier.first",
    });
    const scored = tx.commit({ description: "score" }).state;

    const pathA = advanceOneTick(advanceOneTick(scored, content).state, content).state;

    const envelope = createSaveEnvelope(scored, {
      saveId: "score-replay",
      slotType: "manual",
      displayName: "scored",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-21T12:00:00.000Z",
    });
    const { state: reloaded } = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope)));
    const pathB = advanceOneTick(advanceOneTick(reloaded, content).state, content).state;

    expect(stateHash(pathA)).toBe(stateHash(pathB));
    expect(pathB.score.entries).toHaveLength(1);
  });
});

describe("finaliseScore", () => {
  function ended(
    endingId = contentId("base:ending.false-dawn"),
    status: "won" | "lost" = "lost",
  ): GameState {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    state.run.status = status;
    state.run.endingId = endingId;
    return state;
  }

  it("requires a fixed ending, stores exact raw/category/adjusted totals, and rejects a second finalisation", () => {
    const active = createTransaction(newState());
    expect(() =>
      finaliseScore(active, contentId("base:ending.false-dawn"), content),
    ).toThrow(/ending must be fixed/);

    const tx = createTransaction(ended());
    awardScore(tx, {
      key: "science",
      categoryId: "score.scientific-legacy",
      amount: 1000,
      source: { kind: "system", id: "fixture" },
      explanationKey: "score.fixture.science",
    });
    awardScore(tx, {
      key: "penalty",
      categoryId: "score.safe-stewardship",
      amount: -250,
      source: { kind: "ending", id: "base:ending.false-dawn" },
      explanationKey: "score.fixture.penalty",
    });
    expect(finaliseEndedRun(tx, content)).toBe(true);
    expect(tx.read().score.final).toEqual({
      rawScore: 1250,
      adjustedScore: 1250,
      categoryTotals: {
        "score.scientific-legacy": 1000,
        "score.safe-stewardship": -250,
        "score.prosperity-impact": 0,
        "score.institution-building": 0,
        "score.race-operations": 0,
        "score.endgame": 500,
      },
      difficultyMultiplier: 1,
      victoryClassMultiplier: 1,
      leaderboardEligibility: "local-only",
    });
    expect(tx.read().score.entries.at(-1)).toMatchObject({
      key: "ending/base:ending.false-dawn",
      amount: 500,
    });
    expect(finaliseEndedRun(tx, content)).toBe(false);
    expect(() => finaliseScore(tx, contentId("base:ending.false-dawn"), content)).toThrow(
      /already been finalised/,
    );
    expect(() => tx.commit({ description: "final score" })).not.toThrow();
  });

  it("applies authored difficulty and full-victory multipliers with the mandated floor", () => {
    const state = structuredClone(
      ended(contentId("base:ending.the-broadly-shared-future"), "won"),
    ) as DeepMutable<GameState>;
    state.run.difficultyId = contentId("base:difficulty.frontier");
    const tx = createTransaction(state);
    awardScore(tx, {
      key: "odd",
      categoryId: "score.scientific-legacy",
      amount: 1,
      source: { kind: "system" },
      explanationKey: "score.fixture.odd",
    });
    finaliseEndedRun(tx, content);
    expect(tx.read().score.final).toMatchObject({
      rawScore: 10_001,
      adjustedScore: 15_626,
      difficultyMultiplier: 1.25,
      victoryClassMultiplier: 1.25,
      leaderboardEligibility: "winning-run",
    });
  });
});
