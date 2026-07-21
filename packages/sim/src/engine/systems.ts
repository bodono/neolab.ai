import type { CompiledContent } from "@neolab/content-schema";

import type { GameCalendar } from "../model/state.ts";
import type { Tick } from "../model/units.ts";
import type { RandomOracle } from "../random/oracle.ts";
import type { SimulationTransaction } from "./transaction.ts";
import { phaseIndex, type TickPhase } from "./tick-phases.ts";

/** Read-only per-tick services for systems (TDD section 9.4). */
export interface TickContext {
  readonly tick: Tick;
  readonly content: CompiledContent;
  readonly random: RandomOracle;
  readonly calendar: GameCalendar;
}

export interface TickSystem {
  readonly id: string;
  readonly phase: TickPhase;
  readonly priority: number;
  run(tx: SimulationTransaction, context: TickContext): void;
}

/**
 * Sorted, validated system registry (TDD section 9.2). Registration is code;
 * content can never inject executable tick systems.
 */
export function createSystemRegistry(
  systems: readonly TickSystem[],
): readonly TickSystem[] {
  const seenIds = new Set<string>();
  const seenSlots = new Set<string>();
  for (const system of systems) {
    if (seenIds.has(system.id)) {
      throw new Error(`Duplicate tick system id "${system.id}"`);
    }
    seenIds.add(system.id);
    const slot = `${system.phase}#${String(system.priority)}`;
    if (seenSlots.has(slot)) {
      throw new Error(
        `Duplicate phase/priority slot ${slot} (system "${system.id}"); ` +
          "give concurrent systems distinct priorities",
      );
    }
    seenSlots.add(slot);
  }
  return [...systems].sort((a, b) => {
    const byPhase = phaseIndex(a.phase) - phaseIndex(b.phase);
    if (byPhase !== 0) return byPhase;
    const byPriority = a.priority - b.priority;
    if (byPriority !== 0) return byPriority;
    return a.id < b.id ? -1 : 1;
  });
}
