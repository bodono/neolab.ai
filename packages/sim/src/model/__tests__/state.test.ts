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

  it("defaults Stage 2 hardware queues when loading a Stage 1 state", () => {
    const legacy = JSON.parse(JSON.stringify(createBareState())) as {
      run: { idCounters: { facility?: unknown } };
      labs: Record<
        string,
        {
          compute: { deliveries?: unknown; leases?: unknown };
          finance: {
            ledger?: unknown;
            settlements?: unknown;
            consecutiveNegativeCashWeeks?: unknown;
          };
          market: {
            priceTier?: unknown;
            priceChangeTicks?: unknown;
            monetisationEfficiency?: unknown;
            weeksAccruedThisCycle?: unknown;
            segments?: unknown;
          };
          facilities: {
            instances: Array<{
              id?: unknown;
              enabled?: unknown;
              modifierIds?: unknown;
            }>;
          };
        }
      >;
    };
    const lab = Object.values(legacy.labs)[0];
    if (lab === undefined) throw new Error("fixture lab missing");
    delete lab.compute.deliveries;
    delete lab.compute.leases;
    delete lab.finance.ledger;
    delete lab.finance.settlements;
    delete lab.finance.consecutiveNegativeCashWeeks;
    delete lab.market.priceTier;
    delete lab.market.priceChangeTicks;
    delete lab.market.monetisationEfficiency;
    delete lab.market.weeksAccruedThisCycle;
    delete lab.market.segments;
    delete legacy.run.idCounters.facility;
    for (const facility of lab.facilities.instances) {
      delete facility.id;
      delete facility.enabled;
      delete facility.modifierIds;
    }

    const loaded = validateGameState(legacy);
    const loadedLab = loaded.labs[loaded.run.playerLabId];
    expect(loadedLab?.compute.deliveries).toEqual([]);
    expect(loadedLab?.finance.ledger).toEqual([]);
    expect(loadedLab?.finance.settlements).toEqual([]);
    expect(loadedLab?.finance.consecutiveNegativeCashWeeks).toBeUndefined();
    expect(loadedLab?.market).toMatchObject({
      priceTier: "market",
      priceChangeTicks: [],
      monetisationEfficiency: 0.55,
      weeksAccruedThisCycle: 0,
      segments: {},
    });
    expect(loaded.run.idCounters.facility).toBe(0);
    expect(loadedLab?.facilities.instances[0]).toMatchObject({
      modifierIds: [],
    });
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
