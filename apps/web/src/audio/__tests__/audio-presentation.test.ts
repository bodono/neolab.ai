import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import {
  createNewGame,
  createProgressiveNewGame,
  seed128,
  type DomainEvent,
  type GameView,
  type NewGameConfig,
} from "@neolab/sim/public";
import { withBaselineModels } from "@neolab/testkit";

import {
  alarmCueForVisiblePresentation,
  cuesForDomainEvent,
  cuesForDomainEvents,
  endgameMusicChapterForVisibleState,
  resolveMusicState,
} from "../audio-presentation.ts";
import { BrowserGameRuntime } from "../../runtime/index.ts";

const content = loadCompiledContent();
const config = {
  seed: seed128("0123456789abcdef0123456789abcdef"),
  difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
  leaderId: "base:leader.sam-altmann" as NewGameConfig["leaderId"],
  mandateId: "base:mandate.build-the-science" as NewGameConfig["mandateId"],
};
const runtime = new BrowserGameRuntime(
  withBaselineModels(createNewGame(config, content), content),
  content,
  {
    scheduler: {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    },
  },
);
const view = runtime.getView();

describe("player-safe audio presentation", () => {
  it("routes the laboratory soundtrack to the active section focus", () => {
    expect(resolveMusicState(undefined, "lab")).toEqual({ kind: "title" });
    expect(resolveMusicState(view, "research")).toEqual({
      kind: "laboratory",
      focus: "research",
    });
    expect(resolveMusicState(view, "models")).toEqual({
      kind: "laboratory",
      focus: "commercial",
    });
    expect(resolveMusicState(view, "finances")).toEqual({
      kind: "laboratory",
      focus: "commercial",
    });
    expect(resolveMusicState(view, "evaluations")).toEqual({
      kind: "laboratory",
      focus: "safety",
    });
    expect(resolveMusicState(view, "lab")).toEqual({
      kind: "laboratory",
      focus: "general",
    });
    expect(JSON.stringify(resolveMusicState(view, "lab"))).not.toMatch(
      /hidden|alignment|deception|trueSafety/i,
    );
  });

  it("lets a visible incident alarm own its cue and temporary crisis music", () => {
    const model = view.models.cards[0]!;
    const alarm = {
      key: "model-incident-result:test-visible-alarm",
      kind: "model-incident-result",
      attention: "modal",
      modelId: model.modelId,
      modelDisplayName: model.displayName,
      createdAtTick: 439,
      category: "minor",
      severity: 24,
      contained: true,
      threatLabel: "DATA BREACH",
      headline: "The model repeated private customer data.",
      auraLoss: 1,
      fineMillions: 0,
      governmentTrustLost: 1,
      governmentAttentionAdded: 2,
      hardwareGpusDestroyed: 0,
      researchOutputReductionPercent: 0,
    } as const;
    const alarmView: GameView = { ...view, presentationQueue: [alarm] };

    expect(alarmCueForVisiblePresentation(alarm)).toEqual({
      cueId: "crisis-opened",
      occurrenceKey: `incident:${model.modelId}:439`,
    });
    expect(resolveMusicState(alarmView, "lab")).toEqual({
      kind: "crisis",
      crisisId: alarm.key,
      flavour: "machine",
    });
    expect(alarmCueForVisiblePresentation({ ...alarm, category: "critical" })).toEqual({
      cueId: "containment-warning",
      occurrenceKey: `incident:${model.modelId}:439`,
    });
  });

  it("maps visible endgame stages to presentation-only music chapters", () => {
    const cases = [
      ["candidate-activation", "candidacy"],
      ["confirmation", "capability-proof"],
      ["evidence-sprint", "dossier-review"],
      ["pressure-collision", "pressure"],
      ["rollout", "controlled-rollout"],
      ["final-review", "deployment-planning"],
      ["world-waiting", "deployment-held"],
      ["retirement-attempt", "retirement-held"],
      ["containment-failure", "containment-failure"],
      ["resolved", "local-recovery"],
    ] as const;
    for (const [stage, chapter] of cases) {
      expect(endgameMusicChapterForVisibleState({ stage })).toBe(chapter);
    }

    expect(
      endgameMusicChapterForVisibleState({
        stage: "retirement-attempt",
        stageActions: {
          kind: "retirement-attempt",
          contested: true,
        },
      }),
    ).toBe("observed-resistance");

    expect(
      endgameMusicChapterForVisibleState({
        stage: "evidence-sprint",
        stageActions: {
          kind: "evidence-sprint",
          activeResponseId: "deception-aware-containment",
        },
      }),
    ).toBe("safety-work");
  });

  it("returns retirement recovery to ordinary skippable laboratory music", () => {
    const recoveryView = {
      ...view,
      endgame: {
        active: true,
        stage: "recovery",
        stageActions: { kind: "recovery" },
      },
    } as unknown as GameView;

    expect(resolveMusicState(recoveryView, "lab")).toEqual({
      kind: "laboratory",
      focus: "general",
    });
  });

  it("does not let hidden candidate state change an observationally identical score", () => {
    const safeWorld = {
      stage: "world-waiting",
      stageActions: { kind: "world-waiting" },
      superintelligenceTruth: "not-genuine",
      hiddenSafety: { deception: 5 },
    };
    const dangerousWorld = {
      stage: "world-waiting",
      stageActions: { kind: "world-waiting" },
      superintelligenceTruth: "genuine",
      hiddenSafety: { deception: 95 },
    };
    expect(endgameMusicChapterForVisibleState(safeWorld)).toBe(
      endgameMusicChapterForVisibleState(dangerousWorld),
    );
    expect(endgameMusicChapterForVisibleState(dangerousWorld)).toBe("deployment-held");
  });

  it("does not retain a coalition-specific victory music state", () => {
    const endedView: GameView = {
      ...view,
      meta: {
        ...view.meta,
        status: "won",
        endingId: "base:ending.the-stewardship-compact",
      },
    };
    expect(resolveMusicState(endedView, "lab")).toEqual({
      kind: "victory",
      tier: "full",
    });
  });

  it("keeps The Long Pause on the authored moratorium score", () => {
    const endedView: GameView = {
      ...view,
      meta: {
        ...view.meta,
        status: "lost",
        endingId: "base:ending.the-long-pause",
      },
    };
    expect(resolveMusicState(endedView, "lab")).toEqual({
      kind: "endgame",
      chapter: "moratorium",
    });
    expect(
      cuesForDomainEvent({ kind: "run-ended", result: "lost" }, endedView, 31, 0),
    ).toEqual([
      {
        cueId: "race-lost",
        occurrenceKey: "ending:base:ending.the-long-pause",
        notice: {
          title: "The frontier race has paused",
          detail:
            "The verified moratorium has taken effect. The ending screen explains the survival outcome and the restraint that secured it.",
          tone: "information",
        },
      },
    ]);
  });

  it("maps visible player and rival events without reading hidden state", () => {
    const playerPaper: DomainEvent = {
      kind: "paper-discovered",
      paperId: "base:paper.test" as never,
      labId: view.identity.labId,
      worldFirst: true,
    };
    const rivalPaper: DomainEvent = {
      ...playerPaper,
      labId: "base:lab.rival",
    };
    const playerRediscovery: DomainEvent = {
      ...playerPaper,
      worldFirst: false,
    };
    expect(cuesForDomainEvent(playerPaper, view, 3, 0)).toEqual([
      {
        cueId: "paper-discovered",
        occurrenceKey: "paper:base:paper.test",
        notice: {
          title: "World-first paper discovered",
          detail:
            "Your lab has made a research discovery. The educational discovery dossier explains the result and its rewards.",
          tone: "positive",
        },
      },
    ]);
    expect(cuesForDomainEvent(playerRediscovery, view, 3, 0)).toEqual([
      {
        cueId: "paper-discovered",
        occurrenceKey: "paper-rediscovery:base:paper.test",
        notice: {
          title: "Paper independently rediscovered",
          detail:
            "A rival lab reached this result first. Your independent rediscovery and its research unlocks have been recorded.",
          tone: "positive",
        },
      },
    ]);
    // A raw rival discovery may be secret. Only the later public-signal event
    // is allowed to create a player-visible notice.
    expect(cuesForDomainEvent(rivalPaper, view, 3, 0)).toEqual([]);
  });

  it("does not sound safety success for failed or anomalous evaluations", () => {
    const modelId = view.models.cards[0]!.modelId as never;
    const failed: DomainEvent = {
      kind: "evaluation-completed",
      evaluationId: "evaluation-1" as never,
      modelId,
      definitionId: "base:evaluation.test" as never,
      automaticBaseline: false,
      anomalyCount: 2,
    };
    expect(cuesForDomainEvent(failed, view, 5, 0)).toEqual([]);
    expect(cuesForDomainEvent({ ...failed, anomalyCount: 0 }, view, 5, 0)).toEqual([
      {
        cueId: "safety-win",
        occurrenceKey: "evaluation:evaluation-1",
        notice: {
          title: "Evaluation completed without an anomaly",
          detail:
            "The latest model evaluation found no reportable anomaly. This is useful evidence, not proof that the model is safe.",
          tone: "positive",
        },
      },
    ]);
    expect(
      cuesForDomainEvent(
        {
          ...failed,
          definitionId: content.evaluations.baselineEvaluationId,
          automaticBaseline: true,
          anomalyCount: 0,
        },
        view,
        5,
        0,
      ),
    ).toEqual([]);
  });

  it("plays a one-shot success cue when the player's training run completes", () => {
    const model = view.models.cards[0]!;
    const completed: DomainEvent = {
      kind: "training-completed",
      labId: view.identity.labId as never,
      projectId: "run:project:training:complete" as never,
      modelId: model.modelId as never,
      regressions: [],
    };

    expect(cuesForDomainEvent(completed, view, 5, 0)).toEqual([
      {
        cueId: "capability-tier",
        occurrenceKey: "training:run:project:training:complete",
        notice: {
          title: `${model.displayName} finished training`,
          detail:
            "The run completed successfully. Open Models to review the new model and its automatic baseline evaluation.",
          tone: "positive",
          internalAction: {
            destination: "models",
            label: "Review model",
          },
        },
      },
    ]);
    expect(
      cuesForDomainEvent(
        { ...completed, labId: "run:lab:rival:test" as never },
        view,
        5,
        0,
      ),
    ).toEqual([]);
  });

  it("still celebrates a completed run that produced measured regressions", () => {
    const model = view.models.cards[0]!;
    const completed: DomainEvent = {
      kind: "training-completed",
      labId: view.identity.labId as never,
      projectId: "run:project:training:regressions" as never,
      modelId: model.modelId as never,
      regressions: ["reasoning"],
    };

    expect(cuesForDomainEvent(completed, view, 5, 0)[0]?.notice).toEqual({
      title: `${model.displayName} finished training`,
      detail:
        "The run completed successfully with 1 measured regression. Open Models to inspect the result.",
      tone: "positive",
      internalAction: {
        destination: "models",
        label: "Review model",
      },
    });
  });

  it("links a real paper when the player's lab discovers it", () => {
    const paper = view.research.techTree.papers.find(
      (candidate) => candidate.paperId === "base:paper.perceptron",
    );
    if (paper?.primarySourceUrl === undefined) {
      throw new Error("real paper source missing from view");
    }
    const event: DomainEvent = {
      kind: "paper-discovered",
      paperId: paper.paperId as never,
      labId: view.identity.labId,
      worldFirst: true,
    };

    expect(cuesForDomainEvent(event, view, 3, 0)).toEqual([
      {
        cueId: "paper-discovered",
        occurrenceKey: `paper:${paper.paperId}`,
        notice: {
          title: paper.title,
          detail:
            "Your lab has made a research discovery. The educational discovery dossier explains the result and its rewards.",
          tone: "positive",
          externalLink: {
            href: paper.primarySourceUrl,
            label: "Read the real paper ↗",
          },
        },
      },
    ]);
  });

  it("links a real paper from an independent-rediscovery side notice", () => {
    const paper = view.research.techTree.papers.find(
      (candidate) => candidate.paperId === "base:paper.perceptron",
    );
    if (paper?.primarySourceUrl === undefined) {
      throw new Error("real paper source missing from view");
    }
    const event: DomainEvent = {
      kind: "paper-discovered",
      paperId: paper.paperId as never,
      labId: view.identity.labId,
      worldFirst: false,
    };

    expect(cuesForDomainEvent(event, view, 3, 0)).toEqual([
      {
        cueId: "paper-discovered",
        occurrenceKey: `paper-rediscovery:${paper.paperId}`,
        notice: {
          title: paper.title,
          detail:
            "A rival lab reached this result first. Your independent rediscovery and its research unlocks have been recorded.",
          tone: "positive",
          externalLink: {
            href: paper.primarySourceUrl,
            label: "Read the real paper ↗",
          },
        },
      },
    ]);
  });

  it("rounds anomaly severity in player-facing notices", () => {
    const modelId = view.models.cards[0]!.modelId as never;
    const event: DomainEvent = {
      kind: "anomaly-detected",
      anomalyId: "run:anomaly:test" as never,
      modelId,
      observedSeverity: 23.975939295205855,
    };

    expect(cuesForDomainEvent(event, view, 5, 0)).toEqual([
      {
        cueId: "containment-warning",
        occurrenceKey: "anomaly:run:anomaly:test",
        notice: {
          title: "Serious evaluation anomaly detected",
          detail: `${view.models.cards[0]!.displayName} produced an anomaly with observed severity 24/100. Open Models to inspect the evidence.`,
          tone: "critical",
        },
      },
    ]);
  });

  it("links critical model incidents to the evaluation review surface", () => {
    const model = view.models.cards[0]!;
    const event: DomainEvent = {
      kind: "model-incident",
      modelId: model.modelId as never,
      severity: 78,
      category: "critical",
      contained: false,
    };

    expect(cuesForDomainEvent(event, view, 6, 0)).toEqual([
      {
        cueId: "containment-warning",
        occurrenceKey: `incident:${model.modelId}:6`,
        notice: {
          title: "Containment warning",
          detail: `${model.displayName} caused a critical incident. Open Safety & evaluations to inspect the model evidence and commission follow-up testing. The incident record remains in the Lab feed.`,
          tone: "critical",
          internalAction: {
            destination: "evaluations",
            label: "Review in Safety & evaluations",
          },
        },
      },
    ]);
  });

  it("plays a themed warning cue for minor model-incident alarms", () => {
    const model = view.models.cards[0]!;
    const event: DomainEvent = {
      kind: "model-incident",
      modelId: model.modelId as never,
      severity: 24,
      category: "minor",
      contained: true,
    };

    expect(cuesForDomainEvent(event, view, 431, 0)).toEqual([
      {
        cueId: "crisis-opened",
        occurrenceKey: `incident:${model.modelId}:431`,
        notice: {
          title: "Minor model incident",
          detail: `${model.displayName} caused an incident that was contained. Review the event before advancing time.`,
          tone: "warning",
        },
      },
    ]);
  });

  it("names the financing round when an offer closes", () => {
    const event: DomainEvent = {
      kind: "funding-offer-accepted",
      labId: view.identity.labId as never,
      offerId: "run:funding-offer:test" as never,
      cashMillions: 42,
      conditionCount: 1,
      roundOrdinal: 2,
      roundLabel: "Series A",
    };

    expect(cuesForDomainEvent(event, view, 7, 0)).toEqual([
      {
        cueId: "fundraising-complete",
        occurrenceKey: "funding:run:funding-offer:test",
        notice: {
          title: "Series A financing closed",
          detail:
            "The Series A offer has been accepted and the lab's cash position has changed. Open Finances for the updated runway.",
          tone: "positive",
        },
      },
    ]);
  });

  it("explains the family bridge conversion when the opening Seed closes", () => {
    const event: DomainEvent = {
      kind: "funding-offer-accepted",
      labId: view.identity.labId as never,
      offerId: "run:funding-offer:opening" as never,
      cashMillions: 30,
      conditionCount: 0,
      roundOrdinal: 1,
      roundLabel: "Seed",
      openingRecapitalisation: {
        bridgeConversionMillions: 75,
        operatingTopUpMillions: 0,
        postCloseCashMillions: 30,
      },
    };

    expect(cuesForDomainEvent(event, view, 7, 0)).toEqual([
      {
        cueId: "fundraising-complete",
        occurrenceKey: "funding:run:funding-offer:opening",
        notice: {
          title: "Seed financing closed",
          detail:
            "Your parents converted the opening bridge into their angel stake. The Seed closed with $30M cash.",
          tone: "positive",
        },
      },
    ]);
  });

  it("announces a player training delay once with the schedule consequences", () => {
    const event: DomainEvent = {
      kind: "training-failure-check",
      labId: view.identity.labId as never,
      projectId: "run:project:training:test" as never,
      checkpoint: 0.3,
      outcome: "delay-and-cost",
      delayWeeks: 2,
    };

    expect(cuesForDomainEvent(event, view, 7, 0)).toEqual([
      {
        cueId: "crisis-opened",
        occurrenceKey: "training-delay:run:project:training:test:0.3",
        notice: {
          title: "Model training is delayed",
          detail:
            "Model training slipped by 2 weeks at its 30% checkpoint. GPUs remain reserved, and the overrun adds no training compute. The setback is recorded in the Lab feed.",
          tone: "warning",
        },
      },
    ]);
    expect(
      cuesForDomainEvent({ ...event, outcome: "none", delayWeeks: 0 }, view, 7, 0),
    ).toEqual([]);
  });

  it("explains the exact benefit when a rival publishes a paper", () => {
    const rival = view.world.rivals[0];
    if (rival === undefined) throw new Error("rival view missing");
    const paper = view.research.techTree.papers.find(
      (candidate) => candidate.paperId === "base:paper.perceptron",
    );
    if (paper?.primarySourceUrl === undefined) throw new Error("paper view missing");
    const summary = `${paper.title} is now public. Your lab immediately received: Architecture research output +2%.`;
    const event: DomainEvent = {
      kind: "rival-public-signal",
      labId: rival.labId as never,
      signalId: "rival-signal:test",
      signalKind: "release",
      subjectId: paper.paperId,
      summary,
    };

    expect(cuesForDomainEvent(event, view, 6, 0)).toEqual([
      {
        cueId: "rival-breakthrough",
        occurrenceKey: `rival:${rival.labId}:rival-signal:test`,
        notice: {
          title: `${rival.labName} published ${paper.title}`,
          detail: summary,
          tone: "positive",
          externalLink: {
            href: paper.primarySourceUrl,
            label: "Read the real paper ↗",
          },
        },
      },
    ]);
  });

  it("keeps rival public signals quiet until rival intelligence is unlocked", () => {
    const openingRuntime = new BrowserGameRuntime(
      withBaselineModels(createProgressiveNewGame(config, content), content),
      content,
      {
        scheduler: {
          now: () => 0,
          requestFrame: () => 1,
          cancelFrame: () => undefined,
        },
      },
    );
    const openingView = openingRuntime.getView();
    expect(openingView.meta.labMaturity?.features).not.toContain("world");
    const rival = openingView.world.rivals[0];
    if (rival === undefined) throw new Error("rival view missing");
    const event: DomainEvent = {
      kind: "rival-public-signal",
      labId: rival.labId as never,
      signalId: "rival-signal:opening-breakthrough",
      signalKind: "benchmark",
      subjectId: "run:model:rival:opening",
      summary: `${rival.labName} reported a new benchmark result.`,
    };

    expect(cuesForDomainEvent(event, openingView, 1, 0)).toEqual([]);
  });

  it("never exposes internal rival lab ids in benchmark notices", () => {
    const rival = view.world.rivals[0];
    if (rival === undefined) throw new Error("rival view missing");
    const event: DomainEvent = {
      kind: "rival-public-signal",
      labId: rival.labId as never,
      signalId: "rival-signal:benchmark",
      signalKind: "benchmark",
      subjectId: "run:model:rival:test",
      summary: `${rival.labId} reported a new benchmark result for ${rival.aiName}-2.`,
    };

    expect(cuesForDomainEvent(event, view, 6, 0)).toEqual([
      {
        cueId: "rival-breakthrough",
        occurrenceKey: `rival:${rival.labId}:rival-signal:benchmark`,
        notice: {
          title: `${rival.labName} reported a capability advance`,
          detail: `${rival.labName} reported a new benchmark result for ${rival.aiName}-2.`,
          tone: "warning",
        },
      },
    ]);
  });

  it("presents a rival containment incident as an incident, not a breakthrough", () => {
    const rival = view.world.rivals[0];
    if (rival === undefined) throw new Error("rival view missing");
    const event: DomainEvent = {
      kind: "rival-public-signal",
      labId: rival.labId as never,
      signalId: "rival-signal:incident",
      signalKind: "incident",
      subjectId: "rival-incident:test",
      summary: "A rival lab reported a contained serious laboratory incident.",
    };

    expect(cuesForDomainEvent(event, view, 6, 0)).toEqual([
      {
        cueId: "rival-breakthrough",
        occurrenceKey: `rival:${rival.labId}:rival-signal:incident`,
        notice: {
          title: `AI incident reported at ${rival.labName}`,
          detail: `${rival.labName} reported a contained serious laboratory incident.`,
          tone: "warning",
        },
      },
    ]);
  });

  it("presents direct autonomy catastrophe endings as terminal events", () => {
    const endedView: GameView = {
      ...view,
      meta: {
        ...view.meta,
        status: "lost",
        endingId: "base:ending.a-war-measured-in-milliseconds",
      },
    };
    const runEnded: DomainEvent = { kind: "run-ended", result: "lost" };

    expect(resolveMusicState(endedView, "lab")).toEqual({
      kind: "ending-catastrophe",
    });
    expect(cuesForDomainEvent(runEnded, endedView, 31, 0)).toEqual([
      {
        cueId: "containment-failure",
        occurrenceKey: "ending:base:ending.a-war-measured-in-milliseconds",
        notice: {
          title: "Containment has failed",
          detail: "The ending screen reveals the terminal outcome and the hidden audit.",
          tone: "critical",
        },
      },
    ]);
  });

  it("uses the run result for an unknown legacy ending id", () => {
    const endedView: GameView = {
      ...view,
      meta: {
        ...view.meta,
        status: "won",
        endingId: "legacy:ending.retired-victory",
      },
    };
    const runEnded: DomainEvent = { kind: "run-ended", result: "won" };

    expect(cuesForDomainEvent(runEnded, endedView, 31, 0)).toEqual([
      {
        cueId: "race-won",
        occurrenceKey: "ending:legacy:ending.retired-victory",
        notice: {
          title: "The run has been won",
          detail:
            "The ending screen explains the outcome and the decisions that produced it.",
          tone: "positive",
        },
      },
    ]);
  });

  it("suppresses a happy same-tick cue when the run ends", () => {
    const endedView: GameView = {
      ...view,
      meta: {
        ...view.meta,
        status: "lost",
        endingId: "base:ending.a-war-measured-in-milliseconds",
      },
    };
    const events: readonly DomainEvent[] = [
      {
        kind: "paper-discovered",
        paperId: "base:paper.test" as never,
        labId: view.identity.labId,
        worldFirst: true,
      },
      { kind: "run-ended", result: "lost" },
    ];

    expect(cuesForDomainEvents(events, endedView, 31)).toEqual([
      {
        cueId: "containment-failure",
        occurrenceKey: "ending:base:ending.a-war-measured-in-milliseconds",
        notice: {
          title: "Containment has failed",
          detail: "The ending screen reveals the terminal outcome and the hidden audit.",
          tone: "critical",
        },
      },
    ]);
  });

  it("clearly announces a successful researcher retention resolution", () => {
    const researcher = view.people.market.candidates[0];
    if (researcher === undefined) throw new Error("researcher view missing");
    const stayed: DomainEvent = {
      kind: "researcher-poaching-resolved",
      researcherId: researcher.researcherId as never,
      rivalLabId: "lab:rival-1",
      departed: false,
      probability: 0.05,
      draw: 0.53,
    };

    expect(cuesForDomainEvent(stayed, view, 12, 0)).toEqual([
      {
        cueId: "researcher-joins",
        occurrenceKey: `retained:${researcher.researcherId}:12`,
        notice: {
          title: `${researcher.displayName} is staying`,
          detail:
            "The rival recruitment attempt ended without a departure. Their roster bonuses remain active, any current assignment is unchanged, and the outcome is recorded in the Lab feed.",
          tone: "positive",
        },
      },
    ]);
    expect(cuesForDomainEvent({ ...stayed, departed: true }, view, 12, 0)).toEqual([]);
  });

  it("leaves a player departure to its durable modal instead of a top notice", () => {
    const departed: DomainEvent = {
      kind: "researcher-departed",
      researcherId: "base:researcher.departed" as never,
      researcherName: "Geoffrey Kingma",
      formerLabId: view.identity.labId as never,
      reason: "voluntary",
      rivalLabId: "",
    };

    expect(cuesForDomainEvent(departed, view, 12, 0)).toEqual([]);
  });

  it("suppresses a legacy departure event whose former employer is unknown", () => {
    const legacyDeparture = {
      kind: "researcher-departed",
      researcherId: "base:researcher.departed",
      reason: "voluntary",
      rivalLabId: "",
    } as unknown as DomainEvent;

    expect(cuesForDomainEvent(legacyDeparture, view, 12, 0)).toEqual([]);
  });

  it("does not announce a rival lab's researcher departure as the player's loss", () => {
    const rivalDeparture: DomainEvent = {
      kind: "researcher-departed",
      researcherId: "base:researcher.rival" as never,
      researcherName: "Rival Researcher",
      formerLabId: "lab:rival-1" as never,
      reason: "voluntary",
      rivalLabId: "lab:rival-2",
    };

    expect(cuesForDomainEvent(rivalDeparture, view, 12, 0)).toEqual([]);
  });

  it("names a completed facility and explains its primary permanent rewards", () => {
    const facility = view.facilities.catalogue.find(
      (candidate) => candidate.definitionId === "base:facility.headquarters-1",
    );
    if (facility === undefined) throw new Error("headquarters facility view missing");
    const completed: DomainEvent = {
      kind: "facility-completed",
      labId: view.identity.labId as never,
      projectId: "project:headquarters-test" as never,
      definitionId: facility.definitionId as never,
    };

    expect(cuesForDomainEvent(completed, view, 12, 0)).toEqual([
      {
        cueId: "score-milestone",
        occurrenceKey: "facility:base:facility.headquarters-1",
        notice: {
          title: "Headquarters I is operational",
          detail:
            "Adds 1 major-project slot while operational. Open Facilities to review every permanent effect.",
          tone: "positive",
        },
      },
    ]);
  });

  it("never creates an event sound without visible explanatory copy", () => {
    const events: readonly DomainEvent[] = [
      {
        kind: "researcher-departed",
        researcherId: "base:researcher.test" as never,
        researcherName: "Test Researcher",
        formerLabId: view.identity.labId as never,
        reason: "voluntary",
        rivalLabId: "",
      },
      {
        kind: "government-intervention-triggered",
        labId: view.identity.labId as never,
        interventionId: "intervention-1",
        interventionKind: "licensing-action",
        trigger: "quarterly-pressure",
        pressure: 63,
      },
    ];

    const requests = events.flatMap((event, index) =>
      cuesForDomainEvent(event, view, 9, index),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.notice).toEqual({
      title: "Government decision incoming",
      detail:
        "Licensing action was triggered at 63 intervention pressure. The formal decision will arrive when the next simulation week advances.",
      tone: "warning",
    });
    for (const request of requests) {
      expect(request.notice.title.trim()).not.toBe("");
      expect(request.notice.detail.trim()).not.toBe("");
    }
  });

  it("lets the researcher departure modal own the departure sound", () => {
    const departure = {
      key: "researcher-departure:researcher:test:12",
      kind: "researcher-departure",
      attention: "modal",
      researcherId: "researcher:test",
      researcherDisplayName: "Test Researcher",
      reason: "voluntary",
      createdAtTick: 12,
    } as const;

    expect(alarmCueForVisiblePresentation(departure)).toEqual({
      cueId: "researcher-departs",
      occurrenceKey: "depart:researcher:test:12",
    });
  });
});
