import {
  createSaveEnvelope,
  loadSaveEnvelope,
  MAX_SAVE_IMPORT_BYTES,
  parseImportedSaveBlob,
  saveMetadataFromEnvelope,
  SaveLoadError,
  type ImportSaveResult,
  type LoadSaveResult,
  type SaveEnvelopeV1,
  type SaveMetadata,
  type SaveRepository,
  type WriteSaveRequest,
} from "@neolab/sim/public";

const DATABASE_VERSION = 1;
const RECORD_STORE = "save-records";
const SLOT_STORE = "save-slots";

interface SaveSlotPointer {
  readonly saveId: string;
  readonly recordId: string;
}

interface StoredSaveRecord {
  readonly recordId: string;
  readonly envelope: SaveEnvelopeV1;
}

export interface IndexedDbSaveRepositoryOptions {
  readonly indexedDb?: IDBFactory;
  readonly databaseName?: string;
  readonly maxImportBytes?: number;
  /** Deterministic failure seam used to prove pointer-swap atomicity. */
  readonly beforePointerSwap?: (envelope: SaveEnvelopeV1) => void;
}

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
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePointer(value: unknown): SaveSlotPointer {
  if (
    !isRecord(value) ||
    typeof value["saveId"] !== "string" ||
    typeof value["recordId"] !== "string"
  ) {
    throw new SaveLoadError("corrupt IndexedDB slot pointer");
  }
  return { saveId: value["saveId"], recordId: value["recordId"] };
}

function parseStoredRecord(value: unknown): StoredSaveRecord {
  if (
    !isRecord(value) ||
    typeof value["recordId"] !== "string" ||
    !("envelope" in value)
  ) {
    throw new SaveLoadError("corrupt IndexedDB save record");
  }
  const loaded = loadSaveEnvelope(value["envelope"]);
  return { recordId: value["recordId"], envelope: loaded.envelope };
}

function persistenceError(error: unknown): SaveLoadError {
  return error instanceof SaveLoadError
    ? error
    : new SaveLoadError(
        `browser storage failed: ${error instanceof Error ? error.message : String(error)}`,
      );
}

/** Browser production adapter. Canonical state remains behind SaveRepository. */
export class IndexedDbSaveRepository implements SaveRepository {
  readonly #factory: IDBFactory;
  readonly #databaseName: string;
  readonly #maxImportBytes: number;
  readonly #beforePointerSwap: ((envelope: SaveEnvelopeV1) => void) | undefined;
  #databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbSaveRepositoryOptions = {}) {
    const factory = options.indexedDb ?? globalThis.indexedDB;
    if (factory === undefined) {
      throw new SaveLoadError("IndexedDB is not available in this browser");
    }
    this.#factory = factory;
    this.#databaseName = options.databaseName ?? "neolab.ai-saves";
    this.#maxImportBytes = options.maxImportBytes ?? MAX_SAVE_IMPORT_BYTES;
    this.#beforePointerSwap = options.beforePointerSwap;
  }

  async list(): Promise<SaveMetadata[]> {
    try {
      const database = await this.#database();
      const transaction = database.transaction([SLOT_STORE, RECORD_STORE], "readonly");
      const completion = transactionCompletion(transaction);
      const [pointerValues, recordValues] = await Promise.all([
        requestResult(transaction.objectStore(SLOT_STORE).getAll()),
        requestResult(transaction.objectStore(RECORD_STORE).getAll()),
      ]);
      await completion;
      const records = new Map(
        recordValues.map((value) => {
          const record = parseStoredRecord(value);
          return [record.recordId, record] as const;
        }),
      );
      return pointerValues
        .map(parsePointer)
        .map((pointer) => {
          const record = records.get(pointer.recordId);
          if (record === undefined) {
            throw new SaveLoadError(`save slot "${pointer.saveId}" has no record`);
          }
          return saveMetadataFromEnvelope(record.envelope);
        })
        .sort((left, right) =>
          left.updatedAtIso === right.updatedAtIso
            ? left.saveId < right.saveId
              ? -1
              : 1
            : left.updatedAtIso > right.updatedAtIso
              ? -1
              : 1,
        );
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async load(saveId: string): Promise<LoadSaveResult> {
    try {
      const record = await this.#readRecord(saveId);
      if (record === undefined) throw new SaveLoadError(`no save "${saveId}"`);
      const loaded = loadSaveEnvelope(record.envelope);
      return {
        state: loaded.state,
        metadata: saveMetadataFromEnvelope(record.envelope),
      };
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async write(request: WriteSaveRequest): Promise<SaveMetadata> {
    try {
      let existing: StoredSaveRecord | undefined;
      try {
        existing = await this.#readRecord(request.saveId, false);
      } catch (error) {
        if (!(error instanceof SaveLoadError)) throw error;
        // A deliberately written replacement must be able to repair a poisoned
        // slot. The new envelope is still validated before its pointer is
        // committed; only the unusable predecessor's creation date is lost.
        existing = undefined;
      }
      const envelope = createSaveEnvelope(request.state, {
        saveId: request.saveId,
        slotType: request.slotType,
        displayName: request.displayName,
        contentHash: request.contentHash,
        nowIso: request.nowIso,
        ...(existing === undefined
          ? {}
          : { createdAtIso: existing.envelope.createdAtIso }),
      });
      await this.#commitEnvelope(envelope);
      return saveMetadataFromEnvelope(envelope);
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async delete(saveId: string): Promise<void> {
    try {
      const database = await this.#database();
      const transaction = database.transaction([SLOT_STORE, RECORD_STORE], "readwrite");
      const completion = transactionCompletion(transaction);
      const slots = transaction.objectStore(SLOT_STORE);
      const records = transaction.objectStore(RECORD_STORE);
      const pointerValue: unknown = await requestResult(slots.get(saveId));
      if (pointerValue !== undefined) {
        const pointer = parsePointer(pointerValue);
        await requestResult(records.delete(pointer.recordId));
        await requestResult(slots.delete(saveId));
      }
      await completion;
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async export(saveId: string): Promise<Blob> {
    try {
      const record = await this.#readRecord(saveId);
      if (record === undefined) throw new SaveLoadError(`no save "${saveId}"`);
      return new Blob([JSON.stringify(record.envelope)], {
        type: "application/json",
      });
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async import(file: Blob): Promise<ImportSaveResult> {
    try {
      const loaded = await parseImportedSaveBlob(file, this.#maxImportBytes);
      const normalized = createSaveEnvelope(loaded.state, {
        saveId: loaded.envelope.saveId,
        slotType: loaded.envelope.slotType,
        displayName: loaded.envelope.displayName,
        contentHash: loaded.envelope.contentHash,
        createdAtIso: loaded.envelope.createdAtIso,
        nowIso: loaded.envelope.updatedAtIso,
      });
      await this.#commitEnvelope(normalized);
      return { metadata: saveMetadataFromEnvelope(normalized) };
    } catch (error) {
      throw persistenceError(error);
    }
  }

  close(): void {
    void this.#databasePromise?.then((database) => database.close());
    this.#databasePromise = undefined;
  }

  async #database(): Promise<IDBDatabase> {
    this.#databasePromise ??= new Promise((resolve, reject) => {
      const request = this.#factory.open(this.#databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECORD_STORE)) {
          database.createObjectStore(RECORD_STORE, { keyPath: "recordId" });
        }
        if (!database.objectStoreNames.contains(SLOT_STORE)) {
          database.createObjectStore(SLOT_STORE, { keyPath: "saveId" });
        }
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Could not open IndexedDB")),
        { once: true },
      );
      request.addEventListener(
        "blocked",
        () => reject(new Error("IndexedDB upgrade is blocked by another tab")),
        { once: true },
      );
    });
    return this.#databasePromise;
  }

  async #readRecord(
    saveId: string,
    required = true,
  ): Promise<StoredSaveRecord | undefined> {
    const database = await this.#database();
    const transaction = database.transaction([SLOT_STORE, RECORD_STORE], "readonly");
    const completion = transactionCompletion(transaction);
    const pointerValue: unknown = await requestResult(
      transaction.objectStore(SLOT_STORE).get(saveId),
    );
    if (pointerValue === undefined) {
      await completion;
      if (required) throw new SaveLoadError(`no save "${saveId}"`);
      return undefined;
    }
    const pointer = parsePointer(pointerValue);
    const recordValue: unknown = await requestResult(
      transaction.objectStore(RECORD_STORE).get(pointer.recordId),
    );
    await completion;
    if (recordValue === undefined) {
      throw new SaveLoadError(`save slot "${saveId}" has no record`);
    }
    return parseStoredRecord(recordValue);
  }

  async #commitEnvelope(envelope: SaveEnvelopeV1): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction([SLOT_STORE, RECORD_STORE], "readwrite");
    const completion = transactionCompletion(transaction);
    try {
      const slots = transaction.objectStore(SLOT_STORE);
      const records = transaction.objectStore(RECORD_STORE);
      const previousValue: unknown = await requestResult(slots.get(envelope.saveId));
      const previous =
        previousValue === undefined ? undefined : parsePointer(previousValue);
      const recordId = `${envelope.saveId}:${envelope.updatedAtIso}:${envelope.checksum}`;
      await requestResult(records.put({ recordId, envelope: structuredClone(envelope) }));
      const stagedValue: unknown = await requestResult(records.get(recordId));
      const staged = parseStoredRecord(stagedValue);
      loadSaveEnvelope(staged.envelope);
      this.#beforePointerSwap?.(envelope);
      await requestResult(slots.put({ saveId: envelope.saveId, recordId }));
      if (previous !== undefined && previous.recordId !== recordId) {
        await requestResult(records.delete(previous.recordId));
      }
      await completion;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // A transaction which already failed is already rolling back.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }
}
