import type { AutoPauseReason } from "@neolab/sim/public";

export type AutoPauseDestination =
  | "event"
  | "fundraising"
  | "compute"
  | "research"
  | "models"
  | "evaluations"
  | "people"
  | "world"
  | "crisis"
  | "resume";

export interface AutoPauseAction {
  readonly reason: AutoPauseReason;
  readonly label: string;
  readonly destination: AutoPauseDestination;
}

/**
 * Once an investor roadshow is genuinely underway, the player has already
 * acted on an insolvency warning. The clock still runs and bankruptcy remains
 * possible; only the repetitive auto-pause is hidden until the attempt ends.
 */
export function visibleAutoPauseReasons(
  reasons: readonly AutoPauseReason[],
  fundraisingCampaignStatus?: string,
): readonly AutoPauseReason[] {
  return fundraisingCampaignStatus === "active"
    ? reasons.filter((reason) => reason !== "bankruptcy-warning")
    : reasons;
}

const ACTIONS: Readonly<Record<AutoPauseReason, AutoPauseAction>> = {
  "critical-event": {
    reason: "critical-event",
    label: "Resolve critical decision",
    destination: "event",
  },
  "urgent-event": {
    reason: "urgent-event",
    label: "Review urgent decision",
    destination: "event",
  },
  "funding-offers": {
    reason: "funding-offers",
    label: "Review funding offers",
    destination: "fundraising",
  },
  "training-complete": {
    reason: "training-complete",
    label: "Inspect training outcome",
    destination: "models",
  },
  "training-failed": {
    reason: "training-failed",
    label: "Inspect failed training run",
    destination: "models",
  },
  "anomaly-detected": {
    reason: "anomaly-detected",
    label: "Review anomaly dossier",
    destination: "evaluations",
  },
  "anomaly-investigation-complete": {
    reason: "anomaly-investigation-complete",
    label: "Review investigation result",
    destination: "evaluations",
  },
  "agi-candidate": {
    reason: "agi-candidate",
    label: "Review AGI candidate",
    destination: "crisis",
  },
  "candidate-hazard": {
    reason: "candidate-hazard",
    label: "Review candidate containment alert",
    destination: "models",
  },
  "paper-discovered": {
    reason: "paper-discovered",
    label: "Open discovery dossier",
    destination: "research",
  },
  "world-first-paper": {
    reason: "world-first-paper",
    label: "Review discovery",
    destination: "research",
  },
  "research-direction": {
    reason: "research-direction",
    label: "Choose research direction",
    destination: "research",
  },
  "resignation-ultimatum": {
    reason: "resignation-ultimatum",
    label: "Review researcher situation",
    destination: "people",
  },
  "bankruptcy-warning": {
    reason: "bankruptcy-warning",
    label: "Review rescue financing",
    destination: "fundraising",
  },
  "government-intervention": {
    reason: "government-intervention",
    label: "Continue to formal decision",
    destination: "resume",
  },
  "race-emergency": {
    reason: "race-emergency",
    label: "Review Race Emergency",
    destination: "world",
  },
  "rival-final-year": {
    reason: "rival-final-year",
    label: "Review imminent rival deployment",
    destination: "world",
  },
  "rival-crisis-stage": {
    reason: "rival-crisis-stage",
    label: "Review rival crisis stage",
    destination: "world",
  },
  "crisis-stage": {
    reason: "crisis-stage",
    label: "Review Deployment Crisis",
    destination: "crisis",
  },
  "world-phase": {
    reason: "world-phase",
    label: "Review the new phase",
    destination: "research",
  },
  "gpu-generation": {
    reason: "gpu-generation",
    label: "Review new GPU generation",
    destination: "compute",
  },
  manual: {
    reason: "manual",
    label: "Resume simulation",
    destination: "resume",
  },
};

const PRIORITY: readonly AutoPauseReason[] = [
  "critical-event",
  "urgent-event",
  "anomaly-detected",
  "anomaly-investigation-complete",
  "agi-candidate",
  "candidate-hazard",
  "crisis-stage",
  "bankruptcy-warning",
  "funding-offers",
  "resignation-ultimatum",
  "paper-discovered",
  "world-first-paper",
  "research-direction",
  "world-phase",
  "gpu-generation",
  "government-intervention",
  "race-emergency",
  "rival-final-year",
  "rival-crisis-stage",
  "training-failed",
  "training-complete",
  "manual",
];

export function resolveAutoPauseAction(
  reasons: readonly string[],
): AutoPauseAction | undefined {
  const reason = PRIORITY.find((candidate) => reasons.includes(candidate));
  return reason === undefined ? undefined : ACTIONS[reason];
}
