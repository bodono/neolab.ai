import { describe, expect, it } from "vitest";

import { advanceOneTick, stateHash, validateGameState } from "@neolab/sim";

import { scenario, scenarioContent } from "../scenario.ts";

describe("scenario builder", () => {
  it("builds a valid default state", () => {
    const state = scenario().build();
    expect(() => validateGameState(state)).not.toThrow();
    expect(state.run.tick).toBe(0);
  });

  it("applies tick, cash, gpus, aura, and rating edits", () => {
    const state = scenario()
      .atTick(520)
      .withPlayerLab((lab) =>
        lab
          .cash(42)
          .gpus("gpu.volta", 40_000)
          .aura(30)
          .rating("safetyCulture", 70)
          .rating("internalCandour", 61)
          .rating("governmentTrust", 55),
      )
      .build();

    const lab = state.labs[state.run.playerLabId];
    expect(state.run.tick).toBe(520);
    expect(state.run.calendar).toEqual({ year: 2022, week: 1 });
    expect(lab?.finance.cash).toBe(42);
    expect(lab?.compute.lots).toHaveLength(1);
    expect(lab?.compute.lots[0]).toMatchObject({
      generationId: "base:gpu.volta",
      physicalCount: 40_000,
      ownership: "owned",
    });
    expect(lab?.aura.spendable).toBe(30);
    expect(lab?.safety.safetyCulture).toBe(70);
    expect(lab?.organisation.hiddenInternalCandour).toBe(61);
    expect(lab?.politics.governmentTrust).toBe(55);
  });

  it("built states advance through the real engine", () => {
    const state = scenario()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    const next = advanceOneTick(state, scenarioContent());
    expect(next.state.run.tick).toBe(1);
  });

  it("rejects invalid fixtures at build unless unsafeFixture is used", () => {
    expect(() =>
      scenario()
        .withPlayerLab((lab) => lab.rating("safetyCulture", 300))
        .build(),
    ).toThrow(/invalid state/);

    const impossible = scenario()
      .unsafeFixture("testing out-of-range rating handling")
      .withPlayerLab((lab) => lab.rating("safetyCulture", 300))
      .build();
    const lab = impossible.labs[impossible.run.playerLabId];
    expect(lab?.safety.safetyCulture).toBe(300);
  });

  it("rejects unknown GPU generations and empty unsafe reasons", () => {
    expect(() =>
      scenario()
        .withPlayerLab((lab) => lab.gpus("gpu.imaginary", 5))
        .build(),
    ).toThrow(/unknown GPU generation/);
    expect(() => scenario().unsafeFixture("  ")).toThrow(/requires a reason/);
  });

  it("is deterministic for identical configuration", () => {
    const a = scenario()
      .atTick(10)
      .withPlayerLab((lab) => lab.cash(5))
      .build();
    const b = scenario()
      .atTick(10)
      .withPlayerLab((lab) => lab.cash(5))
      .build();
    expect(stateHash(a)).toBe(stateHash(b));
  });
});
