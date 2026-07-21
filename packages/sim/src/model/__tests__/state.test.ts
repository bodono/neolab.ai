import { describe, expect, it } from "vitest";

import { createBareState } from "../fixture.ts";
import { assertPlainSerialisable, validateGameState } from "../schema.ts";
import { calendarFromTick, formatRunEntityId } from "../state.ts";

describe("GameState shell", () => {
  it("accepts the bare fixture through the schema", () => {
    const state = createBareState();
    expect(() => validateGameState(state)).not.toThrow();
  });

  it("round-trips through JSON without loss", () => {
    const state = createBareState();
    const revived: unknown = JSON.parse(JSON.stringify(state));
    expect(revived).toEqual(state);
    expect(() => validateGameState(revived)).not.toThrow();
  });

  it("contains only plain serialisable data", () => {
    expect(() => assertPlainSerialisable(createBareState())).not.toThrow();
  });

  it("plain-data guard rejects Date, Map, Set, class instances, functions, and NaN", () => {
    class Sneaky {}
    for (const bad of [
      new Date(0),
      new Map(),
      new Set(),
      new Sneaky(),
      () => 0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => assertPlainSerialisable({ bad })).toThrow();
    }
  });

  it("schema rejects unknown keys, bad content IDs, and non-finite numbers", () => {
    const base: unknown = JSON.parse(JSON.stringify(createBareState()));

    const withUnknownKey = structuredClone(base) as Record<string, unknown>;
    withUnknownKey["surprise"] = true;
    expect(() => validateGameState(withUnknownKey)).toThrow(/Invalid game state/);

    const withBadId = structuredClone(base) as {
      run: { difficultyId: string };
    };
    withBadId.run.difficultyId = "Not A Content Id";
    expect(() => validateGameState(withBadId)).toThrow(/Invalid game state/);

    const withBadRating = structuredClone(base) as {
      labs: Record<string, { safety: { safetyCulture: number } }>;
    };
    const lab = Object.values(withBadRating.labs)[0];
    if (lab === undefined) throw new Error("fixture lab missing");
    lab.safety.safetyCulture = 101;
    expect(() => validateGameState(withBadRating)).toThrow(/Invalid game state/);
  });

  it("derives the calendar from ticks (2012 start, 52-week years)", () => {
    expect(calendarFromTick(0)).toEqual({ year: 2012, week: 1 });
    expect(calendarFromTick(51)).toEqual({ year: 2012, week: 52 });
    expect(calendarFromTick(52)).toEqual({ year: 2013, week: 1 });
    expect(calendarFromTick(1040)).toEqual({ year: 2032, week: 1 });
  });

  it("formats deterministic run-entity IDs", () => {
    expect(formatRunEntityId("model", "player", 7)).toBe("run:model:player:0007");
    expect(formatRunEntityId("gpu-lot", "lab-3", 0)).toBe("run:gpu-lot:lab-3:0000");
    expect(() => formatRunEntityId("model", "player", -1)).toThrow(RangeError);
    expect(() => formatRunEntityId("model", "player", 1.5)).toThrow(RangeError);
  });
});
