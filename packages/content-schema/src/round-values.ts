/**
 * The owner's content rule: every player-facing bonus is real, visible and
 * round. One definition of "round" serves the compiler's release lint, the
 * compiler's own derived values and the few terms the simulation authors in
 * TypeScript, so the three cannot drift apart.
 *
 * - A multiplicative effect is round when its percentage change,
 *   (value - 1) x 100, is a multiple of 5: x1.05, x1.10, x0.95 and x0.80 are
 *   round; x1.025, x1.08 and x0.968 are not. A value that is already written
 *   as the exact reciprocal of a round multiplier (x0.952381 undoes x1.05) is
 *   accepted as it stands, but rounding never produces one.
 * - An additive effect is round when it is a whole number below 10 in
 *   magnitude, or a multiple of 5 from 10 upwards.
 */
export type RoundedEffectOperation = "add" | "multiply";

/** Percentage step for multiplicative effects. */
export const ROUND_PERCENTAGE_STEP = 5;
/** Additive step once a value reaches `ROUND_ADDITIVE_COARSE_FROM` in magnitude. */
export const ROUND_ADDITIVE_COARSE_STEP = 5;
export const ROUND_ADDITIVE_COARSE_FROM = 10;

const QUOTIENT_TOLERANCE = 1e-6;
const RECIPROCAL_TOLERANCE = 1e-6;

function isMultipleOf(value: number, step: number): boolean {
  const quotient = value / step;
  return Math.abs(quotient - Math.round(quotient)) < QUOTIENT_TOLERANCE;
}

/** Percentage change of a multiplier, with float noise (1.12 - 1 = 0.12000000000000011) removed. */
function percentageChange(multiplier: number): number {
  return Math.round((multiplier - 1) * 100 * 1e6) / 1e6;
}

function isExactReciprocalOfRoundMultiplier(value: number): boolean {
  if (value <= 0) return false;
  const reciprocalSteps = Math.round(percentageChange(1 / value) / ROUND_PERCENTAGE_STEP);
  if (reciprocalSteps === 0) return false;
  const roundMultiplier = 1 + (reciprocalSteps * ROUND_PERCENTAGE_STEP) / 100;
  return Math.abs(value * roundMultiplier - 1) <= RECIPROCAL_TOLERANCE;
}

export function isRoundEffectValue(
  operation: RoundedEffectOperation,
  value: number,
): boolean {
  if (!Number.isFinite(value)) return false;
  if (operation === "multiply") {
    return (
      isMultipleOf(percentageChange(value), ROUND_PERCENTAGE_STEP) ||
      isExactReciprocalOfRoundMultiplier(value)
    );
  }
  const magnitude = Math.abs(value);
  return magnitude >= ROUND_ADDITIVE_COARSE_FROM
    ? isMultipleOf(magnitude, ROUND_ADDITIVE_COARSE_STEP)
    : isMultipleOf(magnitude, 1);
}

/**
 * The nearest round value that keeps the effect pointing the same way. A
 * bonus never becomes a penalty and never rounds away to nothing: when the
 * nearest round value would be x1.00 or 0, the smallest round step is used
 * instead (x1.05 / x0.95, or +1 / -1). Exact halves round away from zero.
 */
export function nearestRoundEffectValue(
  operation: RoundedEffectOperation,
  value: number,
): number {
  if (isRoundEffectValue(operation, value)) return value;
  if (operation === "multiply") {
    const percentage = percentageChange(value);
    const direction = Math.sign(percentage);
    let steps = Math.max(1, Math.round(Math.abs(percentage) / ROUND_PERCENTAGE_STEP));
    // A positive multiplier stays positive: a -100% "discount" deletes the thing.
    if (value > 0 && direction < 0) {
      steps = Math.min(steps, 100 / ROUND_PERCENTAGE_STEP - 1);
    }
    const roundPercentage = direction * steps * ROUND_PERCENTAGE_STEP;
    return Math.round(100 + roundPercentage) / 100;
  }
  const direction = Math.sign(value);
  const magnitude = Math.abs(value);
  const rounded =
    magnitude >= ROUND_ADDITIVE_COARSE_FROM
      ? Math.round(magnitude / ROUND_ADDITIVE_COARSE_STEP) * ROUND_ADDITIVE_COARSE_STEP
      : Math.max(1, Math.round(magnitude));
  return direction * rounded;
}
