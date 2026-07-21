import type { CompiledContent } from "@neolab/content-schema";

import { assertNever } from "../model/assert-never.ts";
import { gpuAllocationSchema } from "../model/schema.ts";
import type { GameState } from "../model/state.ts";
import { tick } from "../model/units.ts";
import { hasLargeCapabilityDomainSwing } from "../compute/gpu-portfolio.ts";
import type {
  CommandValidation,
  GameCommand,
  RuleViolation,
  SetGpuAllocationCommand,
} from "./types.ts";

const ALLOCATION_SUM = 10_000;

function validateSetGpuAllocation(
  state: GameState,
  command: SetGpuAllocationCommand,
  errors: RuleViolation[],
): void {
  const lab = state.labs[command.labId];
  if (lab === undefined) {
    errors.push({ code: "unknown-lab", message: `No lab ${command.labId}` });
    return;
  }
  if (lab.control !== "player") {
    errors.push({
      code: "not-player-lab",
      message: "Only the player lab accepts direct allocation commands",
    });
    return;
  }
  // Runtime boundary validation (TDD 8.2): the web app cannot enforce
  // compile-time types, and an unvalidated payload that reaches canonical
  // state would make later saves unloadable under the strict load schema.
  const parsedAllocation = gpuAllocationSchema.safeParse(command.allocation);
  if (!parsedAllocation.success) {
    const issue = parsedAllocation.error.issues[0];
    errors.push({
      code: "malformed-allocation",
      message: `Allocation payload invalid at "${issue?.path.join(".") ?? ""}": ${issue?.message ?? "?"}`,
    });
    return;
  }
  const allocation = parsedAllocation.data;
  const domainSum = Object.values(allocation.capabilityDomainWeights).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (domainSum !== ALLOCATION_SUM) {
    errors.push({
      code: "allocation-sum",
      message: `Capability domain weights must sum to 10000 basis points, got ${String(domainSum)}`,
    });
  }
  const safetySum = Object.values(allocation.safetyProgramWeights).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (safetySum !== ALLOCATION_SUM) {
    errors.push({
      code: "allocation-sum",
      message: `Safety programme weights must sum to 10000 basis points, got ${String(safetySum)}`,
    });
  }
  for (const domainId of Object.keys(allocation.capabilityDomainWeights)) {
    if (!(domainId in lab.research.domains)) {
      errors.push({
        code: "unknown-domain",
        message: `Allocation references locked or unknown domain ${domainId}`,
      });
    }
  }
}

export function validateCommand(
  state: GameState,
  _content: CompiledContent,
  command: GameCommand,
): CommandValidation {
  const errors: RuleViolation[] = [];

  if (state.run.status !== "active") {
    errors.push({ code: "run-ended", message: "The run has already ended" });
  }
  // Stale-confirmation rejection (TDD section 8.1).
  if (command.meta.expectedTick !== state.run.tick) {
    errors.push({
      code: "stale-command",
      message:
        `Command was issued for tick ${String(command.meta.expectedTick)} but the ` +
        `simulation is at tick ${String(state.run.tick)}; review updated costs`,
    });
  }

  if (errors.length === 0) {
    switch (command.kind) {
      case "set-gpu-allocation":
        validateSetGpuAllocation(state, command, errors);
        break;
      default:
        assertNever(command.kind);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const summary = (() => {
    switch (command.kind) {
      case "set-gpu-allocation": {
        const current = state.labs[command.labId]?.compute.allocation;
        return current !== undefined &&
          hasLargeCapabilityDomainSwing(current, command.allocation)
          ? "Allocation queued; takes effect next week with a one-week context-switch penalty"
          : "Allocation queued; takes effect next week";
      }
      default:
        return assertNever(command.kind);
    }
  })();
  return {
    ok: true,
    preview: {
      summary,
      takesEffectAtTick: tick(state.run.tick + 1),
    },
  };
}
