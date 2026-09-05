import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";

import { RealWorldProfile } from "./real-world-profile.tsx";

const content = loadBrowserCompiledContent();

describe("real-world researcher profile", () => {
  it("renders every authored researcher and leader inspiration", () => {
    const profiles = [
      ...Object.values(content.leaders),
      ...Object.values(content.researchers.definitions),
    ];

    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      expect(profile.inspirationName.trim(), profile.displayName).not.toHaveLength(0);
      const markup = renderToStaticMarkup(
        createElement(RealWorldProfile, {
          inspirationName: profile.inspirationName,
          inspirationSummary: profile.inspirationSummary,
          compact: true,
        }),
      );
      expect(markup, profile.displayName).toContain("inspired by");
      expect(markup, profile.displayName).toContain(profile.inspirationName);
      expect(markup, profile.displayName).not.toContain("paper-reality");
    }
  });

  it("renders the sourced summary and factual-fictional boundary when present", () => {
    const markup = renderToStaticMarkup(
      createElement(RealWorldProfile, {
        inspirationName: "Ada Example",
        inspirationSummary:
          "created a documented research result that changed her field.",
        biography: "This professional biography is sourced from the public record.",
        sourceUrls: ["https://example.edu/profile", "https://example.org/research-paper"],
        realWorldPapers: [
          {
            paperId: "base:paper.example",
            title: "A Real Research Result",
            authors: ["Ada Example", "Grace Example"],
            publicationYear: 2024,
            venue: "Example Conference",
            primarySourceUrl: "https://example.com/paper",
          },
        ],
      }),
    );

    expect(markup).toContain("REAL-WORLD PROFILE");
    expect(markup).toContain("Inspired by");
    expect(markup).toContain("Ada Example");
    expect(markup).toContain(
      "created a documented research result that changed her field.",
    );
    expect(markup).toContain(
      "This professional biography is sourced from the public record.",
    );
    expect(markup).toContain("1 real paper represented in the game");
    expect(markup).toContain("A Real Research Result");
    expect(markup).toContain("Ada Example, Grace Example · 2024 · Example Conference");
    expect(markup).toContain("https://example.com/paper");
    expect(markup).toContain("2 cited sources");
    expect(markup).toContain("example.edu");
    expect(markup).toContain("https://example.org/research-paper");
    expect(markup).toContain("This sourced professional profile is factual.");
    expect(markup).toContain("dialogue, promises, and outcomes are fictional.");
  });

  it("can keep the factual marker without repeating a dossier attribution", () => {
    const markup = renderToStaticMarkup(
      createElement(RealWorldProfile, {
        inspirationName: "Ada Example",
        inspirationSummary: "created a documented research result.",
        biography: "This professional biography is sourced from the public record.",
        showAttribution: false,
      }),
    );

    expect(markup).toContain("REAL-WORLD PROFILE");
    expect(markup).toContain("This professional biography is sourced");
    expect(markup).not.toContain("Inspired by");
    expect(markup).not.toContain("created a documented research result.");
  });
});
