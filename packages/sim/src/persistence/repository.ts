import type { GameState } from "../model/state.ts";
import {
  createSaveEnvelope,
  loadSaveEnvelope,
  SaveLoadError,
  type SaveEnvelopeV1,
} from "./envelope.ts";

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

function toMetadata(envelope: SaveEnvelopeV1): SaveMetadata {
  return {
    saveId: envelope.saveId,
    slotType: envelope.slotType,
    displayName: envelope.displayName,
    contentVersion: envelope.contentVersion,
    createdAtIso: envelope.createdAtIso,
    updatedAtIso: envelope.updatedAtIso,
  };
}

export class MemorySaveRepository implements SaveRepository {
  private readonly slots = new Map<string, SaveEnvelopeV1>();

  list(): Promise<SaveMetadata[]> {
    return Promise.resolve(
      [...this.slots.values()]
        .map(toMetadata)
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
    return Promise.resolve({ state, metadata: toMetadata(envelope) });
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
    return Promise.resolve(toMetadata(envelope));
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
      new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }),
    );
  }

  async import(file: Blob): Promise<ImportSaveResult> {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SaveLoadError("file is not JSON");
    }
    const { envelope } = loadSaveEnvelope(parsed);
    this.slots.set(envelope.saveId, envelope);
    return { metadata: toMetadata(envelope) };
  }
}
