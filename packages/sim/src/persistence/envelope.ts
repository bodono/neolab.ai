import { z } from "zod";

import { assertInvariants, InvariantError } from "../engine/invariants.ts";
import { deepFreeze } from "../engine/transaction.ts";
import { validateGameState } from "../model/schema.ts";
import type { GameState } from "../model/state.ts";
import { hashJson } from "./hash.ts";
import {
  migrateSaveState,
  type MigrationContext,
  type SaveMigrationResult,
} from "./migrations.ts";

/**
 * Versioned save envelope (TDD section 24.1). Real timestamps live ONLY here,
 * injected by the caller — the simulation itself never reads a clock. The
 * checksum detects accidental corruption; it is not anti-cheat.
 */
export interface SaveEnvelopeV1 {
  readonly format: "neolab-save";
  readonly saveVersion: number;
  readonly engineRulesVersion: string;
  readonly contentVersion: string;
  readonly contentHash: string;
  readonly randomContractVersion: number;
  readonly saveId: string;
  readonly slotType: "autosave" | "manual" | "crisis-checkpoint";
  readonly displayName: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly checksum: string;
  readonly state: unknown;
}

const envelopeSchema = z
  .object({
    format: z.literal("neolab-save"),
    saveVersion: z.number().int().positive(),
    engineRulesVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    contentHash: z.string().min(1),
    randomContractVersion: z.number().int().positive(),
    saveId: z.string().min(1),
    slotType: z.enum(["autosave", "manual", "crisis-checkpoint"]),
    displayName: z.string().min(1),
    createdAtIso: z.string().min(1),
    updatedAtIso: z.string().min(1),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
    state: z.unknown(),
  })
  .strict();

export interface CreateEnvelopeOptions {
  readonly saveId: string;
  readonly slotType: SaveEnvelopeV1["slotType"];
  readonly displayName: string;
  readonly contentHash: string;
  /** Caller-supplied wall-clock timestamp; sim code never reads Date. */
  readonly nowIso: string;
  readonly createdAtIso?: string;
}

export function createSaveEnvelope(
  state: GameState,
  options: CreateEnvelopeOptions,
): SaveEnvelopeV1 {
  return {
    format: "neolab-save",
    saveVersion: state.saveVersion,
    engineRulesVersion: state.engineRulesVersion,
    contentVersion: state.contentVersion,
    contentHash: options.contentHash,
    randomContractVersion: state.randomContractVersion,
    saveId: options.saveId,
    slotType: options.slotType,
    displayName: options.displayName,
    createdAtIso: options.createdAtIso ?? options.nowIso,
    updatedAtIso: options.nowIso,
    checksum: hashJson(state),
    state: structuredClone(state),
  };
}

export class SaveLoadError extends Error {
  constructor(detail: string) {
    super(`Save could not be loaded: ${detail}`);
    this.name = "SaveLoadError";
  }
}

export interface LoadedSave {
  readonly envelope: SaveEnvelopeV1;
  readonly state: GameState;
  readonly migration: SaveMigrationResult;
}

/** Parse -> checksum -> migrate -> schema/invariant validate (TDD section 24.5). */
export function loadSaveEnvelope(
  value: unknown,
  migrationContext?: MigrationContext,
): LoadedSave {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SaveLoadError(
      `invalid envelope at "${issue?.path.join(".") ?? ""}": ${issue?.message ?? "?"}`,
    );
  }
  const envelope = parsed.data as SaveEnvelopeV1;
  const actualChecksum = hashJson(envelope.state);
  if (actualChecksum !== envelope.checksum) {
    throw new SaveLoadError(
      `checksum mismatch (expected ${envelope.checksum.slice(0, 12)}…, ` +
        `got ${actualChecksum.slice(0, 12)}…) — the file is corrupt`,
    );
  }
  let migration: SaveMigrationResult;
  try {
    migration = migrateSaveState(envelope.state, migrationContext);
  } catch (error) {
    throw new SaveLoadError(
      `migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (migration.sourceVersion !== envelope.saveVersion) {
    throw new SaveLoadError(
      `envelope version ${String(envelope.saveVersion)} does not match state version ${String(migration.sourceVersion)}`,
    );
  }
  let state: GameState;
  try {
    state = validateGameState(migration.state);
  } catch (error) {
    throw new SaveLoadError(error instanceof Error ? error.message : String(error));
  }
  // A schema-valid save can still violate cross-field invariants; reject it
  // HERE as a load error instead of letting the first tick brick the run
  // (TDD 24.5 step 6).
  try {
    assertInvariants(state);
  } catch (error) {
    if (error instanceof InvariantError) {
      throw new SaveLoadError(`save violates game invariants: ${error.message}`);
    }
    throw error;
  }
  return { envelope, state: deepFreeze(state), migration };
}
