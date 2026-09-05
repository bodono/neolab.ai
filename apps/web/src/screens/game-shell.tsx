import { useCallback, useEffect, useState, type ReactElement } from "react";

import {
  formatTeraflops,
  formatValuation,
  type ResolveRolloutDecisionCommand,
  type HighScoreBoard,
  type HighScoreEntry,
} from "@neolab/sim/public";
import { useGameSession, useGameStore } from "../app/runtime-provider.tsx";
import {
  chooseFalseDawnPathCommand,
  reviewRivalRaceCommand,
  rolloutDecisionCommand,
} from "../app/command-builders.ts";
import { ThemeControl } from "../app/theme-control.tsx";
import { AudioControl } from "../audio/audio-control.tsx";
import { AudioEventNotices } from "../audio/audio-event-notices.tsx";
import { useGameAudio } from "../audio/use-game-audio.ts";
import { AgiWorkspace } from "../features/agi/agi-workspace.tsx";
import { LabAmbientActivity } from "../features/campus/lab-ambient-activity.tsx";
import { RuntimeRecoveryPanel } from "../features/recovery/runtime-recovery.tsx";
import { ComputeWorkspace } from "../features/compute/compute-workspace.tsx";
import { summarizeFleetCapacity } from "../features/compute/fleet-capacity.ts";
import { ProcurementDialog } from "../features/compute/procurement-dialog.tsx";
import { FacilitiesWorkspace } from "../features/facilities/facilities-workspace.tsx";
import { EventFeed } from "../features/events/event-feed.tsx";
import { ActivityNoticeLane } from "../features/notifications/activity-notice-lane.tsx";
import { AmbientActivityWire } from "../features/notifications/ambient-activity-wire.tsx";
import { FundraisingDialog } from "../features/fundraising/fundraising-dialog.tsx";
import {
  AnomalyInvestigationDialog,
  ModelsWorkspace,
  modelEvidenceReviewRequest,
  type EvaluationWorkspaceTab,
  type EvaluationWorkspaceAnchor,
  type ModelWorkspaceTab,
} from "../features/models/models-workspace.tsx";
import { formatCapabilityScore } from "../features/models/capability-format.ts";
import {
  anomalyPresentationKey,
  selectAnomalyForPresentation,
} from "../features/models/anomaly-presentation.ts";
import { CapabilityTrajectory } from "../features/models/capability-trajectory.tsx";
import { MajorProjectsPanel } from "../features/progress/major-projects-panel.tsx";
import { HowToPlayDialog } from "../features/help/how-to-play-dialog.tsx";
import { MechanicHelp } from "../features/help/mechanic-help.tsx";
import { LabMaturityPanel } from "../features/progress/lab-maturity-panel.tsx";
import {
  PeopleWorkspace,
  RecruitResearcherDialog,
  ResearcherDossierDialog,
  StarResearcherStrip,
} from "../features/people/people-workspace.tsx";
import {
  PaperDossierDialog,
  PaperDiscoveryDialog,
  ResearchDirectionDialog,
  ResearchWorkspace,
} from "../features/research/research-workspace.tsx";
import {
  OverlayHost,
  type UserOverlayRequest,
} from "../features/overlays/overlay-host.tsx";
import { PhaseTransitionDialog } from "../features/overlays/phase-transition-dialog.tsx";
import { GpuGenerationDialog } from "../features/overlays/gpu-generation-dialog.tsx";
import { RivalCrisisStageDialog } from "../features/overlays/rival-crisis-stage-dialog.tsx";
import { RivalDeploymentImminentDialog } from "../features/overlays/rival-deployment-imminent-dialog.tsx";
import { WorldWorkspace } from "../features/world/world-workspace.tsx";
import { AiCharacterPanel } from "../features/endgame/ai-character-panel.tsx";
import { CrisisBoard } from "../features/endgame/crisis-board.tsx";
import { EndingScreen } from "../features/endgame/ending-screen.tsx";
import { ContainmentFailureExperience } from "../features/endgame/containment-failure-experience.tsx";
import { VictoryDeploymentExperience } from "../features/endgame/victory-deployment-experience.tsx";
import { RolloutDecisionDialog } from "../features/endgame/rollout-decision-dialog.tsx";
import type { GameView } from "../runtime/index.ts";
import { FEEDBACK_URL } from "../runtime/local-diagnostics.ts";
import {
  resolveAutoPauseAction,
  visibleAutoPauseReasons,
} from "../features/overlays/auto-pause-action.ts";
import { PixelPortrait } from "../features/portraits/pixel-portrait.tsx";
import {
  AdvisoryBoard,
  type AdvisoryDestination,
} from "../features/advisory/advisory-board.tsx";
import { useGamePauseShortcut } from "../app/use-game-pause-shortcut.ts";
import {
  operatingMilestoneForTick,
  shouldShowOperatingMilestone,
} from "./operating-milestone.ts";
import { selectUnacknowledgedPlayerPaper } from "./player-paper-discovery.ts";
import { crisisDecisionKey } from "./crisis-decision-key.ts";
import { TutorialGuide } from "../features/tutorial/tutorial-guide.tsx";

function formatSignedCashflow(millions: number): string {
  return `${millions >= 0 ? "+" : ""}${formatValuation(millions)}`;
}

type DashboardSection =
  | "overview"
  | "crisis"
  | "compute"
  | "facilities"
  | "research"
  | "models"
  | "agi"
  | "evaluations"
  | "people"
  | "world"
  | "finances"
  | "bonuses";

const DASHBOARD_SECTIONS: readonly {
  readonly id: DashboardSection;
  readonly shortLabel: string;
  readonly label: string;
}[] = [
  { id: "overview", shortLabel: "OV", label: "Overview" },
  { id: "compute", shortLabel: "GP", label: "GPUs & compute" },
  { id: "facilities", shortLabel: "CP", label: "Facilities & campus" },
  { id: "research", shortLabel: "RS", label: "Research" },
  { id: "models", shortLabel: "MD", label: "Models & deployment" },
  { id: "agi", shortLabel: "AG", label: "AGI & RSI" },
  { id: "evaluations", shortLabel: "EV", label: "Safety & evaluations" },
  { id: "people", shortLabel: "PP", label: "People" },
  { id: "world", shortLabel: "WD", label: "World & rivals" },
  { id: "finances", shortLabel: "FN", label: "Finances & score" },
  { id: "bonuses", shortLabel: "FX", label: "Bonuses & penalties" },
];

const CRISIS_DASHBOARD_SECTION = {
  id: "crisis",
  shortLabel: "!!",
  label: "Deployment Crisis",
} as const satisfies {
  readonly id: DashboardSection;
  readonly shortLabel: string;
  readonly label: string;
};

function reasonLabel(reason: string): string {
  if (reason === "rival-final-year") return "RIVAL DEPLOYMENT IMMINENT";
  return reason.replaceAll("-", " ").toUpperCase();
}

const RESEARCHER_PAUSE_WARNINGS = new Set([
  "Ultimatum pending",
  "Rival contact reported",
  "Promise due soon",
  "Promise broken",
]);

export function GameShell({
  onRestart,
  onHighScores,
  highScoreBoards,
  highScoreBusy,
  highScoreError,
  onDeleteHighScore,
}: {
  readonly onRestart: () => Promise<string | undefined>;
  readonly onHighScores: () => void;
  readonly highScoreBoards: Readonly<Record<HighScoreBoard, readonly HighScoreEntry[]>>;
  readonly highScoreBusy: boolean;
  readonly highScoreError: string | undefined;
  readonly onDeleteHighScore: (runId: string) => void;
}): ReactElement {
  const { runtime, content } = useGameSession();
  const view = useGameStore((state) => state.gameView);
  const clock = useGameStore((state) => state.clockView);
  const runtimeFault = useGameStore((state) => state.runtimeFault);
  const [buyingGpus, setBuyingGpus] = useState(false);
  const [fundraisingOpen, setFundraisingOpen] = useState(false);
  const [section, setSection] = useState<DashboardSection>("overview");
  const [focusedRivalId, setFocusedRivalId] = useState<string>();
  const [selectedResearcherId, setSelectedResearcherId] = useState<string>();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [peopleNotice, setPeopleNotice] = useState<string>();
  const [dismissedOperatingMilestoneYear, setDismissedOperatingMilestoneYear] =
    useState<number>();
  const [requestedEventId, setRequestedEventId] = useState<string>();
  const [selectedFeedPaperId, setSelectedFeedPaperId] = useState<string>();
  const [deferredEvents, setDeferredEvents] = useState(() => new Set<string>());
  const [acknowledgedPaperIds, setAcknowledgedPaperIds] = useState(
    () => new Set<string>(),
  );
  const [acknowledgedAnomalyKeys, setAcknowledgedAnomalyKeys] = useState(
    () => new Set<string>(),
  );
  const [acknowledgedPhases, setAcknowledgedPhases] = useState(() => new Set<string>());
  const [acknowledgedRivalCrisisStages, setAcknowledgedRivalCrisisStages] = useState(
    () => new Set<string>(),
  );
  const [acknowledgedRivalDeploymentWarnings, setAcknowledgedRivalDeploymentWarnings] =
    useState(() => new Set<string>());
  const [acknowledgedGenerations, setAcknowledgedGenerations] = useState(
    () => new Set<string>(),
  );
  const [deferredCrisisDecisionKeys, setDeferredCrisisDecisionKeys] = useState(
    () => new Set<string>(),
  );
  const [activeAnomalyId, setActiveAnomalyId] = useState<string>();
  const [modelWorkspaceTab, setModelWorkspaceTab] = useState<ModelWorkspaceTab>("train");
  const [requestedModelId, setRequestedModelId] = useState<string>();
  const [evaluationRequest, setEvaluationRequest] = useState<{
    readonly modelId: string;
    readonly workspace: EvaluationWorkspaceTab;
    readonly anchor?: EvaluationWorkspaceAnchor;
  }>();
  const [exitConfirmationOpen, setExitConfirmationOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [resumeAfterHowToPlay, setResumeAfterHowToPlay] = useState(false);
  const [resumeAfterExitCancel, setResumeAfterExitCancel] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string>();
  const acknowledgePresentation = useCallback(
    (key: string) => {
      runtime.acknowledgePresentation(key);
    },
    [runtime],
  );
  const pauseGame = useCallback(() => runtime.pause(), [runtime]);
  const resumeGame = useCallback(() => {
    runtime.resume();
  }, [runtime]);
  const inspectRivalNotice = useCallback(
    (labId: string) => {
      if (
        view?.meta.labMaturity?.stage === "model" &&
        view.meta.labMaturity.checklist.some(
          (item) =>
            item.label === "Open World and inspect the rival race" && !item.complete,
        )
      ) {
        const command = reviewRivalRaceCommand(view);
        if (runtime.validate(command).ok) runtime.dispatch(command);
      }
      setFocusedRivalId(labId);
      setSection("world");
    },
    [runtime, view],
  );
  const inspectResearcherNotice = useCallback((researcherId: string) => {
    setSelectedResearcherId(researcherId);
    setSection("people");
  }, []);

  const audioPresentation = useGameAudio(runtime, view, section);

  const projectedClockStopped = view?.endgame.maxClockSpeed === "paused";
  const displayedClockPaused = (clock?.paused ?? true) || projectedClockStopped;

  useGamePauseShortcut({
    enabled:
      runtimeFault === undefined &&
      view !== undefined &&
      clock !== undefined &&
      view.meta.status === "active" &&
      !projectedClockStopped,
    paused: displayedClockPaused,
    onPause: pauseGame,
    onResume: resumeGame,
  });

  useEffect(() => {
    if (view !== undefined && !view.endgame.active && section === "crisis") {
      setSection("overview");
    }
  }, [section, view]);

  const fundingOffersReady = clock?.autoPauseReasons.includes("funding-offers") ?? false;
  useEffect(() => {
    if (fundingOffersReady) setFundraisingOpen(true);
  }, [fundingOffersReady]);

  if (runtimeFault !== undefined) {
    return <RuntimeRecoveryPanel runtime={runtime} fault={runtimeFault} />;
  }

  if (view === undefined || clock === undefined) {
    return (
      <main className="boot-screen">
        <p>Projecting lab telemetry…</p>
      </main>
    );
  }

  // The canonical transition retains its reasons until the next tick. The clock is the
  // source of truth for whether those reasons are still actively holding time.
  const operatingMilestone = operatingMilestoneForTick(view.meta.tick);
  const autoPause = visibleAutoPauseReasons(
    clock.autoPauseReasons,
    view.fundraising.activeCampaign?.status,
  ).filter(
    (reason) => reason !== "bankruptcy-warning" || view.finance.insolvencyClock.active,
  );
  const runEnded = view.meta.status !== "active";
  const terminalIncidentResult = view.presentationQueue.find(
    (item) => item.kind === "model-incident-result" && item.terminalOutcome,
  );
  const endgameActive = view.endgame.active;
  const visibleSectionIds = new Set<string>(
    view.meta.labMaturity?.visibleSections ?? DASHBOARD_SECTIONS.map((item) => item.id),
  );
  const maturitySections = DASHBOARD_SECTIONS.filter((item) =>
    visibleSectionIds.has(item.id),
  );
  const dashboardSections = endgameActive
    ? maturitySections.flatMap((item, index) =>
        index === 1 ? [CRISIS_DASHBOARD_SECTION, item] : [item],
      )
    : maturitySections;
  const unlockedFeatures = new Set<string>(
    view.meta.labMaturity?.features ?? [
      "compute",
      "models",
      "productisation",
      "evaluations",
      "fundraising",
      "finances",
      "facilities",
      "people",
      "research",
      "world",
      "bonuses",
      "agi",
    ],
  );
  const facilityForecastLines = view.finance.linesPerCycle.filter(
    (line) => line.category === "facility",
  );
  const facilityForecastTotal = facilityForecastLines.reduce(
    (total, line) => total + line.amountMillions,
    0,
  );
  const firstFacilityForecastLine = facilityForecastLines[0];
  const financeForecastLines = view.finance.linesPerCycle.flatMap((line) => {
    if (line.category !== "facility") return [line];
    if (line !== firstFacilityForecastLine) return [];
    return [
      {
        ...line,
        sourceId: "facility-operations-total",
        description: `Facility operations (${String(facilityForecastLines.length)})`,
        amountMillions: facilityForecastTotal,
        amountLabel: `${facilityForecastTotal < 0 ? "−" : ""}${formatValuation(
          Math.abs(facilityForecastTotal),
        )}`,
      },
    ];
  });
  const activeModifierGroupsByKey = new Map<
    string,
    {
      readonly modifier: (typeof view.activeModifiers)[number];
      count: number;
    }
  >();
  for (const modifier of view.activeModifiers) {
    const key = [
      modifier.sourceLabel,
      modifier.sourceKind,
      modifier.targetLabel,
      modifier.effectLabel,
      modifier.explanation,
      String(modifier.temporary),
      String(modifier.remainingWeeks ?? ""),
    ].join("\u0000");
    const group = activeModifierGroupsByKey.get(key);
    if (group === undefined) {
      activeModifierGroupsByKey.set(key, { modifier, count: 1 });
    } else {
      group.count += 1;
    }
  }
  const activeModifierGroups = [...activeModifierGroupsByKey.values()];
  const activeModifierSectionsByKind = new Map<string, typeof activeModifierGroups>();
  for (const group of activeModifierGroups) {
    const groups = activeModifierSectionsByKind.get(group.modifier.sourceKind) ?? [];
    activeModifierSectionsByKind.set(group.modifier.sourceKind, [...groups, group]);
  }
  const activeModifierSections = [...activeModifierSectionsByKind.entries()];
  const researcherPauseActive = autoPause.includes("resignation-ultimatum");
  const researcherNeedingAttention = view.people.roster.find((researcher) =>
    researcher.warnings.some((warning) => RESEARCHER_PAUSE_WARNINGS.has(warning)),
  );
  const researcherAttentionWarning = [
    "Ultimatum pending",
    "Rival contact reported",
    "Promise broken",
    "Promise due soon",
  ].find((warning) => researcherNeedingAttention?.warnings.includes(warning));
  const pendingResearcherDeparture = view.presentationQueue.find(
    (item) => item.kind === "researcher-departure",
  );
  const departedResearcherName = pendingResearcherDeparture?.researcherDisplayName;
  const researcherPauseHeadline =
    researcherNeedingAttention !== undefined && researcherAttentionWarning !== undefined
      ? researcherAttentionWarning === "Promise broken" ||
        (researcherAttentionWarning === "Ultimatum pending" &&
          researcherNeedingAttention.ultimatum?.reason === "compact-breach")
        ? `${researcherNeedingAttention.displayName.toUpperCase()} · PROMISE BROKEN`
        : `${researcherNeedingAttention.displayName.toUpperCase()} · ${researcherAttentionWarning.toUpperCase()}`
      : `${(departedResearcherName ?? "Researcher").toUpperCase()} · DEPARTURE RECORDED`;
  const blockingCritical = view.eventQueue.items.some(
    (item) => item.severity === "critical",
  );
  const blockingResearchDirection = view.research.pendingGenericAdvances.length > 0;
  const blockingEndgameClock = projectedClockStopped;
  const containmentFailureActive =
    view.endgame.active && view.endgame.stage === "containment-failure";
  const finalDeploymentActive =
    view.endgame.active &&
    (view.endgame.stageActions.kind === "world-waiting" ||
      (view.endgame.stageActions.kind === "rollout" &&
        view.endgame.stageActions.currentBeat === "settlement" &&
        view.endgame.stageActions.awaitingDecision &&
        view.endgame.commandRail.deployNow.available));
  const exclusiveEndgameSequenceActive =
    containmentFailureActive || finalDeploymentActive;
  const currentModel =
    view.models.cards.find((model) => model.modelId === view.models.currentModelId) ??
    view.models.cards.at(-1);
  const investigationCompletionPending = autoPause.includes(
    "anomaly-investigation-complete",
  );
  const anomalyDetectionPending = autoPause.includes("anomaly-detected");
  const latestActionableAnomaly = selectAnomalyForPresentation({
    acknowledgedKeys: acknowledgedAnomalyKeys,
    activeAnomalyId: undefined,
    anomalyDetectionPending,
    investigationCompletionPending,
    models: view.models.cards,
  })?.anomaly;
  const latestTrainingOutcome = [...view.facilities.projects]
    .filter(
      (project) =>
        project.kind === "training" &&
        (project.status === "completed" || project.status === "failed"),
    )
    .sort(
      (left, right) =>
        (right.training?.outcomeAtTick ?? right.createdAtTick) -
        (left.training?.outcomeAtTick ?? left.createdAtTick),
    )[0];
  const orphanedTrainingPause =
    latestTrainingOutcome === undefined &&
    autoPause.length > 0 &&
    autoPause.every(
      (reason) => reason === "training-complete" || reason === "training-failed",
    );
  const paperDiscoveryPauseActive = autoPause.some(
    (reason) => reason === "paper-discovered" || reason === "world-first-paper",
  );
  const unacknowledgedPlayerPaper = selectUnacknowledgedPlayerPaper({
    papers: view.research.papers,
    pendingPublicationPaperIds: view.research.pendingPublicationPaperIds,
    acknowledgedPaperIds,
    currentTick: view.meta.tick,
    paperDiscoveryPauseActive,
  });
  const resolvedAutoPauseAction = resolveAutoPauseAction(autoPause);
  const mappedAutoPauseAction = orphanedTrainingPause
    ? {
        reason: "training-complete" as const,
        label: "Dismiss rival training signal",
        destination: "resume" as const,
      }
    : resolvedAutoPauseAction?.reason === "resignation-ultimatum" &&
        researcherNeedingAttention === undefined
      ? {
          reason: "resignation-ultimatum" as const,
          label: "Dismiss researcher departure",
          destination: "resume" as const,
        }
      : resolvedAutoPauseAction;
  const pausedDecisionEvent =
    mappedAutoPauseAction?.reason === "critical-event"
      ? view.eventQueue.items.find((item) => item.severity === "critical")
      : mappedAutoPauseAction?.reason === "urgent-event"
        ? view.eventQueue.items.find((item) => item.severity === "urgent")
        : undefined;
  const autoPauseAction =
    mappedAutoPauseAction?.destination === "event" && pausedDecisionEvent === undefined
      ? {
          reason: mappedAutoPauseAction.reason,
          label: "Dismiss resolved event alert",
          destination: "resume" as const,
        }
      : mappedAutoPauseAction?.reason === "research-direction" &&
          !blockingResearchDirection
        ? {
            reason: "research-direction" as const,
            label: "Research direction recorded",
            destination: "resume" as const,
          }
        : mappedAutoPauseAction;
  const autoPauseActionLabel =
    autoPauseAction?.reason === "resignation-ultimatum" &&
    researcherNeedingAttention !== undefined
      ? researcherAttentionWarning === "Ultimatum pending"
        ? `Respond to ${researcherNeedingAttention.displayName}`
        : researcherAttentionWarning === "Rival contact reported"
          ? `Review ${researcherNeedingAttention.displayName}'s rival approach`
          : `Review ${researcherNeedingAttention.displayName}'s promise`
      : autoPauseAction?.label;
  const selectedResearcher = view.people.roster.find(
    (researcher) => researcher.researcherId === selectedResearcherId,
  );
  const selectedCandidate = view.people.market.candidates.find(
    (candidate) => candidate.researcherId === selectedCandidateId,
  );
  const selectedFeedPaper = view.research.papers.find(
    (paper) => paper.paperId === selectedFeedPaperId,
  );

  function play(speed: "1x" | "2x" | "4x"): void {
    runtime.setSpeed(speed);
    runtime.resume();
  }

  function navigateSection(
    nextSection: DashboardSection,
    options: { readonly preserveEvaluationTarget?: boolean } = {},
  ): void {
    if (nextSection !== "models") setRequestedModelId(undefined);
    if (nextSection === "evaluations" && options.preserveEvaluationTarget !== true) {
      const currentModelId = view?.models.currentModelId;
      setEvaluationRequest(
        currentModelId === undefined
          ? undefined
          : {
              modelId: currentModelId,
              workspace: "overview",
              anchor: "model",
            },
      );
    }
    if (nextSection !== "crisis" && !visibleSectionIds.has(nextSection)) {
      setSection("overview");
      return;
    }
    if (
      view !== undefined &&
      nextSection === "world" &&
      view.meta.labMaturity?.stage === "model" &&
      view.meta.labMaturity.checklist.some(
        (item) =>
          item.label === "Open World and inspect the rival race" && !item.complete,
      )
    ) {
      const command = reviewRivalRaceCommand(view);
      if (runtime.validate(command).ok) runtime.dispatch(command);
    }
    setSection(nextSection);
  }

  const inspectPaperResearcher = (
    definitionId: string,
    inspirationName: string,
  ): void => {
    const rosterResearcher = view.people.roster.find(
      (researcher) => researcher.definitionId === definitionId,
    );
    const marketCandidate = view.people.market.candidates.find(
      (candidate) => candidate.definitionId === definitionId,
    );

    setSelectedResearcherId(rosterResearcher?.researcherId);
    setSelectedCandidateId(
      rosterResearcher === undefined ? marketCandidate?.researcherId : undefined,
    );
    setPeopleNotice(
      rosterResearcher === undefined && marketCandidate === undefined
        ? `The fictional researcher inspired by ${inspirationName} is not on payroll or in this market slate. Their profile will appear here when they become available.`
        : undefined,
    );
    navigateSection("people");
  };

  function revealAttentionPanel(
    nextSection: DashboardSection,
    preferredTargetId: string,
  ): void {
    setSection(nextSection);
    window.requestAnimationFrame(() => {
      const target =
        document.getElementById(preferredTargetId) ??
        document.getElementById("game-workspace-top");
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
      // Flash the revealed panel so the navigation is visible even when the
      // target was already on screen.
      const panel = target?.closest("section");
      if (panel !== null && panel !== undefined) {
        panel.classList.remove("attention-flash");
        window.requestAnimationFrame(() => panel.classList.add("attention-flash"));
        window.setTimeout(() => panel.classList.remove("attention-flash"), 2000);
      }
    });
  }

  function requestExit(): void {
    setResumeAfterExitCancel(clock?.paused === false);
    setExitError(undefined);
    runtime.pause();
    setExitConfirmationOpen(true);
  }

  function openHowToPlay(): void {
    setResumeAfterHowToPlay(clock?.paused === false);
    runtime.pause();
    setHowToPlayOpen(true);
  }

  function closeHowToPlay(): void {
    setHowToPlayOpen(false);
    if (resumeAfterHowToPlay) runtime.resume();
  }

  function cancelExit(): void {
    setExitConfirmationOpen(false);
    setExitError(undefined);
    if (resumeAfterExitCancel) runtime.resume();
  }

  function openDecisionEvent(instanceId: string): void {
    setDeferredEvents((current) => {
      const next = new Set(current);
      next.delete(instanceId);
      return next;
    });
    setRequestedEventId(instanceId);
  }

  function handleAutoPauseAction(): void {
    switch (autoPauseAction?.destination) {
      case "fundraising":
        setFundraisingOpen(true);
        return;
      case "research":
        revealAttentionPanel("research", "papers-title");
        return;
      case "compute":
        revealAttentionPanel("compute", "compute-title");
        return;
      case "models":
        revealAttentionPanel(
          "models",
          latestTrainingOutcome === undefined ? "models-title" : "training-outcome-title",
        );
        return;
      case "evaluations":
        if (latestActionableAnomaly !== undefined) {
          setSection("evaluations");
          setActiveAnomalyId(latestActionableAnomaly.anomalyId);
        } else {
          revealAttentionPanel("evaluations", "evaluations-workspace");
        }
        return;
      case "people":
        handleResearcherPauseAction();
        return;
      case "world":
        revealAttentionPanel(
          "world",
          autoPauseAction.reason === "government-intervention"
            ? "regulation-title"
            : "rivals-title",
        );
        return;
      case "crisis":
        if (endgameActive) {
          setSection("crisis");
        } else {
          revealAttentionPanel("models", "models-title");
        }
        return;
      case "resume":
        runtime.resume();
        return;
      case "event": {
        if (pausedDecisionEvent === undefined) {
          runtime.resume();
          return;
        }
        openDecisionEvent(pausedDecisionEvent.instanceId);
        return;
      }
      case undefined:
        return;
    }
  }

  function handleResearcherPauseAction(): void {
    if (researcherNeedingAttention !== undefined) {
      setSection("people");
      setSelectedResearcherId(researcherNeedingAttention.researcherId);
      return;
    }
    revealAttentionPanel("people", "people-title");
  }

  function handleAdvisoryNavigation(destination: AdvisoryDestination): void {
    if (destination === "fundraising") {
      setFundraisingOpen(true);
      return;
    }
    if (destination === "buy-compute") {
      setBuyingGpus(true);
      return;
    }
    if (destination === "resume") {
      runtime.resume();
      return;
    }
    if (destination === "crisis") {
      if (endgameActive) setSection("crisis");
      return;
    }
    navigateSection(destination);
  }

  function currentUserOverlay(safeView: GameView): UserOverlayRequest | undefined {
    if (exitConfirmationOpen) {
      return {
        key: "exit-current-run",
        node: (
          <div className="modal-backdrop">
            <section
              className="purchase-dialog exit-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="exit-current-run-title"
            >
              <p className="eyebrow">RUN CONTROL // DELIBERATE EXIT</p>
              <h2 id="exit-current-run-title">Return to the title screen?</h2>
              <p>
                The current lab will be saved to the Autosave slot before you leave. You
                can continue it from the title screen or start a different run.
              </p>
              <p className="confirmation-warning">
                Starting another game does not delete this run, but its next autosave will
                replace the shared Autosave slot. Export the save first if you want a
                permanent copy.
              </p>
              {exitError === undefined ? null : (
                <p className="save-error" role="alert">
                  The run could not be saved: {exitError}
                </p>
              )}
              <div className="exit-dialog-actions">
                <button
                  className="secondary"
                  type="button"
                  autoFocus
                  disabled={exitBusy}
                  onClick={cancelExit}
                >
                  Keep playing
                </button>
                <button
                  className="primary danger"
                  type="button"
                  disabled={exitBusy}
                  onClick={() => {
                    setExitBusy(true);
                    setExitError(undefined);
                    void onRestart().then((error) => {
                      if (error !== undefined) {
                        setExitError(error);
                        setExitBusy(false);
                      }
                    });
                  }}
                >
                  {exitBusy ? "Saving…" : "Save & return to title"}
                </button>
              </div>
            </section>
          </div>
        ),
      };
    }
    const pendingCrisisDecisionKey = crisisDecisionKey(safeView);
    if (
      pendingCrisisDecisionKey !== undefined &&
      safeView.endgame.active &&
      safeView.endgame.stageActions.kind === "rollout" &&
      safeView.endgame.stageActions.awaitingDecision &&
      safeView.endgame.stageActions.options.length > 0 &&
      !deferredCrisisDecisionKeys.has(pendingCrisisDecisionKey)
    ) {
      const actions = safeView.endgame.stageActions;
      const deferCrisisDecision = (): void => {
        setDeferredCrisisDecisionKeys(
          (current) => new Set([...current, pendingCrisisDecisionKey]),
        );
      };
      return {
        key: `rollout-decision:${pendingCrisisDecisionKey}`,
        node: (
          <RolloutDecisionDialog
            actions={actions}
            onChoose={(id) => {
              const command = rolloutDecisionCommand(
                safeView,
                id as ResolveRolloutDecisionCommand["optionId"],
              );
              if (!runtime.validate(command).ok) return;
              const receipt = runtime.dispatch(command);
              if (receipt.fault === undefined) deferCrisisDecision();
            }}
            onDefer={deferCrisisDecision}
          />
        ),
      };
    }
    if (
      section !== "crisis" &&
      pendingCrisisDecisionKey !== undefined &&
      !deferredCrisisDecisionKeys.has(pendingCrisisDecisionKey)
    ) {
      const deferCrisisDecision = (): void => {
        setDeferredCrisisDecisionKeys(
          (current) => new Set([...current, pendingCrisisDecisionKey]),
        );
      };
      return {
        key: `crisis-decision:${pendingCrisisDecisionKey}`,
        node: (
          <div className="modal-backdrop crisis-decision-backdrop">
            <section
              className={`crisis-decision-dialog crisis-decision-dialog-${
                safeView.endgame.active ? safeView.endgame.stageActions.kind : "inactive"
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="crisis-decision-dialog-title"
            >
              <header className="crisis-decision-dialog-header">
                <div>
                  <p className="eyebrow">DEPLOYMENT CRISIS // DECISION REQUIRED</p>
                  <h2 id="crisis-decision-dialog-title">
                    The crisis has reached your desk
                  </h2>
                  <p>
                    Resolve this now, or close this window and revisit the decision from
                    the Deployment Crisis command room.
                  </p>
                </div>
                <button
                  className="secondary"
                  type="button"
                  aria-label="Decide later"
                  onClick={deferCrisisDecision}
                >
                  ×
                </button>
              </header>
              <CrisisBoard
                view={safeView}
                runtime={runtime}
                onDecisionCommitted={deferCrisisDecision}
              />
            </section>
          </div>
        ),
      };
    }
    const rivalCrisisStageNews = safeView.eventQueue.autoPauseReasons.includes(
      "rival-final-year",
    )
      ? undefined
      : safeView.world.crisisStageAnnouncements.find((announcement) => {
          const key = `${announcement.labId}:${announcement.modelId}:${announcement.kind}:${announcement.stage}:${String(announcement.tick)}`;
          return (
            safeView.meta.tick - announcement.tick <= 4 &&
            !acknowledgedRivalCrisisStages.has(key)
          );
        });
    if (rivalCrisisStageNews !== undefined) {
      const newsKey = `${rivalCrisisStageNews.labId}:${rivalCrisisStageNews.modelId}:${rivalCrisisStageNews.kind}:${rivalCrisisStageNews.stage}:${String(rivalCrisisStageNews.tick)}`;
      const acknowledgeNews = (): void => {
        setAcknowledgedRivalCrisisStages((current) => new Set([...current, newsKey]));
      };
      return {
        key: `rival-crisis-stage:${newsKey}`,
        node: (
          <RivalCrisisStageDialog
            announcement={rivalCrisisStageNews}
            onContinue={acknowledgeNews}
            onOpenRivalWatch={() => {
              acknowledgeNews();
              navigateSection("world");
            }}
          />
        ),
      };
    }
    if (safeView.eventQueue.autoPauseReasons.includes("rival-final-year")) {
      const warning = safeView.world.rivals.find(
        (rival) =>
          rival.candidateCountdown !== undefined &&
          rival.candidateCountdown.finalDeploymentWarningActive &&
          !acknowledgedRivalDeploymentWarnings.has(
            `${rival.labId}:${rival.candidateCountdown.modelName}:${String(safeView.meta.tick)}`,
          ),
      );
      if (warning?.candidateCountdown !== undefined) {
        const warningKey = `${warning.labId}:${warning.candidateCountdown.modelName}:${String(safeView.meta.tick)}`;
        const acknowledgeWarning = (): void => {
          setAcknowledgedRivalDeploymentWarnings(
            (current) => new Set([...current, warningKey]),
          );
          setAcknowledgedRivalCrisisStages((current) => {
            const next = new Set(current);
            for (const announcement of safeView.world.crisisStageAnnouncements) {
              if (
                announcement.labId === warning.labId &&
                safeView.meta.tick - announcement.tick <= 4
              ) {
                next.add(
                  `${announcement.labId}:${announcement.modelId}:${announcement.kind}:${announcement.stage}:${String(announcement.tick)}`,
                );
              }
            }
            return next;
          });
          runtime.resume();
        };
        return {
          key: `rival-deployment-imminent:${warningKey}`,
          node: (
            <RivalDeploymentImminentDialog
              warning={{
                labName: warning.labName,
                modelName: warning.candidateCountdown.modelName,
                estimateLabel: warning.candidateCountdown.estimateLabel,
                confidence: warning.candidateCountdown.confidence,
              }}
              onContinue={acknowledgeWarning}
              onOpenRivalWatch={() => {
                setAcknowledgedRivalDeploymentWarnings(
                  (current) => new Set([...current, warningKey]),
                );
                setAcknowledgedRivalCrisisStages((current) => {
                  const next = new Set(current);
                  for (const announcement of safeView.world.crisisStageAnnouncements) {
                    if (
                      announcement.labId === warning.labId &&
                      safeView.meta.tick - announcement.tick <= 4
                    ) {
                      next.add(
                        `${announcement.labId}:${announcement.modelId}:${announcement.kind}:${announcement.stage}:${String(announcement.tick)}`,
                      );
                    }
                  }
                  return next;
                });
                navigateSection("world");
                setFocusedRivalId(warning.labId);
              }}
            />
          ),
        };
      }
    }
    if (selectedFeedPaper !== undefined) {
      return {
        key: `paper-dossier:${selectedFeedPaper.paperId}`,
        node: (
          <PaperDossierDialog
            paper={selectedFeedPaper}
            runtime={runtime}
            view={safeView}
            onClose={() => setSelectedFeedPaperId(undefined)}
            onOpenResearch={() => {
              setSelectedFeedPaperId(undefined);
              revealAttentionPanel("research", "papers-title");
            }}
            onInspectResearcher={(definitionId, inspirationName) => {
              setSelectedFeedPaperId(undefined);
              inspectPaperResearcher(definitionId, inspirationName);
            }}
          />
        ),
      };
    }
    const anomalyRecord = selectAnomalyForPresentation({
      acknowledgedKeys: acknowledgedAnomalyKeys,
      activeAnomalyId,
      anomalyDetectionPending,
      investigationCompletionPending,
      models: safeView.models.cards,
    });
    if (anomalyRecord !== undefined) {
      const presentationKey = anomalyPresentationKey(anomalyRecord.anomaly);
      const acknowledge = (): void => {
        setAcknowledgedAnomalyKeys((current) => new Set([...current, presentationKey]));
        setActiveAnomalyId(undefined);
      };
      return {
        key: `anomaly:${presentationKey}`,
        node: (
          <AnomalyInvestigationDialog
            anomaly={anomalyRecord.anomaly}
            model={anomalyRecord.model}
            runtime={runtime}
            view={safeView}
            onDecided={acknowledge}
            onReviewEvidence={() => {
              acknowledge();
              setEvaluationRequest(
                modelEvidenceReviewRequest(anomalyRecord.model.modelId),
              );
              revealAttentionPanel("evaluations", "model-safety-case");
            }}
            onResume={() => {
              acknowledge();
              runtime.resume();
            }}
          />
        ),
      };
    }
    if (unacknowledgedPlayerPaper !== undefined) {
      const markAcknowledged = (): void => {
        setAcknowledgedPaperIds(
          (current) => new Set([...current, unacknowledgedPlayerPaper.paperId]),
        );
      };
      return {
        key: `paper-discovery:${unacknowledgedPlayerPaper.paperId}`,
        node: (
          <PaperDiscoveryDialog
            paper={unacknowledgedPlayerPaper}
            runtime={runtime}
            view={safeView}
            onAcknowledge={markAcknowledged}
            onPublicationChosen={markAcknowledged}
            onInspectResearcher={(definitionId, inspirationName) => {
              markAcknowledged();
              inspectPaperResearcher(definitionId, inspirationName);
            }}
          />
        ),
      };
    }
    const pendingResearchDirection = safeView.research.pendingGenericAdvances[0];
    if (pendingResearchDirection !== undefined) {
      return {
        key: `research-direction:${pendingResearchDirection.programId}:${String(pendingResearchDirection.threshold)}`,
        node: (
          <ResearchDirectionDialog
            advance={pendingResearchDirection}
            pendingCount={safeView.research.pendingGenericAdvances.length}
            runtime={runtime}
            view={safeView}
          />
        ),
      };
    }
    if (
      (safeView.meta.phase === "scaling" || safeView.meta.phase === "frontier") &&
      safeView.meta.phaseChangedAtTick !== undefined &&
      safeView.meta.tick - safeView.meta.phaseChangedAtTick <= 4 &&
      !acknowledgedPhases.has(safeView.meta.phase)
    ) {
      const phase = safeView.meta.phase;
      const acknowledgePhase = (): void => {
        setAcknowledgedPhases((current) => new Set([...current, phase]));
      };
      return {
        key: `world-phase:${phase}`,
        node: (
          <PhaseTransitionDialog
            phase={phase}
            content={content}
            onReviewFacilities={() => {
              acknowledgePhase();
              navigateSection("facilities");
            }}
            onReviewResearch={() => {
              acknowledgePhase();
              navigateSection("research");
            }}
            onContinue={acknowledgePhase}
          />
        ),
      };
    }
    if (
      safeView.compute.currentGenerationUnlockedAtTick !== undefined &&
      safeView.meta.tick - safeView.compute.currentGenerationUnlockedAtTick <= 4 &&
      !acknowledgedGenerations.has(safeView.compute.currentGenerationId)
    ) {
      const generationId = safeView.compute.currentGenerationId;
      const acknowledgeGeneration = (): void => {
        setAcknowledgedGenerations((current) => new Set([...current, generationId]));
      };
      return {
        key: `gpu-generation:${generationId}`,
        node: (
          <GpuGenerationDialog
            generationId={generationId}
            content={content}
            onContinue={acknowledgeGeneration}
            onOpenProcurement={() => {
              acknowledgeGeneration();
              setBuyingGpus(true);
            }}
            onOpenFacilities={() => {
              acknowledgeGeneration();
              navigateSection("facilities");
            }}
          />
        ),
      };
    }
    if (buyingGpus) {
      return {
        key: "gpu-market",
        node: (
          <ProcurementDialog
            content={content}
            runtime={runtime}
            view={safeView}
            onClose={() => setBuyingGpus(false)}
          />
        ),
      };
    }
    if (fundraisingOpen) {
      return {
        key: "fundraising",
        node: (
          <FundraisingDialog
            runtime={runtime}
            view={safeView}
            onClose={() => setFundraisingOpen(false)}
          />
        ),
      };
    }
    if (selectedResearcher !== undefined) {
      return {
        key: `researcher:${selectedResearcher.researcherId}`,
        node: (
          <ResearcherDossierDialog
            key={selectedResearcher.researcherId}
            researcher={selectedResearcher}
            runtime={runtime}
            view={safeView}
            onClose={() => setSelectedResearcherId(undefined)}
            onNavigate={(destination) => {
              setSelectedResearcherId(undefined);
              navigateSection(destination === "lab" ? "facilities" : destination);
            }}
            onDismissed={(name) => {
              setPeopleNotice(`${name} has departed from the lab.`);
              setSelectedResearcherId(undefined);
            }}
          />
        ),
      };
    }
    if (selectedCandidate !== undefined) {
      return {
        key: `candidate:${selectedCandidate.researcherId}`,
        node: (
          <RecruitResearcherDialog
            key={selectedCandidate.researcherId}
            candidate={selectedCandidate}
            runtime={runtime}
            view={safeView}
            onClose={() => setSelectedCandidateId(undefined)}
            onRecruited={() => {
              setPeopleNotice(undefined);
              setSelectedCandidateId(undefined);
            }}
          />
        ),
      };
    }
    return undefined;
  }

  const userOverlay = currentUserOverlay(view);
  const sideNoticeSuppressed =
    audioPresentation.notices.length > 0 ||
    exclusiveEndgameSequenceActive ||
    userOverlay !== undefined ||
    view.presentationQueue.some((item) => item.attention === "modal") ||
    view.eventQueue.items.some(
      (item) =>
        item.severity === "critical" ||
        ((item.severity === "urgent" || item.severity === "decision") &&
          !deferredEvents.has(item.instanceId)) ||
        item.instanceId === requestedEventId,
    );
  const campaignPhaseLabel = `${view.meta.phase.charAt(0).toUpperCase()}${view.meta.phase.slice(1)} phase`;
  const incomingPhysicalGpus = view.compute.pendingDeliveries.reduce(
    (sum, delivery) => sum + delivery.physicalGpus,
    0,
  );
  const fleetCapacity = summarizeFleetCapacity({
    ownedPhysicalGpus: view.compute.totalOwnedPhysicalGpus,
    incomingPhysicalGpus,
    supportedPhysicalGpus: view.facilities.capacity.supportedOwnedGpuCount,
  });

  if (runEnded) {
    if (terminalIncidentResult !== undefined) {
      return (
        <OverlayHost
          view={view}
          runtime={runtime}
          deferredEventIds={deferredEvents}
          requestedEventId={requestedEventId}
          exclusiveSequenceActive={false}
          userOverlay={undefined}
          onAcknowledgePresentation={(key) => {
            runtime.acknowledgePresentation(key);
          }}
          onDeferEvent={() => undefined}
          onCloseRequestedEvent={() => undefined}
          onEventResolved={() => undefined}
          onResolveEndgameReturn={() => undefined}
          onInspectPresentation={() => undefined}
          onProductisePresentation={() => undefined}
        />
      );
    }
    return (
      <>
        <EndingScreen
          view={view}
          audit={runtime.getPostRunAudit()}
          onRestart={onRestart}
          onHighScores={onHighScores}
          highScoreBoards={highScoreBoards}
          highScoreBusy={highScoreBusy}
          highScoreError={highScoreError}
          onDeleteHighScore={onDeleteHighScore}
        />
        <AudioEventNotices
          notices={audioPresentation.notices}
          onDismiss={audioPresentation.dismissNotice}
          onDismissAll={audioPresentation.dismissAllNotices}
        />
        {userOverlay?.key.startsWith("rival-crisis-stage:") ? userOverlay.node : null}
      </>
    );
  }

  return (
    <main className="game-shell">
      <LabAmbientActivity view={view} paused={displayedClockPaused} />
      {containmentFailureActive ? (
        <ContainmentFailureExperience view={view} runtime={runtime} />
      ) : null}
      {finalDeploymentActive ? (
        <VictoryDeploymentExperience view={view} runtime={runtime} />
      ) : null}
      <header className="identity-header">
        <div className="identity-lockup">
          <PixelPortrait
            className="leader-header-portrait"
            subjectId={view.identity.leaderId}
            name={view.identity.leaderName}
          />
          <div className="identity-copy">
            <p className="eyebrow">
              {view.identity.labName.toUpperCase()} // {view.identity.aiName}
            </p>
            <h1>{view.identity.leaderName}</h1>
            <p>
              {view.identity.labName} · {view.identity.aiName} programme ·{" "}
              {campaignPhaseLabel}
            </p>
          </div>
        </div>
        <AmbientActivityWire view={view} suppressed={exclusiveEndgameSequenceActive} />
        <div className="date-block">
          <span>{view.meta.calendar.year}</span>
          <strong>WEEK {view.meta.calendar.week}</strong>
        </div>
        <div className="clock-controls" aria-label="Game and audio controls">
          <button
            className="toolbar-help-button"
            type="button"
            title="Open the 60-second how-to-play briefing"
            onClick={(event) => {
              // WebKit does not focus every pointer-clicked button. Make the opener
              // explicit so modal focus restoration is identical across browsers,
              // matching the exit button below.
              event.currentTarget.focus();
              openHowToPlay();
            }}
          >
            How to play
          </button>
          <a
            className="feedback-link"
            href={FEEDBACK_URL}
            target="_blank"
            rel="noreferrer"
            title="Report feedback or a bug"
          >
            Feedback ↗
          </a>
          <AudioControl />
          <ThemeControl placement="toolbar" />
          <button
            type="button"
            aria-label="Pause game"
            aria-keyshortcuts="Space"
            aria-pressed={displayedClockPaused}
            disabled={blockingEndgameClock}
            title={
              blockingEndgameClock
                ? "Time is stopped until the blocking decision is resolved"
                : "Space toggles pause / resume"
            }
            onClick={() => runtime.pause()}
          >
            <span className="pause-glyph" aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
          {(["1x", "2x", "4x"] as const).map((speed) => (
            <button
              key={speed}
              data-tutorial-target={speed === "2x" ? "clock-2x" : undefined}
              type="button"
              disabled={
                runEnded ||
                blockingCritical ||
                blockingResearchDirection ||
                blockingEndgameClock ||
                exclusiveEndgameSequenceActive
              }
              aria-pressed={!displayedClockPaused && clock.selectedSpeed === speed}
              onClick={() => play(speed)}
            >
              {speed}
            </button>
          ))}
          <button
            className="step-button"
            type="button"
            disabled={
              runEnded ||
              blockingCritical ||
              blockingResearchDirection ||
              blockingEndgameClock ||
              exclusiveEndgameSequenceActive
            }
            onClick={() => runtime.stepOneTick()}
          >
            Step one week
          </button>
          <button
            className="exit-run-button"
            type="button"
            onClick={(event) => {
              // WebKit does not focus every pointer-clicked button. Make the opener
              // explicit so modal focus restoration is identical across browsers.
              event.currentTarget.focus();
              requestExit();
            }}
          >
            Quit / new game
          </button>
        </div>
      </header>
      {howToPlayOpen ? <HowToPlayDialog onClose={closeHowToPlay} /> : null}
      {view.meta.guidedTutorial ? (
        <TutorialGuide
          view={view}
          onNavigate={(destination) => navigateSection(destination)}
          onExit={requestExit}
        />
      ) : null}

      {view.meta.guidedTutorial ? null : (
        <AudioEventNotices
          notices={audioPresentation.notices}
          onDismiss={audioPresentation.dismissNotice}
          onDismissAll={audioPresentation.dismissAllNotices}
          onInternalAction={(request) => {
            const action = request.notice.internalAction;
            if (action === undefined) return;
            audioPresentation.dismissNotice(request.occurrenceKey);
            revealAttentionPanel(
              action.destination,
              action.destination === "evaluations"
                ? "evaluation-workflow-title"
                : "game-workspace-top",
            );
          }}
        />
      )}
      <ActivityNoticeLane
        view={view}
        suppressed={sideNoticeSuppressed}
        onAcknowledgePresentation={acknowledgePresentation}
        onInspectRival={inspectRivalNotice}
        onInspectResearcher={inspectResearcherNotice}
      />

      {autoPause.length === 0 ? null : (
        <section
          className={`warning-banner${view.endgame.active ? " endgame-warning-banner" : ""}`}
          role="alert"
        >
          <div>
            <strong>AUTO-PAUSED</strong>
            <span>
              {orphanedTrainingPause
                ? "RIVAL TRAINING SIGNAL"
                : autoPause
                    .map((reason) =>
                      reason === "resignation-ultimatum"
                        ? researcherPauseHeadline
                        : reasonLabel(reason),
                    )
                    .join(" · ")}
            </span>
            {autoPause.some(
              (reason) => reason === "training-complete" || reason === "training-failed",
            ) ? (
              <small>
                {orphanedTrainingPause
                  ? "A rival finished training. Dismiss this legacy alert to resume."
                  : latestTrainingOutcome?.status === "failed"
                    ? `The previous ${latestTrainingOutcome.displayName.toLowerCase()} failed at a training checkpoint. No model was created; its GPUs were released. Any run now marked queued is a separate, newer attempt.`
                    : latestTrainingOutcome === undefined
                      ? "A training run ended. Open Models for the outcome report before resuming time."
                      : `${latestTrainingOutcome.training?.completedModelDisplayName ?? currentModel?.displayName ?? "The new model"} finished training and baseline evaluation; its GPUs were released. Open Models for the outcome report before resuming time.`}
              </small>
            ) : null}
            {researcherPauseActive ? (
              <small>
                {researcherNeedingAttention === undefined
                  ? `${departedResearcherName ?? "A researcher"} has already left the lab, so there is no ultimatum left to answer. The Lab feed records what happened.`
                  : researcherAttentionWarning === "Ultimatum pending"
                    ? researcherNeedingAttention.ultimatum?.reason === "compact-breach"
                      ? `${researcherNeedingAttention.displayName} issued an ultimatum after this promise was broken: ${researcherNeedingAttention.compact.requirement}`
                      : `${researcherNeedingAttention.displayName} has issued an ultimatum with ${String(researcherNeedingAttention.ultimatum?.expiresInWeeks ?? 4)} weeks remaining. Review their dossier before advancing time.`
                    : researcherAttentionWarning === "Rival contact reported"
                      ? researcherNeedingAttention.rivalApproach === undefined
                        ? `${researcherNeedingAttention.displayName} has been approached by a rival lab. Review their dossier and current status.`
                        : `${researcherNeedingAttention.rivalApproach.rivalLabName} is recruiting ${researcherNeedingAttention.displayName}. The approach resolves in ${String(researcherNeedingAttention.rivalApproach.resolvesInWeeks)} week${researcherNeedingAttention.rivalApproach.resolvesInWeeks === 1 ? "" : "s"}; open the dossier to make a retention offer or deliberately take the risk. If you continue, this remains in the Lab feed until it resolves.`
                      : `${researcherNeedingAttention.displayName}'s promise needs attention: ${researcherAttentionWarning?.toLowerCase() ?? "review required"}.`}
              </small>
            ) : null}
            {autoPause.includes("bankruptcy-warning") &&
            view.finance.insolvencyClock.active ? (
              <small>
                The lab has been below $0 for{" "}
                {String(view.finance.insolvencyClock.consecutiveWeeks)} consecutive weeks.
                Bankruptcy is automatic at week{" "}
                {String(view.finance.insolvencyClock.bankruptcyAtWeeks)}; a possible or
                active fundraiser does not stop the clock. Restore cash to $0 or above to
                reset it.
              </small>
            ) : null}
            {autoPause.includes("government-intervention") ? (
              <small>
                Government pressure triggered a formal response. Continue to receive the
                decision; it will remain in the Lab feed if deferred.
              </small>
            ) : null}
            {blockingResearchDirection ? (
              <small>
                {view.research.pendingGenericAdvances[0]?.programName ??
                  "A research programme"}{" "}
                reached a permanent branching point. Choose a direction in the decision
                window before time can advance.
              </small>
            ) : null}
          </div>
          {!runEnded && autoPauseAction !== undefined ? (
            <div className="warning-banner-actions">
              <button type="button" onClick={handleAutoPauseAction}>
                {autoPauseActionLabel}
              </button>
              {researcherPauseActive &&
              researcherNeedingAttention !== undefined &&
              autoPauseAction.reason !== "resignation-ultimatum" ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={handleResearcherPauseAction}
                >
                  Review {researcherNeedingAttention.displayName}
                </button>
              ) : null}
              {autoPauseAction.destination === "resume" ||
              autoPauseAction.reason === "critical-event" ||
              blockingResearchDirection ||
              blockingEndgameClock ? null : (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => runtime.resume()}
                >
                  Resume time
                </button>
              )}
            </div>
          ) : blockingCritical ? (
            <span>Resolve the critical decision to resume.</span>
          ) : null}
        </section>
      )}

      {view.meta.status === "active" &&
      shouldShowOperatingMilestone(
        operatingMilestone,
        dismissedOperatingMilestoneYear,
      ) ? (
        <p className="milestone-banner" data-testid="operating-milestone">
          <span>{operatingMilestone.label}</span>
          <button
            type="button"
            className="milestone-banner-dismiss"
            aria-label={`Dismiss ${String(operatingMilestone.completedYears)}-year operating milestone`}
            onClick={() =>
              setDismissedOperatingMilestoneYear(operatingMilestone.completedYears)
            }
          >
            ×
          </button>
        </p>
      ) : null}

      <section className="command-status-strip" aria-label="Current lab status">
        <article
          className={
            view.finance.insolvencyClock.active
              ? view.finance.insolvencyClock.band
              : view.finance.runway.band
          }
        >
          <span>Cash</span>
          <strong>{view.finance.balanceLabel}</strong>
          <small>
            {formatSignedCashflow(view.finance.incomeMillionsPerCycle)} in · −
            {formatValuation(view.finance.outgoingsMillionsPerCycle)} out ·{" "}
            {formatSignedCashflow(view.finance.netMillionsPerCycle)} net
          </small>
          <small>
            {view.finance.runway.isInfinite
              ? "Infinite runway"
              : `${view.finance.runway.weeks?.toFixed(1) ?? "0"} weeks runway`}
          </small>
          {view.finance.balanceMillions < 0 ? (
            <small className="negative-cash-clock">
              {view.finance.insolvencyClock.active
                ? "Insolvency clock"
                : "Opening credit"}
              : {view.finance.insolvencyClock.label}
            </small>
          ) : null}
          <div className="command-status-actions">
            {unlockedFeatures.has("fundraising") ? (
              <button
                type="button"
                data-tutorial-target="open-fundraising"
                disabled={runEnded}
                onClick={() => setFundraisingOpen(true)}
              >
                Fundraise
              </button>
            ) : null}
            {unlockedFeatures.has("finances") ? (
              <button
                type="button"
                aria-current={section === "finances" ? "page" : undefined}
                onClick={() => navigateSection("finances")}
              >
                Details
              </button>
            ) : null}
          </div>
        </article>
        <article>
          <span>Fleet compute</span>
          <strong>{formatTeraflops(view.compute.totalTeraflops)}</strong>
          <small>
            {view.compute.generationMix.length === 0
              ? "No GPUs online"
              : view.compute.generationMix
                  .map((generation) => generation.label)
                  .join(" · ")}
          </small>
          <small
            className={`fleet-capacity-line ${fleetCapacity.state}`}
            title="Owned and incoming GPUs / facility capacity"
          >
            {fleetCapacity.label}
          </small>
          <div className="command-status-actions">
            <button type="button" disabled={runEnded} onClick={() => setBuyingGpus(true)}>
              Buy
            </button>
            <button
              type="button"
              aria-current={section === "compute" ? "page" : undefined}
              onClick={() => navigateSection("compute")}
            >
              Allocate
            </button>
          </div>
        </article>
        {unlockedFeatures.has("fundraising") || unlockedFeatures.has("people") ? (
          <article>
            <span>Aura</span>
            <strong>{view.topBar.aura.spendable}</strong>
            <small className="command-status-aura-record">
              <span>
                Lifetime {view.topBar.aura.lifetime} · Public standing{" "}
                {Math.round(view.topBar.aura.signal)}/100
              </span>
              <MechanicHelp label="Public standing">
                Reputation earned through public results. It helps valuation, fundraising,
                legitimacy, and some endings. Scandals can reduce it.
              </MechanicHelp>
            </small>
            <small
              title={
                view.topBar.aura.incomeSources.length === 0
                  ? "Aura currently arrives only from one-off events: papers, launches, safety work."
                  : [
                      "Recurring Aura, paid every 4 weeks:",
                      ...view.topBar.aura.incomeSources.map(
                        (source) =>
                          `  ${source.label}: +${String(source.amountPerCycle)}`,
                      ),
                    ].join("\n")
              }
            >
              Recurring: {view.topBar.aura.incomeLabel}
            </small>
            <small>
              {view.topBar.aura.recentChanges[0] === undefined
                ? "No recent one-off Aura change"
                : `Latest one-off: ${view.topBar.aura.recentChanges[0].label} · week ${String(view.topBar.aura.recentChanges[0].tick)}`}
            </small>
            <div className="command-status-actions">
              {unlockedFeatures.has("people") ? (
                <button
                  type="button"
                  aria-current={section === "people" ? "page" : undefined}
                  onClick={() => navigateSection("people")}
                >
                  Recruit
                </button>
              ) : null}
            </div>
          </article>
        ) : null}
        {unlockedFeatures.has("models") ? (
          <article>
            <span>Current AI</span>
            <strong>{currentModel?.displayName ?? "No model"}</strong>
            <small>
              {currentModel === undefined
                ? "Training required"
                : `Tier ${String(currentModel.tier.level)} · ${currentModel.tier.name}`}
            </small>
            {currentModel === undefined ? null : (
              <small>
                Measured capability{" "}
                {formatCapabilityScore(currentModel.frontierCapabilityEstimate)}
                /100
              </small>
            )}
            <small>
              {currentModel === undefined
                ? `${view.identity.aiName} family · no trained generation`
                : `${currentModel.tier.progressLabel.replaceAll("-", " ")} · ${currentModel.capabilityConfidence} confidence`}
            </small>
            <div className="command-status-actions">
              <button
                type="button"
                aria-current={section === "models" ? "page" : undefined}
                onClick={() => navigateSection("models")}
              >
                Models
              </button>
            </div>
          </article>
        ) : null}
        {unlockedFeatures.has("models") ? (
          <article
            className={
              view.facilities.capacity.availableMajorProjectSlots === 0
                ? "warning"
                : undefined
            }
          >
            <span>Major projects</span>
            <strong>
              {view.facilities.capacity.occupiedMajorProjectSlots}/
              {view.facilities.capacity.majorProjectSlots}
            </strong>
            <small>
              {view.facilities.capacity.availableMajorProjectSlots} slot
              {view.facilities.capacity.availableMajorProjectSlots === 1 ? "" : "s"} free
            </small>
            <small>
              {
                view.facilities.projects.filter(
                  (project) =>
                    project.majorProjectSlotsReserved > 0 && project.status === "queued",
                ).length
              }{" "}
              waiting in queue
            </small>
            <div className="command-status-actions">
              <button
                type="button"
                onClick={() => revealAttentionPanel("overview", "major-projects-title")}
              >
                Inspect
              </button>
              {unlockedFeatures.has("facilities") ? (
                <button
                  type="button"
                  aria-current={section === "facilities" ? "page" : undefined}
                  onClick={() => navigateSection("facilities")}
                >
                  Expand
                </button>
              ) : null}
            </div>
          </article>
        ) : null}
        {unlockedFeatures.has("finances") ? (
          <article>
            <span>Valuation</span>
            <strong>{view.finance.valuation.markLabel}</strong>
            <small>
              {view.finance.valuation.weeklyChangePercent >= 0 ? "+" : "−"}
              {Math.abs(view.finance.valuation.weeklyChangePercent).toFixed(1)}% this week
              · {view.finance.valuation.mood}
            </small>
            <small>
              {view.finance.valuation.officialMarkLabel === undefined
                ? "What investors would pay today"
                : `Last priced round ${view.finance.valuation.officialMarkLabel}`}
            </small>
            <div className="command-status-actions">
              <button
                type="button"
                aria-current={section === "finances" ? "page" : undefined}
                onClick={() => navigateSection("finances")}
              >
                Breakdown
              </button>
            </div>
          </article>
        ) : null}
      </section>

      <div className="game-console-frame">
        <nav className="game-sidebar" aria-label="Lab sections">
          <div className="game-sidebar-heading">
            <span>NEOLAB OS</span>
            <strong>Command</strong>
          </div>
          {dashboardSections.map((item) => (
            <button
              className={item.id === "crisis" ? "crisis-navigation" : undefined}
              type="button"
              key={item.id}
              data-tutorial-target={`nav-${item.id}`}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => navigateSection(item.id)}
            >
              <span aria-hidden="true">{item.shortLabel}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>

        <div id="game-workspace-top" className="game-console-main">
          {section === "overview" ? (
            <div className="overview-workspace">
              <LabMaturityPanel view={view} />

              {unlockedFeatures.has("models") ? <MajorProjectsPanel view={view} /> : null}

              {unlockedFeatures.has("evaluations") ? (
                <div className="dashboard-priority-stack">
                  <div className="dashboard-command-desk">
                    {unlockedFeatures.has("research") ? (
                      <AdvisoryBoard
                        view={view}
                        paused={displayedClockPaused}
                        onNavigate={handleAdvisoryNavigation}
                      />
                    ) : null}

                    <section
                      className="console-panel feed-panel feed-panel-prominent"
                      aria-labelledby="feed-title"
                    >
                      <header className="panel-heading compact">
                        <div>
                          <p className="eyebrow">INTERNAL WIRE // WHAT JUST HAPPENED</p>
                          <h2 id="feed-title">Lab feed</h2>
                        </div>
                        <span className="wire-live">LIVE</span>
                      </header>
                      <EventFeed
                        view={view}
                        onReview={setRequestedEventId}
                        onOpenPaper={setSelectedFeedPaperId}
                        onInspectResearcher={inspectResearcherNotice}
                      />
                    </section>
                  </div>
                </div>
              ) : null}

              {unlockedFeatures.has("people") ? (
                <StarResearcherStrip
                  view={view}
                  onInspect={setSelectedResearcherId}
                  onOpenMarket={() => navigateSection("people")}
                />
              ) : null}

              {unlockedFeatures.has("models") ? (
                <CapabilityTrajectory view={view} />
              ) : null}
            </div>
          ) : (
            <div className="dashboard-workspace-layout">
              <div className="main-workspace">
                {section === "compute" ? (
                  <ComputeWorkspace
                    content={content}
                    view={view}
                    runtime={runtime}
                    onBuyGpus={() => setBuyingGpus(true)}
                    onOpenModels={() => navigateSection("models")}
                  />
                ) : null}
                {section === "crisis" && view.endgame.active ? (
                  <div className="crisis-workspace">
                    <section className="crisis-workspace-intro">
                      <p className="eyebrow">
                        ENDGAME COMMAND // THE NORMAL DASHBOARD STILL OPERATES
                      </p>
                      <h2>The Deployment Crisis has its own command room</h2>
                    </section>
                    <CrisisBoard
                      view={view}
                      runtime={runtime}
                      onRolloutDecisionRequested={() => {
                        const key = crisisDecisionKey(view);
                        if (key === undefined) return;
                        setDeferredCrisisDecisionKeys((current) => {
                          const next = new Set(current);
                          next.delete(key);
                          return next;
                        });
                      }}
                    />
                    <AiCharacterPanel view={view} runtime={runtime} />
                  </div>
                ) : null}
                {section === "facilities" ? (
                  <FacilitiesWorkspace
                    runtime={runtime}
                    view={view}
                    paused={displayedClockPaused}
                    onInspectResearcher={setSelectedResearcherId}
                  />
                ) : null}
                {section === "research" ? (
                  <ResearchWorkspace
                    runtime={runtime}
                    view={view}
                    onInspectResearcher={inspectPaperResearcher}
                    onInspectProgrammeLead={setSelectedResearcherId}
                    onOpenPeople={() => navigateSection("people")}
                    onOpenCompute={() => navigateSection("compute")}
                  />
                ) : null}
                {section === "models" ? (
                  <ModelsWorkspace
                    content={content}
                    onOpenAnomaly={setActiveAnomalyId}
                    onOpenEvaluations={(request) => {
                      if (request === undefined) {
                        navigateSection("evaluations");
                        return;
                      }
                      setEvaluationRequest(request);
                      revealAttentionPanel(
                        "evaluations",
                        request.anchor === "safety-case"
                          ? "model-safety-case"
                          : "evaluation-workflow-panel-overview",
                      );
                    }}
                    onWorkspaceChange={setModelWorkspaceTab}
                    {...(requestedModelId === undefined ? {} : { requestedModelId })}
                    requestedWorkspace={modelWorkspaceTab}
                    runtime={runtime}
                    view={view}
                  />
                ) : null}
                {section === "agi" ? (
                  <AgiWorkspace runtime={runtime} view={view} />
                ) : null}
                {section === "evaluations" ? (
                  <ModelsWorkspace
                    content={content}
                    onOpenAnomaly={setActiveAnomalyId}
                    onOpenModels={() => navigateSection("models")}
                    {...(evaluationRequest === undefined
                      ? {}
                      : {
                          requestedEvaluationWorkspace: evaluationRequest.workspace,
                          requestedModelId: evaluationRequest.modelId,
                        })}
                    runtime={runtime}
                    view={view}
                    workspaceMode="evaluations"
                  />
                ) : null}
                {section === "people" ? (
                  <PeopleWorkspace
                    runtime={runtime}
                    view={view}
                    notice={peopleNotice}
                    onInspect={setSelectedResearcherId}
                    onNavigate={(destination) =>
                      navigateSection(destination === "lab" ? "facilities" : destination)
                    }
                    onRecruit={setSelectedCandidateId}
                  />
                ) : null}
                {section === "world" ? (
                  <WorldWorkspace
                    {...(focusedRivalId === undefined ? {} : { focusedRivalId })}
                    onOpenDecision={openDecisionEvent}
                    runtime={runtime}
                    view={view}
                  />
                ) : null}
                {section === "finances" ? (
                  <>
                    <section
                      className="console-panel finance-breakdown"
                      aria-labelledby="finance-breakdown-title"
                    >
                      <header className="panel-heading">
                        <div>
                          <p className="eyebrow">FINANCE OFFICE // FOUR-WEEK FORECAST</p>
                          <h2 id="finance-breakdown-title">Income and costs</h2>
                        </div>
                        <div className="panel-heading-tools">
                          <span>
                            Projected closing balance{" "}
                            {view.finance.projectedClosingCashLabel}
                          </span>
                          <MechanicHelp label="Finance forecast">
                            Four-week cashflow at the current plan. Facility operations
                            are grouped; the total remains exact.
                          </MechanicHelp>
                        </div>
                      </header>
                      {view.finance.balanceMillions < 0 ? (
                        <aside
                          className={`finance-insolvency-clock ${view.finance.insolvencyClock.band}`}
                          role="status"
                          aria-label={
                            view.finance.insolvencyClock.active
                              ? "Insolvency clock"
                              : "Opening credit"
                          }
                        >
                          <div>
                            <span>
                              {view.finance.insolvencyClock.active
                                ? "52-WEEK INSOLVENCY CLOCK"
                                : "FAMILY & FRIENDS CREDIT LINE"}
                            </span>
                            <strong>{view.finance.insolvencyClock.label}</strong>
                          </div>
                          <p>{view.finance.insolvencyClock.explanation}</p>
                        </aside>
                      ) : null}
                      <div className="finance-summary-strip">
                        <article>
                          <span>Income</span>
                          <strong>
                            {formatSignedCashflow(view.finance.incomeMillionsPerCycle)}
                          </strong>
                        </article>
                        <article>
                          <span>Outgoings</span>
                          <strong>
                            −{formatValuation(view.finance.outgoingsMillionsPerCycle)}
                          </strong>
                        </article>
                        <article>
                          <span>Net</span>
                          <strong
                            className={
                              view.finance.netMillionsPerCycle < 0
                                ? "negative"
                                : "positive"
                            }
                          >
                            {formatSignedCashflow(view.finance.netMillionsPerCycle)}
                          </strong>
                        </article>
                      </div>
                      <div
                        className="finance-lines"
                        role="table"
                        aria-label="Forecast lines"
                      >
                        <div className="finance-line finance-line-heading" role="row">
                          <span role="columnheader">Source</span>
                          <span role="columnheader">Category</span>
                          <span role="columnheader">Four weeks</span>
                        </div>
                        {financeForecastLines.map((line, index) => (
                          <div
                            className="finance-line"
                            role="row"
                            key={`${line.category}:${line.sourceId}:${String(index)}`}
                          >
                            <span role="cell">{line.description}</span>
                            <span role="cell">{line.category.replaceAll("-", " ")}</span>
                            <strong
                              role="cell"
                              className={
                                line.amountMillions < 0 ? "negative" : "positive"
                              }
                            >
                              {line.amountMillions > 0 ? "+" : ""}
                              {line.amountLabel}
                            </strong>
                          </div>
                        ))}
                      </div>
                      <p className="panel-note">{view.finance.runway.explanation}</p>
                    </section>
                    <section className="console-panel valuation-panel">
                      <header className="panel-heading">
                        <div>
                          <p className="eyebrow">MARKET VALUATION</p>
                          <h2>{view.finance.valuation.markLabel}</h2>
                        </div>
                        <span>
                          {view.finance.valuation.weeklyChangePercent >= 0 ? "+" : "−"}
                          {Math.abs(view.finance.valuation.weeklyChangePercent).toFixed(
                            1,
                          )}
                          % this week · {view.finance.valuation.mood}
                        </span>
                      </header>
                      <div className="finance-lines" role="table" aria-label="Valuation">
                        <div className="finance-line finance-line-heading" role="row">
                          <span role="columnheader">Component</span>
                          <span role="columnheader">Contribution</span>
                        </div>
                        {/*
                          Every term, always. The asset half used to render only
                          when it was the binding floor, which hid cash, fleet
                          and buildings exactly when a player started caring
                          about them, and left a headline that did not follow
                          from its own breakdown.
                        */}
                        <div className="finance-line finance-line-subheading" role="row">
                          <span role="cell">What the lab owns</span>
                          <strong role="cell">
                            {view.finance.valuation.breakdown.assetValueLabel}
                          </strong>
                        </div>
                        <div className="finance-line" role="row">
                          <span role="cell">— Cash</span>
                          <strong role="cell">
                            {view.finance.valuation.breakdown.cashLabel}
                          </strong>
                        </div>
                        <div className="finance-line" role="row">
                          <span role="cell">— GPU fleet</span>
                          <strong role="cell">
                            {view.finance.valuation.breakdown.gpuFleetValueLabel}
                          </strong>
                        </div>
                        <div className="finance-line" role="row">
                          <span role="cell">— Facilities</span>
                          <strong role="cell">
                            {view.finance.valuation.breakdown.facilitiesValueLabel}
                          </strong>
                        </div>
                        <div className="finance-line finance-line-subheading" role="row">
                          <span role="cell">What the market expects</span>
                          <strong role="cell">
                            {view.finance.valuation.breakdown.goingConcernLabel}
                          </strong>
                        </div>
                        <div className="finance-line" role="row">
                          <span role="cell">— Revenue contribution</span>
                          <strong role="cell">
                            {view.finance.valuation.breakdown.revenueValueLabel}
                          </strong>
                        </div>
                        <div className="finance-line" role="row">
                          <span role="cell">— Capability contribution</span>
                          <strong role="cell">
                            {view.finance.valuation.breakdown.capabilityValueLabel}
                          </strong>
                        </div>
                        <div className="finance-line" role="row">
                          <span role="cell">— Research depth</span>
                          <strong role="cell">
                            ×
                            {view.finance.valuation.breakdown.researchDepthMultiplier.toFixed(
                              2,
                            )}
                          </strong>
                        </div>
                        <div className="finance-line" role="row">
                          <span role="cell">— Public standing</span>
                          <strong role="cell">
                            ×{view.finance.valuation.breakdown.hypeMultiplier.toFixed(2)}
                          </strong>
                        </div>
                        <div className="finance-line" role="row">
                          <span role="cell">— Incidents &amp; intervention</span>
                          <strong
                            role="cell"
                            className={
                              view.finance.valuation.breakdown.haircutMultiplier < 1
                                ? "negative"
                                : undefined
                            }
                          >
                            ×
                            {view.finance.valuation.breakdown.haircutMultiplier.toFixed(
                              2,
                            )}
                          </strong>
                        </div>
                        {view.finance.valuation.breakdown.repricingMultiplier > 1 ? (
                          <div className="finance-line" role="row">
                            <span role="cell">Frontier repricing</span>
                            <strong role="cell" className="positive">
                              ×
                              {view.finance.valuation.breakdown.repricingMultiplier.toFixed(
                                2,
                              )}
                            </strong>
                          </div>
                        ) : null}
                        {view.finance.valuation.breakdown.haircutMultiplier < 1 ? (
                          <div className="finance-line" role="row">
                            <span role="cell">Incident and oversight haircut</span>
                            <strong role="cell" className="negative">
                              ×
                              {view.finance.valuation.breakdown.haircutMultiplier.toFixed(
                                2,
                              )}
                            </strong>
                          </div>
                        ) : null}
                      </div>
                    </section>
                    <section className="console-panel score-breakdown">
                      <header className="panel-heading">
                        <div>
                          <p className="eyebrow">RUN LEDGER // SCORE BREAKDOWN</p>
                          <h2>{view.score.displayTotal} points earned</h2>
                        </div>
                        <span>Scoring rules {view.score.version}</span>
                      </header>
                      <div>
                        {Object.entries(view.score.categoryTotals).map(
                          ([category, total]) => (
                            <article key={category}>
                              <span>
                                {category
                                  .replace(/^score\./, "")
                                  .replaceAll(".", " ")
                                  .replaceAll("-", " ")}
                              </span>
                              <strong>{total}</strong>
                            </article>
                          ),
                        )}
                      </div>
                    </section>
                  </>
                ) : null}
                {section === "bonuses" ? (
                  <section
                    className="console-panel modifier-breakdown"
                    aria-labelledby="modifier-breakdown-title"
                  >
                    <header className="panel-heading">
                      <div>
                        <p className="eyebrow">EFFECT RESOLVER // CURRENT LAB</p>
                        <h2 id="modifier-breakdown-title">Bonuses and penalties</h2>
                      </div>
                      <div className="panel-heading-tools">
                        <span>
                          {view.activeModifiers.length} effects
                          {activeModifierGroups.length === view.activeModifiers.length
                            ? ""
                            : ` · ${String(activeModifierGroups.length)} groups`}
                        </span>
                        <MechanicHelp label="Bonuses and penalties">
                          Effects are grouped by source. Open a category for exact values,
                          expiry, and stacking details.
                        </MechanicHelp>
                      </div>
                    </header>
                    {view.activeModifiers.length === 0 ? (
                      <p>No active bonuses or penalties.</p>
                    ) : (
                      <div className="modifier-section-list">
                        {activeModifierSections.map(([sourceKind, groups]) => {
                          const effectCount = groups.reduce(
                            (total, group) => total + group.count,
                            0,
                          );
                          return (
                            <details className="modifier-section" key={sourceKind}>
                              <summary>
                                <strong>{sourceKind.replaceAll("-", " ")}</strong>
                                <span>
                                  {effectCount} effects · {groups.length} groups
                                </span>
                              </summary>
                              <ul className="modifier-list">
                                {groups.map(({ modifier, count }) => (
                                  <li key={modifier.modifierId}>
                                    <div className="modifier-source">
                                      <span>{modifier.sourceLabel}</span>
                                      <small>
                                        {count === 1
                                          ? modifier.sourceKind
                                          : `${modifier.sourceKind} · ${String(count)} identical`}
                                      </small>
                                    </div>
                                    <strong>{modifier.targetLabel}</strong>
                                    <span
                                      className={
                                        modifier.effectLabel.includes("−")
                                          ? "negative"
                                          : ""
                                      }
                                    >
                                      {modifier.effectLabel}
                                    </span>
                                    <details>
                                      <summary>How this applies</summary>
                                      <p>
                                        {modifier.explanation}
                                        {modifier.temporary
                                          ? ` Expires in ${String(modifier.remainingWeeks ?? 0)} weeks.`
                                          : modifier.sourceKind === "founding mandate"
                                            ? " This is part of your permanent founding mandate and cannot be changed during this run."
                                            : " This effect has no scheduled expiry."}
                                        {count === 1
                                          ? ""
                                          : ` ${String(count)} identical effects are grouped here.`}
                                      </p>
                                    </details>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <OverlayHost
        view={view}
        runtime={runtime}
        deferredEventIds={deferredEvents}
        requestedEventId={requestedEventId}
        exclusiveSequenceActive={exclusiveEndgameSequenceActive}
        userOverlay={userOverlay}
        onAcknowledgePresentation={(key) => {
          const presentation = view.presentationQueue.find((item) => item.key === key);
          if (presentation?.kind === "model-incident-result") {
            audioPresentation.dismissNotice(
              `incident:${presentation.modelId}:${String(presentation.createdAtTick)}`,
            );
          }
          const acknowledged = runtime.acknowledgePresentation(key);
          if (
            acknowledged &&
            (presentation?.kind === "researcher-poaching" ||
              presentation?.kind === "researcher-departure")
          ) {
            runtime.resume();
          }
        }}
        onDeferEvent={(instanceId) => {
          setDeferredEvents((current) => new Set([...current, instanceId]));
        }}
        onCloseRequestedEvent={() => setRequestedEventId(undefined)}
        onEventResolved={(instanceId) => {
          setRequestedEventId(undefined);
          setDeferredEvents((current) => {
            const next = new Set(current);
            next.delete(instanceId);
            return next;
          });
        }}
        onResolveEndgameReturn={(key, path) => {
          const command = chooseFalseDawnPathCommand(view, key, path);
          if (!runtime.validate(command).ok) return;
          const receipt = runtime.dispatch(command);
          if (receipt.fault !== undefined) return;
          if (path === "successor-programme") {
            setModelWorkspaceTab("train");
            navigateSection("models");
          } else {
            navigateSection("overview");
          }
        }}
        onProductisePresentation={(key) => {
          const presentation = view.presentationQueue.find((item) => item.key === key);
          if (
            presentation?.kind !== "capability-tier" ||
            !presentation.isPlayerModel ||
            !unlockedFeatures.has("productisation")
          ) {
            return;
          }
          runtime.acknowledgePresentation(key);
          setRequestedModelId(presentation.modelId);
          setModelWorkspaceTab("release");
          navigateSection("models");
        }}
        onInspectPresentation={(key) => {
          const presentation = view.presentationQueue.find((item) => item.key === key);
          if (presentation?.kind === "model-incident-result") {
            audioPresentation.dismissNotice(
              `incident:${presentation.modelId}:${String(presentation.createdAtTick)}`,
            );
          }
          runtime.acknowledgePresentation(key);
          if (presentation?.kind === "safety-practice-level") {
            setEvaluationRequest({
              modelId: presentation.modelId,
              workspace: "overview",
              anchor: "safety-case",
            });
            navigateSection("evaluations", { preserveEvaluationTarget: true });
          } else if (presentation?.kind === "model-incident-result") {
            setEvaluationRequest({
              modelId: presentation.modelId,
              workspace: "overview",
              anchor: "safety-case",
            });
            navigateSection("evaluations", { preserveEvaluationTarget: true });
          } else if (presentation?.kind === "candidate-containment-incident") {
            setRequestedModelId(presentation.modelId);
            setModelWorkspaceTab("train");
            navigateSection("models");
          } else if (presentation?.kind === "researcher-poaching") {
            setSelectedResearcherId(presentation.researcherId);
            navigateSection("people");
          } else if (presentation?.kind === "researcher-departure") {
            navigateSection("people");
          } else if (presentation?.kind === "autonomy-unlock") {
            if (view.endgame.active) {
              navigateSection("crisis");
            } else {
              revealAttentionPanel("agi", "autonomy-title");
            }
          } else if (
            presentation?.kind === "capability-tier" &&
            presentation.isPlayerModel === false
          ) {
            const owner = view.world.rivals.find(
              (rival) => rival.labId === presentation.ownerLabId,
            );
            setFocusedRivalId(owner?.labId);
            navigateSection("world");
          } else if (
            presentation?.kind === "capability-tier" &&
            presentation.isPlayerModel
          ) {
            setRequestedModelId(presentation.modelId);
            setModelWorkspaceTab("train");
            navigateSection("models");
          } else {
            navigateSection("models");
          }
        }}
      />
    </main>
  );
}
