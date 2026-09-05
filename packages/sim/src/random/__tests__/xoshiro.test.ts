import { describe, expect, it } from "vitest";

import { Xoshiro128StarStar } from "../xoshiro.ts";

describe("Xoshiro128StarStar", () => {
  it("matches the reference algorithm on a hand-computed sequence", () => {
    // From the published transition: with state [1, 2, 3, 4]
    //   #1: rotl(2*5, 7) * 9 = 1280 * 9        = 11520
    //   #2: s1 becomes 0, so the output is 0
    //   #3: rotl(1029*5, 7) * 9 = 658560 * 9    = 5927040
    const generator = new Xoshiro128StarStar([1, 2, 3, 4]);
    expect(generator.nextUint32()).toBe(11520);
    expect(generator.nextUint32()).toBe(0);
    expect(generator.nextUint32()).toBe(5927040);
  });

  it("stays within unsigned 32-bit range", () => {
    const generator = new Xoshiro128StarStar([0xdeadbeef, 0xcafebabe, 0x8badf00d, 1]);
    for (let i = 0; i < 1000; i += 1) {
      const value = generator.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(0x1_0000_0000);
    }
  });

  it("rejects the all-zero state", () => {
    expect(() => new Xoshiro128StarStar([0, 0, 0, 0])).toThrow(RangeError);
  });
});
