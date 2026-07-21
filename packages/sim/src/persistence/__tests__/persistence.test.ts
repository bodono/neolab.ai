import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { GameState } from "../../model/state.ts";
import { seed128 } from "../../random/seed.ts";
import { createSaveEnvelope, loadSaveEnvelope, SaveLoadError } from "../envelope.ts";
import { stableStringify, stateHash } from "../hash.ts";
import { MemorySaveRepository } from "../repository.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const NOW = "2026-07-21T12:00:00.000Z";

function newState(seedHex: string, leaderId: string): GameState {
  return createNewGame(
    {
      seed: seed128(seedHex),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId(leaderId),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

function advance(state: GameState, ticks: number): GameState {
  let current = state;
  for (let i = 0; i < ticks; i += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

describe("stable hashing", () => {
  it("is key-order independent", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("distinguishes different states", () => {
    const a = newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann");
    const b = advance(a, 1);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});

describe("save envelope", () => {
  it("round-trips a state with checksum verification", () => {
    const state = advance(
      newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"),
      7,
    );
    const envelope = createSaveEnvelope(state, {
      saveId: "manual-1",
      slotType: "manual",
      displayName: "Week 8",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });
    const revived: unknown = JSON.parse(JSON.stringify(envelope));
    const loaded = loadSaveEnvelope(revived);
    expect(stateHash(loaded.state)).toBe(stateHash(state));
    expect(loaded.envelope.slotType).toBe("manual");
  });

  it("rejects tampered payloads via the checksum", () => {
    const state = newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann");
    const envelope = createSaveEnvelope(state, {
      saveId: "tampered",
      slotType: "manual",
      displayName: "x",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });
    const hacked = JSON.parse(JSON.stringify(envelope)) as {
      state: { labs: Record<string, { finance: { cash: number } }> };
    };
    const lab = Object.values(hacked.state.labs)[0];
    if (lab === undefined) throw new Error("lab missing");
    lab.finance.cash = 9999;
    expect(() => loadSaveEnvelope(hacked)).toThrow(SaveLoadError);
    expect(() => loadSaveEnvelope(hacked)).toThrow(/checksum mismatch/);
  });

  it("rejects malformed envelopes with a readable error", () => {
    expect(() => loadSaveEnvelope({ format: "neolab-save" })).toThrow(SaveLoadError);
    expect(() => loadSaveEnvelope("not an object")).toThrow(SaveLoadError);
  });
});

describe("MemorySaveRepository", () => {
  it("writes, lists, loads, exports, imports, and deletes", async () => {
    const repository = new MemorySaveRepository();
    const state = advance(
      newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"),
      3,
    );
    await repository.write({
      state,
      saveId: "auto-1",
      slotType: "autosave",
      displayName: "Autosave",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });

    const listed = await repository.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.slotType).toBe("autosave");

    const loaded = await repository.load("auto-1");
    expect(stateHash(loaded.state)).toBe(stateHash(state));

    const blob = await repository.export("auto-1");
    const other = new MemorySaveRepository();
    const imported = await other.import(blob);
    expect(imported.metadata.saveId).toBe("auto-1");
    const reloaded = await other.load("auto-1");
    expect(stateHash(reloaded.state)).toBe(stateHash(state));

    await repository.delete("auto-1");
    expect(await repository.list()).toHaveLength(0);
    await expect(repository.load("auto-1")).rejects.toThrow(/no save/);
  });

  it("rejects corrupt imports without storing them", async () => {
    const repository = new MemorySaveRepository();
    await expect(
      repository.import(new Blob(["{not json"], { type: "application/json" })),
    ).rejects.toThrow(/not JSON/);
    await expect(
      repository.import(new Blob([JSON.stringify({ format: "neolab-save" })])),
    ).rejects.toThrow(SaveLoadError);
    expect(await repository.list()).toHaveLength(0);
  });
});

describe("replay determinism (Stage 1 exit gate)", () => {
  const CONFIGS: readonly [string, string][] = [
    ["0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"],
    ["0123456789abcdef0123456789abcdef", "base:leader.liang-wenfang"],
    ["fedcba9876543210fedcba9876543210", "base:leader.sam-altmann"],
    ["fedcba9876543210fedcba9876543210", "base:leader.dario-amodeo"],
  ];

  it.each(CONFIGS)(
    "seed %s / %s: save-load mid-run matches an uninterrupted run",
    (seedHex, leaderId) => {
      const start = newState(seedHex, leaderId);

      const uninterrupted = advance(start, 200);

      const half = advance(start, 100);
      const envelope = createSaveEnvelope(half, {
        saveId: "replay",
        slotType: "manual",
        displayName: "halfway",
        contentHash: content.manifest.bundleHash,
        nowIso: NOW,
      });
      const { state: reloaded } = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope)));
      const resumed = advance(reloaded, 100);

      expect(stateHash(resumed)).toBe(stateHash(uninterrupted));
      expect(stableStringify(resumed)).toBe(stableStringify(uninterrupted));
    },
  );
});
