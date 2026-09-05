export {
  advanceRivalTalentMoves,
  createInitialRivalStrategy,
  createRivalDecisionContext,
  queueRivalWeeklyCommands,
  RIVAL_PERSONALITIES,
  RIVAL_PLAN_DEFINITIONS,
  updateRivalQuarterPlans,
  WeightedUtilityRivalPolicy,
  type RivalDecisionContext,
  type RivalPlanDefinition,
  type RivalPlanSelection,
  type RivalPolicy,
  type RivalPolicyCommand,
} from "./policy.ts";
export {
  projectRivalPublicSignals,
  recordRivalPublicSignal,
  type RecordRivalPublicSignalInput,
  type RivalPublicSignalView,
} from "./signals.ts";
export {
  advanceRivalResearch,
  calculateRivalProgramResearch,
  calculateRivalResearchStrength,
  type RivalProgramResearchOutput,
  type RivalResearchStrength,
} from "./research.ts";
export {
  advanceRivalAutonomy,
  chooseRivalAutonomyLevel,
  rivalAutonomyCapability,
  rivalAutonomyMultiplier,
} from "./autonomy.ts";
export {
  projectRivalRelationships,
  quoteRivalDiplomacy,
  resolveRivalDiplomacy,
  RIVAL_DIPLOMACY_DISABLED_REASON,
  RIVAL_DIPLOMACY_ENABLED,
  RIVAL_DIPLOMACY_RULES,
  type RivalDiplomacyQuote,
  type RivalRelationshipBand,
  type RivalRelationshipView,
} from "./diplomacy.ts";
export {
  advanceRivalIncidents,
  calculateRivalIncidentRisk,
  resolveRivalHighSeverityFailure,
  RIVAL_INCIDENT_CONSEQUENCES,
  type RivalIncidentRisk,
} from "./incidents.ts";
export {
  advanceRivalCandidateCountdowns,
  calculateRivalCandidateDuration,
  isRivalAgiCandidate,
  projectRivalCandidateCountdowns,
  rivalDeploymentCrisisStageAt,
  rivalDeploymentCrisisStageLabel,
  RIVAL_ASCENDANCE_ENDING_ID,
  RIVAL_CANDIDATE_BASE_WEEKS,
  type RivalCandidateCountdownView,
} from "./candidate-countdown.ts";

export {
  RIVAL_CONCURRENT_COMPONENT_BUILDS,
  advanceRivalCandidateProgramme,
  agiComponentBuildingFlag,
  agiComponentProgress,
} from "./candidate-programme-race.ts";
