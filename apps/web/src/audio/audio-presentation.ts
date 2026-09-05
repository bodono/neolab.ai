import {
  endingConsequenceForId,
  formatValuation,
  isCanonicalEndingId,
  type DomainEvent,
  type GameView,
  type PresentationQueueItemView,
} from "@neolab/sim/public";

import type {
  CueRequest,
  EndgameMusicChapter,
  LaboratoryMusicFocus,
  MusicTrackId,
  MusicState,
} from "./audio-types.ts";

export type GameSection =
  | "lab"
  | "research"
  | "models"
  | "people"
  | "world"
  | "finances"
  | "bonuses"
  | "overview"
  | "crisis"
  | "compute"
  | "facilities"
  | "agi"
  | "evaluations";
type BareCueRequest = Omit<CueRequest, "notice">;

export type VisibleAlarmCue = Pick<CueRequest, "cueId" | "occurrenceKey">;

/**
 * Modal incident alarms own their warning sound. Domain events remain the
 * normal real-time route, but the visible presentation is the durable source
 * of truth across queued notices, hot reloads, and restored saves.
 */
export function alarmCueForVisiblePresentation(
  item: PresentationQueueItemView,
): VisibleAlarmCue | undefined {
  if (item.kind === "model-incident-result") {
    return {
      cueId:
        item.category === "critical" || item.category === "catastrophe"
          ? "containment-warning"
          : "crisis-opened",
      occurrenceKey: `incident:${item.modelId}:${String(item.createdAtTick)}`,
    };
  }
  if (item.kind === "candidate-containment-incident") {
    return {
      cueId: "containment-warning",
      occurrenceKey: `candidate-incident:${item.incidentId}`,
    };
  }
  if (item.kind === "researcher-departure") {
    return {
      cueId: "researcher-departs",
      occurrenceKey: `depart:${item.researcherId}:${String(item.createdAtTick)}`,
    };
  }
  return undefined;
}

function endingState(view: GameView): MusicState {
  const endingId = view.meta.endingId ?? "";
  if (endingId.endsWith("the-long-pause")) {
    return { kind: "endgame", chapter: "moratorium" };
  }
  const consequence = endingConsequenceForId(endingId);
  if (consequence === "extinction") {
    return { kind: "extinction" };
  }
  if (view.meta.status === "won") {
    return {
      kind: "victory",
      tier: QUALIFIED_VICTORY_SUFFIXES.some((suffix) => endingId.endsWith(suffix))
        ? "qualified"
        : "full",
    };
  }
  if (consequence === "catastrophic-control-loss") {
    return { kind: "ending-catastrophe" };
  }
  return { kind: "ending-defeat" };
}

/** Wins that arrive with an asterisk: celebrated one register lower. */
const QUALIFIED_VICTORY_SUFFIXES = [
  "move-fast-and-somehow-nobody-died",
  "the-lab-that-ate-the-world",
  "miracle-terms-and-conditions-apply",
] as const;

interface VisibleEndgameAudioState {
  readonly stage: string;
  readonly stageActions?: {
    readonly kind: string;
    /** Optional player-visible substates used to score the authored sequence. */
    readonly phase?: string;
    readonly status?: string;
    readonly candidateResponse?: string;
    readonly contested?: boolean;
    readonly activeResponseId?: string;
    readonly pendingRemediation?: unknown;
  };
}

/**
 * Simulation stages and music chapters are intentionally separate. Every key
 * here is a stage the live state machine can actually emit; finer changes are
 * selected below from player-visible stage actions.
 */
const VISIBLE_ENDGAME_STAGE_CHAPTERS: Readonly<Record<string, EndgameMusicChapter>> = {
  "candidate-activation": "candidacy",
  confirmation: "capability-proof",
  "evidence-sprint": "dossier-review",
  "pressure-collision": "pressure",
  rollout: "controlled-rollout",
  "final-review": "deployment-planning",
  "world-waiting": "deployment-held",
  "retirement-attempt": "retirement-held",
  "containment-failure": "containment-failure",
  resolved: "local-recovery",
  recovery: "local-recovery",
};

const VISIBLE_RETIREMENT_RESISTANCE_MARKERS = new Set([
  "resistance-observed",
  "resisting",
  "resisted",
  "local-containment-breach",
]);

/**
 * Map only the state already projected to the player. Hidden SI truth, safety
 * traits, and unresolved outcome draws are neither accepted nor inspected.
 */
export function endgameMusicChapterForVisibleState(
  endgame: VisibleEndgameAudioState,
): EndgameMusicChapter {
  if (
    endgame.stage === "evidence-sprint" &&
    (endgame.stageActions?.activeResponseId !== undefined ||
      endgame.stageActions?.pendingRemediation !== undefined)
  ) {
    return "safety-work";
  }
  if (endgame.stage === "retirement-attempt") {
    const visibleMarkers = [
      endgame.stageActions?.phase,
      endgame.stageActions?.status,
      endgame.stageActions?.candidateResponse,
    ];
    if (
      endgame.stageActions?.contested === true ||
      visibleMarkers.some(
        (marker) =>
          marker !== undefined && VISIBLE_RETIREMENT_RESISTANCE_MARKERS.has(marker),
      )
    ) {
      return "observed-resistance";
    }
  }
  // A newly introduced visible stage defaults to the neutral candidacy score
  // until presentation gives it an explicit chapter. It must never infer a
  // more ominous track from hidden model state.
  return VISIBLE_ENDGAME_STAGE_CHAPTERS[endgame.stage] ?? "candidacy";
}

export function laboratoryFocusForSection(section: GameSection): LaboratoryMusicFocus {
  switch (section) {
    case "research":
      return "research";
    case "models":
    case "finances":
    case "compute":
      return "commercial";
    case "evaluations":
    case "facilities":
    case "agi":
      return "safety";
    default:
      return "general";
  }
}

/**
 * Normal play routes the soundtrack to specialized focus pools (research,
 * commercial, safety, or general). Crises, endgame chapters, and endings steer
 * to their dedicated music states.
 */
export function resolveMusicState(
  view: GameView | undefined,
  section: GameSection,
): MusicState {
  if (view === undefined) return { kind: "title" };
  if (view.meta.status !== "active") return endingState(view);
  if (view.endgame.active) {
    // Retirement recovery is ordinary laboratory play with section focus, not
    // a 26-week unskippable thriller cue.
    if (view.endgame.stage === "recovery") {
      return { kind: "laboratory", focus: laboratoryFocusForSection(section) };
    }
    return {
      kind: "endgame",
      chapter: endgameMusicChapterForVisibleState(view.endgame),
    };
  }
  const visibleIncidentAlarm = view.presentationQueue.find(
    (item) =>
      item.kind === "model-incident-result" ||
      item.kind === "candidate-containment-incident",
  );
  if (visibleIncidentAlarm !== undefined) {
    return {
      kind: "crisis",
      crisisId: visibleIncidentAlarm.key,
      flavour: "machine",
    };
  }
  const visibleCrisis = view.eventQueue.items.find(
    (item) => item.severity === "critical" || item.severity === "urgent",
  );
  if (visibleCrisis !== undefined) {
    return {
      kind: "crisis",
      crisisId: visibleCrisis.instanceId,
      flavour: /\.autonomy\.|\.anomaly/.test(visibleCrisis.definitionId)
        ? "machine"
        : "institutional",
    };
  }
  return { kind: "laboratory", focus: laboratoryFocusForSection(section) };
}

function ownsModel(view: GameView, modelId: string): boolean {
  return view.models.cards.some((model) => model.modelId === modelId);
}

/**
 * Rival simulation and public-signal history begin immediately, but the
 * progressive opening deliberately introduces the race only when World &
 * rivals becomes available. Do not let an audio notice reveal that system
 * before its chapter does. Classic campaigns have no maturity gate.
 */
function rivalIntelligenceUnlocked(view: GameView): boolean {
  return view.meta.labMaturity?.features.includes("world") ?? true;
}

function endingCue(endingId: string, occurrenceKey: string): BareCueRequest {
  const consequence = endingConsequenceForId(endingId);
  if (consequence === "extinction" || consequence === "catastrophic-control-loss") {
    return { cueId: "containment-failure", occurrenceKey };
  }
  if (endingId.endsWith("nationalised-future")) {
    return { cueId: "nationalised", occurrenceKey };
  }
  if (endingId.endsWith("the-worlds-most-expensive-insolvency")) {
    return { cueId: "bankruptcy", occurrenceKey };
  }
  if (
    endingId.endsWith("the-broadly-shared-future") ||
    endingId.endsWith("the-stewardship-compact") ||
    endingId.endsWith("a-cautious-golden-age") ||
    QUALIFIED_VICTORY_SUFFIXES.some((suffix) => endingId.endsWith(suffix))
  ) {
    return { cueId: "race-won", occurrenceKey };
  }
  // Every remaining loss — the board's declared victory included — recedes.
  return { cueId: "race-lost", occurrenceKey };
}

/**
 * Major visible good news steers the laboratory soundtrack toward its
 * thematically matching track. Everything here is a player-visible fact; a
 * suggestion is advisory and the manager applies its own focus-pool and
 * cooldown guards.
 */
export function musicSuggestionForDomainEvent(
  event: DomainEvent,
  view: GameView,
): MusicTrackId | undefined {
  const playerLabId = view.identity.labId;
  switch (event.kind) {
    case "gpu-delivered":
      return event.labId === playerLabId ? "gpus-arrive-tuesday" : undefined;
    case "training-completed":
      return event.labId === playerLabId && event.regressions.length === 0
        ? "converged-before-lunch"
        : undefined;
    case "paper-discovered":
      return event.labId === playerLabId && event.worldFirst
        ? "peer-reviewer-two"
        : undefined;
    case "funding-offer-accepted":
      return event.labId === playerLabId ? "budget-approved" : undefined;
    case "researcher-recruited":
      return event.labId === playerLabId ? "new-hire-orientation" : undefined;
    case "capability-tier-reached":
      return ownsModel(view, event.modelId) ? "demo-worked-twice" : undefined;
    default:
      return undefined;
  }
}

function cueRequestsForDomainEvent(
  event: DomainEvent,
  view: GameView,
  receiptTick: number,
  eventIndex: number,
): readonly BareCueRequest[] {
  const playerLabId = view.identity.labId;
  const fallbackKey = `${String(receiptTick)}:${String(eventIndex)}:${event.kind}`;
  switch (event.kind) {
    case "paper-discovered":
      return event.labId === playerLabId
        ? [
            {
              cueId: "paper-discovered",
              occurrenceKey: event.worldFirst
                ? `paper:${event.paperId}`
                : `paper-rediscovery:${event.paperId}`,
            },
          ]
        : [];
    case "generic-advance-chosen":
      return event.labId === playerLabId
        ? [
            {
              cueId: "major-breakthrough",
              occurrenceKey: `advance:${event.programId}:${String(event.threshold)}`,
            },
          ]
        : [];
    case "training-completed":
      return event.labId === playerLabId
        ? [
            {
              cueId: "capability-tier",
              occurrenceKey: `training:${event.projectId}`,
            },
          ]
        : [];
    case "capability-tier-reached":
      return ownsModel(view, event.modelId)
        ? [{ cueId: "capability-tier", occurrenceKey: `tier:${event.tierId}` }]
        : [];
    case "evaluation-completed":
      return ownsModel(view, event.modelId) &&
        !event.automaticBaseline &&
        event.anomalyCount === 0
        ? [{ cueId: "safety-win", occurrenceKey: `evaluation:${event.evaluationId}` }]
        : [];
    case "funding-offer-accepted":
      return event.labId === playerLabId
        ? [{ cueId: "fundraising-complete", occurrenceKey: `funding:${event.offerId}` }]
        : [];
    case "researcher-recruited":
      return event.labId === playerLabId
        ? [{ cueId: "researcher-joins", occurrenceKey: `join:${event.researcherId}` }]
        : [];
    case "researcher-poaching-resolved":
      return event.departed
        ? []
        : [
            {
              cueId: "researcher-joins",
              occurrenceKey: `retained:${event.researcherId}:${String(receiptTick)}`,
            },
          ];
    case "researcher-departed":
      // Player departures are durable modal presentations. Do not also emit a
      // top-of-screen audio notice for the same loss.
      return [];
    case "rival-public-signal":
      return event.labId !== playerLabId && rivalIntelligenceUnlocked(view)
        ? [
            {
              cueId: "rival-breakthrough",
              occurrenceKey: `rival:${event.labId}:${event.signalId}`,
            },
          ]
        : [];
    case "government-intervention-triggered":
      return event.labId === playerLabId
        ? [
            {
              cueId: "regulatory-attention",
              occurrenceKey: `regulation:${event.interventionId}`,
            },
          ]
        : [];
    case "training-failure-check":
      return event.labId === playerLabId &&
        event.outcome === "delay-and-cost" &&
        event.delayWeeks > 0
        ? [
            {
              cueId: "crisis-opened",
              occurrenceKey: `training-delay:${event.projectId}:${String(event.checkpoint)}`,
            },
          ]
        : [];
    case "model-incident":
      if (!ownsModel(view, event.modelId)) return [];
      return event.category === "critical" || event.category === "catastrophe"
        ? [
            {
              cueId: "containment-warning",
              occurrenceKey: `incident:${event.modelId}:${String(receiptTick)}`,
            },
          ]
        : [
            {
              // Even a minor AI incident should interrupt the ordinary laboratory
              // score with a brief warning. The composed crisis cue stays within
              // the soundtrack's palette; the stronger containment cue remains
              // reserved for critical and catastrophic incidents.
              cueId: "crisis-opened",
              occurrenceKey: `incident:${event.modelId}:${String(receiptTick)}`,
            },
          ];
    case "anomaly-detected":
      return ownsModel(view, event.modelId) && event.observedSeverity >= 3
        ? [{ cueId: "containment-warning", occurrenceKey: `anomaly:${event.anomalyId}` }]
        : [];
    case "decision-event-instantiated":
      return event.severity === "critical"
        ? [{ cueId: "crisis-opened", occurrenceKey: `decision:${event.instanceId}` }]
        : [];
    case "coalition-proposed":
      return event.memberLabIds.some((labId) => labId === playerLabId)
        ? [
            {
              cueId: "coalition-proposed",
              occurrenceKey: `coalition-proposal:${event.coalitionId}`,
            },
          ]
        : [];
    case "coalition-ratified":
      return event.memberLabIds.some((labId) => labId === playerLabId)
        ? [{ cueId: "coalition-formed", occurrenceKey: `coalition:${event.coalitionId}` }]
        : [];
    case "endgame-crisis-started":
      return [{ cueId: "endgame-begins", occurrenceKey: `endgame:${event.modelId}` }];
    case "endgame-ending-resolved":
      return [endingCue(event.endingId, `ending:${event.endingId}`)];
    case "facility-completed":
      return event.labId === playerLabId
        ? [{ cueId: "score-milestone", occurrenceKey: `facility:${event.definitionId}` }]
        : [];
    case "run-ended": {
      const endingId = view.meta.endingId;
      return endingId !== undefined && isCanonicalEndingId(endingId)
        ? [endingCue(endingId, `ending:${endingId}`)]
        : [
            {
              cueId: event.result === "won" ? "race-won" : "race-lost",
              occurrenceKey: `ending:${endingId ?? fallbackKey}`,
            },
          ];
    }
    default:
      return [];
  }
}

function sentenceCase(value: string): string {
  const readable = value.replaceAll("-", " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

function modelName(view: GameView, modelId: string): string {
  return (
    view.models.cards.find((model) => model.modelId === modelId)?.displayName ??
    "A lab model"
  );
}

function researcherName(view: GameView, researcherId: string): string {
  return (
    [...view.people.roster, ...view.people.market.candidates].find(
      (researcher) => researcher.researcherId === researcherId,
    )?.displayName ?? "A star researcher"
  );
}

function rivalName(view: GameView, labId: string): string {
  return (
    view.world.rivals.find((rival) => rival.labId === labId)?.labName ?? "A rival lab"
  );
}

function rivalSignalSummary(
  view: GameView,
  event: Extract<DomainEvent, { kind: "rival-public-signal" }>,
): string {
  const namedIds = view.world.rivals.reduce(
    (summary, rival) => summary.replaceAll(rival.labId, rival.labName),
    event.summary,
  );
  const reportingLab = view.world.rivals.find((rival) => rival.labId === event.labId);
  return reportingLab === undefined
    ? namedIds
    : namedIds.replace(/^A rival lab\b/, reportingLab.labName);
}

function realPaperSourceLink(
  view: GameView,
  paperId: string,
): CueRequest["notice"]["externalLink"] {
  const paper =
    view.research.papers.find((item) => item.paperId === paperId) ??
    view.research.techTree.papers.find((item) => item.paperId === paperId);
  return paper?.historicity === "real" && paper.primarySourceUrl !== undefined
    ? { href: paper.primarySourceUrl, label: "Read the real paper ↗" }
    : undefined;
}

function facilityCompletionNotice(
  view: GameView,
  event: Extract<DomainEvent, { kind: "facility-completed" }>,
): CueRequest["notice"] {
  const catalogueEntry = view.facilities.catalogue.find(
    (facility) => facility.definitionId === event.definitionId,
  );
  const completedEntry = view.facilities.completed.find(
    (facility) => facility.definitionId === event.definitionId,
  );
  const displayName =
    catalogueEntry?.displayName ?? completedEntry?.displayName ?? "Facility";
  const primaryEffect = catalogueEntry?.benefits[0];
  const highlightedEffects = primaryEffect === undefined ? [] : [primaryEffect.label];

  return {
    title: `${displayName} is operational`,
    detail:
      highlightedEffects.length === 0
        ? "Construction is complete. Open Facilities to review its permanent effects."
        : `${highlightedEffects.join(". ")}. Open Facilities to review every permanent effect.`,
    tone: "positive",
  };
}

function noticeForDomainEvent(
  cueId: CueRequest["cueId"],
  event: DomainEvent,
  view: GameView,
): CueRequest["notice"] {
  switch (cueId) {
    case "paper-discovered": {
      const discoveredPaper =
        event.kind === "paper-discovered"
          ? view.research.papers.find((item) => item.paperId === event.paperId)
          : undefined;
      const paper =
        event.kind === "paper-discovered"
          ? (discoveredPaper ??
            view.research.techTree.papers.find((item) => item.paperId === event.paperId))
          : undefined;
      const paperLink =
        event.kind === "paper-discovered"
          ? realPaperSourceLink(view, event.paperId)
          : undefined;
      return {
        title:
          paper?.title ??
          (event.kind === "paper-discovered" && !event.worldFirst
            ? "Paper independently rediscovered"
            : "World-first paper discovered"),
        detail:
          event.kind === "paper-discovered" && !event.worldFirst
            ? `${rivalName(view, discoveredPaper?.discovererLabId ?? "")} reached this result first. Your independent rediscovery and its research unlocks have been recorded.`
            : "Your lab has made a research discovery. The educational discovery dossier explains the result and its rewards.",
        tone: "positive",
        ...(paperLink === undefined ? {} : { externalLink: paperLink }),
      };
    }
    case "major-breakthrough":
      return {
        title: "Research direction unlocked",
        detail:
          "A research programme has locked in a permanent direction. Its new benefit is active and the choice is recorded in Research.",
        tone: "positive",
      };
    case "capability-tier":
      if (event.kind === "training-completed") {
        const regressionCount = event.regressions.length;
        return {
          title: `${modelName(view, event.modelId)} finished training`,
          detail:
            regressionCount === 0
              ? "The run completed successfully. Open Models to review the new model and its automatic baseline evaluation."
              : `The run completed successfully with ${String(regressionCount)} measured regression${regressionCount === 1 ? "" : "s"}. Open Models to inspect the result.`,
          tone: "positive",
          internalAction: {
            destination: "models",
            label: "Review model",
          },
        };
      }
      return {
        title: `${event.kind === "capability-tier-reached" ? modelName(view, event.modelId) : "Your model"} reached a new capability tier`,
        detail:
          "Baseline evaluation changed the model's measured capability tier. Open Models to inspect what changed.",
        tone: "positive",
      };
    case "safety-win":
      return {
        title: "Evaluation completed without an anomaly",
        detail:
          "The latest model evaluation found no reportable anomaly. This is useful evidence, not proof that the model is safe.",
        tone: "positive",
      };
    case "fundraising-complete":
      return {
        title: `${event.kind === "funding-offer-accepted" ? event.roundLabel : "Fundraising round"} financing closed`,
        detail:
          event.kind === "funding-offer-accepted" &&
          event.openingRecapitalisation !== undefined
            ? `Your parents converted the opening bridge into their angel stake. The ${event.roundLabel} closed with ${formatValuation(event.openingRecapitalisation.postCloseCashMillions)} cash.`
            : event.kind === "funding-offer-accepted"
              ? `The ${event.roundLabel} offer has been accepted and the lab's cash position has changed. Open Finances for the updated runway.`
              : "A funding offer has been accepted and the lab's cash position has changed. Open Finances for the updated runway.",
        tone: "positive",
      };
    case "researcher-joins":
      if (event.kind === "researcher-poaching-resolved") {
        return {
          title: `${researcherName(view, event.researcherId)} is staying`,
          detail:
            "The rival recruitment attempt ended without a departure. Their roster bonuses remain active, any current assignment is unchanged, and the outcome is recorded in the Lab feed.",
          tone: "positive",
        };
      }
      return {
        title: "Star researcher joined the lab",
        detail:
          "The listed recruitment terms were paid. Open People to choose a research programme for them to lead and review their bonuses, salary, and promise.",
        tone: "positive",
      };
    case "researcher-departs": {
      const departedName =
        event.kind === "researcher-departed" &&
        typeof event.researcherName === "string" &&
        event.researcherName.trim().length > 0
          ? event.researcherName
          : event.kind === "researcher-departed"
            ? researcherName(view, event.researcherId)
            : "A star researcher";
      return {
        title: `${departedName} left the lab`,
        detail: `${departedName} has departed. Their bonuses no longer apply. The Lab feed records the reason; open People to review the roster.`,
        tone: "warning",
      };
    }
    case "rival-breakthrough": {
      const labName =
        event.kind === "rival-public-signal" || event.kind === "paper-discovered"
          ? rivalName(view, event.labId)
          : "A rival lab";
      const publishedPaperTitle =
        event.kind === "rival-public-signal" && event.signalKind === "release"
          ? (view.research.papers.find((paper) => paper.paperId === event.subjectId)
              ?.title ??
            view.research.techTree.papers.find(
              (paper) => paper.paperId === event.subjectId,
            )?.title)
          : undefined;
      const publishedPaperLink =
        event.kind === "rival-public-signal" &&
        event.signalKind === "release" &&
        publishedPaperTitle !== undefined
          ? realPaperSourceLink(view, event.subjectId)
          : undefined;
      const signalTitle =
        event.kind !== "rival-public-signal"
          ? `${labName} reported a research advance`
          : event.signalKind === "incident"
            ? `AI incident reported at ${labName}`
            : event.signalKind === "candidate"
              ? `${labName} reported an AGI candidate`
              : event.signalKind === "autonomy"
                ? `${labName} expanded model autonomy`
                : event.signalKind === "hire"
                  ? `${labName} recruited a star researcher`
                  : event.signalKind === "benchmark"
                    ? `${labName} reported a capability advance`
                    : `${labName} made a public release`;
      return {
        title:
          publishedPaperTitle === undefined
            ? signalTitle
            : `${labName} published ${publishedPaperTitle}`,
        detail:
          event.kind === "rival-public-signal"
            ? rivalSignalSummary(view, event)
            : "This is a competitor signal, not progress by your lab. Open World & rivals for the information currently available.",
        tone: publishedPaperTitle === undefined ? "warning" : "positive",
        ...(publishedPaperLink === undefined ? {} : { externalLink: publishedPaperLink }),
      };
    }
    case "regulatory-attention":
      return {
        title: "Government decision incoming",
        detail:
          event.kind === "government-intervention-triggered"
            ? `${sentenceCase(event.interventionKind)} was triggered at ${Math.round(event.pressure)} intervention pressure. The formal decision will arrive when the next simulation week advances.`
            : "Regulatory pressure produced a new intervention. Its formal decision will arrive next week.",
        tone: "warning",
      };
    case "crisis-opened":
      if (event.kind === "training-failure-check") {
        const project = view.facilities.projects.find(
          (candidate) => candidate.projectId === event.projectId,
        );
        const runName = project?.displayName ?? "Model training";
        const checkpoint = Math.round(event.checkpoint * 100);
        const revisedSchedule =
          project === undefined
            ? ""
            : ` The run is now scheduled for ${String(project.expectedDurationWeeks)} weeks from start.`;
        return {
          title: `${runName} is delayed`,
          detail: `${runName} slipped by ${String(event.delayWeeks)} week${event.delayWeeks === 1 ? "" : "s"} at its ${String(checkpoint)}% checkpoint.${revisedSchedule} GPUs remain reserved, and the overrun adds no training compute. The setback is recorded in the Lab feed.`,
          tone: "warning",
        };
      }
      return {
        title:
          event.kind === "model-incident"
            ? `${sentenceCase(event.category)} model incident`
            : "Critical lab decision opened",
        detail:
          event.kind === "model-incident"
            ? `${modelName(view, event.modelId)} caused an incident${event.contained ? " that was contained" : " that is not confirmed contained"}. Review the event before advancing time.`
            : "A high-severity decision now requires attention. The event window explains what happened and the available responses.",
        tone: "warning",
      };
    case "containment-warning":
      return {
        title:
          event.kind === "anomaly-detected"
            ? "Serious evaluation anomaly detected"
            : "Containment warning",
        detail:
          event.kind === "anomaly-detected"
            ? `${modelName(view, event.modelId)} produced an anomaly with observed severity ${String(Math.round(event.observedSeverity))}/100. Open Models to inspect the evidence.`
            : event.kind === "model-incident"
              ? `${modelName(view, event.modelId)} caused a ${event.category} incident. Open Safety & evaluations to inspect the model evidence and commission follow-up testing. The incident record remains in the Lab feed.`
              : "A potentially dangerous model signal requires immediate review.",
        tone: "critical",
        ...(event.kind === "model-incident"
          ? {
              internalAction: {
                destination: "evaluations" as const,
                label: "Review in Safety & evaluations",
              },
            }
          : {}),
      };
    case "coalition-proposed":
      return {
        title: "Coalition proposal opened",
        detail:
          "A safety coalition proposal involving your lab is now active. Open World & rivals to review its terms and members.",
        tone: "information",
      };
    case "coalition-formed":
      return {
        title: "Safety coalition ratified",
        detail:
          "The coalition has been formed. Shared governance and coalition projects are now available in World & rivals.",
        tone: "positive",
      };
    case "endgame-begins":
      return {
        title: "Deployment crisis has begun",
        detail:
          "An AGI candidate has triggered the endgame. The crisis board now governs containment, verification, and deployment decisions.",
        tone: "critical",
      };
    case "race-won":
      return {
        title: "The run has been won",
        detail:
          "The ending screen explains the outcome and the decisions that produced it.",
        tone: "positive",
      };
    case "race-lost":
      return {
        title: view.meta.endingId?.endsWith("the-long-pause")
          ? "The frontier race has paused"
          : view.meta.endingId?.endsWith("rival-ascendance")
            ? "A rival won the frontier race"
            : "The run has ended in defeat",
        detail: view.meta.endingId?.endsWith("the-long-pause")
          ? "The verified moratorium has taken effect. The ending screen explains the survival outcome and the restraint that secured it."
          : "The ending screen explains what happened and why the run ended.",
        tone: view.meta.endingId?.endsWith("the-long-pause") ? "information" : "critical",
      };
    case "nationalised":
      return {
        title: "The lab has been nationalised",
        detail: "The ending screen explains the intervention and the state of the lab.",
        tone: "critical",
      };
    case "bankruptcy":
      return {
        title: "The lab is insolvent",
        detail:
          "The ending screen explains how the lab remained below $0 for a full year.",
        tone: "critical",
      };
    case "containment-failure":
      return {
        title: "Containment has failed",
        detail: "The ending screen reveals the terminal outcome and the hidden audit.",
        tone: "critical",
      };
    case "score-milestone":
      return event.kind === "facility-completed"
        ? facilityCompletionNotice(view, event)
        : {
            title: "Facility construction completed",
            detail: "A new facility is operational. Its permanent benefits now apply.",
            tone: "positive",
          };
  }
}

/**
 * Audio and visible explanation are one presentation contract. A cue request cannot
 * exist without the notice that tells the player what the sound refers to.
 */
export function cuesForDomainEvent(
  event: DomainEvent,
  view: GameView,
  receiptTick: number,
  eventIndex: number,
): readonly CueRequest[] {
  return cueRequestsForDomainEvent(event, view, receiptTick, eventIndex).map(
    (request) => ({
      ...request,
      notice: noticeForDomainEvent(request.cueId, event, view),
    }),
  );
}

/**
 * A terminal outcome supersedes ordinary events from the same simulation
 * receipt. The ending screen is now the whole game surface: a paper chime or
 * facility notice must never be allowed to play before its terminal sting.
 */
export function cuesForDomainEvents(
  events: readonly DomainEvent[],
  view: GameView,
  receiptTick: number,
): readonly CueRequest[] {
  const requests = events.flatMap((event, eventIndex) =>
    cuesForDomainEvent(event, view, receiptTick, eventIndex),
  );
  const terminal = requests.find((request) =>
    request.occurrenceKey.startsWith("ending:"),
  );
  return terminal === undefined ? requests : [terminal];
}
