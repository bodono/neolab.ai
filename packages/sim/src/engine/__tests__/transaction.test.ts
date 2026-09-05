import { describe, expect, it } from "vitest";

import { contentId, validateCompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { seed128 } from "../../random/seed.ts";
import { createNewGame } from "../create-new-game.ts";
import { clonePlainData } from "../draft.ts";
import { createTransaction } from "../transaction.ts";

const content = validateCompiledContent(rawBundle);

function newState() {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.sam-altmann"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

describe("plain-data transaction clone", () => {
  it("deeply isolates transaction updates from canonical input", () => {
    const before = newState();
    const openingCash = before.labs[before.run.playerLabId]?.finance.cash;
    const tx = createTransaction(before);

    expect(tx.read()).not.toBe(before);
    expect(tx.read().labs).not.toBe(before.labs);
    expect(tx.read().labs[before.run.playerLabId]).not.toBe(
      before.labs[before.run.playerLabId],
    );

    tx.update((draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("Player lab missing");
      lab.flags["transaction-clone-test"] = true;
    });
    const result = tx.commit({ description: "test plain-data clone isolation" });

    expect(before.labs[before.run.playerLabId]?.finance.cash).toBe(openingCash);
    expect(before.labs[before.run.playerLabId]?.flags["transaction-clone-test"]).toBe(
      undefined,
    );
    expect(
      result.state.labs[result.state.run.playerLabId]?.flags["transaction-clone-test"],
    ).toBe(true);
    expect(Object.isFrozen(result.state)).toBe(true);
  });

  it("preserves arrays and permitted null-prototype records without shared branches", () => {
    const record = Object.assign(Object.create(null) as Record<string, unknown>, {
      nested: { values: [1, 2, { label: "three" }] },
    });
    const clone = clonePlainData(record);

    expect(Object.getPrototypeOf(clone)).toBe(null);
    expect(clone).toEqual(record);
    expect(clone).not.toBe(record);
    expect(clone.nested).not.toBe(record.nested);
    const cloneNested = clone.nested as { values: unknown[] };
    const recordNested = record.nested as { values: unknown[] };
    expect(cloneNested.values).not.toBe(recordNested.values);
    expect(cloneNested.values[2]).not.toBe(recordNested.values[2]);
  });

  it("rejects non-plain objects at the clone boundary", () => {
    expect(() => clonePlainData({ invalid: new Date(0) })).toThrow(
      "clonePlainData requires a plain object",
    );
  });

  it("poisons a failed update while leaving canonical input byte-identical", () => {
    const before = newState();
    const snapshot = JSON.stringify(before);
    const tx = createTransaction(before);

    expect(() =>
      tx.update((draft) => {
        draft.run.calendar.week = 99;
        throw new Error("deliberate partial update");
      }),
    ).toThrow("deliberate partial update");
    expect(() => tx.commit({ description: "must not commit" })).toThrow(/poisoned/);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
