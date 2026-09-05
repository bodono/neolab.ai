import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RealWorldResearcherCredits } from "./research-workspace.tsx";

describe("real-world paper researcher credits", () => {
  it("shows represented authors as attribution rather than broken profile links", () => {
    const onInspectResearcher = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(RealWorldResearcherCredits, {
        paper: {
          realWorldResearcherCredits: [
            {
              definitionId: "base:researcher.ada-example",
              displayName: "Ada Exempler",
              inspirationName: "Ada Example",
            },
            {
              definitionId: "base:researcher.grace-example",
              displayName: "Grace Exempler",
              inspirationName: "Grace Example",
            },
          ],
        },
        onInspectResearcher,
      }),
    );

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("open profile");
    expect(markup).toContain("Ada Example");
    expect(markup).toContain("Grace Example");
    expect(markup).toContain("inspired the fictional character Ada Exempler");
    expect(markup).toContain("inspired the fictional character Grace Exempler");
    expect(onInspectResearcher).not.toHaveBeenCalled();
  });

  it("renders nothing when the paper has no represented star researcher", () => {
    const markup = renderToStaticMarkup(
      createElement(RealWorldResearcherCredits, {
        paper: { realWorldResearcherCredits: [] },
        onInspectResearcher: vi.fn(),
      }),
    );

    expect(markup).toBe("");
  });
});
