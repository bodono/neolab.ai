/**
 * Closed modifier-target registry (TDD section 11.2). The compiler and the
 * runtime both reject unknown targets; adding a target means adding it here
 * with the rule site that consumes it.
 */
export const MODIFIER_TARGETS = new Set([
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
]);

export function isModifierTarget(target: string): boolean {
  return MODIFIER_TARGETS.has(target);
}
