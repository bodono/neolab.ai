import type { CompiledContent } from "@neolab/content-schema";

import type { LabId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";
import { calculateProjectCapacity } from "../projects/capacity.ts";
import { CRISIS_SLOT_FLOOR } from "../projects/slot-policy.ts";

export interface CrisisProjectCapacity {
  readonly maximum: number;
  /** Slots held by crisis projects running right now (active or paused). */
  readonly occupied: number;
  /**
   * Slots held by every commissioned crisis project that has not finished
   * (queued, active, or paused). Costs are spent at commissioning time, so
   * this — not `occupied` — is what new commissions are gated on.
   */
  readonly committed: number;
  /** Slots a new commission could still claim, net of `committed`. */
  readonly available: number;
}

/**
 * Crisis workstreams draw from the same major-project pool as everything
 * else, with a floor: up to CRISIS_SLOT_FLOOR run even when construction
 * has every slot committed. Above the floor, capacity is whatever the
 * campus has free — a bigger campus runs a broader crisis response.
 */
export function calculateCrisisProjectCapacity(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): CrisisProjectCapacity {
  const capacity = calculateProjectCapacity(state, content, labId);
  const ordinaryOccupied =
    capacity.occupiedMajorProjectSlots - capacity.occupiedCrisisSlots;
  const maximum = Math.max(
    CRISIS_SLOT_FLOOR,
    capacity.majorProjectSlots - ordinaryOccupied,
  );
  return {
    maximum,
    occupied: capacity.occupiedCrisisSlots,
    committed: capacity.committedCrisisSlots,
    available: capacity.availableCrisisSlots,
  };
}
