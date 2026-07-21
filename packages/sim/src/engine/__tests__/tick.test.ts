import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import type { CommandId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { basisPoints } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { applyCommand } from "../../commands/apply.ts";
import { advanceOneTick } from "../advance-tick.ts";
import { createNewGame } from "../create-new-game.ts";
import { createSystemRegistry, type TickSystem } from "../systems.ts";
import type { DomainEvent } from "../domain-events.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

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

function advanceTicks(
  state: GameState,
  count: number,
): { state: GameState; events: DomainEvent[] } {
  let current = state;
  const events: DomainEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = advanceOneTick(current, content);
    current = result.state;
    events.push(...result.domainEvents);
  }
  return { state: current, events };
}

describe("advanceOneTick", () => {
  it("advances the tick and calendar and emits a summary event", () => {
    const state = newState();
    const result = advanceOneTick(state, content);
    expect(result.state.run.tick).toBe(1);
    expect(result.state.run.calendar).toEqual({ year: 2012, week: 2 });
    expect(result.domainEvents).toContainEqual({ kind: "tick-completed", tick: 0 });
    // Input state untouched.
    expect(state.run.tick).toBe(0);
  });

  it("applies queued allocation orders at the start of the next tick", () => {
    const state = newState();
    const queued = applyCommand(state, content, {
      kind: "set-gpu-allocation",
      meta: {
        commandId: "cmd-1" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      allocation: {
        servingBasisPoints: basisPoints(6000),
        capabilityBasisPoints: basisPoints(8000),
        capabilityDomainWeights: {
          "base:domain.architectures": basisPoints(5000),
          "base:domain.optimisation-scaling": basisPoints(2000),
          "base:domain.data-representation": basisPoints(3000),
        },
        safetyProgramWeights: {
          "base:safety.alignment-control": basisPoints(5000),
          "base:safety.interpretability-evals": basisPoints(4000),
          "base:safety.security-containment": basisPoints(1000),
        },
      },
    });
    const afterTick = advanceOneTick(queued.state, content);
    const lab = afterTick.state.labs[afterTick.state.run.playerLabId];
    expect(lab?.compute.allocation.servingBasisPoints).toBe(6000);
    expect(afterTick.state.run.queuedOrders).toHaveLength(0);
    expect(afterTick.domainEvents).toContainEqual({
      kind: "orders-applied",
      tick: 0,
      count: 1,
    });
  });

  it("marks 13 cycle boundaries and 4 quarter boundaries per 52-week year", () => {
    const { state, events } = advanceTicks(newState(), 52);
    expect(state.run.calendar).toEqual({ year: 2013, week: 1 });
    const cycles = events.filter((event) => event.kind === "cycle-boundary");
    const quarters = events.filter((event) => event.kind === "quarter-boundary");
    expect(cycles).toHaveLength(13);
    expect(quarters).toHaveLength(4);
    expect(cycles[0]).toEqual({ kind: "cycle-boundary", tick: 3 });
    expect(
      quarters.map((event) => (event.kind === "quarter-boundary" ? event.tick : -1)),
    ).toEqual([12, 25, 38, 51]);
  });

  it("clears auto-pause reasons at the start of each tick", () => {
    const state = newState();
    const withPause = structuredClone(state) as unknown as {
      run: { autoPauseReasons: string[] };
    };
    withPause.run.autoPauseReasons = ["manual"];
    const result = advanceOneTick(withPause as unknown as GameState, content);
    expect(result.state.run.autoPauseReasons).toEqual([]);
  });

  it("refuses to advance an ended run", () => {
    const state = structuredClone(newState()) as {
      run: { status: string; endingId?: string };
    };
    state.run.status = "lost";
    state.run.endingId = "base:ending.test";
    expect(() => advanceOneTick(state as unknown as GameState, content)).toThrow(
      /Cannot advance/,
    );
  });

  it("is deterministic: same input state produces identical output", () => {
    const state = newState();
    const a = advanceOneTick(state, content);
    const b = advanceOneTick(state, content);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.domainEvents).toEqual(b.domainEvents);
  });
});

describe("createSystemRegistry", () => {
  const system = (
    id: string,
    phase: TickSystem["phase"],
    priority: number,
  ): TickSystem => ({
    id,
    phase,
    priority,
    run: () => undefined,
  });

  it("sorts by phase order, then priority, then id", () => {
    const sorted = createSystemRegistry([
      system("z", "tick-summary", 0),
      system("b", "apply-orders", 5),
      system("a", "apply-orders", 5.5),
      system("c", "research", 0),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "a", "c", "z"]);
  });

  it("rejects duplicate ids and duplicate phase/priority slots", () => {
    expect(() =>
      createSystemRegistry([system("dup", "serving", 0), system("dup", "papers", 1)]),
    ).toThrow(/Duplicate tick system id/);
    expect(() =>
      createSystemRegistry([system("one", "serving", 0), system("two", "serving", 0)]),
    ).toThrow(/Duplicate phase\/priority/);
  });
});
