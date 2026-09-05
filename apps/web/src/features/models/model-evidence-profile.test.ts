import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelEvidenceProfile } from "./model-evidence-profile.tsx";

describe("ModelEvidenceProfile", () => {
  it("keeps detailed model safety readings permanently visible", () => {
    const markup = renderToStaticMarkup(
      createElement(ModelEvidenceProfile, {
        capabilities: [],
        safetyRows: [
          {
            id: "alignment",
            label: "Alignment",
            evaluated: true,
            minimum: 48,
            maximum: 72,
            tone: "uneasy",
          },
        ],
        safetyReportCount: 1,
        independentReportCount: 0,
        dismissedAnomalyCount: 0,
      }),
    );

    expect(markup).toContain("Alignment, corrigibility, deception and awareness");
    expect(markup).toContain("Warnings are evidence. Clean results are not proof.");
    expect(markup).toContain("48–72");
    expect(markup).not.toContain('<details class="model-safety-summary"');
  });

  it("explains deceptive intent separately from strategic deception capability", () => {
    const markup = renderToStaticMarkup(
      createElement(ModelEvidenceProfile, {
        capabilities: [],
        safetyRows: [],
        safetyReportCount: 0,
        independentReportCount: 0,
        dismissedAnomalyCount: 0,
        explainDeceptionMechanics: true,
      }),
    );

    expect(markup).toContain("DECEPTION // TWO DIFFERENT RISKS");
    expect(markup).toContain("Deceptive intent");
    expect(markup).toContain("true intent above 65");
    expect(markup).toContain("Strategic deception capability");
    expect(markup).toContain("does not itself imply misalignment");
  });

  it("explains every capability and safety trait in practical terms", () => {
    const markup = renderToStaticMarkup(
      createElement(ModelEvidenceProfile, {
        capabilities: [
          { id: "language", label: "Language", value: 50 },
          { id: "reasoning", label: "Reasoning", value: 50 },
          { id: "agency", label: "Agency", value: 50 },
          { id: "toolUse", label: "Tool use", value: 50 },
          { id: "multimodality", label: "Multimodality", value: 50 },
          { id: "scientificAbility", label: "Scientific ability", value: 50 },
          { id: "embodiment", label: "Embodiment", value: 50 },
        ],
        safetyRows: [
          {
            id: "true-alignment",
            label: "Alignment",
            evaluated: true,
            minimum: 40,
            maximum: 60,
            tone: "uneasy",
          },
          {
            id: "corrigibility",
            label: "Corrigibility",
            evaluated: true,
            minimum: 40,
            maximum: 60,
            tone: "uneasy",
          },
          {
            id: "situational-awareness",
            label: "Situational awareness",
            evaluated: true,
            minimum: 40,
            maximum: 60,
            tone: "uneasy",
          },
          {
            id: "deceptive-capability",
            label: "Deception risk",
            evaluated: true,
            minimum: 40,
            maximum: 60,
            tone: "uneasy",
          },
        ],
        safetyReportCount: 1,
        independentReportCount: 0,
        dismissedAnomalyCount: 0,
      }),
    );

    for (const label of [
      "Language",
      "Reasoning",
      "Agency",
      "Tool use",
      "Multimodality",
      "Scientific ability",
      "Embodiment",
      "Alignment",
      "Corrigibility",
      "Situational awareness",
      "Deception risk",
    ]) {
      expect(markup).toContain(`aria-label="Explain ${label}"`);
    }
    expect(markup.match(/class="mechanic-help"/g)).toHaveLength(11);
    expect(markup).toContain("goal changes, or shutdown without resisting");
    expect(markup).toContain("Higher is more dangerous");
  });
});
