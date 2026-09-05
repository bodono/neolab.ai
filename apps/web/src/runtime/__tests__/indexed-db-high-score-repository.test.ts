import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import {
  createHighScoreEntry,
  type HighScoreEntry,
  type NewGameConfig,
} from "@neolab/sim/public";

import { IndexedDbHighScoreRepository } from "../indexed-db-high-score-repository.ts";
import { IndexedDbSaveRepository } from "../indexed-db-save-repository.ts";
import { finalisedState } from "./score-fixture.ts";

const content = loadCompiledContent();

function entry(runId: string, adjustedScore: number, victory = true): HighScoreEntry {
  const base = createHighScoreEntry(
    finalisedState(content, {
      seed: "0123456789abcdef0123456789abcdef",
      difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
      endingId: victory
        ? "base:ending.the-broadly-shared-future"
        : "base:ending.rival-ascendance",
      status: victory ? "won" : "lost",
    }),
    content,
    "2026-07-22T12:00:00.000Z",
  );
  return { ...base, runId, adjustedScore };
}

describe("IndexedDbHighScoreRepository", () => {
  it("maintains independent all-run and winning boards, upserts, and explicitly deletes", async () => {
    const repository = new IndexedDbHighScoreRepository({
      indexedDb: new IDBFactory(),
      databaseName: "high-score-boards",
    });
    await repository.record(entry("run:a", 100));
    await repository.record(entry("run:b", 300, false));
    await repository.record(entry("run:c", 200));
    expect(
      (await repository.list("all-finished-runs")).map((item) => item.runId),
    ).toEqual(["run:b", "run:c", "run:a"]);
    expect((await repository.list("winning-runs")).map((item) => item.runId)).toEqual([
      "run:c",
      "run:a",
    ]);

    await repository.record(entry("run:a", 400));
    expect((await repository.list("winning-runs")).map((item) => item.runId)).toEqual([
      "run:a",
      "run:c",
    ]);
    await repository.delete("run:c");
    expect((await repository.list("winning-runs")).map((item) => item.runId)).toEqual([
      "run:a",
    ]);
    repository.close();
  });

  it("retains a score when the separate save repository deletes the matching save", async () => {
    const factory = new IDBFactory();
    const scores = new IndexedDbHighScoreRepository({
      indexedDb: factory,
      databaseName: "independent-scores",
    });
    const saves = new IndexedDbSaveRepository({
      indexedDb: factory,
      databaseName: "independent-saves",
    });
    const score = entry("run:independent", 500);
    const state = finalisedState(content, {
      seed: "0123456789abcdef0123456789abcdef",
      difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
      endingId: "base:ending.the-broadly-shared-future",
      status: "won",
    });
    await scores.record(score);
    await saves.write({
      state,
      saveId: score.runId,
      slotType: "manual",
      displayName: "Finished run",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T12:00:00.000Z",
    });
    await saves.delete(score.runId);
    expect(await saves.list()).toEqual([]);
    expect(await scores.list("all-finished-runs")).toEqual([
      expect.objectContaining({ runId: score.runId, adjustedScore: 500 }),
    ]);
    scores.close();
    saves.close();
  });
});
