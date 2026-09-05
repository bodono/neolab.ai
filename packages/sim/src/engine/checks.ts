import type { RandomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";

/**
 * The single implementation of the GDD section 42.3 logistic check. Event
 * previews, recruitment, politics, and endgame resolution all call this —
 * there must never be a second copy of the formula.
 */
export function logisticProbability(strength: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(strength - difficulty) / 10));
}

export interface CheckRequest {
  readonly strength: number;
  readonly difficulty: number;
  /** Default 0.05 (GDD 42.3). */
  readonly minimumProbability?: number;
  /** Default 0.95 (GDD 42.3). */
  readonly maximumProbability?: number;
}

export interface CheckResolution {
  readonly probability: number;
  readonly draw: number;
  readonly success: boolean;
}

/**
 * The probability resolveCheck would use, without drawing. Exposed so a preview
 * and the check itself cannot disagree -- including on the [0.05, 0.95] clamp,
 * which is easy to forget when reimplementing the curve elsewhere.
 */
export function resolveCheckProbability(
  strength: number,
  difficulty: number,
  minimumProbability = 0.05,
  maximumProbability = 0.95,
): number {
  return Math.min(
    maximumProbability,
    Math.max(minimumProbability, logisticProbability(strength, difficulty)),
  );
}

export function resolveCheck(
  oracle: RandomOracle,
  key: RandomKey,
  request: CheckRequest,
): CheckResolution {
  const min = request.minimumProbability ?? 0.05;
  const max = request.maximumProbability ?? 0.95;
  if (!(min >= 0 && max <= 1 && min <= max)) {
    throw new RangeError(`Invalid probability clamp [${String(min)}, ${String(max)}]`);
  }
  const raw = logisticProbability(request.strength, request.difficulty);
  const probability = Math.min(max, Math.max(min, raw));
  const draw = oracle.uniform(key);
  return { probability, draw, success: draw < probability };
}
