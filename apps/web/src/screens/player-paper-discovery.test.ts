import { describe, expect, it } from "vitest";

import type { ResearchPaperView } from "@neolab/sim/public";

import { selectUnacknowledgedPlayerPaper } from "./player-paper-discovery.ts";

function paper(
  overrides: Partial<ResearchPaperView> &
    Pick<ResearchPaperView, "paperId" | "playerHasDiscovered" | "worldFirst">,
): ResearchPaperView {
  return {
    title: overrides.paperId,
    historicity: "real",
    authors: [],
    playerSummary: "",
    archiveExplanation: "",
    insideBaseball: "",
    discoveredAtTick: 10,
    discovererLabId: "lab:rival",
    discovererLabName: "Rival lab",
    playerKnowsPaper: overrides.playerHasDiscovered,
    knowledgeSource: overrides.worldFirst ? "world-first" : "rediscovery",
    unlockLabels: [],
    realWorldResearcherCredits: [],
    ...overrides,
  };
}

describe("selectUnacknowledgedPlayerPaper", () => {
  it("keeps a player rediscovery out of the blocking discovery dialog", () => {
    const rediscovery = paper({
      paperId: "paper:rediscovered",
      playerHasDiscovered: true,
      worldFirst: false,
      playerDiscoveredAtTick: 41,
    });

    expect(
      selectUnacknowledgedPlayerPaper({
        papers: [rediscovery],
        pendingPublicationPaperIds: [],
        acknowledgedPaperIds: new Set(),
        currentTick: 42,
        paperDiscoveryPauseActive: true,
      }),
    ).toBeUndefined();
  });

  it("does not revive historical rediscoveries or show rival-only discoveries", () => {
    const historical = paper({
      paperId: "paper:historical",
      playerHasDiscovered: true,
      worldFirst: false,
      playerDiscoveredAtTick: 40,
    });
    const rivalOnly = paper({
      paperId: "paper:rival-only",
      playerHasDiscovered: false,
      worldFirst: false,
      playerDiscoveredAtTick: 42,
    });

    expect(
      selectUnacknowledgedPlayerPaper({
        papers: [historical, rivalOnly],
        pendingPublicationPaperIds: [],
        acknowledgedPaperIds: new Set(),
        currentTick: 42,
        paperDiscoveryPauseActive: true,
      }),
    ).toBeUndefined();
  });

  it("keeps a pending world-first publication visible until it is resolved", () => {
    const worldFirst = paper({
      paperId: "paper:world-first",
      playerHasDiscovered: true,
      worldFirst: true,
      discovererLabId: "lab:player",
      discovererLabName: "Your lab",
    });

    expect(
      selectUnacknowledgedPlayerPaper({
        papers: [worldFirst],
        pendingPublicationPaperIds: [worldFirst.paperId],
        acknowledgedPaperIds: new Set(),
        currentTick: 99,
        paperDiscoveryPauseActive: false,
      }),
    ).toBe(worldFirst);
  });
});
