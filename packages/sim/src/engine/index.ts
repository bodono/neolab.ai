export { createNewGame, type NewGameConfig } from "./create-new-game.ts";
export { advanceOneTick, TICKS_PER_CYCLE, TICKS_PER_QUARTER } from "./advance-tick.ts";
export {
  createTransaction,
  deepFreeze,
  type SimulationTransaction,
  type StateUpdater,
  type TransitionAudit,
  type TransitionResult,
} from "./transaction.ts";
export type { DomainEvent } from "./domain-events.ts";
export type { DeepMutable } from "./draft.ts";
export {
  assertInvariants,
  collectInvariantViolations,
  InvariantError,
  type InvariantViolation,
} from "./invariants.ts";
export { applyEffect, applyEffects } from "./effect-executor.ts";
export { isModifierTarget, MODIFIER_TARGETS } from "./modifier-targets.ts";
export {
  resolveModifierValue,
  type ModifierBreakdown,
  type ModifierContribution,
} from "./modifier-resolver.ts";
export {
  evaluatePredicate,
  METRIC_REGISTRY,
  readMetric,
  type ComparisonOp,
  type MetricKey,
  type Predicate,
} from "./predicates.ts";
export {
  logisticProbability,
  resolveCheck,
  type CheckRequest,
  type CheckResolution,
} from "./checks.ts";
export { createSystemRegistry, type TickContext, type TickSystem } from "./systems.ts";
export { phaseIndex, TICK_PHASES, type TickPhase } from "./tick-phases.ts";
