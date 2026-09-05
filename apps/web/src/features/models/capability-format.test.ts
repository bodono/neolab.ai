import { describe, expect, it } from "vitest";

import { displayedCapabilityScore, formatCapabilityScore } from "./capability-format.ts";

describe("capability score presentation", () => {
  it("never rounds a sub-threshold score up through an integer gate", () => {
    expect(displayedCapabilityScore(87.999)).toBe(87.9);
    expect(formatCapabilityScore(87.999)).toBe("87.9");
    expect(formatCapabilityScore(79.999)).toBe("79.9");
  });

  it("keeps exact integer assessments compact", () => {
    expect(formatCapabilityScore(88)).toBe("88");
    expect(formatCapabilityScore(100)).toBe("100");
  });
});
