import type { Brand } from "@neolab/content-schema";

/**
 * Branded numeric units (TDD section 5.4).
 *
 * Constructors validate programmer input and THROW on invalid values; they
 * never clamp. Game rules that clamp do so explicitly at the rule site.
 */
export type Tick = Brand<number, "Tick">;
export type CashMillions = Brand<number, "CashMillions">;
export type GpuCount = Brand<number, "GpuCount">;
export type GpuWeeks = Brand<number, "GpuWeeks">;
export type Rating = Brand<number, "Rating0To100">;
export type Fraction = Brand<number, "Fraction0To1">;
export type BasisPoints = Brand<number, "BasisPoints0To10000">;

function requireFinite(value: number, unit: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${unit} must be a finite number, got ${String(value)}`);
  }
}

function requireInteger(value: number, unit: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${unit} must be an integer, got ${String(value)}`);
  }
}

function requireRange(value: number, min: number, max: number, unit: string): void {
  if (value < min || value > max) {
    throw new RangeError(`${unit} must be in [${min}, ${max}], got ${String(value)}`);
  }
}

/** Simulated week index, starting at 0 (GDD section 28.1). */
export function tick(value: number): Tick {
  requireFinite(value, "Tick");
  requireInteger(value, "Tick");
  if (value < 0) {
    throw new RangeError(`Tick must be >= 0, got ${String(value)}`);
  }
  return value as Tick;
}

/** Money in millions of game dollars; may be negative (debts, deltas). */
export function cashMillions(value: number): CashMillions {
  requireFinite(value, "CashMillions");
  return value as CashMillions;
}

/** A count of physical GPUs. Always a non-negative integer (TDD section 7.2.1). */
export function gpuCount(value: number): GpuCount {
  requireFinite(value, "GpuCount");
  requireInteger(value, "GpuCount");
  if (value < 0) {
    throw new RangeError(`GpuCount must be >= 0, got ${String(value)}`);
  }
  return value as GpuCount;
}

/** Physical GPUs multiplied by weeks of use; non-negative. */
export function gpuWeeks(value: number): GpuWeeks {
  requireFinite(value, "GpuWeeks");
  if (value < 0) {
    throw new RangeError(`GpuWeeks must be >= 0, got ${String(value)}`);
  }
  return value as GpuWeeks;
}

/** Rating on the canonical 0-100 scale (GDD section 28.3). */
export function rating(value: number): Rating {
  requireFinite(value, "Rating");
  requireRange(value, 0, 100, "Rating");
  return value as Rating;
}

/** Stored fraction in [0, 1], displayed as a percentage (GDD section 28.3). */
export function fraction(value: number): Fraction {
  requireFinite(value, "Fraction");
  requireRange(value, 0, 1, "Fraction");
  return value as Fraction;
}

/** Integer slider value in [0, 10000]; 10000 = 100% (TDD section 16.1). */
export function basisPoints(value: number): BasisPoints {
  requireFinite(value, "BasisPoints");
  requireInteger(value, "BasisPoints");
  requireRange(value, 0, 10_000, "BasisPoints");
  return value as BasisPoints;
}
