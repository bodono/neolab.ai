/**
 * Closed effect-target registries (TDD section 11.2): the compiler rejects
 * unknown targets at build time and the simulation rejects them at runtime.
 * Both sides import THESE lists — there is exactly one source of truth.
 */

/** Ongoing modifier targets consumed by the modifier resolver. */
export const MODIFIER_TARGET_LIST = [
  "lab.research.all.output",
  "lab.research.diffusionRate",
  "lab.research.domain.robotics-embodiment.output",
  "lab.research.domain.scientific-ai.output",
  "lab.research.alignment.output",
  "lab.research.interpretability.output",
  "lab.research.security.output",
  "lab.market.acquisitionRate",
  "lab.market.demandCeiling",
  "lab.fundraising.duration",
  "lab.fundraising.offerCash",
  "lab.finance.executiveCostPerCycle",
  "lab.revenue.all",
  "lab.costs.fixed",
  "lab.compute.acquisitionCost",
  "lab.compute.ownedDeliveryDuration",
  "lab.compute.ownedPurchasePrice",
  "lab.compute.ownedPowerCost",
  "lab.compute.workloadThroughput",
  "lab.training.frontier.cashCost",
  "lab.product.durationWeeks",
  "lab.product.firstProject.durationWeeks",
  "world.rival.progress",
  "lab.incident.hazard",
  "lab.evidence.displayedQuality",
  "lab.evaluation.cashCost",
  "lab.organisation.boardPatienceTarget",
  "lab.organisation.internalCandourTarget",
  "lab.organisation.safetyCultureTarget",
  "lab.organisation.safetyCultureFloor",
  "lab.politics.governmentTrustFloor",
  "action.tag.coalition.auraCost",
  "action.tag.lobbying.auraCost",
  "assignedProgramme.researchOutput",
  "assignedProgramme.weeklyVarianceWidth",
  "aura.firstPublicLaunchGain",
  "aura.openPaperModelOrDatasetGain",
  "aura.worldFirstCapabilityPaperGain",
  "lab.research.capability.output",
  "lab.research.domain.reinforcement-agency.weeklyVarianceWidth",
  "lab.research.safety.output",
  "lab.training.technicalFailureHazard",
  "pairedProgramme.researchOutput",
  "researcher.burnoutTarget",
  "researcher.departurePressure",
  "researcher.loyalty",
  "researcher.moraleTarget",
  "serving.computePerRequest",
] as const;

/** `.starting` targets applied once during createNewGame's baseline pass. */
export const STARTING_TARGET_LIST = [
  "lab.culture.safety.starting",
  "lab.culture.internalCandour.starting",
  "lab.evals.quality.starting",
  "lab.board.patience.starting",
  "lab.politics.governmentAttention.starting",
  "lab.politics.governmentTrust.starting",
  "lab.aura.spendable.starting",
  // Standing paid every cycle for as long as the source exists, unlike the
  // ".starting" grant above, which fires once at game creation.
  "lab.aura.standingIncome",
  "lab.finance.cash.starting",
  "lab.compute.raw.starting",
  "lab.model.productQuality.starting",
  "lab.research.scientific.startingLevel",
  "lab.research.robotics.startingLevel",
  "lab.research.optimisation.startingLevel",
  "lab.research.alignment.startingLevel",
] as const;

/** One-time grants recorded as lab flags at run creation. */
export const GRANT_TARGET_LIST = [
  "lab.contracts.starterContract",
  "lab.paper.extraCandidatesRevealed",
  "lab.finance.cash.fullGameGrant",
] as const;

const ALL_TARGETS: ReadonlySet<string> = new Set([
  ...MODIFIER_TARGET_LIST,
  ...STARTING_TARGET_LIST,
  ...GRANT_TARGET_LIST,
]);

export function isKnownEffectTarget(target: string): boolean {
  return (
    ALL_TARGETS.has(target) ||
    /^lab\.research\.program\.base:(?:domain|safety)\.[a-z0-9-]+\.(?:output|weeklyVarianceWidth)$/.test(
      target,
    ) ||
    /^(?:domain|safety)\.[a-z0-9-]+\.researchOutput$/.test(target)
  );
}
