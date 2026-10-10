import type { CapabilityAttribute } from "@neolab/content-schema";

import type {
  CapabilityEstimateState,
  CapabilityVector,
  GameState,
} from "../model/state.ts";
import { rating } from "../model/units.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";

export const CAPABILITY_ATTRIBUTES: readonly CapabilityAttribute[] = [
  "language",
  "reasoning",
  "agency",
  "toolUse",
  "multimodality",
  "scientificAbility",
  "embodiment",
];

export const AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY = 88;
export const AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE = 80;
export const SUPERINTELLIGENCE_PROBABILITY_AT_QUALIFICATION = 0.1;

/**
 * Exact scores decide capability gates. Truncate player-facing readings to a
 * tenth so a value such as 87.99 is never rounded up to a gate it has not met.
 */
export function capabilityScoreForDisplay(value: number): number {
  return Math.floor(value * 10) / 10;
}

export function calculateFrontierCapability(vector: CapabilityVector): number {
  return (
    0.2 * vector.language +
    0.25 * vector.reasoning +
    0.2 * vector.agency +
    0.15 * vector.toolUse +
    0.08 * vector.multimodality +
    0.09 * vector.scientificAbility +
    0.03 * vector.embodiment
  );
}

/**
 * The common capability gate for player and rival AGI candidates.
 *
 * Frontier Capability rewards overall strength, while the per-attribute floor
 * prevents a lopsided specialist from qualifying with a severe weakness hidden
 * inside the weighted average.
 */
export function satisfiesAgiCandidateCapabilityGate(
  vector: Readonly<CapabilityVector>,
  frontierCapability = calculateFrontierCapability(vector),
): boolean {
  return (
    frontierCapability >= AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY &&
    CAPABILITY_ATTRIBUTES.every(
      (attribute) => vector[attribute] >= AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
    )
  );
}

/**
 * Player-known prior for the hidden, one-time lineage draw. The draw itself is
 * fixed elsewhere from canonical true capability and is never exposed live.
 */
export function superintelligenceProbability(
  frontierCapability: number,
  floor = SUPERINTELLIGENCE_PROBABILITY_AT_QUALIFICATION,
): number {
  if (frontierCapability < AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY) return 0;
  const progress = Math.min(
    1,
    (frontierCapability - AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY) /
      (100 - AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY),
  );
  return floor + (1 - floor) * progress ** 2;
}

/**
 * The player's difficulty sets the chance at the gate (FC 88) that a first
 * candidate is genuine, stamped on the player lab at the start of a run.
 * Rivals, and saves from before the stamp, use the standard 10%.
 */
export const GENUINE_CANDIDATE_FLOOR_FLAG = "difficulty:genuine-candidate-floor";

export function genuineCandidateFloor(
  state: Readonly<GameState>,
  labId: string | undefined,
): number {
  const value =
    labId === undefined
      ? undefined
      : state.labs[labId as keyof typeof state.labs]?.flags[GENUINE_CANDIDATE_FLOOR_FLAG];
  return typeof value === "number"
    ? value
    : SUPERINTELLIGENCE_PROBABILITY_AT_QUALIFICATION;
}

function clampRating(value: number) {
  return rating(Math.min(100, Math.max(0, value)));
}

export function createCapabilityEstimate(
  truth: CapabilityVector,
  options: {
    readonly confidence: CapabilityEstimateState["confidence"];
    readonly evidenceFlags?: readonly string[];
    readonly oracle?: RandomOracle;
    readonly modelId?: string;
    readonly errorRadius?: number;
  },
): CapabilityEstimateState {
  const errorRadius = options.errorRadius ?? 0;
  const values = Object.fromEntries(
    CAPABILITY_ATTRIBUTES.map((attribute) => {
      const error =
        options.oracle === undefined || options.modelId === undefined || errorRadius <= 0
          ? 0
          : options.oracle.triangular(
              randomKey(
                "model-evidence",
                options.modelId,
                "baseline-capability",
                attribute,
              ),
              -errorRadius,
              0,
              errorRadius,
            );
      return [attribute, clampRating(truth[attribute] + error)];
    }),
  ) as unknown as CapabilityVector;
  return {
    values,
    frontierCapability: clampRating(
      Math.round(calculateFrontierCapability(values) * 1000) / 1000,
    ),
    confidence: options.confidence,
    evidenceFlags: [...(options.evidenceFlags ?? [])],
  };
}
