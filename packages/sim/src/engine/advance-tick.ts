import type { CompiledContent } from "@neolab/content-schema";

import { assertNever } from "../model/assert-never.ts";
import { calendarFromTick, type GameState } from "../model/state.ts";
import { tick as makeTick } from "../model/units.ts";
import { RandomOracleV1 } from "../random/oracle.ts";
import { applyEffects } from "./effect-executor.ts";
import { createSystemRegistry, type TickContext, type TickSystem } from "./systems.ts";
import { createTransaction, type TransitionResult } from "./transaction.ts";

/** Ticks per financial cycle and per quarter (GDD section 28.1). */
export const TICKS_PER_CYCLE = 4;
export const TICKS_PER_QUARTER = 13;

/**
 * Baseline system set for the walking skeleton. Stages 2+ append real
 * economy/research/rival systems into their canonical phases.
 */
function baselineSystems(): readonly TickSystem[] {
  return [
    {
      id: "orders.apply-queued",
      phase: "apply-orders",
      priority: 0,
      run(tx): void {
        tx.update((draft) => {
          const orders = draft.run.queuedOrders;
          if (orders.length === 0) return;
          for (const order of orders) {
            switch (order.kind) {
              case "set-gpu-allocation": {
                const lab = draft.labs[order.labId];
                if (lab !== undefined) {
                  lab.compute.allocation = order.allocation;
                }
                break;
              }
              default:
                assertNever(order.kind);
            }
          }
          draft.run.queuedOrders = [];
        });
        const applied = tx.before.run.queuedOrders.length;
        if (applied > 0) {
          tx.emit({
            kind: "orders-applied",
            tick: tx.before.run.tick,
            count: applied,
          });
        }
      },
    },
    {
      id: "effects.apply-delayed",
      phase: "delayed-effects",
      priority: 0,
      run(tx, context): void {
        // Scheduled consequences fire when their tick arrives (TDD 8.4, GDD
        // 43 delayed effects). Drained to a fixpoint: an effect scheduled with
        // dueInWeeks 0 while this phase runs fires in the SAME tick, so a
        // nested chain can never strand a past-due entry for the commit
        // invariants to reject (review finding: run-bricking softlock).
        const MAX_DRAIN_ROUNDS = 100;
        for (let round = 0; ; round += 1) {
          const due = tx
            .read()
            .scheduledEffects.filter((scheduled) => scheduled.dueAt <= context.tick);
          if (due.length === 0) return;
          if (round >= MAX_DRAIN_ROUNDS) {
            throw new Error(
              `delayed-effects did not settle after ${String(MAX_DRAIN_ROUNDS)} rounds — ` +
                "a scheduled effect is re-scheduling itself with dueInWeeks 0",
            );
          }
          tx.update((draft) => {
            draft.scheduledEffects = draft.scheduledEffects.filter(
              (scheduled) => scheduled.dueAt > context.tick,
            );
          });
          for (const scheduled of due) {
            applyEffects(tx, scheduled.effects, scheduled.source);
          }
        }
      },
    },
    {
      id: "finance.cycle-boundary",
      phase: "cycle-settlement",
      priority: 0,
      run(tx, context): void {
        if ((context.tick + 1) % TICKS_PER_CYCLE === 0) {
          tx.emit({ kind: "cycle-boundary", tick: context.tick });
        }
      },
    },
    {
      id: "world.quarter-boundary",
      phase: "quarter-update",
      priority: 0,
      run(tx, context): void {
        if ((context.tick + 1) % TICKS_PER_QUARTER === 0) {
          tx.emit({ kind: "quarter-boundary", tick: context.tick });
        }
      },
    },
    {
      id: "summary.advance-date",
      phase: "tick-summary",
      priority: 0,
      run(tx, context): void {
        // GDD 30.3 step 18: write the tick summary and advance the date.
        tx.emit({ kind: "tick-completed", tick: context.tick });
        tx.update((draft) => {
          const next = context.tick + 1;
          draft.run.tick = makeTick(next);
          draft.run.calendar = calendarFromTick(next);
        });
      },
    },
  ];
}

const REGISTRY = createSystemRegistry(baselineSystems());

/**
 * Advance exactly one atomic, ordered week (TDD section 9.1). Fast-forward is
 * a loop over this function — there is no multi-week shortcut.
 */
export function advanceOneTick(
  state: GameState,
  content: CompiledContent,
): TransitionResult {
  if (state.run.status !== "active") {
    throw new Error(`Cannot advance a ${state.run.status} run`);
  }

  const tx = createTransaction(state);
  // Auto-pause reasons are outputs of a single tick; clear before running.
  tx.update((draft) => {
    draft.run.autoPauseReasons = [];
  });

  const context: TickContext = {
    tick: state.run.tick,
    content,
    random: new RandomOracleV1(state.run.seed),
    calendar: state.run.calendar,
  };

  for (const system of REGISTRY) {
    system.run(tx, context);
  }

  return tx.commit({ description: `tick ${String(state.run.tick)}` });
}
