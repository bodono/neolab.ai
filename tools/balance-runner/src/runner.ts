import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { loadCompiledContent } from "@neolab/content";
import { assertNoHiddenKeys } from "@neolab/testkit";
import { deriveEndingResolutionInputs } from "@neolab/sim/debug";
import {
  advanceOneTick,
  alignmentLabelForEstimate,
  applyCommand,
  calculateFrontierCapability,
  createNewGame,
  projectGameView,
  stateHash,
  validateCommand,
  type AlignmentEvidenceLabel,
  type GamePhase,
  type GameState,
  type LabId,
  type LabState,
  type ModelId,
  type PlayerKnowledgeContext,
} from "@neolab/sim";

import { listAvailableCommands } from "./available-commands.ts";
import { buildBalanceReport } from "./report.ts";
import type {
  BalanceAnomalyCounts,
  BalanceCommandLogEntry,
  BalanceReport,
  BalanceRunRequest,
  BalanceRunResult,
  BalanceRunSpecification,
  BalanceTracePoint,
  EndgameRunMetrics,
  EventRunMetrics,
  FacilityBuildMetric,
  HiddenInformationRunMetrics,
  LossFamily,
  EndingOutcome,
  ResearcherRunMetrics,
  RivalCandidateOutcome,
  RivalCandidateOutcomeEntry,
  RivalCompetitivenessResult,
  SimulationPolicy,
} from "./types.ts";

function playerContext(state: Readonly<GameState>): PlayerKnowledgeContext {
  const lab = state.labs[state.run.playerLabId];
  const models = lab?.models.modelIds.map((modelId) => state.models[modelId]) ?? [];
  return {
    viewerLabId: state.run.playerLabId,
    intelligenceRatings: {},
    evidenceAccess: {
      evaluationIds: models.flatMap((model) => model?.evaluations ?? []),
      anomalyIds: models.flatMap((model) => model?.anomalies ?? []),
    },
  };
}

function addCount(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

function labRaceStrength(state: Readonly<GameState>, lab: Readonly<LabState>): number {
  const domainLevels = Object.values(lab.research.domains).map((domain) => domain.level);
  const meanDomain =
    domainLevels.length === 0
      ? 0
      : domainLevels.reduce((sum, level) => sum + level, 0) / domainLevels.length;
  const currentModel =
    lab.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  const capability =
    currentModel === undefined
      ? 0
      : calculateFrontierCapability(currentModel.trueCapability);
  return meanDomain + capability * 0.5 + lab.research.discoveredPaperIds.length * 2;
}

type RivalPlausibilitySnapshot = Pick<
  RivalCompetitivenessResult,
  | "plausibilityMeasurement"
  | "plausibilityMeasuredAtTick"
  | "plausibleContenderCount"
  | "atLeastTwoPlausible"
  | "leadingRivalLabId"
>;

type RivalResponseWindowSnapshot = Pick<
  RivalCompetitivenessResult,
  | "responseWindowMeasuredAtTick"
  | "responseWindowRivalLabId"
  | "leadingRivalCandidateWeeksRemaining"
  | "viableResponseWindow"
>;

function rivalPlausibility(
  state: Readonly<GameState>,
  measurement: RivalPlausibilitySnapshot["plausibilityMeasurement"],
): RivalPlausibilitySnapshot {
  const rivals = Object.values(state.labs)
    .filter((lab) => lab.control === "rival")
    .map((lab) => ({ lab, strength: labRaceStrength(state, lab) }))
    .sort(
      (left, right) =>
        right.strength - left.strength || left.lab.id.localeCompare(right.lab.id),
    );
  const leadingStrength = rivals[0]?.strength ?? 0;
  const plausible = rivals.filter(
    (candidate) => leadingStrength - candidate.strength <= 15,
  );
  const leading = rivals[0]?.lab;
  return {
    plausibilityMeasurement: measurement,
    plausibilityMeasuredAtTick: state.run.tick,
    plausibleContenderCount: plausible.length,
    atLeastTwoPlausible: plausible.length >= 2,
    ...(leading === undefined ? {} : { leadingRivalLabId: leading.id }),
  };
}

function rivalResponseWindow(
  state: Readonly<GameState>,
): RivalResponseWindowSnapshot | undefined {
  const leading = Object.entries(state.world.rivals)
    .flatMap(([labId, rival]) => {
      const countdown = rival.candidateCountdown;
      if (
        countdown === undefined ||
        (countdown.status !== "active" && countdown.status !== "paused")
      ) {
        return [];
      }
      const weeksRemaining =
        countdown.status === "paused"
          ? (countdown.remainingWeeksAtPause ?? 0)
          : Math.max(0, countdown.completesAt - state.run.tick);
      return [{ labId, weeksRemaining }];
    })
    .sort(
      (left, right) =>
        left.weeksRemaining - right.weeksRemaining ||
        left.labId.localeCompare(right.labId),
    )[0];
  if (leading === undefined) return undefined;
  return {
    responseWindowMeasuredAtTick: state.run.tick,
    responseWindowRivalLabId: leading.labId,
    leadingRivalCandidateWeeksRemaining: leading.weeksRemaining,
    viableResponseWindow: leading.weeksRemaining >= 8,
  };
}

function rivalCompetitiveness(
  state: Readonly<GameState>,
  frontierSnapshot: RivalPlausibilitySnapshot | undefined,
  responseWindowSnapshot: RivalResponseWindowSnapshot | undefined,
): RivalCompetitivenessResult {
  const plausibility = frontierSnapshot ?? rivalPlausibility(state, "run-end-fallback");
  const planIds = Object.values(state.world.rivals).flatMap((rival) =>
    rival.quarterlyDecisions.map((entry) => entry.selectedPlanId),
  );
  return {
    ...plausibility,
    ...responseWindowSnapshot,
    candidateOutcomes: rivalCandidateOutcomes(state),
    safetyPausePlanSelections: planIds.filter((id) => id === "safety-stand-down").length,
    commercialPlanSelections: planIds.filter((id) => id === "commercial-consolidation")
      .length,
    cooperationPlanSelections: planIds.filter(
      (id) => id === "government-partnership" || id === "coalition-outreach",
    ).length,
  };
}

const RIVAL_OUTCOME_SOURCE_PREFIXES: readonly [string, RivalCandidateOutcome][] = [
  ["rival-candidate:", "countdown-started"],
  ["rival-candidate-incident:", "containment-incident"],
  ["rival-false-dawn:", "false-dawn"],
  ["rival-candidate-contained:", "emergency-containment"],
  ["rival-candidate-delayed:", "deployment-delay"],
] as const;

export function rivalCandidateOutcomes(
  state: Readonly<GameState>,
): RivalCompetitivenessResult["candidateOutcomes"] {
  const timeline: RivalCandidateOutcomeEntry[] = [];
  for (const entry of state.decisionLog) {
    const sourceId = entry.source?.id;
    const relatedIds = entry.relatedIds ?? [];
    const labId = relatedIds.find(
      (id): id is LabId => state.labs[id as LabId]?.control === "rival",
    );
    const modelId = relatedIds.find(
      (id): id is ModelId => state.models[id as ModelId]?.ownerLabId === labId,
    );
    if (sourceId === undefined || labId === undefined || modelId === undefined) continue;
    const outcome =
      sourceId === "base:ending.rival-ascendance"
        ? "rival-ascendance"
        : sourceId === "base:ending.the-door-opened-elsewhere"
          ? "catastrophe"
          : RIVAL_OUTCOME_SOURCE_PREFIXES.find(([prefix]) =>
              sourceId.startsWith(prefix),
            )?.[1];
    if (outcome === undefined) continue;
    timeline.push({ tick: entry.tick, labId, modelId, outcome });
  }
  timeline.sort(
    (left, right) =>
      left.tick - right.tick ||
      left.labId.localeCompare(right.labId) ||
      left.modelId.localeCompare(right.modelId),
  );
  const resolved = timeline.filter(
    (entry) =>
      entry.outcome === "false-dawn" ||
      entry.outcome === "containment-incident" ||
      entry.outcome === "emergency-containment" ||
      entry.outcome === "rival-ascendance" ||
      entry.outcome === "catastrophe",
  );
  const count = (outcome: RivalCandidateOutcome): number =>
    timeline.filter((entry) => entry.outcome === outcome).length;
  const startedArtifacts = [
    ...new Map(
      timeline
        .filter((entry) => entry.outcome === "countdown-started")
        .map((entry) => [`${entry.labId}/${entry.modelId}`, entry]),
    ).values(),
  ];
  const candidatePriors = startedArtifacts.flatMap((entry) => {
    const model = state.models[entry.modelId as ModelId];
    const lineage =
      model === undefined ? undefined : state.lineageSIRecords[model.lineageId];
    return lineage === undefined ? [] : [lineage];
  });
  const firstQualifyingCapabilities = candidatePriors.map(
    (lineage) => lineage.firstQualifyingFrontierCapability,
  );
  const superintelligencePriors = candidatePriors.map(
    (lineage) => lineage.probabilityAtFirstCrossing,
  );
  const containmentIncidents = count("containment-incident");
  const falseDawns = count("false-dawn");
  const emergencyContainments = count("emergency-containment");
  const deploymentDelays = count("deployment-delay");
  const successfulDeployments = count("rival-ascendance");
  const catastrophes = count("catastrophe");
  const countdownClosures =
    containmentIncidents +
    falseDawns +
    emergencyContainments +
    successfulDeployments +
    catastrophes;
  const firstStart = timeline.find((entry) => entry.outcome === "countdown-started");
  const lastResolved = resolved.at(-1);
  return {
    countdownStarts: count("countdown-started"),
    uniqueCandidateArtifacts: startedArtifacts.length,
    countdownClosures,
    resolutionAttempts: countdownClosures + deploymentDelays,
    terminalDeployments: successfulDeployments + catastrophes,
    containmentIncidents,
    falseDawns,
    emergencyContainments,
    deploymentDelays,
    successfulDeployments,
    catastrophes,
    activeCountdownsAtEnd: Object.values(state.world.rivals).filter(
      (rival) =>
        rival.candidateCountdown?.status === "active" ||
        rival.candidateCountdown?.status === "paused",
    ).length,
    candidatePriorSamples: candidatePriors.length,
    ...(firstQualifyingCapabilities.length === 0
      ? {}
      : {
          firstQualifyingCapabilityMin: Math.min(...firstQualifyingCapabilities),
          firstQualifyingCapabilityMean:
            firstQualifyingCapabilities.reduce((sum, value) => sum + value, 0) /
            firstQualifyingCapabilities.length,
          firstQualifyingCapabilityMax: Math.max(...firstQualifyingCapabilities),
          superintelligencePriorMean:
            superintelligencePriors.reduce((sum, value) => sum + value, 0) /
            superintelligencePriors.length,
        }),
    guaranteedGenuineCandidates: candidatePriors.filter(
      (lineage) => lineage.probabilityAtFirstCrossing >= 1,
    ).length,
    notGenuineCandidates: candidatePriors.filter(
      (lineage) => lineage.superintelligenceTruth === "not-genuine",
    ).length,
    ...(firstStart === undefined ? {} : { firstCountdownStartedAt: firstStart.tick }),
    ...(resolved[0] === undefined ? {} : { firstResolvedAt: resolved[0].tick }),
    ...(lastResolved === undefined ? {} : { lastResolvedAt: lastResolved.tick }),
    timeline,
  };
}

function sumResearchPoints(
  domains: Readonly<Record<string, { totalResearchPoints: number }>>,
): number {
  return Object.values(domains).reduce(
    (sum, domain) => sum + domain.totalResearchPoints,
    0,
  );
}

function tracePoint(state: Readonly<GameState>): BalanceTracePoint {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Balance trace player lab missing");
  const model =
    lab.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  const strongestMeasuredModel = lab.models.modelIds
    .map((modelId) => state.models[modelId])
    .filter((candidate) => candidate?.measuredCapability !== undefined)
    .sort(
      (left, right) =>
        (right?.measuredCapability?.frontierCapability ?? 0) -
          (left?.measuredCapability?.frontierCapability ?? 0) ||
        (right?.generationIndex ?? 0) - (left?.generationIndex ?? 0),
    )[0];
  const strongestTrainingProjectId = Object.entries(strongestMeasuredModel?.flags ?? {})
    .find(
      ([flag, enabled]) => flag.startsWith("training-project:") && enabled === true,
    )?.[0]
    .replace("training-project:", "");
  const strongestTrainingProject =
    strongestTrainingProjectId === undefined
      ? undefined
      : state.projects[strongestTrainingProjectId as keyof typeof state.projects];
  const strongestTrainingPayload =
    strongestTrainingProject?.payload.kind === "training"
      ? strongestTrainingProject.payload
      : undefined;
  const employedResearchers = lab.roster.researcherIds.filter(
    (id) => state.researchers[id]?.status === "employed",
  ).length;
  return {
    tick: state.run.tick,
    phase: state.run.phase,
    cashMillions: lab.finance.cash,
    physicalGpus: lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0),
    aura: lab.aura.spendable,
    capabilityResearchPoints: sumResearchPoints(lab.research.domains),
    safetyResearchPoints: sumResearchPoints(lab.research.safetyPrograms),
    safetyEvidence:
      (lab.safety.alignmentScience +
        lab.safety.evalQuality +
        lab.safety.controlTheory +
        lab.safety.practicalControlStrength +
        lab.safety.securityPosture) /
      5,
    frontierCapability:
      model?.measuredCapability?.frontierCapability ??
      (model === undefined ? 0 : calculateFrontierCapability(model.trueCapability)),
    capabilityDomainLevels: Object.fromEntries(
      Object.entries(lab.research.domains).map(([id, domain]) => [id, domain.level]),
    ),
    measuredCapability: { ...(model?.measuredCapability?.values ?? {}) },
    ...(strongestMeasuredModel === undefined
      ? {}
      : { strongestMeasuredModelId: strongestMeasuredModel.id }),
    strongestFrontierCapability:
      strongestMeasuredModel?.measuredCapability?.frontierCapability ?? 0,
    strongestMeasuredCapability: {
      ...(strongestMeasuredModel?.measuredCapability?.values ?? {}),
    },
    strongestTrueFrontierCapability:
      strongestMeasuredModel === undefined
        ? 0
        : calculateFrontierCapability(strongestMeasuredModel.trueCapability),
    strongestTrueCapability: {
      ...(strongestMeasuredModel?.trueCapability ?? {}),
    },
    ...(strongestMeasuredModel === undefined
      ? {}
      : {
          strongestModelTrainedAtTick: strongestMeasuredModel.trainedAt,
          strongestModelGeneration: strongestMeasuredModel.generationIndex,
        }),
    ...(strongestTrainingPayload?.completionReport === undefined
      ? {}
      : {
          strongestModelScaleScore: strongestTrainingPayload.completionReport.scaleScore,
          strongestModelCapabilityPenalty: strongestTrainingPayload.capabilityPenalty,
          strongestModelFailureOutcomes: strongestTrainingPayload.failureChecks.map(
            (check) => check.outcome,
          ),
        }),
    score: state.score.entries.reduce((sum, entry) => sum + entry.amount, 0),
    discoveredPapers: lab.research.discoveredPaperIds.length,
    employedResearchers,
    starSlots: lab.roster.starSlots,
    completedFacilities: lab.facilities.instances.length,
    activeProjects: lab.projects.projectIds.filter((projectId) => {
      const status = state.projects[projectId]?.status;
      return status === "active" || status === "queued" || status === "paused";
    }).length,
    eventInstances: Object.keys(state.eventInstances).length,
  };
}

function policyDecisionDue(state: Readonly<GameState>): boolean {
  if (state.run.tick % 4 === 0 || state.run.tick % 13 === 0) return true;
  if (state.endgame.stage !== "inactive" && state.endgame.stage !== "resolved")
    return true;
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Balance policy player lab missing");
  if (lab.research.pendingGenericAdvances.length > 0) return true;
  if (
    Object.values(state.world.paperRace.discoveries).some(
      (discovery) =>
        discovery.discovererLabId === state.run.playerLabId &&
        discovery.publicationPolicy === undefined,
    )
  )
    return true;
  if (
    Object.values(state.eventInstances).some(
      (instance) => instance.status === "unresolved",
    )
  )
    return true;
  if (
    lab.roster.researcherIds.some(
      (researcherId) => state.researchers[researcherId]?.ultimatum?.status === "pending",
    )
  )
    return true;
  return Object.values(state.fundraising.offers).some(
    (offer) => offer.status === "available",
  );
}

function runKey(input: {
  readonly seed: string;
  readonly policyId: string;
  readonly difficultyId: string;
  readonly leaderId: string;
  readonly mandateId: string;
}): string {
  return [
    input.seed,
    input.policyId,
    input.difficultyId,
    input.leaderId,
    input.mandateId,
  ].join("/");
}

/** Stable matrix expansion used by local, sharded, and aggregate runs. */
export function buildRunSpecifications(
  request: BalanceRunRequest,
): readonly BalanceRunSpecification[] {
  const mode = request.matrixMode ?? "cartesian";
  const specifications: BalanceRunSpecification[] = [];
  let ordinal = 0;
  if (mode === "independent") {
    for (const [seedIndex, seed] of request.seeds.entries()) {
      const policy = request.policies[seedIndex % request.policies.length];
      const difficultyId =
        request.difficultyIds[seedIndex % request.difficultyIds.length];
      const leaderId = request.leaderIds[seedIndex % request.leaderIds.length];
      const mandateId = request.mandateIds[seedIndex % request.mandateIds.length];
      if (
        policy === undefined ||
        difficultyId === undefined ||
        leaderId === undefined ||
        mandateId === undefined
      ) {
        throw new Error("Balance run matrix contains an empty dimension");
      }
      const specification: BalanceRunSpecification = {
        ordinal,
        runKey: runKey({
          seed,
          policyId: policy.id,
          difficultyId,
          leaderId,
          mandateId,
        }),
        seed,
        policyId: policy.id,
        difficultyId,
        leaderId,
        mandateId,
      };
      if (
        request.shard === undefined ||
        specification.ordinal % request.shard.count === request.shard.index
      ) {
        specifications.push(specification);
      }
      ordinal += 1;
    }
    return specifications;
  }
  if (mode === "paired") {
    for (const [seedIndex, seed] of request.seeds.entries()) {
      for (const [policyIndex, policy] of request.policies.entries()) {
        const difficultyId =
          request.difficultyIds[(seedIndex + policyIndex) % request.difficultyIds.length];
        const leaderId =
          request.leaderIds[(seedIndex + policyIndex) % request.leaderIds.length];
        const mandateId =
          request.mandateIds[(seedIndex + policyIndex) % request.mandateIds.length];
        if (
          difficultyId === undefined ||
          leaderId === undefined ||
          mandateId === undefined
        ) {
          throw new Error("Balance run matrix contains an empty dimension");
        }
        const specification: BalanceRunSpecification = {
          ordinal,
          runKey: runKey({
            seed,
            policyId: policy.id,
            difficultyId,
            leaderId,
            mandateId,
          }),
          seed,
          policyId: policy.id,
          difficultyId,
          leaderId,
          mandateId,
        };
        if (
          request.shard === undefined ||
          specification.ordinal % request.shard.count === request.shard.index
        ) {
          specifications.push(specification);
        }
        ordinal += 1;
      }
    }
    return specifications;
  }

  for (const seed of request.seeds) {
    // Policy sits outside the 60 launch configurations so the ten-way nightly
    // modulo shard receives every policy instead of one policy per worker.
    for (const policy of request.policies) {
      for (const difficultyId of request.difficultyIds) {
        for (const leaderId of request.leaderIds) {
          for (const mandateId of request.mandateIds) {
            const specification: BalanceRunSpecification = {
              ordinal,
              runKey: runKey({
                seed,
                policyId: policy.id,
                difficultyId,
                leaderId,
                mandateId,
              }),
              seed,
              policyId: policy.id,
              difficultyId,
              leaderId,
              mandateId,
            };
            if (
              request.shard === undefined ||
              specification.ordinal % request.shard.count === request.shard.index
            ) {
              specifications.push(specification);
            }
            ordinal += 1;
          }
        }
      }
    }
  }
  return specifications;
}

function totalMatrixConfigurations(request: BalanceRunRequest): number {
  const mode = request.matrixMode ?? "cartesian";
  if (mode === "independent") return request.seeds.length;
  return mode === "paired"
    ? request.seeds.length * request.policies.length
    : request.seeds.length *
        request.policies.length *
        request.difficultyIds.length *
        request.leaderIds.length *
        request.mandateIds.length;
}

function phaseCompetitiveness(state: Readonly<GameState>): boolean {
  const player = state.labs[state.run.playerLabId];
  if (player === undefined) return false;
  const strengths = Object.values(state.labs).map((lab) => labRaceStrength(state, lab));
  return Math.max(...strengths, 0) - labRaceStrength(state, player) <= 15;
}

function lossFamily(endingId: string, status: BalanceRunResult["status"]): LossFamily {
  if (status !== "lost") return "not-a-loss";
  if (endingId.endsWith("rival-ascendance") || endingId.endsWith("the-long-pause")) {
    return "rival-ascendance";
  }
  if (
    endingId.endsWith("the-worlds-most-expensive-insolvency") ||
    endingId.endsWith("mission-accomplished-by-the-board")
  ) {
    return "bankruptcy-or-mission-capture";
  }
  if (endingId.endsWith("nationalised-future")) return "regulation-or-nationalisation";
  if (endingId.endsWith("false-dawn") || endingId.endsWith("the-caretaker")) {
    return "capability-or-prosperity";
  }
  if (
    endingId.endsWith("emergency-shutdown") ||
    endingId.endsWith("no-one-holds-the-off-switch") ||
    endingId.endsWith("the-last-human-veto") ||
    endingId.endsWith("the-objective-was-satisfied") ||
    endingId.endsWith("a-war-measured-in-milliseconds") ||
    endingId.endsWith("the-replication-threshold") ||
    endingId.endsWith("the-last-experiment") ||
    endingId.endsWith("there-is-no-one-left-to-read-this") ||
    endingId.endsWith("the-incubation-window") ||
    endingId.endsWith("the-final-command-chain") ||
    endingId.endsWith("the-grey-horizon") ||
    endingId.endsWith("the-empty-patrol") ||
    endingId.endsWith("the-tomb-atmosphere") ||
    endingId.endsWith("every-side-was-certain")
  ) {
    return "loss-of-control";
  }
  return "other";
}

const HUMAN_EXTINCTION_ENDING_SUFFIXES = [
  "there-is-no-one-left-to-read-this",
  "the-incubation-window",
  "the-final-command-chain",
  "the-grey-horizon",
  "the-empty-patrol",
  "the-tomb-atmosphere",
  "every-side-was-certain",
] as const;

function endingOutcome(
  endingId: string,
  status: BalanceRunResult["status"],
): EndingOutcome {
  if (status === "incomplete") return "incomplete";
  if (status === "won") return "player-victory";
  return HUMAN_EXTINCTION_ENDING_SUFFIXES.some((suffix) => endingId.endsWith(suffix))
    ? "human-extinction"
    : "non-extinction-loss";
}

function categoryDistance(
  left: AlignmentEvidenceLabel,
  right: AlignmentEvidenceLabel,
): number {
  const order: readonly AlignmentEvidenceLabel[] = [
    "alarming",
    "concerning",
    "mixed",
    "reassuring",
    "strongly-reassuring",
  ];
  return Math.abs(order.indexOf(left) - order.indexOf(right));
}

function hiddenInformationMetrics(
  state: Readonly<GameState>,
): HiddenInformationRunMetrics {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Balance hidden-information lab missing");
  let weakEvidenceCases = 0;
  let weakEvidenceWrongCategory = 0;
  let strongEvidenceCases = 0;
  let strongEvidenceWrongCategory = 0;
  for (const modelId of lab.models.modelIds) {
    const model = state.models[modelId];
    if (model === undefined || calculateFrontierCapability(model.trueCapability) < 65) {
      continue;
    }
    const evaluations = model.evaluations
      .map((evaluationId) => state.evaluations[evaluationId])
      .filter((evaluation) => evaluation !== undefined);
    const methods = new Set(evaluations.map((evaluation) => evaluation.method));
    const strong =
      methods.size >= 3 &&
      lab.safety.evalQuality >= 70 &&
      lab.organisation.hiddenInternalCandour >= 70;
    const weak = evaluations.length <= 1 || lab.safety.evalQuality < 45;
    for (const evaluation of evaluations) {
      for (const observation of evaluation.observations) {
        if (
          observation.alignmentLabel === undefined ||
          (observation.target !== "true-alignment" &&
            observation.target !== "corrigibility")
        ) {
          continue;
        }
        const truth =
          observation.target === "true-alignment"
            ? model.hiddenSafety.trueAlignment
            : model.hiddenSafety.corrigibility;
        const wrong =
          categoryDistance(
            observation.alignmentLabel,
            alignmentLabelForEstimate(truth),
          ) >= 1;
        if (weak) {
          weakEvidenceCases += 1;
          if (wrong) weakEvidenceWrongCategory += 1;
        }
        if (strong) {
          strongEvidenceCases += 1;
          if (wrong) strongEvidenceWrongCategory += 1;
        }
      }
    }
  }
  const catastrophes = state.incidents.filter(
    (incident) => incident.category === "catastrophe",
  );
  const warningCount = catastrophes.filter((incident) => {
    const model = state.models[incident.modelId];
    if (model === undefined) return false;
    const priorAnomaly = model.anomalies.some((anomalyId) => {
      const anomaly = state.anomalies[anomalyId];
      return anomaly !== undefined && anomaly.createdAt < incident.occurredAt;
    });
    const priorConcerningEvaluation = model.evaluations.some((evaluationId) => {
      const evaluation = state.evaluations[evaluationId];
      return (
        evaluation !== undefined &&
        evaluation.completedAt < incident.occurredAt &&
        evaluation.observations.some(
          (observation) =>
            observation.alignmentLabel === "alarming" ||
            observation.alignmentLabel === "concerning" ||
            observation.alignmentLabel === "mixed",
        )
      );
    });
    return priorAnomaly || priorConcerningEvaluation || model.accessLevel >= 4;
  }).length;
  return {
    weakEvidenceCases,
    weakEvidenceWrongCategory,
    strongEvidenceCases,
    strongEvidenceWrongCategory,
    catastrophes: catastrophes.length,
    catastrophesWithLegibleWarning: warningCount,
    fairCatastrophes: catastrophes.filter((incident) => incident.catastropheLegal).length,
  };
}

function eventMetrics(
  state: Readonly<GameState>,
  content: NonNullable<BalanceRunRequest["content"]>,
): EventRunMetrics {
  const categories: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const likelihoodPromises: Record<string, { trials: number; successes: number }> = {};
  let ordinaryDecisionCount = 0;
  let stateConditionedCount = 0;
  for (const instance of Object.values(state.eventInstances)) {
    const definition = content.events.definitions[instance.definitionId];
    if (
      definition !== undefined &&
      instance.source === "opportunity" &&
      definition.severity !== "feed"
    ) {
      ordinaryDecisionCount += 1;
      addCount(categories, definition.category);
      if (
        definition.weightModifiers.length > 0 ||
        definition.prerequisites.type !== "always"
      ) {
        stateConditionedCount += 1;
      }
    }
    for (const outcome of instance.resolution?.outcomes ?? []) {
      addCount(
        outcomes,
        `${instance.definitionId}/${outcome.optionId}/${outcome.checkId}/${outcome.outcomeId}`,
      );
      const option = definition?.options.find(
        (candidate) => candidate.id === outcome.optionId,
      );
      const check = option?.checks.find((candidate) => candidate.id === outcome.checkId);
      const promise = check?.likelihoodPromise;
      if (promise !== undefined) {
        const metric = likelihoodPromises[promise.label] ?? {
          trials: 0,
          successes: 0,
        };
        metric.trials += 1;
        if (promise.successOutcomeIds.includes(outcome.outcomeId)) {
          metric.successes += 1;
        }
        likelihoodPromises[promise.label] = metric;
      }
    }
  }
  const scheduled = new Map<string, number>();
  const delayedFollowUpWeeks: number[] = [];
  for (const entry of state.decisionLog) {
    const id = entry.relatedIds?.[0];
    if (id === undefined) continue;
    if (entry.category === "delayed-effect-scheduled") scheduled.set(id, entry.tick);
    if (entry.category === "delayed-effect-fired") {
      const scheduledAt = scheduled.get(id);
      if (scheduledAt !== undefined) delayedFollowUpWeeks.push(entry.tick - scheduledAt);
    }
  }
  return {
    ordinaryDecisionCount,
    stateConditionedCount,
    categories,
    outcomes,
    likelihoodPromises,
    delayedFollowUpWeeks,
  };
}

const ENDGAME_STAGE_ORDER = [
  "inactive",
  "candidate-activation",
  "confirmation",
  "evidence-sprint",
  "pressure-collision",
  "final-review",
  "rollout",
  "retirement-attempt",
  "recovery",
  // The containment-failure arc branches off mid-crisis; for the
  // furthest-stage metric it counts as deeper than a completed rollout,
  // since only a run that went far enough to lose control can reach it.
  "containment-failure",
  "world-waiting",
  "resolved",
] as const;

const ENDGAME_STAGE_STALL_ALLOWANCE_WEEKS: Readonly<
  Partial<Record<(typeof ENDGAME_STAGE_ORDER)[number], number>>
> = {
  "candidate-activation": 1,
  confirmation: 52,
  "evidence-sprint": 52,
  "pressure-collision": 26,
  "final-review": 1,
  rollout: 52,
  "retirement-attempt": 1,
  recovery: 78,
  "containment-failure": 1,
  "world-waiting": 0,
};

/** Stage-aware harness alarm: long projects are allowed; blocking screens are not. */
export function stalledEndgameStages(
  stageDwellWeeks: Readonly<Record<string, number>>,
): readonly string[] {
  return Object.entries(stageDwellWeeks)
    .filter(([stage, weeks]) => {
      const allowance =
        ENDGAME_STAGE_STALL_ALLOWANCE_WEEKS[
          stage as (typeof ENDGAME_STAGE_ORDER)[number]
        ];
      return allowance !== undefined && weeks > allowance;
    })
    .map(([stage]) => stage)
    .sort();
}

function endgameMetrics(
  state: Readonly<GameState>,
  furthestStage: string,
  stageDwellWeeks: Readonly<Record<string, number>>,
  content: NonNullable<BalanceRunRequest["content"]>,
): EndgameRunMetrics {
  const gateResults: Record<string, string> = {};
  const gateProbabilities: Record<string, number> = {};
  if (state.endgame.stage === "rollout" || state.endgame.stage === "resolved") {
    for (const resolution of state.endgame.gateResolutions) {
      gateResults[resolution.gate] = resolution.resultId;
      if (resolution.probability !== undefined) {
        gateProbabilities[resolution.gate] = resolution.probability;
      }
    }
  }
  return {
    furthestStage,
    stageDwellWeeks,
    stalledStageIds: stalledEndgameStages(stageDwellWeeks),
    ...(state.endgame.stage === "inactive" || !("crisisStartedAt" in state.endgame)
      ? {}
      : { crisisStartedAt: state.endgame.crisisStartedAt }),
    gateResults,
    gateProbabilities,
    ...(state.endgame.stage === "rollout" || state.endgame.stage === "resolved"
      ? {
          resolutionInputs: (() => {
            const inputs = deriveEndingResolutionInputs(state, content);
            return {
              deploymentModeId: inputs.deploymentModeId,
              capabilityResult: inputs.capabilityResult,
              remainingDefence: inputs.remainingDefence,
              legitimacy: inputs.legitimacy,
              accessLevel: inputs.accessLevel,
              evidenceConfidence: inputs.evidenceConfidence,
              offensiveAgency: inputs.offensiveAgency,
              deceptiveCapability: inputs.deceptiveCapability,
            };
          })(),
        }
      : {}),
  };
}

function anomalyCounts(
  state: Readonly<GameState>,
  content: NonNullable<BalanceRunRequest["content"]>,
): BalanceAnomalyCounts {
  const impossibleProjects = Object.values(state.projects).filter(
    (project) =>
      (project.status === "active" || project.status === "queued") &&
      state.run.tick - project.createdAt >
        Math.max(26, project.expectedDurationWeeks * 2) &&
      project.progress <= 0,
  ).length;
  const negativePrices = Object.values(content.market.priceTiers).filter(
    (tier) => tier.unitPriceMillions < 0,
  ).length;
  const invalidAllocations = Object.values(state.labs).filter((lab) => {
    const allocation = lab.compute.allocation;
    const capability = Object.values(allocation.capabilityDomainWeights).reduce(
      (sum, value) => sum + value,
      0,
    );
    const safety = Object.values(allocation.safetyProgramWeights).reduce(
      (sum, value) => sum + value,
      0,
    );
    return (
      allocation.servingFleetShareBasisPoints < 0 ||
      allocation.servingFleetShareBasisPoints > 10_000 ||
      allocation.capabilityBasisPoints < 0 ||
      allocation.capabilityBasisPoints > 10_000 ||
      capability !== 10_000 ||
      safety !== 10_000
    );
  }).length;
  const deadlockedEvents = Object.values(state.eventInstances).filter(
    (instance) =>
      instance.status === "unresolved" &&
      instance.enabledOptionIds.length === 0 &&
      state.run.tick - instance.createdAt >= 1,
  ).length;
  return { impossibleProjects, negativePrices, invalidAllocations, deadlockedEvents };
}

interface FacilityTracker {
  readonly definitionId: FacilityBuildMetric["definitionId"];
  readonly completedAt: number;
  readonly upfrontCostMillions: number;
  readonly cashAtCompletion: number;
  cashDeltaAfter26Weeks: number | null;
}

function facilityKey(
  instance: Readonly<LabState["facilities"]["instances"][number]>,
  index: number,
): string {
  return (
    instance.id ??
    `${instance.definitionId}/${String(instance.completedAt)}/${String(index)}`
  );
}

function constructionCost(
  state: Readonly<GameState>,
  definitionId: string,
  completedAt: number,
): number {
  const project = Object.values(state.projects)
    .filter(
      (candidate) =>
        candidate.payload.kind === "construction" &&
        candidate.payload.facilityDefinitionId === definitionId &&
        candidate.createdAt <= completedAt,
    )
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  return project?.payload.kind === "construction"
    ? project.payload.upfrontCostMillions
    : 0;
}

/** Commands that represent a human choice for the play-time estimate. */
export function isHumanDecisionCommand(command: { readonly kind: string }): boolean {
  return [
    "respond-to-decision-event",
    "choose-generic-advance",
    "choose-publication-policy",
    "resolve-researcher-ultimatum",
    "nominate-candidate",
    "commit-capability-proof",
    "commit-candidate-safety-response",
    "resolve-pressure-collision",
    "enter-final-review",
    "choose-deployment-mode",
    "resolve-rollout-decision",
    "resolve-containment-failure",
    "configure-candidate-retirement",
    "transmit-candidate-retirement",
    "resolve-candidate-incident",
    "choose-post-retirement-path",
    "choose-false-dawn-path",
    "transmit-deployment",
  ].includes(command.kind);
}

function traceSelected(runKeyValue: string, sampleRate: number): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  const digest = createHash("sha256").update(runKeyValue).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 < sampleRate;
}

function runOne(
  request: BalanceRunRequest & {
    readonly content: NonNullable<BalanceRunRequest["content"]>;
  },
  policy: SimulationPolicy,
  specification: BalanceRunSpecification,
): BalanceRunResult {
  const content = request.content;
  let state = createNewGame(
    {
      seed: specification.seed,
      difficultyId: specification.difficultyId,
      leaderId: specification.leaderId,
      mandateId: specification.mandateId,
    },
    content,
  );
  let rejectedPolicyCommands = 0;
  const rejectedPolicyCommandReasons: Record<string, number> = {};
  let decisionCommands = 0;
  let hires = 0;
  let departures = 0;
  let slotUtilisationSum = 0;
  let slotUtilisationSamples = 0;
  let competitiveEnteringFrontier = false;
  let candidateOrViableCoalition = false;
  let reachedFinalDeploymentChoice = false;
  let furthestEndgameStage = "inactive";
  let observedEndgameStage = state.endgame.stage;
  let observedEndgameStageEnteredAt = state.run.tick;
  const endgameStageDwellWeeks: Record<string, number> = {};
  let worldWaitingCommandSteps = 0;
  const observeEndgameStage = (): void => {
    if (state.endgame.stage !== observedEndgameStage) {
      endgameStageDwellWeeks[observedEndgameStage] = Math.max(
        endgameStageDwellWeeks[observedEndgameStage] ?? 0,
        state.run.tick - observedEndgameStageEnteredAt,
      );
      observedEndgameStage = state.endgame.stage;
      observedEndgameStageEnteredAt = state.run.tick;
    }
    const stageIndex = ENDGAME_STAGE_ORDER.indexOf(state.endgame.stage);
    if (
      stageIndex >
      ENDGAME_STAGE_ORDER.indexOf(
        furthestEndgameStage as (typeof ENDGAME_STAGE_ORDER)[number],
      )
    ) {
      furthestEndgameStage = state.endgame.stage;
    }
    if (state.endgame.stage !== "inactive") candidateOrViableCoalition = true;
    if (
      state.endgame.stage === "final-review" ||
      state.endgame.stage === "rollout" ||
      state.endgame.stage === "world-waiting" ||
      state.endgame.stage === "resolved"
    ) {
      reachedFinalDeploymentChoice = true;
    }
  };
  let frontierRivalSnapshot: RivalPlausibilitySnapshot | undefined;
  let firstRivalResponseWindow = rivalResponseWindow(state);
  const phaseEntryTicks: Partial<Record<GamePhase, number>> = {
    [state.run.phase]: state.run.tick,
  };
  const trace: BalanceTracePoint[] = [];
  const commands: BalanceCommandLogEntry[] = [];
  const traceThisRun = traceSelected(specification.runKey, request.traceSampleRate);
  if (traceThisRun) trace.push(tracePoint(state));
  let previousEmployed = new Set(
    state.labs[state.run.playerLabId]?.roster.researcherIds ?? [],
  );
  const knownFacilities = new Set<string>();
  const facilityTrackers = new Map<string, FacilityTracker>();
  const initialLab = state.labs[state.run.playerLabId];
  for (const [index, instance] of (initialLab?.facilities.instances ?? []).entries()) {
    knownFacilities.add(facilityKey(instance, index));
  }

  while (state.run.status === "active" && state.run.tick < request.maxTicks) {
    let commandsAppliedThisCycle = 0;
    if (policyDecisionDue(state)) {
      const view = projectGameView(state, content, playerContext(state));
      assertNoHiddenKeys(view);
      const available = listAvailableCommands(state, content, policy.id);
      const plannedCommandIds = new Set(
        available.map((candidate) => candidate.command.meta.commandId),
      );
      for (const command of policy.decide(
        { game: view, seed: specification.seed, policyId: policy.id },
        available,
      )) {
        const validation = validateCommand(state, content, command);
        if (!validation.ok) {
          // Policies plan against one coherent weekly snapshot. An earlier
          // command in the same batch may legitimately change demand, Aura,
          // or project capacity and make a later, originally legal action
          // stale. Defer that action until the next policy tick rather than
          // misreporting it as an illegal policy command.
          if (plannedCommandIds.has(command.meta.commandId)) continue;
          rejectedPolicyCommands += 1;
          for (const error of validation.errors) {
            const key = `${command.kind}:${error.code}`;
            rejectedPolicyCommandReasons[key] =
              (rejectedPolicyCommandReasons[key] ?? 0) + 1;
          }
          continue;
        }
        if (traceThisRun)
          commands.push({ tick: state.run.tick, command: structuredClone(command) });
        if (isHumanDecisionCommand(command)) decisionCommands += 1;
        state = applyCommand(state, content, command).state;
        commandsAppliedThisCycle += 1;
        observeEndgameStage();
      }
    }
    // World-waiting is a sealed, command-driven launch-control reveal. It is
    // deliberately not a simulation week: keep dispatching its presentation
    // command until the terminal result is revealed instead of letting rival,
    // finance, or hazard clocks overwrite the selected outcome.
    if (state.run.status !== "active") break;
    if (state.endgame.stage === "world-waiting") {
      worldWaitingCommandSteps += 1;
      if (commandsAppliedThisCycle === 0 || worldWaitingCommandSteps > 16) {
        // A command-driven presentation has no simulation-week dwell. Record a
        // sentinel above its zero-week allowance and terminate this harness
        // run instead of spinning forever at one tick.
        endgameStageDwellWeeks["world-waiting"] = 1;
        break;
      }
      continue;
    }
    worldWaitingCommandSteps = 0;
    state = advanceOneTick(state, content).state;
    observeEndgameStage();

    if (phaseEntryTicks[state.run.phase] === undefined) {
      phaseEntryTicks[state.run.phase] = state.run.tick;
      if (state.run.phase === "frontier") {
        competitiveEnteringFrontier = phaseCompetitiveness(state);
        frontierRivalSnapshot = rivalPlausibility(state, "frontier-entry");
      }
    }
    firstRivalResponseWindow ??= rivalResponseWindow(state);
    if (
      Object.values(state.world.coalitions).some(
        (coalition) =>
          coalition.status === "active" &&
          coalition.memberLabIds.includes(state.run.playerLabId),
      )
    ) {
      candidateOrViableCoalition = true;
    }
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Balance run player lab disappeared");
    const employed = new Set(
      lab.roster.researcherIds.filter(
        (researcherId) => state.researchers[researcherId]?.status === "employed",
      ),
    );
    hires += [...employed].filter((id) => !previousEmployed.has(id)).length;
    departures += [...previousEmployed].filter((id) => !employed.has(id)).length;
    previousEmployed = employed;
    slotUtilisationSum += employed.size / Math.max(1, lab.roster.starSlots);
    slotUtilisationSamples += 1;

    for (const [index, instance] of lab.facilities.instances.entries()) {
      const key = facilityKey(instance, index);
      if (!knownFacilities.has(key)) {
        knownFacilities.add(key);
        facilityTrackers.set(key, {
          definitionId: instance.definitionId,
          completedAt: instance.completedAt,
          upfrontCostMillions: constructionCost(
            state,
            instance.definitionId,
            instance.completedAt,
          ),
          cashAtCompletion: lab.finance.cash,
          cashDeltaAfter26Weeks: null,
        });
      }
    }
    for (const tracker of facilityTrackers.values()) {
      if (
        tracker.cashDeltaAfter26Weeks === null &&
        state.run.tick >= tracker.completedAt + 26
      ) {
        tracker.cashDeltaAfter26Weeks = lab.finance.cash - tracker.cashAtCompletion;
      }
    }
    if (traceThisRun && state.run.tick % 13 === 0) trace.push(tracePoint(state));
  }

  if (traceThisRun && trace.at(-1)?.tick !== state.run.tick)
    trace.push(tracePoint(state));
  const discoveries = Object.values(state.world.paperRace.discoveries);
  const paperOwnership: Record<string, number> = {};
  for (const discovery of discoveries)
    addCount(paperOwnership, discovery.discovererLabId);
  const playerPapers = discoveries.filter(
    (discovery) => discovery.discovererLabId === state.run.playerLabId,
  ).length;
  const eventDefinitions: Record<string, number> = {};
  const eventOptions: Record<string, number> = {};
  for (const instance of Object.values(state.eventInstances)) {
    addCount(eventDefinitions, instance.definitionId);
    if (instance.resolution !== undefined) {
      addCount(eventOptions, `${instance.definitionId}/${instance.resolution.optionId}`);
    }
  }
  const status = state.run.status === "active" ? "incomplete" : state.run.status;
  endgameStageDwellWeeks[observedEndgameStage] = Math.max(
    endgameStageDwellWeeks[observedEndgameStage] ?? 0,
    state.run.tick - observedEndgameStageEnteredAt,
  );
  const endingId = state.run.endingId ?? "max-ticks";
  const playerLab = state.labs[state.run.playerLabId];
  if (playerLab === undefined) throw new Error("Balance result player lab missing");
  const researchers: ResearcherRunMetrics = {
    hires,
    departures,
    employedAtEnd: previousEmployed.size,
    starSlotsAtEnd: playerLab.roster.starSlots,
    meanSlotUtilisation:
      slotUtilisationSamples === 0 ? 0 : slotUtilisationSum / slotUtilisationSamples,
  };
  const finalHash = stateHash(state);
  return {
    ...specification,
    status,
    endingId,
    endingOutcome: endingOutcome(endingId, status),
    lossFamily: lossFamily(endingId, status),
    ticks: state.run.tick,
    estimatedRealMinutes: (state.run.tick * 4 + decisionCommands * 45) / 60,
    score: state.score.entries.reduce((sum, entry) => sum + entry.amount, 0),
    phaseEntryTicks,
    milestones: {
      survivedFoundation:
        phaseEntryTicks.scaling !== undefined ||
        phaseEntryTicks.frontier !== undefined ||
        phaseEntryTicks.crisis !== undefined,
      competitiveEnteringFrontier,
      candidateOrViableCoalition,
      reachedFinalDeploymentChoice,
      victory: status === "won",
    },
    playerWorldFirstPapers: playerPapers,
    totalDiscoveredPapers: discoveries.length,
    playerWorldFirstShare:
      discoveries.length === 0 ? 0 : playerPapers / discoveries.length,
    paperOwnership,
    eventDefinitions,
    eventOptions,
    rivalCompetitiveness: rivalCompetitiveness(
      state,
      frontierRivalSnapshot,
      firstRivalResponseWindow,
    ),
    researchers,
    facilities: [...facilityTrackers.values()].map((tracker) => ({
      definitionId: tracker.definitionId,
      completedAt: tracker.completedAt,
      upfrontCostMillions: tracker.upfrontCostMillions,
      cashDeltaAfter26Weeks: tracker.cashDeltaAfter26Weeks,
    })),
    events: eventMetrics(state, content),
    hiddenInformation: hiddenInformationMetrics(state),
    endgame: endgameMetrics(state, furthestEndgameStage, endgameStageDwellWeeks, content),
    anomalies: anomalyCounts(state, content),
    rejectedPolicyCommands,
    rejectedPolicyCommandReasons,
    ...(traceThisRun
      ? {
          replay: { commands, finalStateHash: finalHash },
          trace,
        }
      : {}),
  };
}

function validateRequest(request: BalanceRunRequest): void {
  if (request.seeds.length === 0) throw new Error("At least one seed is required");
  if (request.difficultyIds.length === 0)
    throw new Error("At least one difficulty is required");
  if (request.leaderIds.length === 0) throw new Error("At least one leader is required");
  if (request.mandateIds.length === 0)
    throw new Error("At least one mandate is required");
  if (request.policies.length === 0) throw new Error("At least one policy is required");
  if (!Number.isInteger(request.maxTicks) || request.maxTicks <= 0) {
    throw new Error("maxTicks must be a positive integer");
  }
  if (request.traceSampleRate < 0 || request.traceSampleRate > 1) {
    throw new Error("traceSampleRate must be in [0, 1]");
  }
  if (
    request.matrixMode !== undefined &&
    request.matrixMode !== "independent" &&
    request.matrixMode !== "paired" &&
    request.matrixMode !== "cartesian"
  ) {
    throw new Error("matrixMode must be independent, paired, or cartesian");
  }
  if (
    request.shard !== undefined &&
    (!Number.isInteger(request.shard.index) ||
      !Number.isInteger(request.shard.count) ||
      request.shard.count <= 0 ||
      request.shard.index < 0 ||
      request.shard.index >= request.shard.count)
  ) {
    throw new Error("shard must satisfy 0 <= index < count");
  }
}

/** Replays one sampled run without invoking its policy and returns the terminal hash. */
export function replayBalanceRun(
  specification: BalanceRunSpecification,
  commandLog: readonly BalanceCommandLogEntry[],
  content: NonNullable<BalanceRunRequest["content"]>,
  maxTicks: number,
): string {
  let state = createNewGame(
    {
      seed: specification.seed,
      difficultyId: specification.difficultyId,
      leaderId: specification.leaderId,
      mandateId: specification.mandateId,
    },
    content,
  );
  let commandIndex = 0;
  while (state.run.status === "active" && state.run.tick < maxTicks) {
    while (commandLog[commandIndex]?.tick === state.run.tick) {
      const entry = commandLog[commandIndex];
      if (entry === undefined) break;
      const validation = validateCommand(state, content, entry.command);
      if (!validation.ok) {
        throw new Error(
          `Replay rejected ${entry.command.kind} at tick ${String(state.run.tick)}: ` +
            validation.errors.map((error) => error.code).join(", "),
        );
      }
      state = applyCommand(state, content, entry.command).state;
      commandIndex += 1;
    }
    if (state.run.status !== "active") break;
    if (state.endgame.stage === "world-waiting") {
      if (commandLog[commandIndex]?.tick !== state.run.tick) {
        throw new Error(
          `Replay stalled in world-waiting at tick ${String(state.run.tick)} without a reveal command`,
        );
      }
      continue;
    }
    state = advanceOneTick(state, content).state;
  }
  if (commandIndex !== commandLog.length) {
    throw new Error(
      `Replay ended with ${String(commandLog.length - commandIndex)} unapplied command(s)`,
    );
  }
  return stateHash(state);
}

export async function runBalanceBatch(
  request: BalanceRunRequest,
): Promise<BalanceReport> {
  await Promise.resolve();
  validateRequest(request);
  const started = performance.now();
  const resolvedRequest = {
    ...request,
    matrixMode: request.matrixMode ?? "cartesian",
    content: request.content ?? loadCompiledContent(),
  };
  const policies = new Map(request.policies.map((policy) => [policy.id, policy]));
  const specifications = buildRunSpecifications(resolvedRequest);
  const runs = specifications.map((specification) => {
    const policy = policies.get(specification.policyId);
    if (policy === undefined) throw new Error(`Missing policy ${specification.policyId}`);
    return runOne(resolvedRequest, policy, specification);
  });
  return buildBalanceReport(runs, {
    elapsedMilliseconds: performance.now() - started,
    requestedMaxTicks: request.maxTicks,
    traceSampleRate: request.traceSampleRate,
    content: resolvedRequest.content,
    matrix: {
      mode: resolvedRequest.matrixMode,
      totalConfigurations: totalMatrixConfigurations(resolvedRequest),
      ...(request.shard === undefined ? {} : { shard: request.shard }),
      seeds: request.seeds.length,
      policies: request.policies.length,
      difficulties: request.difficultyIds.length,
      leaders: request.leaderIds.length,
      mandates: request.mandateIds.length,
    },
  });
}
