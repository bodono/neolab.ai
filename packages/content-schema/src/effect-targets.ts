/**
 * Closed effect-target registries (TDD section 11.2): the compiler rejects
 * unknown targets at build time and the simulation rejects them at runtime.
 * Both sides import THESE lists — there is exactly one source of truth.
 */

/** Ongoing modifier targets consumed by the modifier resolver. */
export const MODIFIER_TARGET_LIST = [
  // Research output
  "lab.research.all.output",
  "lab.research.alignment.output",
  "lab.research.interpretability.output",
  "lab.research.security.output",
  "lab.research.capabilityInfrastructure",
  "lab.research.optimisation.recipeChoices",
  "lab.paper.eligibleFamilies",
  // Market
  "lab.market.acquisitionRate",
  "lab.market.publicAcquisitionRate",
  "lab.market.guardedEnterpriseSatisfaction",
  "lab.market.startingDemand",
  // Finance
  "lab.fundraising.duration",
  "lab.fundraising.offerCash",
  "lab.finance.executiveCostPerCycle",
  "lab.revenue.all",
  "lab.costs.fixed",
  // Compute and construction
  "lab.construction.duration",
  "lab.compute.ownedDeliveryDuration",
  "lab.compute.ownedPurchasePrice",
  "lab.compute.ownedPowerCost",
  "lab.compute.workloadThroughput",
  // Training and product
  "lab.training.frontier.duration",
  "lab.training.frontier.cashCost",
  "lab.product.firstProject.durationWeeks",
  "facility.roboticsLabI.cashCost",
  // World and difficulty
  "world.rival.progress",
  "lab.incident.hazard",
  "lab.evidence.displayedQuality",
] as const;

/** `.starting` targets applied once during createNewGame's baseline pass. */
export const STARTING_TARGET_LIST = [
  "lab.culture.researchFreedom.starting",
  "lab.culture.safety.starting",
  "lab.culture.internalCandour.starting",
  "lab.evals.quality.starting",
  "lab.engineering.quality.starting",
  "lab.board.patience.starting",
  "lab.politics.governmentAttention.starting",
  "lab.politics.governmentTrust.starting",
  "lab.aura.spendable.starting",
  "lab.finance.cash.starting",
  "lab.compute.raw.starting",
  "lab.model.productQuality.starting",
  "lab.research.scientific.startingLevel",
  "lab.research.robotics.startingLevel",
  "lab.research.optimisation.startingLevel",
] as const;

/** One-time grants recorded as lab flags at run creation. */
export const GRANT_TARGET_LIST = [
  "lab.contracts.starterContract",
  "lab.paper.extraCandidatesRevealed",
] as const;

const ALL_TARGETS: ReadonlySet<string> = new Set([
  ...MODIFIER_TARGET_LIST,
  ...STARTING_TARGET_LIST,
  ...GRANT_TARGET_LIST,
]);

export function isKnownEffectTarget(target: string): boolean {
  return ALL_TARGETS.has(target);
}
