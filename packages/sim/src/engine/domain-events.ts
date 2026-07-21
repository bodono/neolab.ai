import type { LabId } from "../model/ids.ts";
import type { Tick } from "../model/units.ts";

/**
 * Internal facts emitted by the engine (TDD section 8.4). Domain events are
 * typed signals for rules, UI moments, and autosaves — never canonical state.
 * The union grows with each stage; switches over it must stay exhaustive.
 */
export type DomainEvent =
  | { readonly kind: "order-queued"; readonly labId: LabId; readonly order: string }
  | { readonly kind: "orders-applied"; readonly tick: Tick; readonly count: number }
  | { readonly kind: "tick-completed"; readonly tick: Tick }
  | { readonly kind: "cycle-boundary"; readonly tick: Tick }
  | { readonly kind: "quarter-boundary"; readonly tick: Tick }
  | { readonly kind: "run-ended"; readonly result: "won" | "lost" };
