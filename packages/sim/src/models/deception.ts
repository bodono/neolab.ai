function clampRating(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Hidden intent above this value excludes the safest deployment outcomes. */
export const SAFEST_ENDING_MAX_DECEPTIVE_INTENT = 65;

/**
 * Pressure for behaviour that requires both the ability and the willingness
 * to deceive. Capability answers "could it?"; intent answers "would it?".
 */
export function deceptiveActionPressure(
  deceptiveCapability: number,
  deceptiveIntent: number,
): number {
  return (clampRating(deceptiveCapability) * clampRating(deceptiveIntent)) / 100;
}
