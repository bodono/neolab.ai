const CONSENT_KEY = "neolab.ai-diagnostics-consent-v1";
const RECORDS_KEY = "neolab.ai-diagnostics-records-v1";
const MAX_RECORDS = 100;

export const FEEDBACK_URL =
  "https://github.com/bodono/neolab.ai-feeback/issues/new?template=feedback.md";

export type LocalDiagnosticEvent =
  | {
      readonly name: "app-opened" | "consent-enabled" | "diagnostics-exported";
    }
  | {
      readonly name: "game-started";
      readonly leaderId: string;
      readonly difficultyId: string;
      readonly mandateId: string;
    }
  | {
      readonly name: "save-loaded";
      readonly slotType: string;
    }
  | {
      readonly name: "operation-failed";
      readonly operation:
        | "list-saves"
        | "load-save"
        | "import-save"
        | "export-save"
        | "list-scores"
        | "delete-score"
        | "save-before-exit";
    };

export interface LocalDiagnosticRecord {
  readonly sequence: number;
  readonly recordedAtIso: string;
  readonly event: LocalDiagnosticEvent;
}

export interface LocalDiagnosticsSnapshot {
  readonly enabled: boolean;
  readonly recordCount: number;
}

export interface LocalDiagnosticsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): LocalDiagnosticsStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function parseRecords(value: string | null): LocalDiagnosticRecord[] {
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is LocalDiagnosticRecord => {
      if (typeof record !== "object" || record === null) return false;
      const candidate = record as Record<string, unknown>;
      return (
        Number.isSafeInteger(candidate["sequence"]) &&
        typeof candidate["recordedAtIso"] === "string" &&
        typeof candidate["event"] === "object" &&
        candidate["event"] !== null &&
        typeof (candidate["event"] as Record<string, unknown>)["name"] === "string"
      );
    });
  } catch {
    return [];
  }
}

/**
 * A deliberately local diagnostic notebook. It has no transport dependency or submission API;
 * players explicitly export its bounded JSON file when they choose to attach it to feedback.
 */
export class LocalDiagnostics {
  readonly #storage: LocalDiagnosticsStorage | undefined;
  readonly #now: () => Date;
  readonly #listeners = new Set<(snapshot: LocalDiagnosticsSnapshot) => void>();
  #enabled: boolean;
  #records: LocalDiagnosticRecord[];

  constructor(
    storage: LocalDiagnosticsStorage | undefined = browserStorage(),
    now: () => Date = () => new Date(),
  ) {
    this.#storage = storage;
    this.#now = now;
    this.#enabled = this.#safeGet(CONSENT_KEY) === "true";
    this.#records = parseRecords(this.#safeGet(RECORDS_KEY)).slice(-MAX_RECORDS);
  }

  getSnapshot(): LocalDiagnosticsSnapshot {
    return { enabled: this.#enabled, recordCount: this.#records.length };
  }

  subscribe(listener: (snapshot: LocalDiagnosticsSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.#safeSet(CONSENT_KEY, String(enabled));
    if (enabled) this.record({ name: "consent-enabled" });
    else this.#emit();
  }

  record(event: LocalDiagnosticEvent): void {
    if (!this.#enabled) return;
    const sequence = (this.#records.at(-1)?.sequence ?? 0) + 1;
    this.#records = [
      ...this.#records,
      { sequence, recordedAtIso: this.#now().toISOString(), event },
    ].slice(-MAX_RECORDS);
    this.#safeSet(RECORDS_KEY, JSON.stringify(this.#records));
    this.#emit();
  }

  exportJson(): string {
    this.record({ name: "diagnostics-exported" });
    return `${JSON.stringify(
      {
        formatVersion: 1,
        privacy: {
          localOnly: true,
          automaticTransmission: false,
          excludes: [
            "save state",
            "run seed",
            "player text",
            "machine identifier",
            "network address",
          ],
        },
        records: this.#records,
      },
      null,
      2,
    )}\n`;
  }

  clear(): void {
    this.#records = [];
    this.#safeRemove(RECORDS_KEY);
    this.#emit();
  }

  #safeGet(key: string): string | null {
    try {
      return this.#storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  #safeSet(key: string, value: string): void {
    try {
      this.#storage?.setItem(key, value);
    } catch {
      // Storage denial must never make the game unavailable.
    }
  }

  #safeRemove(key: string): void {
    try {
      this.#storage?.removeItem(key);
    } catch {
      // Storage denial must never make the game unavailable.
    }
  }

  #emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
