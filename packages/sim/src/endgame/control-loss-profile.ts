import { SAFEST_ENDING_MAX_DECEPTIVE_INTENT } from "../models/deception.ts";

export const STRATEGIC_DECEPTION_THRESHOLD = 70;
export const SEVERE_ALIGNMENT_FAILURE_THRESHOLD = 30;

export type ControlLossNarrativeProfile =
  "strategic-deception" | "overt-objective-conflict" | "operational-control-failure";

/**
 * Classifies the terminal account of a loss of control from fixed model truth.
 * This is privileged post-run information: active-run selectors must never call
 * it to reveal which explanation applies to a live artifact.
 */
export function controlLossNarrativeProfile(
  safety: Readonly<{
    readonly deceptiveCapability: number;
    readonly deceptiveIntent: number;
    readonly trueAlignment: number;
  }>,
): ControlLossNarrativeProfile {
  if (
    safety.deceptiveCapability >= STRATEGIC_DECEPTION_THRESHOLD &&
    safety.deceptiveIntent > SAFEST_ENDING_MAX_DECEPTIVE_INTENT
  ) {
    return "strategic-deception";
  }
  if (
    safety.trueAlignment <= SEVERE_ALIGNMENT_FAILURE_THRESHOLD ||
    safety.deceptiveIntent > SAFEST_ENDING_MAX_DECEPTIVE_INTENT
  ) {
    return "overt-objective-conflict";
  }
  return "operational-control-failure";
}
