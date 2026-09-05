import { describe, expect, it } from "vitest";

import { formatScientificFlop, formatTotalFlop } from "../flops.ts";

describe("formatTotalFlop", () => {
  it("normalises large quantities to one-decimal scientific notation", () => {
    expect(formatTotalFlop(1e27)).toBe("1.0 × 10²⁷ FLOP");
    expect(formatTotalFlop(2.5e28)).toBe("2.5 × 10²⁸ FLOP");
    expect(formatTotalFlop(2.2e29)).toBe("2.2 × 10²⁹ FLOP");
  });

  it("carries rounding into the exponent without producing a two-digit mantissa", () => {
    expect(formatTotalFlop(9.96e28)).toBe("1.0 × 10²⁹ FLOP");
  });

  it("can force scientific notation below the generic large-number threshold", () => {
    expect(formatScientificFlop(5e26)).toBe("5.0 × 10²⁶ FLOP");
  });
});
