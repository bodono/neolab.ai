import { describe, expect, it } from "vitest";

import { researchLevelProgressPresentation } from "./research-level-progress.ts";

describe("researchLevelProgressPresentation", () => {
  it("describes the same deliberately uncertain estimate used by Overview", () => {
    expect(researchLevelProgressPresentation(8, "Hot trail")).toEqual({
      estimateRange: [58, 86],
      label: "58–86% estimated toward Level 9",
      compactLabel: "Est. 58–86% → L9",
      ariaValueText: "Level 8; estimated 58 to 86 percent toward Level 9",
      complete: false,
    });
  });

  it("uses the qualitative momentum ranges rather than canonical RP", () => {
    expect(researchLevelProgressPresentation(0, "Speculative").label).toBe(
      "12–36% estimated toward Level 1",
    );
  });

  it("handles the level cap", () => {
    expect(researchLevelProgressPresentation(100, "Unfunded").label).toBe(
      "Maximum level",
    );
  });
});
