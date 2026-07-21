import type { CompiledContent } from "@neolab/content-schema";

import { assertNever } from "../model/assert-never.ts";
import type { GameState } from "../model/state.ts";
import { tick } from "../model/units.ts";
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
  const allocation = command.allocation;
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
  return {
    ok: true,
    preview: {
      summary: "Allocation queued; takes effect next week",
      takesEffectAtTick: tick(state.run.tick + 1),
    },
  };
}
