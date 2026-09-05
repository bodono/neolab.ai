export const MAXIMUM_MAJOR_PROJECT_SLOTS = 5;

/** Every lab runs two concurrent major projects before any campus expansion. */
export const BASE_MAJOR_PROJECT_SLOTS = 2;

/**
 * Crisis workstreams always find room: up to this many run even when the
 * campus is fully committed to construction. Above the floor, crisis
 * projects compete for the same slots as everything else — there is one
 * pool, and the only way to grow it is to build.
 */
export const CRISIS_SLOT_FLOOR = 2;

/** Facility expansion adds slots, but never beyond the absolute lab maximum. */
export function totalMajorProjectSlots(facilityBonusSlots: number): number {
  return Math.min(
    MAXIMUM_MAJOR_PROJECT_SLOTS,
    BASE_MAJOR_PROJECT_SLOTS + facilityBonusSlots,
  );
}
