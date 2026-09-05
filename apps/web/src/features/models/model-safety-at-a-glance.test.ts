import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelSafetyAtAGlance } from "./model-safety-at-a-glance.tsx";

describe("ModelSafetyAtAGlance", () => {
  it("keeps the four safety questions distinct and progressively disclosed", () => {
    const markup = renderToStaticMarkup(
      createElement(ModelSafetyAtAGlance, {
        assessment: {
          currentRisk: {
            label: "Uncertain",
            tone: "high",
            summary: "Visible factors only.",
            plausibleRange: "Guarded–High",
          },
          modelSafety: {
            label: "Mixed",
            tone: "guarded",
            evaluatedTargets: 2,
            totalTargets: 4,
          },
          labDefence: {
            score: 72,
            label: "Strong",
            practicalControl: 76,
            securityPosture: 63,
            safetyCulture: 58,
            incidentReductionPercent: 54,
          },
          evidence: {
            score: 61,
            label: "Developing",
            effectiveQuality: 70,
            reportCount: 2,
            independentReportCount: 1,
            evaluatedTargets: 2,
            totalTargets: 4,
          },
          access: {
            level: 2,
            label: "Supervised tools",
            deploymentLabel: "Guarded API",
            exposurePercent: 35,
            tone: "guarded",
          },
        },
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
      }),
    );

    expect(markup).toContain("Current risk: Uncertain");
    expect(markup).toContain("Plausible range: Guarded–High");
    expect(markup).toContain("MODEL SAFETY");
    expect(markup).toContain("LAB DEFENCE");
    expect(markup).toContain("EVIDENCE");
    expect(markup).toContain("ACCESS &amp; EXPOSURE");
    expect(markup).toContain("Guarded API · 35/100 exposure");
    expect(markup.match(/<details(?: class="tone-[^"]+")?>/g)).toHaveLength(4);
    expect(markup).toContain('aria-label="Explain Alignment"');
    expect(markup).toContain("does not change model intent");
    expect(markup).toContain("never makes unsafe weights safe");
  });
});
