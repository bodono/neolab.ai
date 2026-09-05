import type {
  CompiledContent,
  TrainingPosture,
  TrainingScale,
} from "@neolab/content-schema";

import type { LabId } from "../model/ids.ts";
import type { GameState, ProjectPayload, ProjectState } from "../model/state.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { trainingQualitySignal } from "./training-quality.ts";

const MAX_HISTORICAL_RUNS = 10;
const SAMPLE_STEP_BASIS_POINTS = 200;
const MAX_PLOTTED_PERPLEXITY = 255;

type TrainingPayload = Extract<ProjectPayload, { readonly kind: "training" }>;
type TrainingProjectState = ProjectState & { readonly payload: TrainingPayload };

export interface TrainingLossPointView {
  readonly trainingFractionBasisPoints: number;
  readonly validationPerplexity: number;
}

export interface TrainingLossCurveView {
  readonly projectId: string;
  readonly label: string;
  readonly role: "current" | "history" | "failed-baseline";
  readonly status: "queued" | "active" | "paused" | "completed" | "failed";
  readonly attemptNumber: number;
  readonly scaleLabel: string;
  readonly postureLabel: string;
  readonly points: readonly TrainingLossPointView[];
  readonly latestPerplexity?: number;
  readonly failedAtBasisPoints?: number;
}

export interface TrainingLossTelemetryView {
  readonly curves: readonly TrainingLossCurveView[];
  readonly omittedSuccessfulRuns: number;
  readonly maximumHistoricalRuns: number;
}

interface CurveProfile {
  readonly start: number;
  readonly floor: number;
  readonly decayRate: number;
  readonly decayShape: number;
  readonly noiseAmplitude: number;
  readonly noiseAnchors: readonly number[];
  readonly plateauCenter: number;
  readonly plateauWidth: number;
  readonly plateauMagnitude: number;
  readonly secondPlateauCenter?: number;
  readonly secondPlateauWidth?: number;
  readonly secondPlateauMagnitude?: number;
  readonly secondWindCenter?: number;
  readonly secondWindMagnitude?: number;
}

const SCALE_FLOOR_MULTIPLIER: Readonly<Record<TrainingScale, number>> = {
  prototype: 1.24,
  product: 0.92,
  frontier: 0.74,
};

const POSTURE_FLOOR_MULTIPLIER: Readonly<Record<TrainingPosture, number>> = {
  conservative: 1.06,
  normal: 1,
  yolo: 0.9,
};

const POSTURE_NOISE_MULTIPLIER: Readonly<Record<TrainingPosture, number>> = {
  conservative: 0.62,
  normal: 1,
  yolo: 1.72,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundPerplexity(value: number): number {
  return Math.round(value * 100) / 100;
}

function isTrainingProject(project: ProjectState): project is TrainingProjectState {
  return project.payload.kind === "training";
}

function outcomeTick(project: TrainingProjectState): number {
  if (project.payload.completionReport !== undefined) {
    return project.payload.completionReport.completedAt;
  }
  return project.payload.failureChecks.at(-1)?.checkedAt ?? project.createdAt;
}

function smoothStep(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function gaussianBump(
  fraction: number,
  center: number,
  width: number,
  magnitude: number,
): number {
  const distance = (fraction - center) / Math.max(0.01, width);
  return magnitude * Math.exp(-(distance * distance));
}

function correlatedNoise(profile: CurveProfile, fraction: number): number {
  const position = fraction * (profile.noiseAnchors.length - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(profile.noiseAnchors.length - 1, leftIndex + 1);
  const localFraction = position - leftIndex;
  const left = profile.noiseAnchors[leftIndex] ?? 0;
  const right = profile.noiseAnchors[rightIndex] ?? left;
  return left + (right - left) * smoothStep(localFraction);
}

function curveProfile(
  project: TrainingProjectState,
  successfulPredecessors: number,
  oracle: RandomOracle,
): CurveProfile {
  const payload = project.payload;
  const key = (...segments: readonly string[]) =>
    randomKey("training-loss-curve-v1", payload.futureModelId, ...segments);
  const computeRatio =
    payload.committedTeraflops / Math.max(1, payload.eraReferenceTeraflops);
  const computeMultiplier = clamp(
    1 / (0.9 + 0.12 * Math.log2(1 + computeRatio)),
    0.68,
    1.18,
  );
  const quality = trainingQualitySignal(oracle, payload.futureModelId);
  const progressionMultiplier = 0.86 ** successfulPredecessors;
  const floorJitter = oracle.triangular(key("floor-jitter"), 0.88, 1, 1.14);
  const floor = clamp(
    34 *
      progressionMultiplier *
      SCALE_FLOOR_MULTIPLIER[payload.scale] *
      POSTURE_FLOOR_MULTIPLIER[payload.posture] *
      computeMultiplier *
      quality.perplexityFloorMultiplier *
      floorJitter,
    1.35,
    72,
  );
  const start = clamp(
    floor +
      oracle.triangular(key("start"), 68, 94, 132) +
      (payload.posture === "yolo" ? 10 : 0),
    72,
    205,
  );
  const decayRate = oracle.triangular(key("decay-rate"), 3.2, 4.8, 6.8);
  const decayShape = oracle.triangular(key("decay-shape"), 0.7, 0.96, 1.34);
  const noiseAmplitude =
    (2.2 + (start - floor) * 0.025) * POSTURE_NOISE_MULTIPLIER[payload.posture];
  const noiseAnchors = Array.from({ length: 15 }, (_, index) =>
    oracle.triangular(key("noise", String(index)), -1, 0, 1),
  );
  const plateauCenter = oracle.triangular(key("plateau", "center"), 0.22, 0.5, 0.78);
  const plateauWidth = oracle.triangular(key("plateau", "width"), 0.045, 0.08, 0.15);
  const plateauMagnitude =
    (start - floor) *
    oracle.triangular(
      key("plateau", "magnitude"),
      payload.posture === "conservative" ? 0.015 : 0.025,
      0.055,
      payload.posture === "yolo" ? 0.13 : 0.09,
    );
  const hasSecondPlateau = oracle.uniform(key("plateau", "second", "present")) < 0.42;
  const hasSecondWind = oracle.uniform(key("second-wind", "present")) < 0.36;
  return {
    start,
    floor,
    decayRate,
    decayShape,
    noiseAmplitude,
    noiseAnchors,
    plateauCenter,
    plateauWidth,
    plateauMagnitude,
    ...(hasSecondPlateau
      ? {
          secondPlateauCenter: oracle.triangular(
            key("plateau", "second", "center"),
            0.52,
            0.7,
            0.9,
          ),
          secondPlateauWidth: oracle.triangular(
            key("plateau", "second", "width"),
            0.025,
            0.055,
            0.1,
          ),
          secondPlateauMagnitude:
            (start - floor) *
            oracle.triangular(key("plateau", "second", "magnitude"), 0.012, 0.03, 0.07),
        }
      : {}),
    ...(hasSecondWind
      ? {
          secondWindCenter: oracle.triangular(
            key("second-wind", "center"),
            0.58,
            0.72,
            0.88,
          ),
          secondWindMagnitude:
            floor * oracle.triangular(key("second-wind", "magnitude"), 0.04, 0.1, 0.2),
        }
      : {}),
  };
}

function perplexityAt(
  project: TrainingProjectState,
  profile: CurveProfile,
  fraction: number,
): number {
  const clampedFraction = clamp(fraction, 0, 1);
  const decay =
    profile.floor +
    (profile.start - profile.floor) *
      Math.exp(-profile.decayRate * clampedFraction ** profile.decayShape);
  const plateau =
    gaussianBump(
      clampedFraction,
      profile.plateauCenter,
      profile.plateauWidth,
      profile.plateauMagnitude,
    ) +
    (profile.secondPlateauCenter === undefined ||
    profile.secondPlateauWidth === undefined ||
    profile.secondPlateauMagnitude === undefined
      ? 0
      : gaussianBump(
          clampedFraction,
          profile.secondPlateauCenter,
          profile.secondPlateauWidth,
          profile.secondPlateauMagnitude,
        ));
  const secondWind =
    profile.secondWindCenter === undefined || profile.secondWindMagnitude === undefined
      ? 0
      : profile.secondWindMagnitude *
        smoothStep(
          (clampedFraction - profile.secondWindCenter) /
            Math.max(0.01, 1 - profile.secondWindCenter),
        );
  const noise =
    correlatedNoise(profile, clampedFraction) *
    profile.noiseAmplitude *
    (0.3 + 0.7 * (1 - clampedFraction));
  const checkpointInstability = project.payload.failureChecks.reduce((sum, check) => {
    if (check.outcome === "none" || check.outcome === "total-loss") return sum;
    const magnitude =
      (profile.start - profile.floor) *
      (check.outcome === "capability-penalty" ? 0.075 : 0.045);
    return sum + gaussianBump(clampedFraction, check.checkpoint, 0.035, magnitude);
  }, 0);
  return clamp(
    decay + plateau + noise + checkpointInstability - secondWind,
    1.05,
    MAX_PLOTTED_PERPLEXITY,
  );
}

function observedBasisPoints(project: TrainingProjectState): number {
  if (project.status === "queued") return 0;
  if (project.status === "completed") return 10_000;
  if (project.status === "failed") {
    const terminal = project.payload.failureChecks.find(
      (check) => check.outcome === "total-loss",
    );
    return Math.round((terminal?.checkpoint ?? project.progress) * 10_000);
  }
  return Math.min(
    10_000,
    Math.round(
      (project.payload.weeksElapsed / Math.max(1, project.expectedDurationWeeks)) *
        10_000,
    ),
  );
}

function ordinaryPoints(
  project: TrainingProjectState,
  profile: CurveProfile,
  maximumBasisPoints: number,
): TrainingLossPointView[] {
  if (project.status === "queued") return [];
  const fractions = Array.from(
    { length: Math.floor(maximumBasisPoints / SAMPLE_STEP_BASIS_POINTS) + 1 },
    (_, index) => index * SAMPLE_STEP_BASIS_POINTS,
  );
  if (fractions.at(-1) !== maximumBasisPoints) fractions.push(maximumBasisPoints);
  return fractions.map((trainingFractionBasisPoints) => ({
    trainingFractionBasisPoints,
    validationPerplexity: roundPerplexity(
      perplexityAt(project, profile, trainingFractionBasisPoints / 10_000),
    ),
  }));
}

function pointsForProject(
  project: TrainingProjectState,
  profile: CurveProfile,
): {
  readonly points: readonly TrainingLossPointView[];
  readonly failedAtBasisPoints?: number;
} {
  const maximumBasisPoints = observedBasisPoints(project);
  const terminalFailure = project.payload.failureChecks.find(
    (check) => check.outcome === "total-loss",
  );
  if (project.status !== "failed" || terminalFailure === undefined) {
    return { points: ordinaryPoints(project, profile, maximumBasisPoints) };
  }
  const failedAtBasisPoints = Math.round(terminalFailure.checkpoint * 10_000);
  const spikeStart = Math.max(0, failedAtBasisPoints - 500);
  const normal = ordinaryPoints(project, profile, spikeStart).filter(
    (point) => point.trainingFractionBasisPoints < spikeStart,
  );
  const startValue = perplexityAt(project, profile, spikeStart / 10_000);
  const middleBasisPoints = Math.max(spikeStart, failedAtBasisPoints - 240);
  return {
    points: [
      ...normal,
      {
        trainingFractionBasisPoints: spikeStart,
        validationPerplexity: roundPerplexity(startValue * 1.08),
      },
      {
        trainingFractionBasisPoints: middleBasisPoints,
        validationPerplexity: roundPerplexity(
          clamp(
            Math.max(startValue * 2.6, profile.start * 1.08),
            1.05,
            MAX_PLOTTED_PERPLEXITY,
          ),
        ),
      },
      {
        trainingFractionBasisPoints: failedAtBasisPoints,
        validationPerplexity: roundPerplexity(
          clamp(
            Math.max(startValue * 8, profile.start * 1.75),
            1.05,
            MAX_PLOTTED_PERPLEXITY,
          ),
        ),
      },
    ],
    failedAtBasisPoints,
  };
}

/**
 * Player-safe, deterministic training telemetry. Curves use immutable training
 * inputs, recorded technical checks, a run-level quality signal shared with
 * selected capability outcomes, and independent keyed noise. Resolved model
 * capability and safety never enter the projection.
 */
export function projectTrainingLossTelemetry(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  oracle: RandomOracle = new RandomOracleV1(state.run.seed),
): TrainingLossTelemetryView {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const projects = lab.projects.projectIds
    .map((projectId) => state.projects[projectId])
    .filter(
      (project): project is TrainingProjectState =>
        project !== undefined &&
        isTrainingProject(project) &&
        project.status !== "cancelled",
    )
    .sort(
      (left, right) =>
        left.completionOrder - right.completionOrder ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  const open = projects.filter(
    (project) =>
      project.status === "queued" ||
      project.status === "active" ||
      project.status === "paused",
  );
  const successful = projects
    .filter((project) => project.status === "completed")
    .sort(
      (left, right) =>
        outcomeTick(right) - outcomeTick(left) ||
        right.completionOrder - left.completionOrder,
    );
  const latestResolved = projects
    .filter((project) => project.status === "completed" || project.status === "failed")
    .sort(
      (left, right) =>
        outcomeTick(right) - outcomeTick(left) ||
        right.completionOrder - left.completionOrder,
    )[0];
  const failedBaseline = latestResolved?.status === "failed" ? latestResolved : undefined;
  const successfulHistoryLimit =
    MAX_HISTORICAL_RUNS - (failedBaseline === undefined ? 0 : 1);
  const selectedSuccessful = successful.slice(0, successfulHistoryLimit);
  const selectedIds = new Set([
    ...open.map((project) => project.id),
    ...selectedSuccessful.map((project) => project.id),
    ...(failedBaseline === undefined ? [] : [failedBaseline.id]),
  ]);
  const selected = projects
    .filter((project) => selectedIds.has(project.id))
    .sort((left, right) => {
      const roleOrder = (project: TrainingProjectState): number =>
        project.status === "completed" ? 0 : project.status === "failed" ? 1 : 2;
      return (
        roleOrder(left) - roleOrder(right) || left.completionOrder - right.completionOrder
      );
    });
  const curves = selected.map((project): TrainingLossCurveView => {
    if (project.status === "cancelled") {
      throw new Error(`Cancelled training project ${project.id} entered telemetry`);
    }
    const attemptNumber =
      projects.findIndex((candidate) => candidate.id === project.id) + 1;
    const successfulPredecessors = projects.filter(
      (candidate) =>
        candidate.completionOrder < project.completionOrder &&
        candidate.status === "completed",
    ).length;
    const profile = curveProfile(project, successfulPredecessors, oracle);
    const { points, failedAtBasisPoints } = pointsForProject(project, profile);
    const latestPoint = points.at(-1);
    const completedModel = state.models[project.payload.futureModelId];
    const scaleLabel = content.training.scales[project.payload.scale].displayName;
    const postureLabel =
      project.payload.posture === "conservative"
        ? "Conservative"
        : project.payload.posture === "yolo"
          ? "YOLO"
          : "Normal";
    const role =
      project.status === "completed"
        ? "history"
        : project.status === "failed"
          ? "failed-baseline"
          : "current";
    return {
      projectId: project.id,
      label:
        completedModel?.displayName ??
        `Run ${String(attemptNumber)} · ${scaleLabel}${project.status === "failed" ? " (failed)" : ""}`,
      role,
      status: project.status,
      attemptNumber,
      scaleLabel,
      postureLabel,
      points,
      ...(latestPoint === undefined
        ? {}
        : { latestPerplexity: latestPoint.validationPerplexity }),
      ...(failedAtBasisPoints === undefined ? {} : { failedAtBasisPoints }),
    };
  });
  return {
    curves,
    omittedSuccessfulRuns: Math.max(0, successful.length - selectedSuccessful.length),
    maximumHistoricalRuns: MAX_HISTORICAL_RUNS,
  };
}
