import type { GameState } from "../model/state.ts";
import type { LabId } from "../model/ids.ts";

export const PROGRESSIVE_CAMPAIGN_FLAG = "campaign:progressive";
export const LAB_MATURITY_STAGE_FLAG = "campaign:lab-maturity-stage";

export const LAB_MATURITY_STAGES = [
  "garage",
  "cluster",
  "model",
  "startup",
  "foundation",
  "product",
  "funding",
  "lab",
  "institution",
  "safety",
  "autonomy",
  "frontier",
] as const;

export type LabMaturityStage = (typeof LAB_MATURITY_STAGES)[number];

export type ProgressiveOpeningCreditPurpose =
  | "evaluation"
  | "facility-construction"
  | "gpu-purchase"
  | "productisation"
  | "recruitment"
  | "training";

/**
 * Random complications stay dormant while the authored opening teaches the
 * core economy. Keep this predicate dependency-light: evaluation completion
 * and other low-level systems need it without importing the campaign engine.
 */
export function isProgressiveOpeningProtected(state: Readonly<GameState>): boolean {
  const flags = state.labs[state.run.playerLabId]?.flags;
  const storedStage = flags?.[LAB_MATURITY_STAGE_FLAG];
  return (
    flags?.[PROGRESSIVE_CAMPAIGN_FLAG] === true &&
    typeof storedStage === "string" &&
    LAB_MATURITY_STAGES.includes(storedStage as LabMaturityStage) &&
    storedStage !== "frontier"
  );
}

/**
 * Required chapter actions may draw on the lab's opening family-and-friends
 * credit line. Keep this narrow: prices remain real and cash may go negative,
 * but unrelated hardware, facilities, and staff still require cash on hand.
 */
export function isProgressiveOpeningCreditAvailable(
  state: Readonly<GameState>,
  labId: LabId,
  purpose: ProgressiveOpeningCreditPurpose,
  targetId?: string,
): boolean {
  if (labId !== state.run.playerLabId || !isProgressiveOpeningProtected(state)) {
    return false;
  }
  const stage = state.labs[labId]?.flags[LAB_MATURITY_STAGE_FLAG];
  switch (purpose) {
    case "gpu-purchase":
      return stage === "garage" || stage === "startup";
    case "training":
      return (
        stage === "cluster" ||
        stage === "foundation" ||
        stage === "institution" ||
        stage === "safety"
      );
    case "facility-construction":
      return (
        (stage === "startup" && targetId === "base:facility.server-rack") ||
        (stage === "institution" && targetId === "base:facility.press-office")
      );
    case "productisation":
      return stage === "product";
    case "recruitment":
      return stage === "lab";
    case "evaluation":
      return stage === "safety";
  }
}

/**
 * Before fundraising is introduced, required purchases may leave the opening
 * lab below $0 without starting the bankruptcy clock. The protection ends as
 * soon as the fundraising chapter begins; the debt itself remains real.
 */
export function isProgressiveOpeningInsolvencyProtected(
  state: Readonly<GameState>,
): boolean {
  if (!isProgressiveOpeningProtected(state)) return false;
  const stage = state.labs[state.run.playerLabId]?.flags[LAB_MATURITY_STAGE_FLAG];
  return (
    stage === "garage" ||
    stage === "cluster" ||
    stage === "model" ||
    stage === "startup" ||
    stage === "foundation" ||
    stage === "product"
  );
}
