import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import {
  advanceOneTick,
  createSaveEnvelope,
  createNewGame,
  seed128,
  stateHash,
  type NewGameConfig,
} from "@neolab/sim/public";

import { IndexedDbSaveRepository } from "../indexed-db-save-repository.ts";

const content = loadCompiledContent();
const NOW = "2026-07-22T10:00:00.000Z";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
  });
}

function newState() {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
      leaderId: "base:leader.sam-altmann" as NewGameConfig["leaderId"],
      mandateId: "base:mandate.build-the-science" as NewGameConfig["mandateId"],
    },
    content,
  );
}

describe("IndexedDbSaveRepository", () => {
  it("writes through a slot pointer, rotates, lists, exports, imports, and deletes", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbSaveRepository({
      indexedDb: factory,
      databaseName: "repository-round-trip",
    });
    const first = newState();
    const second = advanceOneTick(first, content).state;
    await repository.write({
      state: first,
      saveId: "autosave",
      slotType: "autosave",
      displayName: "OpenBrain Autosave",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });
    await repository.write({
      state: second,
      saveId: "autosave",
      slotType: "autosave",
      displayName: "OpenBrain Autosave",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T10:01:00.000Z",
    });

    expect(await repository.list()).toEqual([
      expect.objectContaining({
        saveId: "autosave",
        createdAtIso: NOW,
        updatedAtIso: "2026-07-22T10:01:00.000Z",
      }),
    ]);
    expect(stateHash((await repository.load("autosave")).state)).toBe(stateHash(second));

    const exported = await repository.export("autosave");
    expect(await exported.text()).not.toContain("\n");
    const importedRepository = new IndexedDbSaveRepository({
      indexedDb: factory,
      databaseName: "repository-import",
    });
    expect((await importedRepository.import(exported)).metadata.saveId).toBe("autosave");
    expect(stateHash((await importedRepository.load("autosave")).state)).toBe(
      stateHash(second),
    );

    await repository.delete("autosave");
    expect(await repository.list()).toEqual([]);
    await expect(repository.load("autosave")).rejects.toThrow(/no save/);
    repository.close();
    importedRepository.close();
  });

  it("leaves the previous slot intact when failure occurs before pointer swap", async () => {
    let failBeforeSwap = false;
    const repository = new IndexedDbSaveRepository({
      indexedDb: new IDBFactory(),
      databaseName: "repository-atomicity",
      beforePointerSwap: () => {
        if (failBeforeSwap) throw new Error("simulated quota failure");
      },
    });
    const first = newState();
    const second = advanceOneTick(first, content).state;
    const request = {
      state: first,
      saveId: "autosave",
      slotType: "autosave" as const,
      displayName: "OpenBrain Autosave",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    };
    await repository.write(request);

    failBeforeSwap = true;
    await expect(
      repository.write({
        ...request,
        state: second,
        nowIso: "2026-07-22T10:01:00.000Z",
      }),
    ).rejects.toThrow(/simulated quota failure/);
    failBeforeSwap = false;

    expect(stateHash((await repository.load("autosave")).state)).toBe(stateHash(first));
    repository.close();
  });

  it("replaces an invalid existing autosave with a new resumable run", async () => {
    const factory = new IDBFactory();
    const databaseName = "repository-poisoned-slot-recovery";
    const repository = new IndexedDbSaveRepository({
      indexedDb: factory,
      databaseName,
    });
    const current = newState();
    await repository.write({
      state: current,
      saveId: "autosave",
      slotType: "autosave",
      displayName: "ClopenAI Autosave",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });

    const invalid = structuredClone(current);
    const invalidRun = invalid.run as unknown as {
      status: "active" | "won" | "lost";
      endingId?: string;
    };
    invalidRun.status = "lost";
    invalidRun.endingId = "base:ending.test";
    const invalidEnvelope = createSaveEnvelope(invalid, {
      saveId: "autosave",
      slotType: "autosave",
      displayName: "Invalid Autosave",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T10:00:30.000Z",
    });

    const openRequest = factory.open(databaseName);
    const database = await requestResult(openRequest);
    const transaction = database.transaction("save-records", "readwrite");
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore("save-records");
    const records = (await requestResult(store.getAll())) as Array<
      Record<string, unknown>
    >;
    const existing = records[0];
    if (existing === undefined) throw new Error("Expected an IndexedDB save record");
    await requestResult(store.put({ ...existing, envelope: invalidEnvelope }));
    await completion;
    database.close();

    await expect(repository.load("autosave")).rejects.toThrow(
      /ended run has no final score/,
    );
    await repository.write({
      state: current,
      saveId: "autosave",
      slotType: "autosave",
      displayName: "ClopenAI Autosave",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T10:01:00.000Z",
    });

    const recovered = await repository.load("autosave");
    expect(recovered.state.run).toMatchObject({ tick: 0, status: "active" });
    expect(recovered.state.score.final).toBeUndefined();
    repository.close();
  });
});
