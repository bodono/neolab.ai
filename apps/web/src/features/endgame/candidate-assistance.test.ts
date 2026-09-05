import { describe, expect, it } from "vitest";

import { candidateAssistanceMultiplier } from "./candidate-assistance.ts";

describe("candidateAssistanceMultiplier", () => {
  it.each([
    [0, "×1"],
    [20, "×1.2"],
    [50, "×1.5"],
    [200, "×3"],
    [500, "×6"],
  ])("renders +%s%% as the unambiguous %s speed multiplier", (percent, label) => {
    expect(candidateAssistanceMultiplier(percent)).toBe(label);
  });
});
