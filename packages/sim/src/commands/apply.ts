import type { CompiledContent } from "@neolab/content-schema";

import { assertNever } from "../model/assert-never.ts";
import type { GameState } from "../model/state.ts";
import { createTransaction, type TransitionResult } from "../engine/transaction.ts";
import type { GameCommand } from "./types.ts";
import { validateCommand } from "./validate.ts";

export class CommandRejectedError extends Error {
  readonly codes: readonly string[];

  constructor(codes: readonly string[], detail: string) {
    super(`Command rejected: ${detail}`);
    this.name = "CommandRejectedError";
    this.codes = codes;
  }
}

/**
 * Validate and atomically apply one command (TDD section 8.2). Allocation and
 * policy commands queue an order for the next tick (TDD section 8.3); no cost
 * is ever partially paid.
 */
export function applyCommand(
  state: GameState,
  content: CompiledContent,
  command: GameCommand,
): TransitionResult {
  const validation = validateCommand(state, content, command);
  if (!validation.ok) {
    throw new CommandRejectedError(
      validation.errors.map((error) => error.code),
      validation.errors.map((error) => error.message).join("; "),
    );
  }

  const tx = createTransaction(state);
  switch (command.kind) {
    case "set-gpu-allocation": {
      tx.update((draft) => {
        // Replace any earlier queued allocation for the same lab: the last
        // order issued during a pause wins (GDD section 30.2).
        draft.run.queuedOrders = draft.run.queuedOrders.filter(
          (order) =>
            !(order.kind === "set-gpu-allocation" && order.labId === command.labId),
        );
        draft.run.queuedOrders.push({
          kind: "set-gpu-allocation",
          labId: command.labId,
          allocation: structuredClone(command.allocation),
        });
      });
      tx.emit({
        kind: "order-queued",
        labId: command.labId,
        order: "set-gpu-allocation",
      });
      break;
    }
    default:
      assertNever(command.kind);
  }

  return tx.commit({
    description: `command ${command.kind}`,
    commandId: command.meta.commandId,
  });
}
