/**
 * Public surface of the simulation package (TDD section 33.1).
 *
 * The web app may import ONLY from `@neolab/sim/public`. Everything else in
 * `src/**` is internal and enforced by lint rules.
 *
 * CAUTION (until S2.7): several exports return raw `GameState`, which
 * contains hidden truth (`model.hiddenSafety`, `hiddenInternalCandour`).
 * UI code must not read state directly; the player-safe `projectGameView`
 * projection plus the `assertNoHiddenKeys` guard land in Stage 2 (TDD 20.1),
 * after which views become the only UI-facing data.
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
export { calculateScoreView, type ScoreView } from "./selectors/index.ts";
export {
  createSaveEnvelope,
  loadSaveEnvelope,
  MemorySaveRepository,
  SaveLoadError,
  stateHash,
  type LoadSaveResult,
  type SaveEnvelopeV1,
  type SaveMetadata,
  type SaveRepository,
  type WriteSaveRequest,
} from "./persistence/index.ts";
