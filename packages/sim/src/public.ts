/**
 * Public surface of the simulation package (TDD section 33.1).
 *
 * The web app may import ONLY from `@neolab/sim/public`. Everything else in
 * `src/**` is internal and enforced by lint rules. Hidden state types and
 * privileged selectors are deliberately absent.
 */
export const SIM_PACKAGE = "@neolab/sim";

export { createNewGame, type NewGameConfig } from "./engine/create-new-game.ts";
export { advanceOneTick } from "./engine/advance-tick.ts";
export type { TransitionAudit, TransitionResult } from "./engine/transaction.ts";
export type { DomainEvent } from "./engine/domain-events.ts";
export {
  applyCommand,
  CommandRejectedError,
  validateCommand,
  type CommandMeta,
  type CommandPreview,
  type CommandValidation,
  type GameCommand,
  type RuleViolation,
  type SetGpuAllocationCommand,
} from "./commands/index.ts";
export { seed128, type Seed128 } from "./random/seed.ts";
