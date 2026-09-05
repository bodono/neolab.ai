import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";

import {
  facilitiesUnlockedByPhase,
  PhaseTransitionDialog,
} from "./phase-transition-dialog.tsx";

const content = loadBrowserCompiledContent();

function renderPhase(phase: "scaling" | "frontier"): string {
  return renderToStaticMarkup(
    createElement(PhaseTransitionDialog, {
      phase,
      content,
      onContinue: vi.fn(),
      onReviewFacilities: vi.fn(),
      onReviewResearch: vi.fn(),
    }),
  );
}

describe("PhaseTransitionDialog", () => {
  it("lists every facility plan unlocked by the Scaling era", () => {
    expect(facilitiesUnlockedByPhase(content, "scaling")).toEqual([
      "Data Centre II",
      "Headquarters II",
      "Inference Centre II",
      "Power and Cooling II",
      "Visitor Centre",
    ]);

    const markup = renderPhase("scaling");
    expect(markup).toContain("5 new facility plans are now available");
    expect(markup).toContain("Data Centre II");
    expect(markup).toContain("Visitor Centre");
    expect(markup).toContain("landmark research results are now discoverable");
    expect(markup).toContain("Open facilities");
    expect(markup).toContain("Open research tree");
  });

  it("lists every facility plan unlocked by the Frontier era", () => {
    expect(facilitiesUnlockedByPhase(content, "frontier")).toEqual([
      "Data Centre III — Hyperscale Campus",
      "Inference Centre III",
      "Power and Cooling III — Private Grid",
      "The Embedding Space",
    ]);

    const markup = renderPhase("frontier");
    expect(markup).toContain("4 new facility plans are now available");
    expect(markup).toContain("Data Centre III — Hyperscale Campus");
    expect(markup).toContain("The Embedding Space");
    expect(markup).toContain("AGI candidacy is ahead");
  });
});
