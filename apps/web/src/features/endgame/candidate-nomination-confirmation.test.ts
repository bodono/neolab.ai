import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GameView } from "../../runtime/index.ts";
import {
  CandidateNominationConfirmationContent,
  type CandidatePrior,
} from "./candidate-nomination-confirmation.tsx";

const artifact = {
  modelId: "model:aquarius-7",
  displayName: "Aquarius-7",
  firstCrossingFrontierCapability: 100,
  firstCrossingPriorPercent: 100,
  currentFrontierCapability: 100,
} as CandidatePrior;

const endgame = {
  active: true,
  weeksInCrisis: 0,
  clocks: [
    { label: "Rival window", estimateLabel: "No credible rival deployment window" },
    { label: "Political window", estimateLabel: "12–25 weeks" },
    { label: "Financial window", estimateLabel: "Cashflow currently self-sustaining" },
  ],
} as unknown as Extract<GameView["endgame"], { readonly active: true }>;

describe("candidate nomination confirmation", () => {
  it("uses the formal exact-artifact confirmation in every nomination surface", () => {
    const markup = renderToStaticMarkup(
      createElement(CandidateNominationConfirmationContent, {
        accessLevel: 1,
        artifact,
        displayName: "Aquarius-7",
        endgame,
        measuredFrontierCapability: 100,
        trainedAtTick: 0,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );

    expect(markup).toContain("FORMAL CANDIDACY // EXACT ARTIFACT");
    expect(markup).toContain("Nominate Aquarius-7?");
    expect(markup).toContain("Training record · week 0 · Frontier capability 100");
    expect(markup).toContain("100% at FC 100");
    expect(markup).toContain("No incremental preparation time or resource cost");
    expect(markup).toContain("Rival window: No credible rival deployment window");
    expect(markup).toContain("Return to custody");
    expect(markup).toContain("Nominate exact artifact");
  });

  it("makes abandoning in-flight training explicit", () => {
    const markup = renderToStaticMarkup(
      createElement(CandidateNominationConfirmationContent, {
        accessLevel: 1,
        artifact,
        displayName: "Aquarius-7",
        inFlightTraining: [
          {
            projectId: "project:training:8",
            displayName: "Frontier training",
            status: "active",
            progressLabel: "5 of 12 scheduled weeks elapsed",
          },
        ],
        measuredFrontierCapability: 100,
        trainedAtTick: 0,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );

    expect(markup).toContain("TRAINING PROGRAMME STILL IN FLIGHT");
    expect(markup).toContain(
      "Frontier training · active · 5 of 12 scheduled weeks elapsed",
    );
    expect(markup).toContain("Return and finish training");
    expect(markup).toContain("Abandon training and nominate");
    expect(markup).toContain("spent cash and elapsed work are lost");
  });
});
