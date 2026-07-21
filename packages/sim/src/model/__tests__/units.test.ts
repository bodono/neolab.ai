import { describe, expect, it } from "vitest";

import {
  basisPoints,
  cashMillions,
  fraction,
  gpuCount,
  gpuWeeks,
  rating,
  tick,
} from "../units.ts";

const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe("tick", () => {
  it("accepts 0 and positive integers", () => {
    expect(tick(0)).toBe(0);
    expect(tick(1040)).toBe(1040);
  });
  it("rejects non-finite, negative, and fractional values", () => {
    for (const bad of NON_FINITE) expect(() => tick(bad)).toThrow(RangeError);
    expect(() => tick(-1)).toThrow(RangeError);
    expect(() => tick(1.5)).toThrow(RangeError);
  });
});

describe("cashMillions", () => {
  it("accepts negative, zero, and positive finite values", () => {
    expect(cashMillions(-3.6)).toBe(-3.6);
    expect(cashMillions(0)).toBe(0);
    expect(cashMillions(18)).toBe(18);
  });
  it("rejects non-finite values", () => {
    for (const bad of NON_FINITE) expect(() => cashMillions(bad)).toThrow(RangeError);
  });
});

describe("gpuCount", () => {
  it("accepts non-negative integers", () => {
    expect(gpuCount(0)).toBe(0);
    expect(gpuCount(10_000)).toBe(10_000);
  });
  it("rejects non-finite, negative, and fractional values", () => {
    for (const bad of NON_FINITE) expect(() => gpuCount(bad)).toThrow(RangeError);
    expect(() => gpuCount(-1)).toThrow(RangeError);
    expect(() => gpuCount(2.5)).toThrow(RangeError);
  });
});

describe("gpuWeeks", () => {
  it("accepts non-negative finite values, including fractions", () => {
    expect(gpuWeeks(0)).toBe(0);
    expect(gpuWeeks(1234.5)).toBe(1234.5);
  });
  it("rejects non-finite and negative values", () => {
    for (const bad of NON_FINITE) expect(() => gpuWeeks(bad)).toThrow(RangeError);
    expect(() => gpuWeeks(-0.1)).toThrow(RangeError);
  });
});

describe("rating", () => {
  it("accepts the closed range [0, 100]", () => {
    expect(rating(0)).toBe(0);
    expect(rating(50.5)).toBe(50.5);
    expect(rating(100)).toBe(100);
  });
  it("rejects out-of-range and non-finite values (no silent clamping)", () => {
    for (const bad of NON_FINITE) expect(() => rating(bad)).toThrow(RangeError);
    expect(() => rating(-0.001)).toThrow(RangeError);
    expect(() => rating(100.001)).toThrow(RangeError);
  });
});

describe("fraction", () => {
  it("accepts the closed range [0, 1]", () => {
    expect(fraction(0)).toBe(0);
    expect(fraction(0.25)).toBe(0.25);
    expect(fraction(1)).toBe(1);
  });
  it("rejects out-of-range and non-finite values", () => {
    for (const bad of NON_FINITE) expect(() => fraction(bad)).toThrow(RangeError);
    expect(() => fraction(-0.001)).toThrow(RangeError);
    expect(() => fraction(1.001)).toThrow(RangeError);
  });
});

describe("basisPoints", () => {
  it("accepts integers in [0, 10000]", () => {
    expect(basisPoints(0)).toBe(0);
    expect(basisPoints(4500)).toBe(4500);
    expect(basisPoints(10_000)).toBe(10_000);
  });
  it("rejects out-of-range, fractional, and non-finite values", () => {
    for (const bad of NON_FINITE) expect(() => basisPoints(bad)).toThrow(RangeError);
    expect(() => basisPoints(-1)).toThrow(RangeError);
    expect(() => basisPoints(10_001)).toThrow(RangeError);
    expect(() => basisPoints(0.5)).toThrow(RangeError);
  });
});
