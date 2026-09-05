import { describe, expect, it } from "vitest";

import { LocalDiagnostics, type LocalDiagnosticsStorage } from "../local-diagnostics.ts";

class MemoryStorage implements LocalDiagnosticsStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("local consented diagnostics", () => {
  it("is off by default and records nothing before explicit consent", () => {
    const storage = new MemoryStorage();
    const diagnostics = new LocalDiagnostics(storage);
    diagnostics.record({ name: "app-opened" });

    expect(diagnostics.getSnapshot()).toEqual({ enabled: false, recordCount: 0 });
    expect(diagnostics.exportJson()).not.toContain("app-opened");
  });

  it("stores only allowlisted local records and exports them explicitly", () => {
    const storage = new MemoryStorage();
    const diagnostics = new LocalDiagnostics(
      storage,
      () => new Date("2026-07-22T12:00:00.000Z"),
    );
    diagnostics.setEnabled(true);
    diagnostics.record({
      name: "game-started",
      leaderId: "leader.sam-altmann",
      difficultyId: "difficulty.standard",
      mandateId: "mandate.safe-progress",
    });

    const exported = JSON.parse(diagnostics.exportJson()) as {
      readonly privacy: { readonly automaticTransmission: boolean };
      readonly records: readonly { readonly event: { readonly name: string } }[];
    };
    expect(exported.privacy.automaticTransmission).toBe(false);
    expect(exported.records.map((record) => record.event.name)).toEqual([
      "consent-enabled",
      "game-started",
      "diagnostics-exported",
    ]);
    expect(JSON.stringify(exported.records)).not.toContain("seed");
    expect(new LocalDiagnostics(storage).getSnapshot()).toEqual({
      enabled: true,
      recordCount: 3,
    });
  });

  it("stops recording when disabled and clears retained records separately", () => {
    const diagnostics = new LocalDiagnostics(new MemoryStorage());
    diagnostics.setEnabled(true);
    diagnostics.setEnabled(false);
    diagnostics.record({ name: "app-opened" });
    expect(diagnostics.getSnapshot()).toEqual({ enabled: false, recordCount: 1 });
    diagnostics.clear();
    expect(diagnostics.getSnapshot()).toEqual({ enabled: false, recordCount: 0 });
  });
});
