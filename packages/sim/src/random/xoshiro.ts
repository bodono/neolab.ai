/**
 * xoshiro128** 1.1, following the public-domain reference implementation by
 * David Blackman and Sebastiano Vigna (https://prng.di.unimi.it/xoshiro128starstar.c),
 * translated to unsigned 32-bit JavaScript arithmetic. This is deterministic
 * game infrastructure, not a security mechanism (TDD section 10.2).
 */

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Xoshiro128StarStar {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: readonly [number, number, number, number]) {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
    if (this.s0 === 0 && this.s1 === 0 && this.s2 === 0 && this.s3 === 0) {
      throw new RangeError("xoshiro128** state must not be all zero.");
    }
  }

  /** Next unsigned 32-bit output. */
  nextUint32(): number {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }
}
