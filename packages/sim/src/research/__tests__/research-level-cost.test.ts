import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { researchPointsForNextLevel } from "../research.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const architectures = contentId("base:domain.architectures");
const alignmentControl = contentId("base:safety.alignment-control");
const interpretabilityEvals = contentId("base:safety.interpretability-evals");
const securityContainment = contentId("base:safety.security-containment");

describe("research level costs", () => {
  it("uses distinct late-game growth curves for capability and safety research", () => {
    expect(content.research.rules.levelCostGrowth).toBe(1.1);
    expect(content.research.rules.safetyLevelCostGrowth).toBe(1.15);

    expect(researchPointsForNextLevel(content, architectures, 80)).toBeCloseTo(
      50 * 1.1 ** 60,
    );
    expect(researchPointsForNextLevel(content, alignmentControl, 80)).toBeCloseTo(
      50 * 1.02 * 1.15 ** 60,
    );
  });

  it("keeps safety programme personalities within two percent and neutral on average", () => {
    expect(researchPointsForNextLevel(content, alignmentControl, 20)).toBe(51);
    expect(researchPointsForNextLevel(content, interpretabilityEvals, 20)).toBe(50);
    expect(researchPointsForNextLevel(content, securityContainment, 20)).toBe(49);

    const safetyMultipliers = Object.values(content.research.safetyPrograms)
      .map((program) => program.levelCostMultiplier)
      .sort((left, right) => left - right);
    expect(safetyMultipliers).toEqual([0.98, 1, 1.02]);
    expect(safetyMultipliers.reduce((sum, value) => sum + value, 0) / 3).toBe(1);
  });

  it("does not compound either curve until after level 20", () => {
    expect(researchPointsForNextLevel(content, architectures, 20)).toBe(50);
    expect(researchPointsForNextLevel(content, architectures, 21)).toBeCloseTo(55);
    expect(researchPointsForNextLevel(content, alignmentControl, 21)).toBeCloseTo(
      50 * 1.02 * 1.15,
    );
  });
});
