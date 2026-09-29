import { describe, expect, it } from "vitest";

import { researchLevelProgressPresentation } from "./research-level-progress.ts";

describe("researchLevelProgressPresentation", () => {
  it("describes the band of real progress projected by the simulation", () => {
    expect(researchLevelProgressPresentation(8, [60, 80])).toEqual({
      estimateRange: [60, 80],
      label: "60–80% of the way to Level 9",
      compactLabel: "60–80% → L9",
      ariaValueText: "Level 8; 60 to 80 percent of the way to Level 9",
      complete: false,
    });
  });

  it("starts a fresh level in the lowest band", () => {
    expect(researchLevelProgressPresentation(0, [0, 20]).label).toBe(
      "0–20% of the way to Level 1",
    );
  });

  it("handles the level cap", () => {
    expect(researchLevelProgressPresentation(100, [80, 100]).label).toBe("Maximum level");
  });
});
