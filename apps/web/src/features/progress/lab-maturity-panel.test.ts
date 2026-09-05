import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameView } from "@neolab/sim/public";

import { LabMaturityPanel } from "./lab-maturity-panel.tsx";

describe("LabMaturityPanel", () => {
  it("holds a completed chapter until the next weekly boundary", () => {
    const view = {
      meta: {
        labMaturity: {
          stage: "model",
          chapter: "CHAPTER 03 // YOU ARE NOT ALONE",
          title: "The race is on.",
          directive: "Open World and meet the competition.",
          ordinal: 3,
          total: 12,
          checklist: [{ label: "Open World and inspect the rival race", complete: true }],
          showOverviewPanel: true,
        },
      },
    } as unknown as GameView;

    const markup = renderToStaticMarkup(createElement(LabMaturityPanel, { view }));

    expect(markup).toContain(
      "Objective complete. Advance one week to begin the next chapter.",
    );
    expect(markup).not.toContain("Open World and meet the competition.");
  });
});
