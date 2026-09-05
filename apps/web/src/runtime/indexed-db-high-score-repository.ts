import {
  SCORE_CATEGORY_IDS,
  entriesForBoard,
  type HighScoreBoard,
  type HighScoreEntry,
  type HighScoreRepository,
} from "@neolab/sim/public";

const DATABASE_VERSION = 1;
const ENTRY_STORE = "high-score-entries";

export interface IndexedDbHighScoreRepositoryOptions {
  readonly indexedDb?: IDBFactory;
  readonly databaseName?: string;
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

function parseEntry(value: unknown): HighScoreEntry {
  if (!isRecord(value)) throw new Error("corrupt high-score record");
  const categoryTotals = value["categoryTotals"];
  const requiredStrings = [
    "runId",
    "labDefinitionId",
    "labName",
    "leaderDefinitionId",
    "leaderName",
    "endingId",
    "endingName",
    "seed",
    "difficultyId",
    "scoreVersion",
    "contentHash",
    "engineRulesVersion",
    "recordedAtIso",
  ];
  const requiredNumbers = [
    "rawScore",
    "adjustedScore",
    "totalTicks",
    "weeksAfterCrisisStart",
  ];
  if (
    requiredStrings.some(
      (key) => typeof value[key] !== "string" || String(value[key]).length === 0,
    ) ||
    requiredNumbers.some(
      (key) => typeof value[key] !== "number" || !Number.isFinite(value[key]),
    ) ||
    typeof value["victory"] !== "boolean" ||
    !["winning-run", "local-only", "ineligible"].includes(
      String(value["leaderboardEligibility"]),
    )
  ) {
    throw new Error("corrupt high-score record fields");
  }
  if (
    !isRecord(categoryTotals) ||
    SCORE_CATEGORY_IDS.some(
      (categoryId) =>
        typeof categoryTotals[categoryId] !== "number" ||
        !Number.isFinite(categoryTotals[categoryId]),
    ) ||
    Object.keys(categoryTotals).some(
      (categoryId) =>
        !SCORE_CATEGORY_IDS.includes(categoryId as (typeof SCORE_CATEGORY_IDS)[number]),
    )
  ) {
    throw new Error("corrupt high-score record fields");
  }
  return structuredClone(value) as unknown as HighScoreEntry;
}

/** Independent local database: deleting a save cannot erase its score summary. */
export class IndexedDbHighScoreRepository implements HighScoreRepository {
  readonly #factory: IDBFactory;
  readonly #databaseName: string;
  #databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbHighScoreRepositoryOptions = {}) {
    const factory = options.indexedDb ?? globalThis.indexedDB;
    if (factory === undefined)
      throw new Error("IndexedDB is not available in this browser");
    this.#factory = factory;
    this.#databaseName = options.databaseName ?? "neolab.ai-high-scores";
  }

  async list(board: HighScoreBoard): Promise<HighScoreEntry[]> {
    const database = await this.#database();
    const transaction = database.transaction(ENTRY_STORE, "readonly");
    const completion = transactionCompletion(transaction);
    const values = await requestResult(transaction.objectStore(ENTRY_STORE).getAll());
    await completion;
    return entriesForBoard(values.map(parseEntry), board);
  }

  async record(entry: HighScoreEntry): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(ENTRY_STORE, "readwrite");
    const completion = transactionCompletion(transaction);
    await requestResult(transaction.objectStore(ENTRY_STORE).put(structuredClone(entry)));
    await completion;
  }

  async delete(runId: string): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(ENTRY_STORE, "readwrite");
    const completion = transactionCompletion(transaction);
    await requestResult(transaction.objectStore(ENTRY_STORE).delete(runId));
    await completion;
  }

  close(): void {
    void this.#databasePromise?.then((database) => database.close());
    this.#databasePromise = undefined;
  }

  async #database(): Promise<IDBDatabase> {
    this.#databasePromise ??= new Promise((resolve, reject) => {
      const request = this.#factory.open(this.#databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(ENTRY_STORE)) {
          request.result.createObjectStore(ENTRY_STORE, { keyPath: "runId" });
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Could not open high-score database")),
        { once: true },
      );
      request.addEventListener(
        "blocked",
        () => reject(new Error("High-score database upgrade is blocked")),
        { once: true },
      );
    });
    return this.#databasePromise;
  }
}
