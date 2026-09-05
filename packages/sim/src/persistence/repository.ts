import type { GameState } from "../model/state.ts";
import {
  createSaveEnvelope,
  loadSaveEnvelope,
  SaveLoadError,
  type SaveEnvelopeV1,
} from "./envelope.ts";

// Long campaigns can legitimately exceed the old 8 MiB ceiling, especially
// saves exported by older builds with human-readable indentation. Keep a hard
// ceiling against accidental or hostile imports, but leave ample room to
// recover those files. Current exports are compact and recurring finance
// history is bounded, so ordinary saves should remain far below this limit.
export const MAX_SAVE_IMPORT_BYTES = 32 * 1024 * 1024;

/**
 * Storage-agnostic save repository (TDD section 24.2). The browser ships
 * `IndexedDbSaveRepository` in Stage 5; tests and the balance runner use the
 * in-memory implementation below. The runtime knows only this interface.
 */

export interface SaveMetadata {
  readonly saveId: string;
  readonly slotType: SaveEnvelopeV1["slotType"];
  readonly displayName: string;
  readonly contentVersion: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

export interface WriteSaveRequest {
  readonly state: GameState;
  readonly saveId: string;
  readonly slotType: SaveEnvelopeV1["slotType"];
  readonly displayName: string;
  readonly contentHash: string;
  readonly nowIso: string;
}

export interface LoadSaveResult {
  readonly state: GameState;
  readonly metadata: SaveMetadata;
}

export interface ImportSaveResult {
  readonly metadata: SaveMetadata;
}

export interface SaveRepository {
  list(): Promise<SaveMetadata[]>;
  load(saveId: string): Promise<LoadSaveResult>;
  write(request: WriteSaveRequest): Promise<SaveMetadata>;
  delete(saveId: string): Promise<void>;
  export(saveId: string): Promise<Blob>;
  import(file: Blob): Promise<ImportSaveResult>;
}

export function saveMetadataFromEnvelope(envelope: SaveEnvelopeV1): SaveMetadata {
  return {
    saveId: envelope.saveId,
    slotType: envelope.slotType,
    displayName: envelope.displayName,
    contentVersion: envelope.contentVersion,
    createdAtIso: envelope.createdAtIso,
    updatedAtIso: envelope.updatedAtIso,
  };
}

export async function parseImportedSaveBlob(
  file: Blob,
  maxBytes = MAX_SAVE_IMPORT_BYTES,
): Promise<ReturnType<typeof loadSaveEnvelope>> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Save import limit must be a positive integer");
  }
  if (file.size > maxBytes) {
    throw new SaveLoadError(
      `file is too large (${String(file.size)} bytes; limit ${String(maxBytes)} bytes)`,
    );
  }
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new SaveLoadError("file is not JSON");
  }
  return loadSaveEnvelope(parsed);
}

export class MemorySaveRepository implements SaveRepository {
  private readonly slots = new Map<string, SaveEnvelopeV1>();

  list(): Promise<SaveMetadata[]> {
    return Promise.resolve(
      [...this.slots.values()]
        .map(saveMetadataFromEnvelope)
        .sort((a, b) => (a.saveId < b.saveId ? -1 : 1)),
    );
  }

  load(saveId: string): Promise<LoadSaveResult> {
    const envelope = this.slots.get(saveId);
    if (envelope === undefined) {
      return Promise.reject(new SaveLoadError(`no save "${saveId}"`));
    }
    // Round-trip through the full loader so memory saves exercise the same
    // checksum and schema path as disk saves.
    const { state } = loadSaveEnvelope(structuredClone(envelope));
    return Promise.resolve({ state, metadata: saveMetadataFromEnvelope(envelope) });
  }

  write(request: WriteSaveRequest): Promise<SaveMetadata> {
    const existing = this.slots.get(request.saveId);
    const envelope = createSaveEnvelope(request.state, {
      saveId: request.saveId,
      slotType: request.slotType,
      displayName: request.displayName,
      contentHash: request.contentHash,
      nowIso: request.nowIso,
      ...(existing === undefined ? {} : { createdAtIso: existing.createdAtIso }),
    });
    this.slots.set(request.saveId, envelope);
    return Promise.resolve(saveMetadataFromEnvelope(envelope));
  }

  delete(saveId: string): Promise<void> {
    this.slots.delete(saveId);
    return Promise.resolve();
  }

  export(saveId: string): Promise<Blob> {
    const envelope = this.slots.get(saveId);
    if (envelope === undefined) {
      return Promise.reject(new SaveLoadError(`no save "${saveId}"`));
    }
    return Promise.resolve(
      new Blob([JSON.stringify(envelope)], { type: "application/json" }),
    );
  }

  async import(file: Blob): Promise<ImportSaveResult> {
    const { envelope } = await parseImportedSaveBlob(file);
    this.slots.set(envelope.saveId, envelope);
    return { metadata: saveMetadataFromEnvelope(envelope) };
  }
}
