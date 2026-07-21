import type { CommandId, LabId } from "../model/ids.ts";
import type { GpuAllocationState } from "../model/state.ts";
import type { Tick } from "../model/units.ts";

/**
 * Player intent enters the simulation only through commands (TDD section 8.1).
 * The union grows with each stage; every variant carries `CommandMeta` so
 * stale confirmations are rejected (`expectedTick`).
 */
export interface CommandMeta {
  readonly commandId: CommandId;
  readonly expectedTick: Tick;
  readonly issuedBy: "player" | "tutorial" | "debug";
}

export interface SetGpuAllocationCommand {
  readonly kind: "set-gpu-allocation";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly allocation: GpuAllocationState;
}

export type GameCommand = SetGpuAllocationCommand;

export interface RuleViolation {
  readonly code: string;
  readonly message: string;
}

/**
 * Previews are generated from the same rule functions used by application
 * (TDD section 8.2); the UI must never implement its own cost formula.
 */
export interface CommandPreview {
  readonly summary: string;
  readonly takesEffectAtTick: Tick;
}

export type CommandValidation =
  | { readonly ok: true; readonly preview: CommandPreview }
  | { readonly ok: false; readonly errors: readonly RuleViolation[] };
