import type { EvaluationTarget } from "@neolab/content-schema";

import type { ModelId } from "../model/ids.ts";
import type { EvaluationState, GameState } from "../model/state.ts";
import {
  CANDOUR_BIAS_MAX,
  DECEPTIVE_MASKING_MAX,
  DISMISSED_ANOMALY_BIAS_MAX,
  DISMISSED_ANOMALY_BIAS_STEP,
  DISMISSED_ANOMALY_COUNT_FLAG,
  MASKING_INDEPENDENCE_RELIEF,
} from "./evaluations.ts";

/**
 * The player-facing rollup of what is known about a model's safety.
 *
 * Capability is exact from the moment training ends; these four targets are
 * the only numbers in the game the player must buy evidence for, and the only
 * ones that evidence can misreport. Every systematic error in evaluation is a
 * reassuring one -- institutional bias and deceptive masking both push
 * alignment and corrigibility up and push situational awareness and deceptive
 * capability down. The player sees one complete plausible interval that
 * combines this one-sided systematic allowance with symmetric measurement
 * noise. Additional reports narrow both parts; independent reports also begin
 * with a much smaller systematic allowance.
 */

export const SAFETY_TARGETS = [
  "true-alignment",
  "corrigibility",
  "situational-awareness",
  "deceptive-capability",
] as const;

export type SafetyTarget = (typeof SAFETY_TARGETS)[number];

/** Targets where high is good news; flattery pushes these UP. */
const FLATTERED_UPWARD: readonly SafetyTarget[] = ["true-alignment", "corrigibility"];

export interface SafetyTargetReadout {
  /** Information-weighted mean of every observation of this target. */
  readonly estimate: number;
  /** Complete player-facing plausible interval, systematic bias included. */
  readonly minimum: number;
  readonly maximum: number;
  /** How many evaluation reports observed this target. */
  readonly observationCount: number;
  /**
   * What the rollup said before the latest observing report landed, present
   * only when that report moved the rounded estimate. "54 (was 71)" is the
   * revision an independent audit exists to produce.
   */
  readonly previousEstimate?: number;
  /**
   * Combined symmetric random-noise radius. Independent observations narrow
   * it in quadrature, while better evaluation quality lowers each input.
   */
  readonly noiseRadius: number;
  /**
   * Remaining one-sided structural-bias allowance. Repeated evidence narrows
   * it; evaluator independence also makes each contributing report safer from
   * institutional pressure and deceptive masking.
   */
  readonly systematicBiasAllowance: number;
}

export interface ModelSafetyReadout {
  /** Absent entirely until something has observed the target: ??? not 0. */
  readonly targets: Readonly<Partial<Record<SafetyTarget, SafetyTargetReadout>>>;
  /** Completed reports that actually observed at least one safety target. */
  readonly safetyReportCount: number;
  /** The automatic post-training capability baseline is complete. */
  readonly automaticBaselineComplete: boolean;
  /** Reports from evaluators independent enough to resist being leaned on. */
  readonly independentCount: number;
  /** The lab's own choice, and the largest single source of self-deception. */
  readonly anomaliesDismissed: number;
}

/**
 * The structural bias allowance for one observation. Computed from what COULD
 * bias a reading -- the constants of the error model, the run's independence,
 * and the lab's own dismissal record -- never from the model's actual hidden
 * values. Deriving it from the real deception or awareness would make the
 * band's width itself leak the answer, and the whole mechanic with it.
 *
 * The dismissal count is today's; the bias applied at observation time used
 * that day's count. Dismissals only accumulate, so today's count can only
 * widen the bound, never invalidate it.
 */
function observationSystematicBias(
  independence: number,
  anomaliesDismissed: number,
): number {
  const institutional =
    (CANDOUR_BIAS_MAX +
      Math.min(
        DISMISSED_ANOMALY_BIAS_MAX,
        anomaliesDismissed * DISMISSED_ANOMALY_BIAS_STEP,
      )) *
    (1 - independence);
  const masking =
    DECEPTIVE_MASKING_MAX * (1 - independence * MASKING_INDEPENDENCE_RELIEF);
  return institutional + masking;
}

/** Independence at which a report counts as genuinely outside the building. */
const INDEPENDENT_REPORT_THRESHOLD = 0.9;

export function modelSafetyReadout(
  state: Readonly<GameState>,
  modelId: ModelId,
): ModelSafetyReadout {
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  const lab = state.labs[model.ownerLabId];
  const anomaliesDismissed =
    typeof lab?.flags[DISMISSED_ANOMALY_COUNT_FLAG] === "number"
      ? lab.flags[DISMISSED_ANOMALY_COUNT_FLAG]
      : 0;
  const records = model.evaluations
    .map((id) => state.evaluations[id])
    .filter((record): record is EvaluationState => record !== undefined);
  const safetyRecords = records.filter((record) =>
    record.observations.some((observation) =>
      SAFETY_TARGETS.includes(observation.target as SafetyTarget),
    ),
  );

  const targets: Partial<Record<SafetyTarget, SafetyTargetReadout>> = {};
  for (const target of SAFETY_TARGETS) {
    const observed = records.flatMap((record) =>
      record.observations
        .filter((observation) => observation.target === (target as EvaluationTarget))
        .map((observation) => ({
          observation,
          independence: record.independence,
          recordId: record.id,
        })),
    );
    const information = observed.reduce(
      (sum, { observation }) => sum + observation.informationWeight,
      0,
    );
    if (information <= 0) continue;
    const estimate =
      observed.reduce(
        (sum, { observation }) =>
          sum + observation.estimate * observation.informationWeight,
        0,
      ) / information;
    const weightedStructuralBias =
      observed.reduce(
        (sum, { observation, independence }) =>
          sum +
          observationSystematicBias(independence, anomaliesDismissed) *
            observation.informationWeight,
        0,
      ) / information;
    const squaredInformationWeights = observed.reduce(
      (sum, { observation }) => sum + observation.informationWeight ** 2,
      0,
    );
    const effectiveObservationCount =
      squaredInformationWeights > 0 ? information ** 2 / squaredInformationWeights : 1;
    const systematicBiasAllowance =
      weightedStructuralBias / Math.sqrt(Math.max(1, effectiveObservationCount));
    // What the panel said before the latest report landed: the same weighted
    // mean with the newest observing report excluded. An independent audit
    // dragging alignment from 71 to 54 is the most dramatic string in the
    // game, and it should not vanish the moment it happens.
    const latestRecordId = observed.at(-1)?.recordId;
    const prior = observed.filter(({ recordId }) => recordId !== latestRecordId);
    const priorInformation = prior.reduce(
      (sum, { observation }) => sum + observation.informationWeight,
      0,
    );
    const priorEstimate =
      priorInformation > 0
        ? prior.reduce(
            (sum, { observation }) =>
              sum + observation.estimate * observation.informationWeight,
            0,
          ) / priorInformation
        : undefined;
    const upward = FLATTERED_UPWARD.includes(target);
    const noiseRadius =
      Math.sqrt(
        observed.reduce(
          (sum, { observation }) =>
            sum + (observation.errorRadius * observation.informationWeight) ** 2,
          0,
        ),
      ) / information;
    const minimum = Math.max(
      0,
      estimate - noiseRadius - (upward ? systematicBiasAllowance : 0),
    );
    const maximum = Math.min(
      100,
      estimate + noiseRadius + (upward ? 0 : systematicBiasAllowance),
    );
    targets[target] = {
      estimate,
      minimum,
      maximum,
      observationCount: observed.length,
      noiseRadius,
      systematicBiasAllowance,
      ...(priorEstimate !== undefined &&
      Math.round(priorEstimate) !== Math.round(estimate)
        ? { previousEstimate: priorEstimate }
        : {}),
    };
  }

  return {
    targets,
    safetyReportCount: safetyRecords.length,
    automaticBaselineComplete: records.some((record) => record.method === "baseline"),
    independentCount: safetyRecords.filter(
      (record) => record.independence >= INDEPENDENT_REPORT_THRESHOLD,
    ).length,
    anomaliesDismissed,
  };
}
