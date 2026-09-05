import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ResearcherDepartureDialog } from "./researcher-departure-dialog.tsx";

describe("researcher departure dialog", () => {
  it("makes the identity, reason, impact, and next actions explicit", () => {
    const markup = renderToStaticMarkup(
      createElement(ResearcherDepartureDialog, {
        researcherName: "Dr Test",
        reason: "poached",
        rivalLabName: "xMind",
        onReviewPeople: vi.fn(),
        onResume: vi.fn(),
      }),
    );

    expect(markup).toContain("STAR RESEARCHER DEPARTED");
    expect(markup).toContain("Dr Test has left the lab");
    expect(markup).toContain("accepted an offer from xMind");
    expect(markup).toContain("bonuses no longer apply");
    expect(markup).toContain("Review People");
    expect(markup).toContain("Acknowledge &amp; resume");
  });
});
