/**
 * The ground truth of which effect targets the simulation actually consumes,
 * established by the 2026-07-26 placebo audit. The no-placebo invariant test
 * holds every registry entry and every content-authored target against this
 * manifest, so a bonus whose copy claims a mechanic must either be wired here
 * or explicitly listed as a known placebo awaiting wiring or removal.
 *
 * When you wire a target, move it from PENDING_WIRE_TARGETS into
 * CONSUMED_TARGET_LITERALS (or a pattern). When you delete authored placebo
 * content, remove its entry from PENDING_REMOVAL. The end state is both
 * pending lists empty.
 */

/** Exact strings passed to resolveModifierValue/resolveResearcherStack in sim source. */
export const CONSUMED_TARGET_LITERALS: readonly string[] = [
  "action.tag.coalition.auraCost",
  "action.tag.lobbying.auraCost",
  "assignedProgramme.researchOutput",
  "assignedProgramme.weeklyVarianceWidth",
  "aura.firstPublicLaunchGain",
  "aura.openPaperModelOrDatasetGain",
  "aura.worldFirstCapabilityPaperGain",
  "lab.aura.standingIncome",
  "lab.compute.acquisitionCost",
  "lab.compute.ownedDeliveryDuration",
  "lab.compute.ownedPowerCost",
  "lab.compute.ownedPurchasePrice",
  "lab.compute.workloadThroughput",
  "lab.costs.fixed",
  "lab.evidence.displayedQuality",
  "lab.evals.quality",
  "lab.evaluation.cashCost",
  "lab.finance.executiveCostPerCycle",
  "lab.fundraising.duration",
  "lab.incident.hazard",
  "lab.fundraising.offerCash",
  "lab.market.acquisitionRate",
  "lab.market.demandCeiling",
  "lab.incident.hazard",
  "lab.organisation.boardPatienceTarget",
  "lab.organisation.internalCandourTarget",
  "lab.organisation.safetyCultureTarget",
  "lab.organisation.safetyCultureFloor",
  "lab.politics.governmentTrustFloor",
  "lab.product.durationWeeks",
  "lab.research.all.output",
  "lab.research.diffusionRate",
  "lab.research.domain.robotics-embodiment.output",
  "lab.research.domain.scientific-ai.output",
  "lab.research.capability.output",
  "lab.research.safety.output",
  "lab.product.firstProject.durationWeeks",
  "lab.revenue.all",
  "lab.training.technicalFailureHazard",
  "serving.computePerRequest",
  "pairedProgramme.researchOutput",
  "researcher.burnoutTarget",
  "researcher.departurePressure",
  "researcher.loyalty",
  "researcher.moraleTarget",
  "world.rival.progress",
];

/**
 * Targets routed to the resolver through authored content rather than sim
 * literals (safety programmes carry outputModifierTarget). Consumed, but the
 * source-presence check does not apply.
 */
export const CONTENT_ROUTED_TARGETS: readonly string[] = [
  "lab.research.alignment.output",
  "lab.research.interpretability.output",
  "lab.research.security.output",
];

/** Template families constructed at runtime and resolved. */
export const CONSUMED_TARGET_PATTERNS: readonly RegExp[] = [
  /^lab\.research\.program\.base:(?:domain|safety)\.[a-z0-9-]+\.(?:output|weeklyVarianceWidth)$/,
  /^(?:domain|safety)\.[a-z0-9-]+\.researchOutput$/,
  /^lab\.research\.domain\.[a-z0-9-]+\.output$/,
  /^lab\.research\.domain\.[a-z0-9-]+\.weeklyVarianceWidth$/,
  /^lab\.training\.frontier\.(?:duration|cashCost)$/,
  /^prosperity\.programme\.[a-z0-9-]+\.readiness$/,
];

/**
 * Both remediation lists emptied on 2026-07-26: every registered target is
 * consumed and every authored effect line points at a consumed target. Keep
 * them empty - a new entry here is a placebo shipping, which is a bug.
 */
export const PENDING_WIRE_TARGETS: readonly string[] = [];

/**
 * Deliberate non-mechanical unlock keys: papers set these as flags and the
 * paper card narrates them as research lineage ("Continues the lineage: X").
 * Nothing gates on them by design - they are story, honestly labelled.
 */
export const FLAVOUR_UNLOCK_PREFIXES: readonly string[] = ["research.family."];

export function isFlavourUnlockTarget(target: string): boolean {
  return FLAVOUR_UNLOCK_PREFIXES.some((prefix) => target.startsWith(prefix));
}
export const PENDING_REMOVAL_PREFIXES: readonly string[] = [];

export function isConsumedTarget(target: string): boolean {
  return (
    CONSUMED_TARGET_LITERALS.includes(target) ||
    CONTENT_ROUTED_TARGETS.includes(target) ||
    CONSUMED_TARGET_PATTERNS.some((pattern) => pattern.test(target))
  );
}

export function isKnownPlaceboTarget(target: string): boolean {
  return (
    PENDING_WIRE_TARGETS.includes(target) ||
    PENDING_REMOVAL_PREFIXES.some(
      (prefix) => target === prefix || target.startsWith(prefix),
    )
  );
}

/**
 * Lab flags whose key is written as a bare literal and read by nothing.
 *
 * `consumed-targets.ts` polices modifier targets, which is why the researcher
 * audit could be made systematic -- and it does NOT police flags, which is why
 * nine dead `funding:*` flags survived in a codebase that already had a
 * no-placebo invariant (docs/funding-conditions-audit.md §5.1).
 *
 * This is a record of something that happened, written alongside the effects
 * that actually happened: a lab shaping a technical standard. The mechanics
 * are the ratings applied next to it, so nothing is being promised to a player
 * and nothing is missing. It is declared here rather than deleted because it
 * is a plausible precondition for future political events.
 *
 * Adding an entry is a claim that the flag is deliberately inert. If it is
 * meant to DO something, wire a reader instead -- that is the whole distinction
 * this list exists to force.
 */
export const RECORD_ONLY_FLAGS: readonly string[] = [
  "politics:technical-standard-shaped",
];
