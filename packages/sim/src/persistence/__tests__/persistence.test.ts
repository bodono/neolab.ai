import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { applyEffect } from "../../engine/effect-executor.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { CommandId, ProjectId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { basisPoints, cashMillions, gpuCount } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { createSaveEnvelope, loadSaveEnvelope, SaveLoadError } from "../envelope.ts";
import { hashJson, stableStringify, stateHash } from "../hash.ts";
import {
  MAX_SAVE_IMPORT_BYTES,
  MemorySaveRepository,
  parseImportedSaveBlob,
} from "../repository.ts";

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

function withCash(state: GameState, cash: number): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("test lab missing");
  lab.finance.cash = cashMillions(cash);
  return draft;
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

  it("round-trips generation and interconnect-pinned GPU reservations", () => {
    const state = structuredClone(
      newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"),
    ) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("test lab missing");
    lab.compute.reservations.push({
      projectId: "project:training" as ProjectId,
      gpus: gpuCount(2000),
      generationCounts: { [contentId("base:gpu.kepler")]: 2000 },
    });
    const envelope = createSaveEnvelope(state, {
      saveId: "reservation",
      slotType: "manual",
      displayName: "Pinned training run",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });

    const loaded = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(loaded.state.labs[state.run.playerLabId]?.compute.reservations[0]).toEqual(
      lab.compute.reservations[0],
    );
  });

  it("round-trips delayed consequences with their event origin and audit trail", () => {
    const tx = createTransaction(
      newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"),
    );
    applyEffect(
      tx,
      {
        kind: "schedule-effects",
        dueInWeeks: 3,
        effects: [
          {
            kind: "set-flag",
            subject: { type: "player-lab" },
            flag: "test:delayed-consequence",
            value: true,
          },
        ],
      },
      { kind: "event", id: "run:event:world:0004" },
    );
    const scheduled = tx.commit({ description: "schedule test consequence" }).state;
    const envelope = createSaveEnvelope(scheduled, {
      saveId: "delayed-event",
      slotType: "manual",
      displayName: "Delayed event",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });

    const loaded = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope))).state;
    expect(stateHash(loaded)).toBe(stateHash(scheduled));
    expect(loaded.scheduledEffects[0]).toMatchObject({
      scheduledAt: 0,
      dueAt: 3,
      source: { kind: "event", id: "run:event:world:0004" },
    });
    expect(loaded.decisionLog.at(-1)).toMatchObject({
      category: "delayed-effect-scheduled",
      source: { kind: "event", id: "run:event:world:0004" },
    });
  });

  it("repairs development saves written before engineering quality was retired", () => {
    // Not backwards compatibility: browser IndexedDB outlives dev-server
    // restarts, so a save written by the previous build of THIS version must
    // strip the retired field before strict validation or it fails to load.
    const state = newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann");
    const staleState = structuredClone(state) as unknown as {
      labs: Record<
        string,
        { organisation: Record<string, unknown>; flags: Record<string, unknown> }
      >;
    };
    for (const lab of Object.values(staleState.labs)) {
      lab.organisation["engineeringQuality"] = 50;
      lab.flags["rating-target:engineeringQuality"] = 50;
    }
    const currentEnvelope = createSaveEnvelope(state, {
      saveId: "retired-engineering-quality",
      slotType: "autosave",
      displayName: "Development autosave",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });
    const staleEnvelope = {
      ...currentEnvelope,
      state: staleState,
      checksum: hashJson(staleState),
    };

    const loaded = loadSaveEnvelope(staleEnvelope);

    expect(loaded.migration.applied).toContain("repair:retired-engineering-quality");
    for (const lab of Object.values(loaded.state.labs)) {
      expect(lab.organisation).not.toHaveProperty("engineeringQuality");
      expect(lab.flags).not.toHaveProperty("rating-target:engineeringQuality");
    }
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
    expect(await blob.text()).not.toContain("\n");
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

  it("rejects oversized imports before reading or parsing their contents", async () => {
    const oversized = new Blob([new Uint8Array(MAX_SAVE_IMPORT_BYTES + 1)]);
    await expect(parseImportedSaveBlob(oversized)).rejects.toThrow(/too large/);
  });

  it("allows legacy pretty-printed saves larger than the old 8 MiB ceiling", async () => {
    const legacyLongRunBytes = 13_290_589;
    const legacySizedInvalidJson = new Blob([new Uint8Array(legacyLongRunBytes)]);
    await expect(parseImportedSaveBlob(legacySizedInvalidJson)).rejects.toThrow(
      /file is not JSON/,
    );
  });
});

describe("replay determinism (Stage 1 exit gate)", () => {
  /** Each case advances 400 full world ticks and hashes two complete terminal states. */
  const LONG_SIMULATION_TIMEOUT_MS = 60_000;
  const CONFIGS: readonly [string, string][] = [
    ["0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"],
    ["0123456789abcdef0123456789abcdef", "base:leader.liang-wenfang"],
    ["fedcba9876543210fedcba9876543210", "base:leader.sam-altmann"],
    ["fedcba9876543210fedcba9876543210", "base:leader.dario-amodeo"],
  ];

  it.each(CONFIGS)(
    "seed %s / %s: save-load mid-run matches an uninterrupted run",
    (seedHex, leaderId) => {
      const start = withCash(newState(seedHex, leaderId), 1000);

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
    LONG_SIMULATION_TIMEOUT_MS,
  );

  it("replays a purchase command and in-transit GPU delivery across save/load", () => {
    const start = withCash(
      newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"),
      1000,
    );
    const purchased = applyCommand(start, content, {
      kind: "buy-gpus",
      meta: {
        commandId: "command:replay-purchase" as CommandId,
        expectedTick: start.run.tick,
        issuedBy: "player",
      },
      labId: start.run.playerLabId,
      generationId: start.world.currentGpuGenerationId,
      thousandUnits: 1,
    }).state;
    const envelope = createSaveEnvelope(purchased, {
      saveId: "purchase-replay",
      slotType: "manual",
      displayName: "Hardware in transit",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });
    const reloaded = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope))).state;

    const uninterrupted = advance(purchased, 60);
    const resumed = advance(reloaded, 60);
    expect(stateHash(resumed)).toBe(stateHash(uninterrupted));
    expect(stableStringify(resumed)).toBe(stableStringify(uninterrupted));
  });

  it("replays a queued allocation command across save/load", () => {
    const start = withCash(
      newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"),
      1000,
    );
    const current = start.labs[start.run.playerLabId]?.compute.allocation;
    if (current === undefined) throw new Error("player allocation missing");
    const queued = applyCommand(start, content, {
      kind: "set-gpu-allocation",
      meta: {
        commandId: "command:replay-allocation" as CommandId,
        expectedTick: start.run.tick,
        issuedBy: "player",
      },
      labId: start.run.playerLabId,
      allocation: {
        ...current,
        servingFleetShareBasisPoints: basisPoints(0),
        capabilityBasisPoints: basisPoints(7_000),
      },
    }).state;
    const envelope = createSaveEnvelope(queued, {
      saveId: "allocation-replay",
      slotType: "manual",
      displayName: "Allocation takes effect next week",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });
    const reloaded = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope))).state;

    const uninterrupted = advance(queued, 20);
    const resumed = advance(reloaded, 20);
    expect(stateHash(resumed)).toBe(stateHash(uninterrupted));
    expect(
      resumed.labs[start.run.playerLabId]?.compute.allocation.capabilityBasisPoints,
    ).toBe(7_000);
  });

  it("replays a pending public-price change across save/load", () => {
    const start = withCash(
      newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"),
      1000,
    );
    const repriced = applyCommand(start, content, {
      kind: "set-public-price",
      meta: {
        commandId: "command:replay-price" as CommandId,
        expectedTick: start.run.tick,
        issuedBy: "player",
      },
      labId: start.run.playerLabId,
      priceTier: "premium",
    }).state;
    const envelope = createSaveEnvelope(repriced, {
      saveId: "price-replay",
      slotType: "manual",
      displayName: "Pricing takes effect next cycle",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });
    const reloaded = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope))).state;

    const uninterrupted = advance(repriced, 12);
    const resumed = advance(reloaded, 12);
    expect(stateHash(resumed)).toBe(stateHash(uninterrupted));
    expect(resumed.labs[start.run.playerLabId]?.market.priceTier).toBe("premium");
  });

  it("replays an in-progress facility project and sourced completion modifier", () => {
    const start = withCash(
      newState("0123456789abcdef0123456789abcdef", "base:leader.sam-altmann"),
      1000,
    );
    const queued = applyCommand(start, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:replay-facility" as CommandId,
        expectedTick: start.run.tick,
        issuedBy: "player",
      },
      labId: start.run.playerLabId,
      definitionId: contentId("base:facility.power-and-cooling-1"),
    }).state;
    const inProgress = advance(queued, 3);
    const envelope = createSaveEnvelope(inProgress, {
      saveId: "facility-replay",
      slotType: "manual",
      displayName: "Construction in progress",
      contentHash: content.manifest.bundleHash,
      nowIso: NOW,
    });
    const reloaded = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope))).state;

    const uninterrupted = advance(inProgress, 8);
    const resumed = advance(reloaded, 8);
    expect(stateHash(resumed)).toBe(stateHash(uninterrupted));
    expect(
      resumed.labs[start.run.playerLabId]?.facilities.instances.some(
        (facility) => facility.definitionId === "base:facility.power-and-cooling-1",
      ),
    ).toBe(true);
  });
});
