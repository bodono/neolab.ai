import type { CompiledContent } from "@neolab/content-schema";

import type { LabId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";
import {
  BASE_MAJOR_PROJECT_SLOTS,
  CRISIS_SLOT_FLOOR,
  MAXIMUM_MAJOR_PROJECT_SLOTS,
  totalMajorProjectSlots,
} from "./slot-policy.ts";

export interface ProjectCapacityView {
  readonly baseMajorProjectSlots: number;
  readonly facilityBonusMajorProjectSlots: number;
  readonly maximumMajorProjectSlots: number;
  readonly majorProjectSlots: number;
  /** One ordinary slot held by an unresolved retirement recovery obligation. */
  readonly recoveryMajorProjectSlots: 0 | 1;
  readonly occupiedMajorProjectSlots: number;
  readonly availableMajorProjectSlots: number;
  /**
   * Slots a NEW crisis project could claim right now. One pool with a
   * floor: crisis work competes for the same slots as everything else,
   * but up to CRISIS_SLOT_FLOOR crisis projects always run even when
   * construction has the campus fully committed. Every commissioned
   * crisis project counts against this — including queued ones, because
   * their costs are already spent and they take a slot ahead of any new
   * commission.
   */
  readonly availableCrisisSlots: number;
  readonly occupiedCrisisSlots: number;
  /**
   * Slots held by every commissioned crisis project that has not
   * finished: queued, active, or paused.
   */
  readonly committedCrisisSlots: number;
}

const RUNNING_STATUSES: readonly string[] = ["active", "paused"];
const COMMITTED_STATUSES: readonly string[] = ["queued", "active", "paused"];

function heldSlots(
  state: Readonly<GameState>,
  labId: LabId,
  kind: "crisis" | "ordinary",
  statuses: readonly string[],
): number {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab.projects.projectIds.reduce((sum, projectId) => {
    const project = state.projects[projectId];
    if (project === undefined || !statuses.includes(project.status)) return sum;
    if ((kind === "crisis") !== (project.kind === "crisis")) return sum;
    return sum + project.reservations.majorProjectSlots;
  }, 0);
}

export function calculateProjectCapacity(
  state: Readonly<GameState>,
  _content: CompiledContent,
  labId: LabId,
): ProjectCapacityView {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const facilityBonusMajorProjectSlots = lab.facilities.instances.reduce(
    (sum, instance) => sum + (instance.majorProjectSlotBonus ?? 0),
    0,
  );
  const majorProjectSlots = totalMajorProjectSlots(facilityBonusMajorProjectSlots);
  const occupiedOrdinarySlots = heldSlots(state, labId, "ordinary", RUNNING_STATUSES);
  const occupiedCrisisSlots = heldSlots(state, labId, "crisis", RUNNING_STATUSES);
  const committedCrisisSlots = heldSlots(state, labId, "crisis", COMMITTED_STATUSES);
  const recoveryMajorProjectSlots =
    state.run.status === "active" &&
    labId === state.run.playerLabId &&
    state.endgameHistory.recoveryObligation !== undefined
      ? 1
      : 0;
  const occupiedMajorProjectSlots =
    occupiedOrdinarySlots + occupiedCrisisSlots + recoveryMajorProjectSlots;
  return {
    baseMajorProjectSlots: BASE_MAJOR_PROJECT_SLOTS,
    facilityBonusMajorProjectSlots,
    maximumMajorProjectSlots: MAXIMUM_MAJOR_PROJECT_SLOTS,
    majorProjectSlots,
    recoveryMajorProjectSlots,
    occupiedMajorProjectSlots,
    availableMajorProjectSlots: Math.max(
      0,
      majorProjectSlots - occupiedMajorProjectSlots,
    ),
    availableCrisisSlots: Math.max(
      majorProjectSlots -
        occupiedOrdinarySlots -
        recoveryMajorProjectSlots -
        committedCrisisSlots,
      CRISIS_SLOT_FLOOR - committedCrisisSlots,
      0,
    ),
    occupiedCrisisSlots,
    committedCrisisSlots,
  };
}
