import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import type { Effect } from "../../model/effects.ts";
import type { ModifierId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { randomKey } from "../../random/key.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { advanceOneTick } from "../advance-tick.ts";
import { logisticProbability, resolveCheck } from "../checks.ts";
import { createNewGame } from "../create-new-game.ts";
import { applyEffect, applyEffects } from "../effect-executor.ts";
import { resolveModifierValue } from "../modifier-resolver.ts";
import { evaluatePredicate, readMetric, type Predicate } from "../predicates.ts";
import { createTransaction, type TransitionResult } from "../transaction.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const SOURCE = { kind: "system" as const, id: "test" };

function newState(): GameState {
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

function run(state: GameState, effects: readonly Effect[]): TransitionResult {
  const tx = createTransaction(state);
  applyEffects(tx, effects, SOURCE);
  return tx.commit({ description: "test effects" });
}

function lab(state: GameState) {
  const value = state.labs[state.run.playerLabId];
  if (value === undefined) throw new Error("player lab missing");
  return value;
}

describe("effect executor", () => {
  it("add-resource cash can go negative; aura floors at zero", () => {
    const state = newState();
    const poorer = run(state, [
      {
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "cash",
        amount: -25,
      },
    ]);
    expect(lab(poorer.state).finance.cash).toBe(-7);

    const drained = run(state, [
      {
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "aura-spendable",
        amount: -999,
      },
    ]);
    expect(lab(drained.state).aura.spendable).toBe(0);
    expect(lab(drained.state).aura.lifetime).toBe(20); // unchanged by spending
  });

  it("aura gains raise lifetime alongside spendable (GDD 38.1)", () => {
    const state = newState();
    const richer = run(state, [
      {
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "aura-spendable",
        amount: 12,
      },
    ]);
    expect(lab(richer.state).aura.spendable).toBe(32);
    expect(lab(richer.state).aura.lifetime).toBe(32);
  });

  it("add-rating clamps to the 0-100 scale at the rule site", () => {
    const state = newState();
    const result = run(state, [
      {
        kind: "add-rating",
        subject: { type: "player-lab" },
        rating: "safetyCulture",
        amount: 200,
      },
      {
        kind: "add-rating",
        subject: { type: "player-lab" },
        rating: "boardPatience",
        amount: -500,
      },
      {
        kind: "add-rating",
        subject: { type: "player-lab" },
        rating: "internalCandour",
        amount: 7,
      },
    ]);
    expect(lab(result.state).safety.safetyCulture).toBe(100);
    expect(lab(result.state).organisation.boardPatience).toBe(0);
    expect(lab(result.state).organisation.hiddenInternalCandour).toBe(57);
  });

  it("set-flag writes lab flags", () => {
    const result = run(newState(), [
      {
        kind: "set-flag",
        subject: { type: "player-lab" },
        flag: "covered-up-benchmark",
        value: true,
      },
    ]);
    expect(lab(result.state).flags["covered-up-benchmark"]).toBe(true);
  });

  it("add-modifier registers a sourced, optionally expiring modifier", () => {
    const result = run(newState(), [
      {
        kind: "add-modifier",
        target: "lab.incident.hazard",
        operation: "multiply",
        value: 1.3,
        durationWeeks: 8,
        tags: ["test"],
      },
    ]);
    const added = Object.values(result.state.modifiers).find((modifier) =>
      modifier.tags.includes("test"),
    );
    expect(added).toMatchObject({
      target: "lab.incident.hazard",
      operation: "multiply",
      value: 1.3,
      startsAt: 0,
      endsAt: 8,
      source: SOURCE,
    });
  });

  it("add-modifier rejects unknown targets", () => {
    expect(() =>
      run(newState(), [
        { kind: "add-modifier", target: "lab.nonsense.stat", operation: "add", value: 1 },
      ]),
    ).toThrow(/unknown target/);
  });

  it("remove-modifier deletes by id and rejects unknown ids", () => {
    const state = newState();
    const someModifier = Object.keys(state.modifiers)[0];
    if (someModifier === undefined) throw new Error("expected setup modifiers");
    const removed = run(state, [
      { kind: "remove-modifier", modifierId: someModifier as ModifierId },
    ]);
    expect(someModifier in removed.state.modifiers).toBe(false);
    expect(() =>
      run(state, [
        { kind: "remove-modifier", modifierId: "run:modifier:missing" as ModifierId },
      ]),
    ).toThrow(/no modifier/);
  });

  it("end-run sets status and ending, emits the event, and requests pause", () => {
    const result = run(newState(), [
      { kind: "end-run", result: "lost", endingId: contentId("base:ending.test-loss") },
    ]);
    expect(result.state.run.status).toBe("lost");
    expect(result.state.run.endingId).toBe("base:ending.test-loss");
    expect(result.domainEvents).toContainEqual({ kind: "run-ended", result: "lost" });
    expect(result.autoPauseReasons).toContain("critical-event");
  });

  it("schedule-effects fires through the delayed-effects phase at the due tick", () => {
    const state = newState();
    const scheduled = run(state, [
      {
        kind: "schedule-effects",
        dueInWeeks: 2,
        effects: [
          {
            kind: "add-resource",
            subject: { type: "player-lab" },
            resource: "cash",
            amount: 5,
          },
        ],
      },
    ]);
    expect(scheduled.state.scheduledEffects).toHaveLength(1);

    // Scheduled while paused at tick 0, dueAt = 2: it fires during the
    // processing of tick 2 (the third advance).
    const afterOne = advanceOneTick(scheduled.state, content);
    expect(lab(afterOne.state).finance.cash).toBe(18); // processing tick 0
    const afterTwo = advanceOneTick(afterOne.state, content);
    expect(lab(afterTwo.state).finance.cash).toBe(18); // processing tick 1
    const afterThree = advanceOneTick(afterTwo.state, content);
    expect(afterThree.state.scheduledEffects).toHaveLength(0);
    expect(lab(afterThree.state).finance.cash).toBe(23);
  });
});

describe("modifier resolver", () => {
  it("applies constraints, then additive, then multiplicative, in stable order", () => {
    const state = run(newState(), [
      {
        kind: "add-modifier",
        target: "lab.incident.hazard",
        operation: "multiply",
        value: 2,
      },
      {
        kind: "add-modifier",
        target: "lab.incident.hazard",
        operation: "add",
        value: 10,
      },
      {
        kind: "add-modifier",
        target: "lab.incident.hazard",
        operation: "max",
        value: 50,
      },
    ]).state;
    // base 20 -> max(20,50)=50 -> +10=60 -> *2=120
    const breakdown = resolveModifierValue(state, "lab.incident.hazard", 20);
    expect(breakdown.afterConstraints).toBe(50);
    expect(breakdown.afterAdditive).toBe(60);
    expect(breakdown.final).toBe(120);
    expect(breakdown.contributions).toHaveLength(3);
  });

  it("ignores expired and not-yet-started modifiers", () => {
    const withExpiring = run(newState(), [
      {
        kind: "add-modifier",
        target: "lab.revenue.all",
        operation: "multiply",
        value: 3,
        durationWeeks: 1,
      },
    ]).state;
    expect(resolveModifierValue(withExpiring, "lab.revenue.all", 10).final).toBe(30);
    const later = advanceOneTick(withExpiring, content).state; // tick 1: endsAt=1, expired
    expect(resolveModifierValue(later, "lab.revenue.all", 10).final).toBe(10);
  });

  it("applies final clamps and rejects unknown targets", () => {
    const state = run(newState(), [
      {
        kind: "add-modifier",
        target: "lab.costs.fixed",
        operation: "multiply",
        value: 0.1,
      },
    ]).state;
    expect(
      resolveModifierValue(state, "lab.costs.fixed", 10, { clampMin: 5 }).final,
    ).toBe(5);
    expect(() => resolveModifierValue(state, "made.up.target", 1)).toThrow(
      /unknown target/,
    );
  });

  it("difficulty modifiers from createNewGame resolve through the same path", () => {
    const frontier = createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.frontier"),
        leaderId: contentId("base:leader.sam-altmann"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    );
    expect(resolveModifierValue(frontier, "world.rival.progress", 1).final).toBeCloseTo(
      1.12,
      10,
    );
    expect(resolveModifierValue(frontier, "lab.revenue.all", 100).final).toBeCloseTo(
      92,
      10,
    );
  });
});

describe("predicates and metrics", () => {
  it("evaluates nested all/any/not/compare/has-flag", () => {
    const state = run(newState(), [
      { kind: "set-flag", subject: { type: "player-lab" }, flag: "starter", value: true },
    ]).state;
    const predicate: Predicate = {
      type: "all",
      items: [
        { type: "compare", metric: "player.cash", op: "gte", value: 18 },
        { type: "compare", metric: "player.gpus.total", op: "eq", value: 10_000 },
        { type: "has-flag", flag: "starter" },
        {
          type: "not",
          item: {
            type: "compare",
            metric: "player.politics.governmentAttention",
            op: "gt",
            value: 50,
          },
        },
        {
          type: "any",
          items: [
            { type: "compare", metric: "run.tick", op: "eq", value: 999 },
            {
              type: "compare",
              metric: "player.safety.safetyCulture",
              op: "gte",
              value: 40,
            },
          ],
        },
      ],
    };
    expect(evaluatePredicate(state, predicate)).toBe(true);
    expect(
      evaluatePredicate(state, { type: "has-flag", flag: "starter", value: false }),
    ).toBe(false);
    expect(evaluatePredicate(state, { type: "has-flag", flag: "absent" })).toBe(false);
  });

  it("reads registered metrics and rejects unknown ones", () => {
    const state = newState();
    expect(readMetric(state, "player.cash")).toBe(18);
    expect(readMetric(state, "player.aura.spendable")).toBe(20);
    expect(() => readMetric(state, "player.secret.trueAlignment" as never)).toThrow(
      /Unknown metric/,
    );
  });
});

describe("logistic checks (GDD 42.3)", () => {
  it("matches the canonical anchor points", () => {
    expect(logisticProbability(50, 50)).toBeCloseTo(0.5, 12);
    expect(logisticProbability(60, 50)).toBeCloseTo(0.7310585786, 8);
    expect(logisticProbability(70, 50)).toBeCloseTo(0.8807970779, 8);
  });

  it("clamps to [5%, 95%] by default and honours custom clamps", () => {
    const oracle = new RandomOracleV1(seed128("0123456789abcdef0123456789abcdef"));
    const hopeless = resolveCheck(oracle, randomKey("check", "hopeless"), {
      strength: 0,
      difficulty: 100,
    });
    expect(hopeless.probability).toBe(0.05);
    const certain = resolveCheck(oracle, randomKey("check", "certain"), {
      strength: 100,
      difficulty: 0,
    });
    expect(certain.probability).toBe(0.95);
    const custom = resolveCheck(oracle, randomKey("check", "custom"), {
      strength: 0,
      difficulty: 100,
      minimumProbability: 0.01,
      maximumProbability: 0.99,
    });
    expect(custom.probability).toBeCloseTo(0.01, 6);
    expect(() =>
      resolveCheck(oracle, randomKey("check", "bad"), {
        strength: 1,
        difficulty: 1,
        minimumProbability: 0.9,
        maximumProbability: 0.1,
      }),
    ).toThrow(RangeError);
  });

  it("is deterministic per key and success follows the stored draw", () => {
    const oracle = new RandomOracleV1(seed128("0123456789abcdef0123456789abcdef"));
    const key = randomKey("event", "root-access-02", "option-sandbox", "check-escape");
    const a = resolveCheck(oracle, key, { strength: 55, difficulty: 50 });
    const b = resolveCheck(oracle, key, { strength: 55, difficulty: 50 });
    expect(a).toEqual(b);
    expect(a.success).toBe(a.draw < a.probability);
  });
});

describe("effects apply against a single applyEffect call too", () => {
  it("exposes the same behaviour through applyEffect", () => {
    const state = newState();
    const tx = createTransaction(state);
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "cash",
        amount: 1,
      },
      SOURCE,
    );
    const result = tx.commit({ description: "single" });
    expect(lab(result.state).finance.cash).toBe(19);
  });
});
