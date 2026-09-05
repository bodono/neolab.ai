import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GameView, ResearchPaperView } from "@neolab/sim/public";

import {
  LAB_FEED_DECISION_LIMIT,
  PaperFeedEntry,
  ResearcherApproachFeedEntry,
} from "./event-feed.tsx";

it("keeps the overview feed compact", () => {
  expect(LAB_FEED_DECISION_LIMIT).toBe(8);
});

describe("paper feed entry", () => {
  it("links rival discoveries to their educational dossier", () => {
    const paper = {
      paperId: "paper:perceptron",
      title:
        "The Perceptron: A Probabilistic Model for Information Storage and Organization in the Brain",
      discovererLabName: "xMind",
      discoveredAtTick: 18,
      worldFirst: false,
      playerHasDiscovered: false,
    } as ResearchPaperView;

    const markup = renderToStaticMarkup(
      createElement(PaperFeedEntry, {
        paper,
        currentTick: 40,
        onOpenPaper: vi.fn(),
      }),
    );

    expect(markup).toContain("xMind PAPER");
    expect(markup).toContain("22 weeks ago");
    expect(markup).toContain("About this paper");
    expect(markup).toContain(paper.title);
  });
});

describe("researcher approach feed entry", () => {
  it("keeps an unanswered counter-offer visible and links back to the dossier", () => {
    const researcher = {
      researcherId: "run:researcher:yann",
      displayName: "Yann LeNet",
      rivalApproach: {
        stage: "counteroffer",
        rivalLabName: "xMind",
        resolvesInWeeks: 3,
        retentionResponseKind: "none",
        retentionResponseLabel: "No retention offer submitted",
      },
    } as GameView["people"]["roster"][number] & {
      readonly rivalApproach: NonNullable<
        GameView["people"]["roster"][number]["rivalApproach"]
      >;
    };

    const markup = renderToStaticMarkup(
      createElement(ResearcherApproachFeedEntry, {
        researcher,
        onInspectResearcher: vi.fn(),
      }),
    );

    expect(markup).toContain("COUNTER-OFFER");
    expect(markup).toContain("xMind is recruiting Yann LeNet");
    expect(markup).toContain("No retention offer submitted");
    expect(markup).toContain("3 weeks remaining");
    expect(markup).toContain("Review counter-offer");
    expect(markup).toContain("severity-urgent");
  });

  it("keeps a submitted retention response visible until the approach resolves", () => {
    const researcher = {
      researcherId: "run:researcher:yann",
      displayName: "Yann LeNet",
      rivalApproach: {
        stage: "counteroffer",
        rivalLabName: "xMind",
        resolvesInWeeks: 1,
        retentionResponseKind: "serious",
        retentionResponseLabel: "Serious retention package recorded",
      },
    } as GameView["people"]["roster"][number] & {
      readonly rivalApproach: NonNullable<
        GameView["people"]["roster"][number]["rivalApproach"]
      >;
    };

    const markup = renderToStaticMarkup(
      createElement(ResearcherApproachFeedEntry, {
        researcher,
        onInspectResearcher: vi.fn(),
      }),
    );

    expect(markup).toContain("Serious retention package recorded");
    expect(markup).toContain("1 week remaining");
    expect(markup).toContain("Review retention response");
  });
});
