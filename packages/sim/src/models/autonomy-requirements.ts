import type { AutonomyAccessLevel } from "../model/state.ts";

export interface StandingAutonomyRequirement {
  /** Visible measured-frontier-capability threshold for unlocking the rung. */
  readonly frontierCapability: number;
}

/**
 * One access ladder for both ordinary play and the Deployment Crisis.
 * Entering the crisis changes the decision surface, not the safety bar.
 *
 * Capability is the ONLY requirement. Safety-programme minimums used to gate
 * rungs 3-5 (Interpretability & Evals, Security & Containment), but a licence
 * requirement is exactly the built-in caution this game refuses to force:
 * whether to hand root to an uninspected model is the player's call, and the
 * consequences -- exposure feeding incident hazard, situational awareness
 * climbing while the model does your science, deception compounding under
 * poor alignment and then masking your own safety readings -- are the
 * mechanic. The programmes keep their real value (evaluation quality,
 * operational defence); they just stop being a permission slip.
 */
export const STANDING_AUTONOMY_REQUIREMENTS: Readonly<
  Record<AutonomyAccessLevel, StandingAutonomyRequirement>
> = {
  0: { frontierCapability: 0 },
  1: { frontierCapability: 20 },
  2: { frontierCapability: 30 },
  3: { frontierCapability: 45 },
  4: { frontierCapability: 60 },
  5: { frontierCapability: 75 },
};
