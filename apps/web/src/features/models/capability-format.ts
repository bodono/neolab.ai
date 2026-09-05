import { capabilityScoreForDisplay } from "@neolab/sim/public";

/**
 * Capability gates use the simulation's exact score. Player-facing readings
 * therefore truncate to one decimal place instead of rounding up through a
 * threshold: 87.99 must never be presented as 88 while it remains below the
 * FC 88 candidacy gate.
 */
export function displayedCapabilityScore(value: number): number {
  return capabilityScoreForDisplay(value);
}

export function formatCapabilityScore(value: number): string {
  return displayedCapabilityScore(value).toFixed(1).replace(/\.0$/, "");
}
