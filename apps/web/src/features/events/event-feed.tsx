import type { ReactElement } from "react";

import {
  formatTeraflops,
  type GameView,
  type ResearchPaperView,
} from "@neolab/sim/public";

import { useEventCopy } from "./event-copy.ts";

export const LAB_FEED_DECISION_LIMIT = 8;

type RosterResearcher = GameView["people"]["roster"][number];
type ResearcherWithRivalApproach = RosterResearcher & {
  readonly rivalApproach: NonNullable<RosterResearcher["rivalApproach"]>;
};

function agoLabel(currentTick: number, occurredAt: number): string {
  const weeks = Math.max(0, currentTick - occurredAt);
  return weeks === 0 ? "this week" : `${String(weeks)} week${weeks === 1 ? "" : "s"} ago`;
}

function activityCategoryLabel(entry: GameView["decisionLog"][number]): string {
  if (entry.category === "reaction") return "REACTION";
  if (entry.category === "ambient") {
    if (entry.source?.id === "ambient:ai") return "AI NOTE";
    if (entry.source?.id === "ambient:campus") return "CAMPUS";
    if (entry.source?.id === "ambient:nerves") return "OVERHEARD";
    if (entry.source?.id === "ambient:money") return "FINANCE WIRE";
    if (entry.source?.id?.startsWith("ambient:rival:") === true) {
      return "RIVAL GOSSIP";
    }
    return entry.source?.kind === "researcher" ? "LAB CHAT" : "LAB CHAT";
  }
  if (
    entry.source?.kind === "system" &&
    entry.source.id?.startsWith("rival-incident:") === true
  ) {
    return "RIVAL INCIDENT";
  }
  if (
    entry.source?.kind === "system" &&
    entry.source.id?.startsWith("incident:") === true
  ) {
    return "INCIDENT";
  }
  if (
    entry.source?.kind === "system" &&
    entry.source.id?.startsWith("training-setback:") === true
  ) {
    return "TRAINING DELAY";
  }
  if (
    entry.source?.kind === "system" &&
    entry.source.id?.startsWith("fundraising-offers:") === true
  ) {
    return "FUNDRAISING";
  }
  switch (entry.category) {
    case "persistent-modifier-added":
      return "ONGOING EFFECT";
    case "persistent-modifier-removed":
      return "EFFECT ENDED";
    default:
      return entry.category.replaceAll("-", " ").toUpperCase();
  }
}

function activitySummary(entry: GameView["decisionLog"][number]): string {
  if (entry.category !== "persistent-modifier-added") return entry.summary;
  const legacy =
    /^Persistent modifier \S+ from (.+): (\S+) (add|multiply|min|max) (-?\d+(?:\.\d+)?)\.$/.exec(
      entry.summary,
    );
  if (legacy === null) return entry.summary;
  const [, source, rawTarget, operation, rawValue] = legacy;
  if (
    source === undefined ||
    rawTarget === undefined ||
    operation === undefined ||
    rawValue === undefined
  ) {
    return entry.summary;
  }
  const subject = source.includes(":funding-offer:")
    ? "A funding agreement"
    : "A lab-wide effect";
  const target =
    rawTarget === "lab.organisation.boardPatienceTarget"
      ? "a legacy organisation term"
      : rawTarget
          .replace(/^(?:lab|world)\./, "")
          .replaceAll(".", " ")
          .replaceAll("-", " ")
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase();
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return entry.summary;
  switch (operation) {
    case "add":
      return `${subject} ${value >= 0 ? "increased" : "reduced"} ${target} by ${String(Math.abs(value))}.`;
    case "multiply": {
      const percentage = Math.round(Math.abs((value - 1) * 1000)) / 10;
      return `${subject} ${value >= 1 ? "increased" : "reduced"} ${target} by ${String(percentage)}%.`;
    }
    case "min":
      return `${subject} capped ${target} at ${String(value)}.`;
    case "max":
      return `${subject} set a minimum ${target} of ${String(value)}.`;
    default:
      return entry.summary;
  }
}

export function PaperFeedEntry({
  paper,
  currentTick,
  onOpenPaper,
}: {
  readonly paper: ResearchPaperView;
  readonly currentTick: number;
  readonly onOpenPaper: (paperId: string) => void;
}): ReactElement {
  return (
    <li className="paper-feed-entry">
      <div>
        <b>
          {paper.worldFirst
            ? "YOUR WORLD-FIRST PAPER"
            : paper.playerHasDiscovered
              ? "YOUR REDISCOVERY"
              : `${paper.discovererLabName} PAPER`}
        </b>
        <span>{paper.title}</span>
      </div>
      <time>{agoLabel(currentTick, paper.discoveredAtTick)}</time>
      <button
        type="button"
        className="text-button paper-feed-link"
        onClick={() => onOpenPaper(paper.paperId)}
      >
        About this paper →
      </button>
    </li>
  );
}

function hasRivalApproach(
  researcher: RosterResearcher,
): researcher is ResearcherWithRivalApproach {
  return researcher.rivalApproach !== undefined;
}

export function ResearcherApproachFeedEntry({
  researcher,
  onInspectResearcher,
}: {
  readonly researcher: ResearcherWithRivalApproach;
  readonly onInspectResearcher: (researcherId: string) => void;
}): ReactElement {
  const approach = researcher.rivalApproach;
  const responseRecorded = approach.retentionResponseKind !== "none";
  const deadline =
    approach.resolvesInWeeks === 0
      ? "resolves this week"
      : `${String(approach.resolvesInWeeks)} week${approach.resolvesInWeeks === 1 ? "" : "s"} remaining`;
  const reviewLabel = responseRecorded
    ? "Review retention response"
    : approach.stage === "counteroffer"
      ? "Review counter-offer"
      : "Review rival approach";

  return (
    <li className={`event-feed-entry${responseRecorded ? "" : " severity-urgent"}`}>
      <div>
        <b>{approach.stage === "counteroffer" ? "COUNTER-OFFER" : "RIVAL CONTACT"}</b>
        <span>
          {approach.rivalLabName} is recruiting {researcher.displayName}.{" "}
          {approach.retentionResponseLabel}.
        </span>
      </div>
      <time>{deadline}</time>
      <button
        type="button"
        className="text-button"
        onClick={() => onInspectResearcher(researcher.researcherId)}
      >
        {reviewLabel}
      </button>
    </li>
  );
}

export function EventFeed({
  view,
  onReview,
  onOpenPaper,
  onInspectResearcher,
}: {
  readonly view: GameView;
  readonly onReview: (instanceId: string) => void;
  readonly onOpenPaper: (paperId: string) => void;
  readonly onInspectResearcher: (researcherId: string) => void;
}): ReactElement {
  const copy = useEventCopy();
  const decisionGroups = [...view.decisionLog]
    .reverse()
    .reduce<
      Array<{
        readonly entry: GameView["decisionLog"][number];
        count: number;
      }>
    >((groups, entry) => {
      const existing = groups.find(
        (group) =>
          group.entry.tick === entry.tick &&
          group.entry.category === entry.category &&
          activitySummary(group.entry) === activitySummary(entry),
      );
      if (existing !== undefined) {
        existing.count += 1;
      } else {
        groups.push({ entry, count: 1 });
      }
      return groups;
    }, [])
    .slice(0, LAB_FEED_DECISION_LIMIT);
  const rivalApproaches = view.people.roster.filter(hasRivalApproach);
  const liveProjects = view.facilities.projects.filter(
    (project) =>
      project.status === "queued" ||
      project.status === "active" ||
      project.status === "paused",
  );
  const recentPapers = view.research.papers.slice(0, 3);
  return (
    <>
      <ul aria-label="Recent lab activity" tabIndex={0}>
        {view.eventQueue.items.map((item) => (
          <li
            key={item.instanceId}
            className={`event-feed-entry severity-${item.severity}`}
          >
            <div>
              <b>{item.severity.toUpperCase()}</b>
              <span>{copy(item.titleKey, item.tokens, "title")}</span>
            </div>
            <time>{item.deadlineLabel}</time>
            <button
              type="button"
              className="text-button"
              onClick={() => onReview(item.instanceId)}
            >
              Review decision
            </button>
          </li>
        ))}
        {rivalApproaches.map((researcher) => (
          <ResearcherApproachFeedEntry
            key={`rival-approach:${researcher.researcherId}`}
            researcher={researcher}
            onInspectResearcher={onInspectResearcher}
          />
        ))}
        {view.compute.pendingDeliveries.map((delivery) => (
          <li key={delivery.lotId}>
            <b>PROCUREMENT</b>
            {delivery.label}
          </li>
        ))}
        {liveProjects.map((project) => (
          <li key={project.projectId}>
            <b>{project.kind.toUpperCase()}</b>
            {project.displayName}: {project.progressLabel}
          </li>
        ))}
        {recentPapers.map((paper) => (
          <PaperFeedEntry
            key={`paper:${paper.paperId}`}
            paper={paper}
            currentTick={view.meta.tick}
            onOpenPaper={onOpenPaper}
          />
        ))}
        {decisionGroups.map(({ entry, count }, index) => (
          <li
            key={`${entry.tick}:${entry.summary}:${String(index)}`}
            className="audit-feed-entry"
          >
            <div>
              <b>
                {activityCategoryLabel(entry)}
                {count === 1 ? "" : ` ×${String(count)}`}
              </b>
              <span>{activitySummary(entry)}</span>
            </div>
            <time>{agoLabel(view.meta.tick, entry.tick)}</time>
          </li>
        ))}
        <li>
          <b>MARKET</b>
          {formatTeraflops(view.market.deliveredTeraflops)} of inference demand served
        </li>
      </ul>
      {view.decisionLog.length <= LAB_FEED_DECISION_LIMIT ? null : (
        <p className="feed-history-note">Recent activity · full history in Archive</p>
      )}
    </>
  );
}
