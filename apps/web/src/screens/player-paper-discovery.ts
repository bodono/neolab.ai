import type { ResearchPaperView } from "@neolab/sim/public";

export function selectUnacknowledgedPlayerPaper({
  papers,
  pendingPublicationPaperIds,
  acknowledgedPaperIds,
  currentTick,
  paperDiscoveryPauseActive,
}: {
  readonly papers: readonly ResearchPaperView[];
  readonly pendingPublicationPaperIds: readonly string[];
  readonly acknowledgedPaperIds: ReadonlySet<string>;
  readonly currentTick: number;
  readonly paperDiscoveryPauseActive: boolean;
}): ResearchPaperView | undefined {
  const pendingPublication = new Set(pendingPublicationPaperIds);
  return [...papers]
    .filter((paper) => {
      if (!paper.playerHasDiscovered || acknowledgedPaperIds.has(paper.paperId)) {
        return false;
      }
      // Independent rediscoveries are concise side notifications. Only a
      // world-first result can open the blocking publication dossier.
      if (!paper.worldFirst) return false;
      if (pendingPublication.has(paper.paperId)) return true;
      const playerReachedAt =
        paper.playerDiscoveredAtTick ??
        (paper.worldFirst ? paper.discoveredAtTick : undefined);
      return (
        paperDiscoveryPauseActive &&
        playerReachedAt !== undefined &&
        currentTick - playerReachedAt >= 0 &&
        currentTick - playerReachedAt <= 1
      );
    })
    .sort(
      (left, right) =>
        (right.playerDiscoveredAtTick ?? right.discoveredAtTick) -
        (left.playerDiscoveredAtTick ?? left.discoveredAtTick),
    )[0];
}
