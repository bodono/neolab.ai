interface RunLedgerEntry {
  readonly telemetryRunId: string;
  readonly emittedKeys: readonly string[];
}

interface StoredLedger {
  readonly version: 1;
  readonly runs: Readonly<Record<string, RunLedgerEntry>>;
}

export interface AnalyticsLedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "neolab:analytics-ledger:v1";
const MAX_RUNS = 40;
const MAX_KEYS_PER_RUN = 160;

export class AnalyticsLedger {
  readonly #storage: AnalyticsLedgerStorage | undefined;
  #ledger: StoredLedger;

  constructor(storage?: AnalyticsLedgerStorage) {
    this.#storage = storage;
    this.#ledger = this.#read();
  }

  telemetryRunId(runId: string): string {
    const existing = this.#ledger.runs[runId];
    if (existing !== undefined) return existing.telemetryRunId;
    const entry: RunLedgerEntry = {
      telemetryRunId: createOpaqueId(),
      emittedKeys: [],
    };
    this.#writeRun(runId, entry);
    return entry.telemetryRunId;
  }

  emitOnce(runId: string, key: string, emit: () => void): boolean {
    const existing = this.#ledger.runs[runId] ?? {
      telemetryRunId: createOpaqueId(),
      emittedKeys: [],
    };
    if (existing.emittedKeys.includes(key)) return false;
    emit();
    this.#writeRun(runId, {
      ...existing,
      emittedKeys: [...existing.emittedKeys, key].slice(-MAX_KEYS_PER_RUN),
    });
    return true;
  }

  #writeRun(runId: string, entry: RunLedgerEntry): void {
    const retainedEntries = [
      ...Object.entries(this.#ledger.runs).filter(
        ([storedRunId]) => storedRunId !== runId,
      ),
      [runId, entry] as const,
    ].slice(-MAX_RUNS);
    const runs: Record<string, RunLedgerEntry> = {};
    for (const [storedRunId, storedEntry] of retainedEntries) {
      runs[storedRunId] = storedEntry;
    }
    this.#ledger = { version: 1, runs };
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#ledger));
    } catch {
      // Private browsing or a full storage quota must not affect play.
    }
  }

  #read(): StoredLedger {
    try {
      const raw = this.#storage?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return { version: 1, runs: {} };
      const parsed = JSON.parse(raw) as Partial<StoredLedger>;
      if (parsed.version !== 1 || typeof parsed.runs !== "object") {
        return { version: 1, runs: {} };
      }
      return { version: 1, runs: parsed.runs ?? {} };
    } catch {
      return { version: 1, runs: {} };
    }
  }
}

function createOpaqueId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `run-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}
