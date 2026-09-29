import type {
  CompiledContent,
  EventDefinition,
  EventEffectDefinition,
} from "@neolab/content-schema";

import type { GameState } from "../model/state.ts";

/**
 * Event cash is authored at opening-era prices, when a lab holds tens of
 * millions. The multiplier is the current GPU generation's price over the first
 * generation's, so a $4M choice in the Kepler era costs about $51M in the
 * Ampere era and about $1.9B in the Kolmogorov era: still a real choice once a
 * lab holds billions. Events authored at their intended scale opt out with
 * `cashScaling: fixed`.
 */
export function eventCashMultiplier(
  state: Readonly<GameState>,
  content: CompiledContent,
  definition: Pick<EventDefinition, "cashScaling">,
): number {
  if (definition.cashScaling === "fixed") return 1;
  const generations = Object.values(content.gpuGenerations);
  const current = content.gpuGenerations[state.world.currentGpuGenerationId];
  const first = generations.reduce<(typeof generations)[number] | undefined>(
    (earliest, generation) =>
      earliest === undefined ||
      generation.unlockAtWorldFrontierCapability <
        earliest.unlockAtWorldFrontierCapability
        ? generation
        : earliest,
    undefined,
  );
  if (current === undefined || first === undefined) {
    throw new Error(`Unknown GPU generation ${state.world.currentGpuGenerationId}`);
  }
  return Math.max(
    1,
    current.gameCostMillionsPerThousand / first.gameCostMillionsPerThousand,
  );
}

/** Scales cash amounts, rounded to two significant figures so every figure reads round. */
export function scaleEventCash(
  effects: readonly EventEffectDefinition[],
  multiplier: number,
): EventEffectDefinition[] {
  return effects.map((effect) =>
    multiplier === 1 || effect.kind !== "add-resource" || effect.resource !== "cash"
      ? structuredClone(effect)
      : {
          ...structuredClone(effect),
          amount: Number((effect.amount * multiplier).toPrecision(2)),
        },
  );
}
