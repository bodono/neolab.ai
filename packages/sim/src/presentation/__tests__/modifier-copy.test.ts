import { describe, expect, it } from "vitest";

import { modifierEffectPreview, modifierTargetDisplayLabel } from "../modifier-copy.ts";

describe("modifier copy", () => {
  it("preserves AI capitalization in research-domain labels", () => {
    const target = "lab.research.domain.scientific-ai.output";

    expect(modifierTargetDisplayLabel(target)).toBe("Scientific AI research output");
    expect(modifierEffectPreview(target, "multiply", 1.2)).toBe(
      "Scientific AI research output increases by 20%",
    );
  });

  it("uses the same player-facing labels for facility mechanics", () => {
    expect(
      modifierEffectPreview("lab.compute.ownedDeliveryDuration", "multiply", 0.85),
    ).toBe("Owned GPU delivery time decreases by 15%");
    expect(
      modifierEffectPreview("lab.training.technicalFailureHazard", "multiply", 0.8),
    ).toBe("Training technical-failure risk decreases by 20%");
    expect(modifierEffectPreview("lab.research.diffusionRate", "add", 0.25)).toBe(
      "Knowledge diffusion rate +0.25",
    );
  });

  it("describes recurring launch delays without exposing modifier paths", () => {
    expect(modifierEffectPreview("lab.product.durationWeeks", "multiply", 1.08)).toBe(
      "Future model launch time increases by 8%",
    );
  });
});
