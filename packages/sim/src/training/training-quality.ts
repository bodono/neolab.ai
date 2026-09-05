import type { CapabilityAttribute } from "@neolab/content-schema";

import type { ModelId } from "../model/ids.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";

/**
 * A run-level latent shared by optimisation telemetry and capability outcomes.
 * It is intentionally narrow: validation perplexity is most informative about
 * language modelling, somewhat informative about reasoning, and says nothing
 * direct about agency, tool use, embodiment, or model safety.
 */
export interface TrainingQualitySignal {
  /** Centred triangular draw in the inclusive range -1..1. */
  readonly score: number;
  /** A better-quality run settles at a lower validation-perplexity floor. */
  readonly perplexityFloorMultiplier: number;
}

const CAPABILITY_ADJUSTMENT: Readonly<Partial<Record<CapabilityAttribute, number>>> = {
  language: 4,
  reasoning: 2.5,
};

const PERPLEXITY_LOG_SENSITIVITY = 0.2;

export function trainingQualitySignal(
  oracle: RandomOracle,
  modelId: ModelId,
): TrainingQualitySignal {
  const score = oracle.triangular(randomKey("training-quality-v1", modelId), -1, 0, 1);
  return {
    score,
    perplexityFloorMultiplier: Math.exp(-PERPLEXITY_LOG_SENSITIVITY * score),
  };
}

export function trainingQualityCapabilityAdjustment(
  score: number,
  attribute: CapabilityAttribute,
): number {
  return score * (CAPABILITY_ADJUSTMENT[attribute] ?? 0);
}
