import { sha256 } from "@noble/hashes/sha2.js";

import { describeRandomKey, type RandomKey } from "./key.ts";
import type { Seed128 } from "./seed.ts";
import { Xoshiro128StarStar } from "./xoshiro.ts";

/**
 * Deterministic keyed randomness (TDD sections 10.1-10.2).
 *
 * Every semantic key derives an independent generator from the master seed,
 * so adding a new draw anywhere can never perturb existing outcomes. Calling
 * the same method with the same key always returns the same value.
 *
 * Documented draw consumption per call: `uniform`, `triangular`, and
 * `weighted` use one local draw each (rejection sampling in `integer` and
 * `shuffle` may consume more from the same local generator).
 */
export interface RandomOracle {
  uniform(key: RandomKey): number; // [0, 1)
  integer(key: RandomKey, minInclusive: number, maxInclusive: number): number;
  triangular(key: RandomKey, min: number, mode: number, max: number): number;
  weighted<T extends string>(key: RandomKey, weights: Readonly<Record<T, number>>): T;
  shuffle<T>(key: RandomKey, values: readonly T[]): T[];
}

/** Stored in every save; a future V2 must never change a V1 run. */
export const RANDOM_CONTRACT_VERSION = 1;

const DOMAIN = "neolab-rng-v1";
const TWO_32 = 0x1_0000_0000;
const encoder = new TextEncoder();

function lengthPrefixed(chunks: readonly string[]): Uint8Array {
  const encoded = chunks.map((chunk) => encoder.encode(chunk));
  const total = encoded.reduce((sum, bytes) => sum + 4 + bytes.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const bytes of encoded) {
    view.setUint32(offset, bytes.length, false); // unsigned 32-bit big-endian length
    offset += 4;
    out.set(bytes, offset);
    offset += bytes.length;
  }
  return out;
}

export class RandomOracleV1 implements RandomOracle {
  private readonly seed: Seed128;

  constructor(seed: Seed128) {
    this.seed = seed;
  }

  /** Steps 3-6 of the derivation contract (TDD section 10.2). */
  private generatorFor(key: RandomKey): Xoshiro128StarStar {
    const material = lengthPrefixed([DOMAIN, this.seed, ...key.segments]);
    const digest = sha256(material);
    const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
    const s0 = view.getUint32(0, true);
    const s1 = view.getUint32(4, true);
    const s2 = view.getUint32(8, true);
    let s3 = view.getUint32(12, true);
    if (s0 === 0 && s1 === 0 && s2 === 0 && s3 === 0) {
      s3 = 0x9e3779b9;
    }
    const generator = new Xoshiro128StarStar([s0, s1, s2, s3]);
    for (let i = 0; i < 8; i += 1) {
      generator.nextUint32();
    }
    return generator;
  }

  uniform(key: RandomKey): number {
    return this.generatorFor(key).nextUint32() / TWO_32;
  }

  integer(key: RandomKey, minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new RangeError(`integer(${describeRandomKey(key)}) bounds must be integers.`);
    }
    if (minInclusive > maxInclusive) {
      throw new RangeError(
        `integer(${describeRandomKey(key)}) requires min <= max, got ` +
          `${String(minInclusive)} > ${String(maxInclusive)}.`,
      );
    }
    const range = maxInclusive - minInclusive + 1;
    if (range > TWO_32) {
      throw new RangeError(`integer(${describeRandomKey(key)}) range exceeds 2^32.`);
    }
    // Rejection sampling so every integer has equal probability (step 8).
    const generator = this.generatorFor(key);
    const threshold = TWO_32 - (TWO_32 % range);
    for (;;) {
      const draw = generator.nextUint32();
      if (draw < threshold) {
        return minInclusive + (draw % range);
      }
    }
  }

  triangular(key: RandomKey, min: number, mode: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(mode) || !Number.isFinite(max)) {
      throw new RangeError(
        `triangular(${describeRandomKey(key)}) bounds must be finite.`,
      );
    }
    if (!(min <= mode && mode <= max)) {
      throw new RangeError(
        `triangular(${describeRandomKey(key)}) requires min <= mode <= max, got ` +
          `(${String(min)}, ${String(mode)}, ${String(max)}).`,
      );
    }
    if (min === max) {
      return min;
    }
    // Standard inverse triangular CDF over one uniform draw (step 9).
    const u = this.uniform(key);
    const cut = (mode - min) / (max - min);
    if (u < cut) {
      return min + Math.sqrt(u * (max - min) * (mode - min));
    }
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }

  weighted<T extends string>(key: RandomKey, weights: Readonly<Record<T, number>>): T {
    // Stable candidate order by code point (step 10).
    const candidates = (Object.keys(weights) as T[]).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (candidates.length === 0) {
      throw new RangeError(`weighted(${describeRandomKey(key)}) has no candidates.`);
    }
    let total = 0;
    for (const candidate of candidates) {
      const weight = weights[candidate];
      if (!Number.isFinite(weight) || weight < 0) {
        throw new RangeError(
          `weighted(${describeRandomKey(key)}) has invalid weight ` +
            `${String(weight)} for "${candidate}".`,
        );
      }
      total += weight;
    }
    if (total <= 0) {
      throw new RangeError(`weighted(${describeRandomKey(key)}) weights sum to zero.`);
    }
    const draw = this.uniform(key) * total;
    let cumulative = 0;
    for (const candidate of candidates) {
      cumulative += weights[candidate];
      if (cumulative > draw) {
        return candidate;
      }
    }
    // Floating-point tail: the last positively weighted candidate wins.
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const candidate = candidates[i];
      if (candidate !== undefined && weights[candidate] > 0) {
        return candidate;
      }
    }
    throw new Error(`weighted(${describeRandomKey(key)}) selection failed.`);
  }

  shuffle<T>(key: RandomKey, values: readonly T[]): T[] {
    // Unbiased Fisher-Yates from the final index down (step 11), one local
    // generator with rejection-sampled indices.
    const result = [...values];
    const generator = this.generatorFor(key);
    for (let i = result.length - 1; i >= 1; i -= 1) {
      const range = i + 1;
      const threshold = TWO_32 - (TWO_32 % range);
      let draw = generator.nextUint32();
      while (draw >= threshold) {
        draw = generator.nextUint32();
      }
      const j = draw % range;
      const a = result[i] as T;
      result[i] = result[j] as T;
      result[j] = a;
    }
    return result;
  }
}
