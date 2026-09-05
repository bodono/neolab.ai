/**
 * Canonical weekly update order (GDD section 30.3, TDD section 9.2).
 * The array IS the order; systems are grouped by phase and sorted within it.
 */
export const TICK_PHASES = [
  "apply-orders",
  "deliveries",
  "reserve-capacity",
  "normalise-allocation",
  "serving",
  "research",
  "projects",
  "project-completion",
  "papers",
  "rivals",
  "organisational-update",
  "incidents",
  "event-generation",
  "delayed-effects",
  "cycle-settlement",
  "quarter-update",
  "ending-checks",
  "tick-summary",
] as const;

export type TickPhase = (typeof TICK_PHASES)[number];

const PHASE_INDEX: ReadonlyMap<TickPhase, number> = new Map(
  TICK_PHASES.map((phase, index) => [phase, index]),
);

export function phaseIndex(phase: TickPhase): number {
  const index = PHASE_INDEX.get(phase);
  if (index === undefined) {
    throw new Error(`Unknown tick phase ${String(phase)}`);
  }
  return index;
}
