import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ResearcherPoachingDialog } from "./researcher-poaching-dialog.tsx";

describe("researcher poaching dialog", () => {
  it("presents every rival approach as an explicit modal decision", () => {
    const markup = renderToStaticMarkup(
      createElement(ResearcherPoachingDialog, {
        item: {
          key: "researcher-poaching:poaching:test",
          kind: "researcher-poaching",
          attention: "modal",
          researcherId: "researcher:test",
          researcherDisplayName: "Dr Test",
          poachingId: "poaching:test",
          rivalLabId: "lab:rival",
          rivalLabName: "xMind",
          stage: "rumour",
          resolvesInWeeks: 1,
          responseRecorded: false,
          createdAtTick: 12,
        },
        onReview: vi.fn(),
        onDefer: vi.fn(),
      }),
    );

    expect(markup).toContain("RIVAL APPROACH // RETENTION DECISION");
    expect(markup).toContain("xMind is recruiting Dr Test");
    expect(markup).toContain("resolves in 1 week");
    expect(markup).toContain("Review rival approach");
    expect(markup).toContain("Decide later");
  });
});
