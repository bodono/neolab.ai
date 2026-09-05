export type { ResearcherBenefitRow } from "./researchers.ts";
export {
  quoteResearcherCommitment,
  researcherCommitmentTargets,
  startResearcherCommitment,
  type ResearcherCommitmentQuote,
  type ResearcherCommitmentStatus,
  type ResearcherCommitmentTargets,
} from "./commitments.ts";
export {
  assignResearcher,
  quoteResearcherAssignment,
  type ResearcherAssignmentInput,
  type ResearcherAssignmentQuote,
} from "./assignments.ts";
export {
  programmeModifierTarget,
  quoteResearcherBenefits,
  quoteResearcherContribution,
  researcherSkillForAssignment,
  syncAllResearcherAbilityModifiers,
  syncResearcherAbilityModifiers,
  type ResearcherContributionBreakdown,
} from "./researchers.ts";
export {
  createInitialTalentMarketState,
  generateTalentMarketCandidates,
  isResearcherAvailable,
  quoteRecruitment,
  recruitResearcher,
  reconcileResearcherHousing,
  refreshTalentMarket,
  TALENT_MARKET_REFRESH_WEEKS,
  type RecruitmentQuote,
  type RecruitmentResult,
} from "./talent-market.ts";
export {
  compactWindowWeeks,
  evaluateResearcherCompactCheck,
  evaluateResearcherCompacts,
  type CompactCheckResult,
} from "./compacts.ts";
export {
  addResearcherPromise,
  evaluateResearcherPromises,
  recordResearcherMemory,
  ZERO_RESEARCHER_MEMORY_EFFECT,
  type AddResearcherPromiseRequest,
} from "./promises.ts";
export {
  acceptUltimatumSettlement,
  advanceResearcherCrises,
  calculateDeparturePressure,
  calculateResearcherStateTargets,
  checkResearcherDeparture,
  departResearcher,
  dismissResearcher,
  hasAcceptedUltimatumProtection,
  ORGANISATION_DRIFT_RATE,
  ORGANISATION_TARGET_FLAGS,
  quoteDismissal,
  quoteRetentionOffer,
  quoteUltimatumResponse,
  respondToUltimatum,
  startPoachingAttempt,
  startingOrganisationTargetFlags,
  submitRetentionOffer,
  updateOrganisationRatings,
  updateResearcherStates,
  type DeparturePressureBreakdown,
  type DismissalQuote,
  type OrganisationRatingDrift,
  type ResearcherStateTargets,
  type RetentionOfferInput,
  type RetentionOfferPreview,
  type RetentionPromiseInput,
  type UltimatumResponse,
  type UltimatumResponsePreview,
} from "./people.ts";
