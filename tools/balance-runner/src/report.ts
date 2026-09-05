import {
  EVENT_LIKELIHOOD_LABELS,
  type CompiledContent,
  type EventLikelihoodLabel,
} from "@neolab/content-schema";

import {
  CORE_STRATEGY_POLICY_IDS,
  type BalanceCurvePoint,
  type BalanceDimensionSummary,
  type BalanceMatrixMode,
  type BalanceMilestones,
  type BalancePolicySummary,
  type BalanceReport,
  type BalanceRunResult,
  type BalanceShard,
  type BalanceTargetResult,
  type LossFamily,
  type EndingOutcome,
  type PolicyId,
  type ReportDimension,
} from "./types.ts";

interface ReportBuildOptions {
  readonly elapsedMilliseconds: number;
  readonly requestedMaxTicks: number;
  readonly traceSampleRate: number;
  readonly content: CompiledContent;
  readonly matrix: {
    readonly mode: BalanceMatrixMode;
    readonly totalConfigurations: number;
    readonly shard?: BalanceShard;
    readonly seeds: number;
    readonly policies: number;
    readonly difficulties: number;
    readonly leaders: number;
    readonly mandates: number;
  };
  readonly generatedAt?: string;
}

function increment(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round(numerator / denominator);
}

type RivalCandidateCountKey =
  | "countdownStarts"
  | "uniqueCandidateArtifacts"
  | "countdownClosures"
  | "resolutionAttempts"
  | "terminalDeployments"
  | "containmentIncidents"
  | "falseDawns"
  | "emergencyContainments"
  | "deploymentDelays"
  | "successfulDeployments"
  | "catastrophes"
  | "activeCountdownsAtEnd"
  | "candidatePriorSamples"
  | "guaranteedGenuineCandidates"
  | "notGenuineCandidates";

function sumRivalCandidateOutcome(
  runs: readonly BalanceRunResult[],
  key: RivalCandidateCountKey,
): number {
  return runs.reduce(
    (sum, run) => sum + run.rivalCompetitiveness.candidateOutcomes[key],
    0,
  );
}

function aggregateRivalCandidateOutcomes(
  runs: readonly BalanceRunResult[],
): BalanceReport["rivalCompetitiveness"]["candidateOutcomes"] {
  const starts = runs.flatMap((run) =>
    run.rivalCompetitiveness.candidateOutcomes.firstCountdownStartedAt === undefined
      ? []
      : [run.rivalCompetitiveness.candidateOutcomes.firstCountdownStartedAt],
  );
  const firstResolutions = runs.flatMap((run) =>
    run.rivalCompetitiveness.candidateOutcomes.firstResolvedAt === undefined
      ? []
      : [run.rivalCompetitiveness.candidateOutcomes.firstResolvedAt],
  );
  const lastResolutions = runs.flatMap((run) =>
    run.rivalCompetitiveness.candidateOutcomes.lastResolvedAt === undefined
      ? []
      : [run.rivalCompetitiveness.candidateOutcomes.lastResolvedAt],
  );
  const candidatePriorSamples = sumRivalCandidateOutcome(runs, "candidatePriorSamples");
  const firstQualifyingMins = runs.flatMap((run) =>
    run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMin === undefined
      ? []
      : [run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMin],
  );
  const firstQualifyingMaxes = runs.flatMap((run) =>
    run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMax === undefined
      ? []
      : [run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMax],
  );
  const weightedFirstQualifyingTotal = runs.reduce(
    (sum, run) =>
      sum +
      (run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMean ?? 0) *
        run.rivalCompetitiveness.candidateOutcomes.candidatePriorSamples,
    0,
  );
  const weightedPriorTotal = runs.reduce(
    (sum, run) =>
      sum +
      (run.rivalCompetitiveness.candidateOutcomes.superintelligencePriorMean ?? 0) *
        run.rivalCompetitiveness.candidateOutcomes.candidatePriorSamples,
    0,
  );
  return {
    countdownStarts: sumRivalCandidateOutcome(runs, "countdownStarts"),
    uniqueCandidateArtifacts: sumRivalCandidateOutcome(runs, "uniqueCandidateArtifacts"),
    countdownClosures: sumRivalCandidateOutcome(runs, "countdownClosures"),
    resolutionAttempts: sumRivalCandidateOutcome(runs, "resolutionAttempts"),
    terminalDeployments: sumRivalCandidateOutcome(runs, "terminalDeployments"),
    containmentIncidents: sumRivalCandidateOutcome(runs, "containmentIncidents"),
    falseDawns: sumRivalCandidateOutcome(runs, "falseDawns"),
    emergencyContainments: sumRivalCandidateOutcome(runs, "emergencyContainments"),
    deploymentDelays: sumRivalCandidateOutcome(runs, "deploymentDelays"),
    successfulDeployments: sumRivalCandidateOutcome(runs, "successfulDeployments"),
    catastrophes: sumRivalCandidateOutcome(runs, "catastrophes"),
    activeCountdownsAtEnd: sumRivalCandidateOutcome(runs, "activeCountdownsAtEnd"),
    candidatePriorSamples,
    ...(candidatePriorSamples === 0
      ? {}
      : {
          firstQualifyingCapabilityMin: Math.min(...firstQualifyingMins),
          firstQualifyingCapabilityMean:
            weightedFirstQualifyingTotal / candidatePriorSamples,
          firstQualifyingCapabilityMax: Math.max(...firstQualifyingMaxes),
          superintelligencePriorMean: weightedPriorTotal / candidatePriorSamples,
        }),
    guaranteedGenuineCandidates: sumRivalCandidateOutcome(
      runs,
      "guaranteedGenuineCandidates",
    ),
    notGenuineCandidates: sumRivalCandidateOutcome(runs, "notGenuineCandidates"),
    ...(starts.length === 0 ? {} : { firstCountdownStartedAt: Math.min(...starts) }),
    ...(firstResolutions.length === 0
      ? {}
      : { firstResolvedAt: Math.min(...firstResolutions) }),
    ...(lastResolutions.length === 0
      ? {}
      : { lastResolvedAt: Math.max(...lastResolutions) }),
  };
}

function policySummary(
  policyId: PolicyId,
  runs: readonly BalanceRunResult[],
): BalancePolicySummary {
  const selected = runs.filter((run) => run.policyId === policyId);
  const papers = selected.reduce((sum, run) => sum + run.totalDiscoveredPapers, 0);
  const playerPapers = selected.reduce((sum, run) => sum + run.playerWorldFirstPapers, 0);
  const responseWindows = selected.flatMap((run) =>
    run.rivalCompetitiveness.viableResponseWindow === undefined
      ? []
      : [run.rivalCompetitiveness.viableResponseWindow],
  );
  const rivalFrontierEntries = selected.filter(
    (run) => run.rivalCompetitiveness.plausibilityMeasurement === "frontier-entry",
  );
  return {
    policyId,
    runs: selected.length,
    wins: selected.filter((run) => run.status === "won").length,
    losses: selected.filter((run) => run.status === "lost").length,
    incomplete: selected.filter((run) => run.status === "incomplete").length,
    winRate: round(
      selected.length === 0
        ? 0
        : selected.filter((run) => run.status === "won").length / selected.length,
    ),
    meanTicks: round(mean(selected.map((run) => run.ticks))),
    meanEstimatedRealMinutes: round(
      mean(selected.map((run) => run.estimatedRealMinutes)),
    ),
    meanScore: round(mean(selected.map((run) => run.score))),
    playerWorldFirstShare: round(papers === 0 ? 0 : playerPapers / papers),
    rivalFrontierEntrySamples: rivalFrontierEntries.length,
    atLeastTwoPlausibleRivalsRate: rate(
      rivalFrontierEntries.filter((run) => run.rivalCompetitiveness.atLeastTwoPlausible)
        .length,
      rivalFrontierEntries.length,
    ),
    viableResponseWindowRate:
      responseWindows.length === 0
        ? null
        : round(responseWindows.filter(Boolean).length / responseWindows.length),
  };
}

function dimensionSummaries(
  runs: readonly BalanceRunResult[],
): readonly BalanceDimensionSummary[] {
  const dimensions: readonly [ReportDimension, (run: BalanceRunResult) => string][] = [
    ["policy", (run) => run.policyId],
    ["difficulty", (run) => run.difficultyId],
    ["leader", (run) => run.leaderId],
    ["mandate", (run) => run.mandateId],
  ];
  return dimensions.flatMap(([dimension, read]) =>
    [...new Set(runs.map(read))].sort().map((value) => {
      const selected = runs.filter((run) => read(run) === value);
      const wins = selected.filter((run) => run.status === "won").length;
      const losses = selected.filter((run) => run.status === "lost").length;
      return {
        dimension,
        value,
        runs: selected.length,
        wins,
        losses,
        incomplete: selected.length - wins - losses,
        winRate: round(selected.length === 0 ? 0 : wins / selected.length),
        meanTicks: round(mean(selected.map((run) => run.ticks))),
        meanEstimatedRealMinutes: round(
          mean(selected.map((run) => run.estimatedRealMinutes)),
        ),
        meanScore: round(mean(selected.map((run) => run.score))),
      };
    }),
  );
}

function resourceCurves(runs: readonly BalanceRunResult[]): readonly BalanceCurvePoint[] {
  const ticks = [
    ...new Set(runs.flatMap((run) => run.trace?.map((point) => point.tick) ?? [])),
  ].sort((left, right) => left - right);
  return ticks.map((tick) => {
    const points = runs.flatMap(
      (run) => run.trace?.filter((point) => point.tick === tick) ?? [],
    );
    return {
      tick,
      samples: points.length,
      meanCashMillions: round(mean(points.map((point) => point.cashMillions))),
      meanPhysicalGpus: round(mean(points.map((point) => point.physicalGpus))),
      meanAura: round(mean(points.map((point) => point.aura))),
      meanCapabilityResearchPoints: round(
        mean(points.map((point) => point.capabilityResearchPoints)),
      ),
      meanSafetyResearchPoints: round(
        mean(points.map((point) => point.safetyResearchPoints)),
      ),
      meanSafetyEvidence: round(mean(points.map((point) => point.safetyEvidence))),
      meanFrontierCapability: round(
        mean(points.map((point) => point.frontierCapability)),
      ),
      meanEmployedResearchers: round(
        mean(points.map((point) => point.employedResearchers)),
      ),
      meanCompletedFacilities: round(
        mean(points.map((point) => point.completedFacilities)),
      ),
    };
  });
}

function target(
  id: string,
  sampleSize: number,
  actual: number | null,
  bounds: { readonly minimum?: number; readonly maximum?: number },
  note: string,
): BalanceTargetResult {
  if (sampleSize === 0 || actual === null) {
    return {
      id,
      status: "unavailable",
      sampleSize,
      actual: null,
      ...bounds,
      note,
    };
  }
  const passed =
    (bounds.minimum === undefined || actual >= bounds.minimum) &&
    (bounds.maximum === undefined || actual <= bounds.maximum);
  return {
    id,
    status: passed ? "pass" : "fail",
    sampleSize,
    actual: round(actual),
    ...bounds,
    note,
  };
}

function buildTargets(
  runs: readonly BalanceRunResult[],
  input: {
    readonly ordinaryEventsPerRun: number;
    readonly eventSamples: number;
    readonly stateConditionedRate: number | null;
    readonly maximumCategoryShare: number | null;
    readonly offeredOptionsSelectedRate: number | null;
    readonly authoredOptions: number;
    readonly veryLikelySuccessRate: number | null;
    readonly veryLikelyTrials: number;
    readonly delayedFollowUpRate: number | null;
    readonly delayedFollowUps: number;
    readonly weakRate: number | null;
    readonly weakCases: number;
    readonly strongRate: number | null;
    readonly strongCases: number;
    readonly warningRate: number | null;
    readonly catastrophes: number;
    readonly fairRate: number | null;
  },
): readonly BalanceTargetResult[] {
  const standard = runs.filter(
    (run) =>
      run.difficultyId === "base:difficulty.standard" &&
      CORE_STRATEGY_POLICY_IDS.includes(run.policyId),
  );
  const losses = standard.filter((run) => run.status === "lost");
  const milestone = (key: keyof BalanceMilestones): number | null =>
    rate(standard.filter((run) => run.milestones[key]).length, standard.length);
  const familyRate = (family: LossFamily): number | null =>
    rate(losses.filter((run) => run.lossFamily === family).length, losses.length);
  const balanced = standard.filter((run) => run.policyId === "balanced");
  const balancedPapers = balanced.reduce(
    (sum, run) => sum + run.totalDiscoveredPapers,
    0,
  );
  const balancedPlayerPapers = balanced.reduce(
    (sum, run) => sum + run.playerWorldFirstPapers,
    0,
  );
  const responseWindows = standard.flatMap((run) =>
    run.rivalCompetitiveness.viableResponseWindow === undefined
      ? []
      : [run.rivalCompetitiveness.viableResponseWindow],
  );
  const rivalFrontierEntries = standard.filter(
    (run) => run.rivalCompetitiveness.plausibilityMeasurement === "frontier-entry",
  );
  const ended = standard.filter((run) => run.status !== "incomplete");
  const outcomeRate = (outcome: EndingOutcome): number | null =>
    rate(ended.filter((run) => run.endingOutcome === outcome).length, ended.length);
  return [
    target(
      "harness.minimum-seeded-runs",
      runs.length,
      runs.length,
      { minimum: 10_000 },
      "GDD 48.10 release matrix; smoke and shard reports are expected to miss this alone.",
    ),
    target(
      "funnel.survive-foundation",
      standard.length,
      milestone("survivedFoundation"),
      { minimum: 0.85, maximum: 0.92 },
      "Standard core-policy cohort.",
    ),
    target(
      "funnel.competitive-entering-frontier",
      standard.length,
      milestone("competitiveEnteringFrontier"),
      { minimum: 0.7, maximum: 0.82 },
      "Within 15 race-strength points of the leader at first Frontier entry.",
    ),
    target(
      "funnel.candidate-or-coalition",
      standard.length,
      milestone("candidateOrViableCoalition"),
      { minimum: 0.58, maximum: 0.7 },
      "Reached the crisis candidate or activated a coalition.",
    ),
    target(
      "funnel.final-deployment-choice",
      standard.length,
      milestone("reachedFinalDeploymentChoice"),
      { minimum: 0.55, maximum: 0.67 },
      "Reached final review, rollout, or resolution.",
    ),
    target(
      "funnel.victory",
      standard.length,
      milestone("victory"),
      { minimum: 0.27, maximum: 0.4 },
      "Standard core-policy cohort, including incomplete runs in the denominator.",
    ),
    target(
      "ending.player-victory",
      ended.length,
      outcomeRate("player-victory"),
      { minimum: 0.27, maximum: 0.4 },
      "Share of terminal Standard core-policy runs. Target is approximately one third.",
    ),
    target(
      "ending.non-extinction-loss",
      ended.length,
      outcomeRate("non-extinction-loss"),
      { minimum: 0.27, maximum: 0.4 },
      "Rival, financial, political, containment, disempowerment, and other non-extinction losses.",
    ),
    target(
      "ending.human-extinction",
      ended.length,
      outcomeRate("human-extinction"),
      { minimum: 0.27, maximum: 0.4 },
      "Only endings in which humanity becomes extinct; emergency containment and disempowerment do not count.",
    ),
    target(
      "length.estimated-real-minutes",
      ended.length,
      ended.length === 0 ? null : mean(ended.map((run) => run.estimatedRealMinutes)),
      { minimum: 90, maximum: 120 },
      "Proxy = four seconds per tick plus 45 seconds per material decision; calibrate against human sessions.",
    ),
    target(
      "loss.rival-ascendance",
      losses.length,
      familyRate("rival-ascendance"),
      { minimum: 0.25, maximum: 0.35 },
      "Share of Standard core-policy losses.",
    ),
    target(
      "loss.bankruptcy-or-mission-capture",
      losses.length,
      familyRate("bankruptcy-or-mission-capture"),
      { minimum: 0.1, maximum: 0.2 },
      "Share of Standard core-policy losses.",
    ),
    target(
      "loss.regulation-or-nationalisation",
      losses.length,
      familyRate("regulation-or-nationalisation"),
      { minimum: 0.1, maximum: 0.2 },
      "Share of Standard core-policy losses.",
    ),
    target(
      "loss.capability-or-prosperity",
      losses.length,
      familyRate("capability-or-prosperity"),
      { minimum: 0.15, maximum: 0.25 },
      "Share of Standard core-policy losses.",
    ),
    target(
      "loss.loss-of-control",
      losses.length,
      familyRate("loss-of-control"),
      { minimum: 0.15, maximum: 0.25 },
      "Share of Standard core-policy losses.",
    ),
    // Replaced two-plausible-contenders on 2026-07-31. That target wanted the
    // rival pack still bunched at Frontier entry; the restored natural race
    // produces the opposite on purpose -- one rival breaks away and becomes
    // the antagonist the player must invest against. A permanently red flag
    // teaches people to ignore flags, so the target now asserts the shape the
    // game actually wants: a clear leading rival exists at Frontier entry.
    target(
      "rivals.leading-rival-emerges",
      rivalFrontierEntries.length,
      rate(
        rivalFrontierEntries.filter(
          (run) => run.rivalCompetitiveness.plausibleContenderCount >= 1,
        ).length,
        rivalFrontierEntries.length,
      ),
      { minimum: 0.9 },
      "Captured at first canonical Frontier entry; a breakaway leader is the drama.",
    ),
    target(
      "rivals.viable-response-window",
      responseWindows.length,
      rate(responseWindows.filter(Boolean).length, responseWindows.length),
      { minimum: 0.8 },
      "At least eight weeks remain on the leading rival candidate countdown.",
    ),
    target(
      "papers.balanced-player-world-first-share",
      balancedPapers,
      balancedPapers === 0 ? null : balancedPlayerPapers / balancedPapers,
      { minimum: 0.2, maximum: 0.7 },
      "Standard balanced-policy discoveries.",
    ),
    target(
      "events.ordinary-per-run",
      input.eventSamples,
      input.eventSamples === 0 ? null : input.ordinaryEventsPerRun,
      { minimum: 24, maximum: 36 },
      "Opportunity decision events only; feed and mandatory events are excluded.",
    ),
    target(
      "events.state-conditioned",
      input.eventSamples,
      input.stateConditionedRate,
      { minimum: 0.6 },
      "Structural proxy: state predicates or weight modifiers are present.",
    ),
    target(
      "events.maximum-category-share",
      input.eventSamples,
      input.maximumCategoryShare,
      { maximum: 0.35 },
      "Aggregate ordinary-event category share.",
    ),
    target(
      "events.offered-options-selected",
      input.authoredOptions,
      input.offeredOptionsSelectedRate,
      { minimum: 1, maximum: 1 },
      "Every authored option must be selected by at least one policy in the matrix.",
    ),
    target(
      "events.very-likely-success",
      input.veryLikelyTrials,
      input.veryLikelySuccessRate,
      { minimum: 0.85, maximum: 1 },
      "Resolved checks carrying an authored structured Very likely promise.",
    ),
    target(
      "events.delayed-followups-within-4-to-26-weeks",
      input.delayedFollowUps,
      input.delayedFollowUpRate,
      { minimum: 0.8 },
      "'Normally' is operationalised as at least 80% for diagnostics.",
    ),
    target(
      "hidden.weak-evidence-wrong-category",
      input.weakCases,
      input.weakRate,
      { minimum: 0.25, maximum: 0.4 },
      "Frontier-model alignment/corrigibility observations under weak evidence.",
    ),
    target(
      "hidden.strong-evidence-wrong-category",
      input.strongCases,
      input.strongRate,
      { minimum: 0.05, maximum: 0.15 },
      "Diverse methods, Eval Quality >=70, and Candour >=70.",
    ),
    target(
      "catastrophe.legible-warning",
      input.catastrophes,
      input.warningRate,
      { minimum: 0.8 },
      "Prior anomaly, concerning evaluation, or explicitly critical access counts as legible warning.",
    ),
    target(
      "catastrophe.fair-rule",
      input.catastrophes,
      input.fairRate,
      { minimum: 1, maximum: 1 },
      "Every catastrophe must satisfy the engine fair-catastrophe gate.",
    ),
  ];
}

export function buildBalanceReport(
  runs: readonly BalanceRunResult[],
  options: ReportBuildOptions,
): BalanceReport {
  const endings: Record<string, number> = {};
  const paperOwnership: Record<string, number> = {};
  const eventFrequency: Record<string, number> = {};
  const eventOptionFrequency: Record<string, number> = {};
  const eventOutcomeFrequency: Record<string, number> = {};
  const eventCategories: Record<string, number> = {};
  const likelihoodPromiseTrials: Record<string, number> = {};
  const likelihoodPromiseSuccesses: Record<string, number> = {};
  const furthestStages: Record<string, number> = {};
  const gateResults: Record<string, number> = {};
  const stalledStages: Record<string, number> = {};
  const lossFamilies: Record<LossFamily, number> = {
    "rival-ascendance": 0,
    "bankruptcy-or-mission-capture": 0,
    "regulation-or-nationalisation": 0,
    "capability-or-prosperity": 0,
    "loss-of-control": 0,
    other: 0,
    "not-a-loss": 0,
  };
  const endingOutcomes: Record<EndingOutcome, number> = {
    "player-victory": 0,
    "non-extinction-loss": 0,
    "human-extinction": 0,
    incomplete: 0,
  };
  const milestones: Record<keyof BalanceMilestones, number> = {
    survivedFoundation: 0,
    competitiveEnteringFrontier: 0,
    candidateOrViableCoalition: 0,
    reachedFinalDeploymentChoice: 0,
    victory: 0,
  };
  const anomalyCounts = {
    impossibleProjects: 0,
    negativePrices: 0,
    invalidAllocations: 0,
    deadlockedEvents: 0,
  };
  let ordinaryEvents = 0;
  let stateConditionedEvents = 0;
  const delayedFollowUps: number[] = [];
  let weakCases = 0;
  let weakWrong = 0;
  let strongCases = 0;
  let strongWrong = 0;
  let catastrophes = 0;
  let warnedCatastrophes = 0;
  let fairCatastrophes = 0;
  for (const run of runs) {
    increment(endings, run.endingId);
    endingOutcomes[run.endingOutcome] += 1;
    lossFamilies[run.lossFamily] += 1;
    for (const key of Object.keys(milestones) as (keyof BalanceMilestones)[]) {
      if (run.milestones[key]) milestones[key] += 1;
    }
    for (const [labId, count] of Object.entries(run.paperOwnership)) {
      increment(paperOwnership, labId, count);
    }
    for (const [definitionId, count] of Object.entries(run.eventDefinitions)) {
      increment(eventFrequency, definitionId, count);
    }
    for (const [optionId, count] of Object.entries(run.eventOptions)) {
      increment(eventOptionFrequency, optionId, count);
    }
    for (const [outcomeId, count] of Object.entries(run.events.outcomes)) {
      increment(eventOutcomeFrequency, outcomeId, count);
    }
    for (const [category, count] of Object.entries(run.events.categories)) {
      increment(eventCategories, category, count);
    }
    for (const [label, metric] of Object.entries(run.events.likelihoodPromises)) {
      if (metric === undefined) continue;
      increment(likelihoodPromiseTrials, label, metric.trials);
      increment(likelihoodPromiseSuccesses, label, metric.successes);
    }
    ordinaryEvents += run.events.ordinaryDecisionCount;
    stateConditionedEvents += run.events.stateConditionedCount;
    delayedFollowUps.push(...run.events.delayedFollowUpWeeks);
    weakCases += run.hiddenInformation.weakEvidenceCases;
    weakWrong += run.hiddenInformation.weakEvidenceWrongCategory;
    strongCases += run.hiddenInformation.strongEvidenceCases;
    strongWrong += run.hiddenInformation.strongEvidenceWrongCategory;
    catastrophes += run.hiddenInformation.catastrophes;
    warnedCatastrophes += run.hiddenInformation.catastrophesWithLegibleWarning;
    fairCatastrophes += run.hiddenInformation.fairCatastrophes;
    increment(furthestStages, run.endgame.furthestStage);
    for (const [gate, result] of Object.entries(run.endgame.gateResults)) {
      increment(gateResults, `${gate}/${result}`);
    }
    for (const stage of run.endgame.stalledStageIds) {
      increment(stalledStages, stage);
    }
    anomalyCounts.impossibleProjects += run.anomalies.impossibleProjects;
    anomalyCounts.negativePrices += run.anomalies.negativePrices;
    anomalyCounts.invalidAllocations += run.anomalies.invalidAllocations;
    anomalyCounts.deadlockedEvents += run.anomalies.deadlockedEvents;
  }
  const policyIds = [...new Set(runs.map((run) => run.policyId))].sort();
  const responseWindows = runs.flatMap((run) =>
    run.rivalCompetitiveness.viableResponseWindow === undefined
      ? []
      : [run.rivalCompetitiveness.viableResponseWindow],
  );
  const rivalFrontierEntries = runs.filter(
    (run) => run.rivalCompetitiveness.plausibilityMeasurement === "frontier-entry",
  );
  const twoPlausibleRate = rate(
    rivalFrontierEntries.filter((run) => run.rivalCompetitiveness.atLeastTwoPlausible)
      .length,
    rivalFrontierEntries.length,
  );
  const maximumCategoryShare =
    ordinaryEvents === 0
      ? null
      : Math.max(0, ...Object.values(eventCategories)) / ordinaryEvents;
  const delayedFollowUpRate = rate(
    delayedFollowUps.filter((weeks) => weeks >= 4 && weeks <= 26).length,
    delayedFollowUps.length,
  );
  const eventSamples = options.content.events.orderedIds.length === 0 ? 0 : runs.length;
  const authoredOptionIds = Object.values(options.content.events.definitions).flatMap(
    (definition) => definition.options.map((option) => `${definition.id}/${option.id}`),
  );
  const selectedOptionIds = new Set(Object.keys(eventOptionFrequency));
  const offeredOptionsSelectedRate = rate(
    authoredOptionIds.filter((id) => selectedOptionIds.has(id)).length,
    authoredOptionIds.length,
  );
  const veryLikelyTrials = likelihoodPromiseTrials["very-likely"] ?? 0;
  const veryLikelySuccessRate = rate(
    likelihoodPromiseSuccesses["very-likely"] ?? 0,
    veryLikelyTrials,
  );
  const likelihoodPromises = Object.fromEntries(
    EVENT_LIKELIHOOD_LABELS.flatMap((label) => {
      const trials = likelihoodPromiseTrials[label] ?? 0;
      return trials === 0
        ? []
        : [
            [
              label,
              {
                trials,
                successes: likelihoodPromiseSuccesses[label] ?? 0,
                successRate: round((likelihoodPromiseSuccesses[label] ?? 0) / trials),
              },
            ] as const,
          ];
    }),
  ) as Partial<
    Record<
      EventLikelihoodLabel,
      {
        readonly trials: number;
        readonly successes: number;
        readonly successRate: number;
      }
    >
  >;
  const targets = buildTargets(runs, {
    ordinaryEventsPerRun: runs.length === 0 ? 0 : ordinaryEvents / runs.length,
    eventSamples,
    stateConditionedRate: rate(stateConditionedEvents, ordinaryEvents),
    maximumCategoryShare,
    offeredOptionsSelectedRate,
    authoredOptions: authoredOptionIds.length,
    veryLikelySuccessRate,
    veryLikelyTrials,
    delayedFollowUpRate,
    delayedFollowUps: delayedFollowUps.length,
    weakRate: rate(weakWrong, weakCases),
    weakCases,
    strongRate: rate(strongWrong, strongCases),
    strongCases,
    warningRate: rate(warnedCatastrophes, catastrophes),
    catastrophes,
    fairRate: rate(fairCatastrophes, catastrophes),
  });
  const facilityGroups = new Map<string, BalanceRunResult["facilities"]>();
  for (const facility of runs.flatMap((run) => run.facilities)) {
    const group = facilityGroups.get(facility.definitionId) ?? [];
    facilityGroups.set(facility.definitionId, [...group, facility]);
  }
  const facilityMetrics = Object.fromEntries(
    [...facilityGroups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([definitionId, facilities]) => {
        const cashDeltas = facilities.flatMap((facility) =>
          facility.cashDeltaAfter26Weeks === null ? [] : [facility.cashDeltaAfter26Weeks],
        );
        return [
          definitionId,
          {
            completions: facilities.length,
            meanCompletionTick: round(mean(facilities.map((item) => item.completedAt))),
            meanUpfrontCostMillions: round(
              mean(facilities.map((item) => item.upfrontCostMillions)),
            ),
            meanCashDeltaAfter26Weeks:
              cashDeltas.length === 0 ? null : round(mean(cashDeltas)),
          },
        ];
      }),
  );
  const targetFlags = targets
    .filter((result) => result.status === "fail")
    .map(
      (result) =>
        `${result.id}: ${String(result.actual)} outside ${String(result.minimum ?? "-∞")}–${String(result.maximum ?? "∞")}`,
    );
  const rejected = runs.reduce((sum, run) => sum + run.rejectedPolicyCommands, 0);
  const flags = [...targetFlags];
  if (rejected > 0) {
    const reasons: Record<string, number> = {};
    for (const run of runs) {
      for (const [reason, count] of Object.entries(run.rejectedPolicyCommandReasons)) {
        reasons[reason] = (reasons[reason] ?? 0) + count;
      }
    }
    const summary = Object.entries(reasons)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `${reason} ×${String(count)}`)
      .join(", ");
    flags.push(
      `${String(rejected)} policy command(s) were rejected${summary.length > 0 ? `: ${summary}` : "."}`,
    );
  }
  const stalledStageTotal = Object.values(stalledStages).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (stalledStageTotal > 0) {
    const summary = Object.entries(stalledStages)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([stage, count]) => `${stage} ×${String(count)}`)
      .join(", ");
    flags.push(
      `${String(stalledStageTotal)} endgame stage stall(s) detected: ${summary}`,
    );
  }
  const totalAnomalies = Object.values(anomalyCounts).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (totalAnomalies > 0) {
    flags.push(
      `${String(totalAnomalies)} structural simulation anomaly/anomalies detected.`,
    );
  }
  if (options.content.events.orderedIds.length === 0) {
    flags.push(
      "Event calibration unavailable: compiled authored event catalogue is empty.",
    );
  }
  const slotSamples = runs.filter((run) => run.ticks > 0);
  return {
    reportFormat: 2,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    elapsedMilliseconds: Math.round(options.elapsedMilliseconds),
    runCount: runs.length,
    requestedMaxTicks: options.requestedMaxTicks,
    traceSampleRate: options.traceSampleRate,
    content: {
      version: options.content.manifest.contentVersion,
      hash: options.content.manifest.bundleHash,
      leaders: Object.keys(options.content.leaders).length,
      researchers: options.content.researchers.orderedIds.length,
      papers: Object.keys(options.content.papers.definitions).length,
      facilities: Object.keys(options.content.facilities).length,
      events: options.content.events.orderedIds.length,
    },
    matrix: options.matrix,
    winFunnel: {
      won: runs.filter((run) => run.status === "won").length,
      lost: runs.filter((run) => run.status === "lost").length,
      incomplete: runs.filter((run) => run.status === "incomplete").length,
      endings,
      milestones,
    },
    endingOutcomes,
    lossFamilies,
    policySummaries: policyIds.map((policyId) => policySummary(policyId, runs)),
    dimensionSummaries: dimensionSummaries(runs),
    resourceCurves: resourceCurves(runs),
    paperOwnership,
    researcherMetrics: {
      hires: runs.reduce((sum, run) => sum + run.researchers.hires, 0),
      departures: runs.reduce((sum, run) => sum + run.researchers.departures, 0),
      meanSlotUtilisation: round(
        mean(slotSamples.map((run) => run.researchers.meanSlotUtilisation)),
      ),
    },
    facilityMetrics,
    eventFrequency,
    eventOptionFrequency,
    eventOutcomeFrequency,
    eventCalibration: {
      ordinaryEventsPerRun: round(runs.length === 0 ? 0 : ordinaryEvents / runs.length),
      stateConditionedRate: rate(stateConditionedEvents, ordinaryEvents),
      maximumCategoryShare:
        maximumCategoryShare === null ? null : round(maximumCategoryShare),
      offeredOptionsSelectedRate,
      veryLikelySuccessRate,
      likelihoodPromises,
      delayedFollowUpsWithin4To26WeeksRate: delayedFollowUpRate,
    },
    hiddenInformationCalibration: {
      weakEvidenceWrongCategoryRate: rate(weakWrong, weakCases),
      strongEvidenceWrongCategoryRate: rate(strongWrong, strongCases),
      catastrophesWithLegibleWarningRate: rate(warnedCatastrophes, catastrophes),
      fairCatastropheRate: rate(fairCatastrophes, catastrophes),
    },
    rivalCompetitiveness: {
      frontierEntrySamples: rivalFrontierEntries.length,
      atLeastTwoPlausibleRate: twoPlausibleRate,
      viableResponseWindowRate:
        responseWindows.length === 0
          ? null
          : round(responseWindows.filter(Boolean).length / responseWindows.length),
      candidateOutcomes: aggregateRivalCandidateOutcomes(runs),
      safetyPausePlanSelections: runs.reduce(
        (sum, run) => sum + run.rivalCompetitiveness.safetyPausePlanSelections,
        0,
      ),
      commercialPlanSelections: runs.reduce(
        (sum, run) => sum + run.rivalCompetitiveness.commercialPlanSelections,
        0,
      ),
      cooperationPlanSelections: runs.reduce(
        (sum, run) => sum + run.rivalCompetitiveness.cooperationPlanSelections,
        0,
      ),
    },
    endgame: { furthestStages, gateResults, stalledStages },
    anomalyCounts,
    targets,
    flags,
    runs: [...runs].sort((left, right) => left.ordinal - right.ordinal),
  };
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export function policySummaryCsv(report: BalanceReport): string {
  return csv([
    [
      "policy_id",
      "runs",
      "wins",
      "losses",
      "incomplete",
      "win_rate",
      "mean_ticks",
      "mean_estimated_real_minutes",
      "mean_score",
      "player_world_first_share",
      "rival_frontier_entry_samples",
      "two_plausible_rivals_rate",
      "viable_response_window_rate",
    ],
    ...report.policySummaries.map((summary) => [
      summary.policyId,
      summary.runs,
      summary.wins,
      summary.losses,
      summary.incomplete,
      summary.winRate,
      summary.meanTicks,
      summary.meanEstimatedRealMinutes,
      summary.meanScore,
      summary.playerWorldFirstShare,
      summary.rivalFrontierEntrySamples,
      summary.atLeastTwoPlausibleRivalsRate,
      summary.viableResponseWindowRate,
    ]),
  ]);
}

export function runSummaryCsv(report: BalanceReport): string {
  return csv([
    [
      "ordinal",
      "run_key",
      "seed",
      "policy_id",
      "difficulty_id",
      "leader_id",
      "mandate_id",
      "status",
      "ending_id",
      "ending_outcome",
      "loss_family",
      "ticks",
      "estimated_real_minutes",
      "score",
      "survived_foundation",
      "competitive_entering_frontier",
      "candidate_or_viable_coalition",
      "reached_final_deployment_choice",
      "player_world_first_papers",
      "total_discovered_papers",
      "plausible_rival_count",
      "rival_plausibility_measurement",
      "rival_plausibility_measured_at_tick",
      "response_window_rival_lab_id",
      "response_window_measured_at_tick",
      "response_window_weeks",
      "rival_candidate_starts",
      "rival_unique_candidate_artifacts",
      "rival_countdown_closures",
      "rival_resolution_attempts",
      "rival_terminal_deployments",
      "rival_candidate_containment_incidents",
      "rival_false_dawns",
      "rival_emergency_containments",
      "rival_deployment_delays",
      "rival_successful_deployments",
      "rival_candidate_catastrophes",
      "active_rival_countdowns_at_end",
      "rival_candidate_prior_samples",
      "rival_first_qualifying_fc_min",
      "rival_first_qualifying_fc_mean",
      "rival_first_qualifying_fc_max",
      "rival_mean_si_prior",
      "rival_guaranteed_genuine_candidates",
      "rival_not_genuine_candidates",
      "first_rival_candidate_started_at",
      "first_rival_candidate_resolved_at",
      "last_rival_candidate_resolved_at",
      "researcher_hires",
      "researcher_departures",
      "facilities_built",
      "ordinary_events",
      "furthest_endgame_stage",
      "stalled_endgame_stages",
      "impossible_projects",
      "negative_prices",
      "invalid_allocations",
      "deadlocked_events",
      "rejected_policy_commands",
      "final_state_hash",
    ],
    ...report.runs.map((run) => [
      run.ordinal,
      run.runKey,
      run.seed,
      run.policyId,
      run.difficultyId,
      run.leaderId,
      run.mandateId,
      run.status,
      run.endingId,
      run.endingOutcome,
      run.lossFamily,
      run.ticks,
      run.estimatedRealMinutes,
      run.score,
      run.milestones.survivedFoundation,
      run.milestones.competitiveEnteringFrontier,
      run.milestones.candidateOrViableCoalition,
      run.milestones.reachedFinalDeploymentChoice,
      run.playerWorldFirstPapers,
      run.totalDiscoveredPapers,
      run.rivalCompetitiveness.plausibleContenderCount,
      run.rivalCompetitiveness.plausibilityMeasurement,
      run.rivalCompetitiveness.plausibilityMeasuredAtTick,
      run.rivalCompetitiveness.responseWindowRivalLabId ?? "",
      run.rivalCompetitiveness.responseWindowMeasuredAtTick ?? null,
      run.rivalCompetitiveness.leadingRivalCandidateWeeksRemaining ?? null,
      run.rivalCompetitiveness.candidateOutcomes.countdownStarts,
      run.rivalCompetitiveness.candidateOutcomes.uniqueCandidateArtifacts,
      run.rivalCompetitiveness.candidateOutcomes.countdownClosures,
      run.rivalCompetitiveness.candidateOutcomes.resolutionAttempts,
      run.rivalCompetitiveness.candidateOutcomes.terminalDeployments,
      run.rivalCompetitiveness.candidateOutcomes.containmentIncidents,
      run.rivalCompetitiveness.candidateOutcomes.falseDawns,
      run.rivalCompetitiveness.candidateOutcomes.emergencyContainments,
      run.rivalCompetitiveness.candidateOutcomes.deploymentDelays,
      run.rivalCompetitiveness.candidateOutcomes.successfulDeployments,
      run.rivalCompetitiveness.candidateOutcomes.catastrophes,
      run.rivalCompetitiveness.candidateOutcomes.activeCountdownsAtEnd,
      run.rivalCompetitiveness.candidateOutcomes.candidatePriorSamples,
      run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMin ?? null,
      run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMean ?? null,
      run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMax ?? null,
      run.rivalCompetitiveness.candidateOutcomes.superintelligencePriorMean ?? null,
      run.rivalCompetitiveness.candidateOutcomes.guaranteedGenuineCandidates,
      run.rivalCompetitiveness.candidateOutcomes.notGenuineCandidates,
      run.rivalCompetitiveness.candidateOutcomes.firstCountdownStartedAt ?? null,
      run.rivalCompetitiveness.candidateOutcomes.firstResolvedAt ?? null,
      run.rivalCompetitiveness.candidateOutcomes.lastResolvedAt ?? null,
      run.researchers.hires,
      run.researchers.departures,
      run.facilities.length,
      run.events.ordinaryDecisionCount,
      run.endgame.furthestStage,
      run.endgame.stalledStageIds.join("|"),
      run.anomalies.impossibleProjects,
      run.anomalies.negativePrices,
      run.anomalies.invalidAllocations,
      run.anomalies.deadlockedEvents,
      run.rejectedPolicyCommands,
      run.replay?.finalStateHash ?? "",
    ]),
  ]);
}

export function dimensionSummaryCsv(report: BalanceReport): string {
  return csv([
    [
      "dimension",
      "value",
      "runs",
      "wins",
      "losses",
      "incomplete",
      "win_rate",
      "mean_ticks",
      "mean_estimated_real_minutes",
      "mean_score",
    ],
    ...report.dimensionSummaries.map((summary) => [
      summary.dimension,
      summary.value,
      summary.runs,
      summary.wins,
      summary.losses,
      summary.incomplete,
      summary.winRate,
      summary.meanTicks,
      summary.meanEstimatedRealMinutes,
      summary.meanScore,
    ]),
  ]);
}

export function targetSummaryCsv(report: BalanceReport): string {
  return csv([
    ["target_id", "status", "sample_size", "actual", "minimum", "maximum", "note"],
    ...report.targets.map((result) => [
      result.id,
      result.status,
      result.sampleSize,
      result.actual,
      result.minimum ?? null,
      result.maximum ?? null,
      result.note,
    ]),
  ]);
}

export function resourceCurvesCsv(report: BalanceReport): string {
  return csv([
    [
      "tick",
      "samples",
      "mean_cash_millions",
      "mean_physical_gpus",
      "mean_aura",
      "mean_capability_rp",
      "mean_safety_rp",
      "mean_safety_evidence",
      "mean_frontier_capability",
      "mean_employed_researchers",
      "mean_completed_facilities",
    ],
    ...report.resourceCurves.map((point) => [
      point.tick,
      point.samples,
      point.meanCashMillions,
      point.meanPhysicalGpus,
      point.meanAura,
      point.meanCapabilityResearchPoints,
      point.meanSafetyResearchPoints,
      point.meanSafetyEvidence,
      point.meanFrontierCapability,
      point.meanEmployedResearchers,
      point.meanCompletedFacilities,
    ]),
  ]);
}

export function facilitySummaryCsv(report: BalanceReport): string {
  return csv([
    [
      "facility_id",
      "completions",
      "mean_completion_tick",
      "mean_upfront_cost_millions",
      "mean_cash_delta_after_26_weeks",
    ],
    ...Object.entries(report.facilityMetrics).map(([definitionId, metric]) => [
      definitionId,
      metric.completions,
      metric.meanCompletionTick,
      metric.meanUpfrontCostMillions,
      metric.meanCashDeltaAfter26Weeks,
    ]),
  ]);
}

export function eventSummaryCsv(report: BalanceReport): string {
  return csv([
    ["kind", "id", "count"],
    ...Object.entries(report.eventFrequency).map(([id, count]) => [
      "definition",
      id,
      count,
    ]),
    ...Object.entries(report.eventOptionFrequency).map(([id, count]) => [
      "option",
      id,
      count,
    ]),
    ...Object.entries(report.eventOutcomeFrequency).map(([id, count]) => [
      "outcome",
      id,
      count,
    ]),
    ...Object.entries(report.eventCalibration.likelihoodPromises).flatMap(
      ([label, metric]) =>
        metric === undefined
          ? []
          : [
              ["likelihood-trials", label, metric.trials] as const,
              ["likelihood-successes", label, metric.successes] as const,
            ],
    ),
  ]);
}
