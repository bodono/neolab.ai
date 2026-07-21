import { describe, expect, it } from "vitest";

import { randomKey } from "../key.ts";
import { RandomOracleV1 } from "../oracle.ts";
import { seed128 } from "../seed.ts";

const SEED = seed128("0123456789abcdef0123456789abcdef");
const OTHER_SEED = seed128("fedcba9876543210fedcba9876543210");

function oracle(): RandomOracleV1 {
  return new RandomOracleV1(SEED);
}

describe("uniform", () => {
  it("is deterministic per (seed, key) and independent of call order", () => {
    const a = oracle();
    const b = oracle();
    const key = randomKey("training", "model-07", "reasoning");
    const first = a.uniform(key);
    a.uniform(randomKey("unrelated", "draw"));
    expect(a.uniform(key)).toBe(first);
    b.uniform(randomKey("something", "else", "entirely"));
    expect(b.uniform(key)).toBe(first);
  });

  it("differs across seeds and keys", () => {
    const key = randomKey("event", "root-access-02", "check-escape");
    expect(oracle().uniform(key)).not.toBe(new RandomOracleV1(OTHER_SEED).uniform(key));
    expect(oracle().uniform(key)).not.toBe(
      oracle().uniform(randomKey("event", "root-access-02", "check-escapf")),
    );
  });

  it("stays in [0, 1) and covers the range reasonably", () => {
    const rng = oracle();
    let min = 1;
    let max = 0;
    for (let i = 0; i < 2000; i += 1) {
      const u = rng.uniform(randomKey("coverage", String(i)));
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      min = Math.min(min, u);
      max = Math.max(max, u);
    }
    expect(min).toBeLessThan(0.05);
    expect(max).toBeGreaterThan(0.95);
  });
});

describe("integer", () => {
  it("honours inclusive bounds and reaches both endpoints", () => {
    const rng = oracle();
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const value = rng.integer(randomKey("int", String(i)), 3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it("handles a single-value range", () => {
    expect(oracle().integer(randomKey("int", "solo"), 42, 42)).toBe(42);
  });

  it("rejects invalid bounds", () => {
    const rng = oracle();
    expect(() => rng.integer(randomKey("bad"), 5, 4)).toThrow(RangeError);
    expect(() => rng.integer(randomKey("bad"), 0.5, 4)).toThrow(RangeError);
  });
});

describe("triangular", () => {
  it("stays within [min, max] and validates ordering", () => {
    const rng = oracle();
    for (let i = 0; i < 500; i += 1) {
      const value = rng.triangular(randomKey("tri", String(i)), 0.9, 1.0, 1.1);
      expect(value).toBeGreaterThanOrEqual(0.9);
      expect(value).toBeLessThanOrEqual(1.1);
    }
    expect(() => rng.triangular(randomKey("tri", "bad"), 1, 0.5, 2)).toThrow(RangeError);
    expect(() => rng.triangular(randomKey("tri", "bad"), 1, 3, 2)).toThrow(RangeError);
    expect(() => rng.triangular(randomKey("tri", "bad"), Number.NaN, 1, 2)).toThrow(
      RangeError,
    );
  });

  it("returns min when the range is degenerate", () => {
    expect(oracle().triangular(randomKey("tri", "flat"), 2, 2, 2)).toBe(2);
  });
});

describe("weighted", () => {
  it("never selects zero-weight candidates", () => {
    const rng = oracle();
    for (let i = 0; i < 300; i += 1) {
      const choice = rng.weighted(randomKey("weighted", String(i)), {
        never: 0,
        sometimes: 1,
        often: 3,
      });
      expect(choice).not.toBe("never");
    }
  });

  it("is deterministic and insensitive to declaration order", () => {
    const key = randomKey("weighted", "stable");
    const a = oracle().weighted(key, { alpha: 1, beta: 2, gamma: 3 });
    const b = oracle().weighted(key, { gamma: 3, alpha: 1, beta: 2 });
    expect(a).toBe(b);
  });

  it("rejects invalid weight sets", () => {
    const rng = oracle();
    const key = randomKey("weighted", "invalid");
    expect(() => rng.weighted(key, {})).toThrow(RangeError);
    expect(() => rng.weighted(key, { a: 0, b: 0 })).toThrow(RangeError);
    expect(() => rng.weighted(key, { a: -1, b: 2 })).toThrow(RangeError);
    expect(() => rng.weighted(key, { a: Number.NaN })).toThrow(RangeError);
    expect(() => rng.weighted(key, { a: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe("shuffle", () => {
  it("returns a deterministic permutation without mutating the input", () => {
    const input = ["a", "b", "c", "d", "e", "f", "g"];
    const frozen = [...input];
    const key = randomKey("shuffle", "labs");
    const once = oracle().shuffle(key, input);
    const twice = oracle().shuffle(key, input);
    expect(input).toEqual(frozen);
    expect(once).toEqual(twice);
    expect([...once].sort()).toEqual([...frozen].sort());
  });

  it("handles empty and single-element arrays", () => {
    expect(oracle().shuffle(randomKey("shuffle", "empty"), [])).toEqual([]);
    expect(oracle().shuffle(randomKey("shuffle", "one"), [1])).toEqual([1]);
  });

  it("produces different orders for different keys (sanity)", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const a = oracle().shuffle(randomKey("shuffle", "a"), input);
    const b = oracle().shuffle(randomKey("shuffle", "b"), input);
    expect(a).not.toEqual(b);
  });
});

describe("seed and key validation", () => {
  it("canonicalises seeds", () => {
    expect(seed128("0X0123456789ABCDEF0123456789ABCDEF")).toBe(
      "0123456789abcdef0123456789abcdef",
    );
    expect(() => seed128("123")).toThrow(RangeError);
    expect(() => seed128("zz23456789abcdef0123456789abcdef")).toThrow(RangeError);
  });

  it("validates key segments", () => {
    expect(() => randomKey()).toThrow(RangeError);
    expect(() => randomKey("ok", "")).toThrow(RangeError);
    expect(() => randomKey("bad\u0000segment")).toThrow(RangeError);
    expect(() => randomKey("bad\nsegment")).toThrow(RangeError);
    expect(randomKey("spaces are fine").segments).toEqual(["spaces are fine"]);
  });

  it("length-prefixing prevents segment-boundary collisions", () => {
    const rng = oracle();
    expect(rng.uniform(randomKey("a/b", "c"))).not.toBe(
      rng.uniform(randomKey("a", "b/c")),
    );
    expect(rng.uniform(randomKey("ab", "c"))).not.toBe(rng.uniform(randomKey("a", "bc")));
  });
});
