import type {
  ResearcherAssignmentInput,
  ResearcherAssignmentQuote,
} from "../researchers/assignments.ts";
import type {
  ContentId,
  PublicationPolicy,
  PublicPriceTier,
  TrainingPosture,
  DeploymentPolicy,
  ProductisationMode,
} from "@neolab/content-schema";

import type { GpuPurchaseQuote, GpuSaleQuote } from "../compute/gpu-market.ts";
import type { GpuAllocationPlan } from "../compute/gpu-portfolio.ts";
import type {
  AnomalyId,
  CoalitionId,
  CommandId,
  EventInstanceId,
  FundingOfferId,
  LabId,
  ModelId,
  ResearcherId,
} from "../model/ids.ts";
import type { ConstructionQuote } from "../facilities/facilities.ts";
import type {
  FundingCampaignType,
  CoalitionAssetKind,
  CoalitionProjectType,
  AgiComponentType,
  GovernmentProgrammeId,
  GpuAllocationState,
  LobbyingApproach,
  LobbyingObjective,
  RivalDiplomacyAction,
  AutonomyAccessLevel,
  DeploymentModeId,
  ProsperityProgrammeId,
  RolloutDecisionOptionId,
  ContainmentFailureActionId,
  CandidateArchiveDisposition,
  RetirementProcedureId,
} from "../model/state.ts";
import type { Tick } from "../model/units.ts";
import type { TrainingQuote } from "../training/training.ts";
import type { EvaluationQuote } from "../evaluations/evaluations.ts";
import type { EventOptionPreview } from "../events/event-engine.ts";
import type { ProductisationQuote } from "../productisation/productisation.ts";
import type {
  FundingOfferQuote,
  FundraisingCampaignQuote,
} from "../fundraising/fundraising.ts";
import type { RecruitmentQuote } from "../researchers/talent-market.ts";
import type { ResearcherCommitmentQuote } from "../researchers/commitments.ts";
import type {
  DismissalQuote,
  RetentionOfferInput,
  RetentionOfferPreview,
  UltimatumResponse,
  UltimatumResponsePreview,
} from "../researchers/people.ts";
import type { LobbyingProjectQuote } from "../politics/politics.ts";
import type { RivalDiplomacyQuote } from "../rivals/diplomacy.ts";
import type {
  CoalitionEligibility,
  CoalitionProjectQuote,
  CoalitionProposalQuote,
} from "../coalition/coalition.ts";
import type { CandidateAccessQuote } from "../endgame/access.ts";
import type { CandidateIncidentReviewQuote } from "../endgame/candidate-lifecycle.ts";
import type {
  CandidateSafetyResponseQuote,
  CapabilityProofProjectQuote,
} from "../endgame/crisis-stages.ts";
import type {
  CapabilityChallengeId,
  CapabilityVerifierId,
} from "../endgame/capability-proof.ts";
import type { CandidateSafetyResponseId } from "../endgame/candidate-dossier.ts";
import type { DeploymentModeQuote } from "../endgame/resolution.ts";
import type { DeploymentTransmissionQuote } from "../endgame/deployment-command.ts";

/**
 * Player intent enters the simulation only through commands (TDD section 8.1).
 * The union grows with each stage; every variant carries `CommandMeta` so
 * stale confirmations are rejected (`expectedTick`).
 */
export interface CommandMeta {
  readonly commandId: CommandId;
  readonly expectedTick: Tick;
  readonly issuedBy: "player" | "rival" | "tutorial" | "debug";
}

export interface SetGpuAllocationCommand {
  readonly kind: "set-gpu-allocation";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly allocation: GpuAllocationState;
}

export interface BuyGpusCommand {
  readonly kind: "buy-gpus";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly generationId: ContentId;
  /** Number of 1,000-GPU blocks to order. */
  readonly thousandUnits: number;
}

export interface SellGpusCommand {
  readonly kind: "sell-gpus";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly generationId: ContentId;
  /** Number of 1,000-GPU blocks to sell at the flat resale fraction. */
  readonly thousandUnits: number;
}

export interface SetPublicPriceCommand {
  readonly kind: "set-public-price";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly priceTier: PublicPriceTier;
}

export interface StartFacilityConstructionCommand {
  readonly kind: "start-facility-construction";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly definitionId: ContentId;
}

export interface StartFundraisingCampaignCommand {
  readonly kind: "start-fundraising-campaign";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly campaign: FundingCampaignType;
}

export interface AcceptFundingOfferCommand {
  readonly kind: "accept-funding-offer";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly offerId: FundingOfferId;
}

export interface StartAgiComponentCommand {
  readonly kind: "start-agi-component";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly componentType: AgiComponentType;
}

export interface JoinGovernmentProgrammeCommand {
  readonly kind: "join-government-programme";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly programmeId: GovernmentProgrammeId;
}

export interface LeaveGovernmentProgrammeCommand {
  readonly kind: "leave-government-programme";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly programmeId: GovernmentProgrammeId;
}

export interface StartLobbyingProjectCommand {
  readonly kind: "start-lobbying-project";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly objective: LobbyingObjective;
  readonly approach: LobbyingApproach;
}

export interface ConductRivalDiplomacyCommand {
  readonly kind: "conduct-rival-diplomacy";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly rivalLabId: LabId;
  readonly action: RivalDiplomacyAction;
}

export interface ProposeCoalitionCommand {
  readonly kind: "propose-coalition";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly rivalLabIds: readonly LabId[];
  readonly governmentMember: boolean;
  readonly independentBodyMember: boolean;
}

export interface StartCoalitionProjectCommand {
  readonly kind: "start-coalition-project";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly coalitionId: CoalitionId;
  readonly projectType: CoalitionProjectType;
  readonly contributorLabId?: LabId;
  readonly assetKind?: CoalitionAssetKind;
}

export interface RatifyCoalitionCommand {
  readonly kind: "ratify-coalition";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly coalitionId: CoalitionId;
}

export interface ChooseGenericAdvanceCommand {
  readonly kind: "choose-generic-advance";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly programId: ContentId;
  readonly threshold: number;
  readonly optionId: ContentId;
}

export interface ChoosePublicationPolicyCommand {
  readonly kind: "choose-publication-policy";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly paperId: ContentId;
  readonly policy: PublicationPolicy;
}

export interface StartTrainingRunCommand {
  readonly kind: "start-training-run";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly parentModelId?: ModelId;
  readonly posture: TrainingPosture;
  /**
   * FLOPS commitment in TFLOP/s. Omitted means a high-end prototype for the
   * current era. Together with durationWeeks this is the whole size decision:
   * the run's name (Prototype / Product / Frontier) is derived from what the
   * two multiply to, not chosen up front.
   */
  readonly committedTeraflops?: number;
  /** Weeks to run. Omitted means TRAINING_DEFAULT_WEEKS. */
  readonly durationWeeks?: number;
  readonly technicalLeadId?: ResearcherId;
}

export interface StartEvaluationCommand {
  readonly kind: "start-evaluation";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly definitionId: ContentId;
  /**
   * Chosen pacing, one of the quote's offered options. The FLOP bill is
   * invariant, so this trades usable compute rate against calendar time,
   * never total compute or evidence quality.
   */
  readonly durationWeeks?: number;
}

export interface DismissAnomalyCommand {
  readonly kind: "dismiss-anomaly";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly anomalyId: AnomalyId;
}

export interface InvestigateAnomalyCommand {
  readonly kind: "investigate-anomaly";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly anomalyId: AnomalyId;
}

export interface RespondToDecisionEventCommand {
  readonly kind: "respond-to-decision-event";
  readonly meta: CommandMeta;
  readonly instanceId: EventInstanceId;
  readonly optionId: string;
}

export interface StartProductisationCommand {
  readonly kind: "start-productisation";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly mode: ProductisationMode;
}

export interface SetModelDeploymentPolicyCommand {
  readonly kind: "set-model-deployment-policy";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly policy: DeploymentPolicy;
}

export interface RecruitResearcherCommand {
  readonly kind: "recruit-researcher";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly researcherId: ResearcherId;
}

export interface StartResearcherCommitmentCommand {
  readonly kind: "start-researcher-commitment";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly researcherId: ResearcherId;
}

export interface AssignResearcherCommand {
  readonly kind: "assign-researcher";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly researcherId: ResearcherId;
  readonly assignment: ResearcherAssignmentInput;
}

export interface SubmitRetentionOfferCommand {
  readonly kind: "submit-retention-offer";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly researcherId: ResearcherId;
  readonly offer: RetentionOfferInput;
}

export interface ResolveResearcherUltimatumCommand {
  readonly kind: "resolve-researcher-ultimatum";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly researcherId: ResearcherId;
  readonly response: UltimatumResponse;
}

export interface DismissResearcherCommand {
  readonly kind: "dismiss-researcher";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly researcherId: ResearcherId;
  readonly confirmed: true;
}

/** Persist that the player deliberately opened and inspected the rival race. */
export interface ReviewRivalRaceCommand {
  readonly kind: "review-rival-race";
  readonly meta: CommandMeta;
  readonly labId: LabId;
}

export interface SetModelAutonomyCommand {
  readonly kind: "set-model-autonomy";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly level: AutonomyAccessLevel;
  readonly confirmationText?: string;
}

export interface SetCandidateAccessCommand {
  readonly kind: "set-candidate-access";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly level: AutonomyAccessLevel;
  readonly confirmationText?: string;
}

export interface IsolateCandidateArtifactCommand {
  readonly kind: "isolate-candidate-artifact";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
}

export interface ResolveCandidateIncidentCommand {
  readonly kind: "resolve-candidate-incident";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
}

export interface NominateCandidateCommand {
  readonly kind: "nominate-candidate";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
  /** Explicitly surrender any queued, active, or paused ordinary training. */
  readonly abandonInFlightTraining?: boolean;
}

export interface CommitCapabilityProofCommand {
  readonly kind: "commit-capability-proof";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly challengeId: CapabilityChallengeId;
  readonly verifierId?: CapabilityVerifierId;
}

export interface CommitCandidateSafetyResponseCommand {
  readonly kind: "commit-candidate-safety-response";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly responseId: CandidateSafetyResponseId;
}

export interface ResolvePressureCollisionCommand {
  readonly kind: "resolve-pressure-collision";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly optionId: "delay" | "comply" | "push-ahead";
}

export interface EnterFinalReviewCommand {
  readonly kind: "enter-final-review";
  readonly meta: CommandMeta;
  readonly labId: LabId;
}

export interface ChooseDeploymentModeCommand {
  readonly kind: "choose-deployment-mode";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modeId: DeploymentModeId;
  /** Optional for save/replay compatibility; omitted commands select the strongest programme. */
  readonly prosperityProgrammeId?: ProsperityProgrammeId;
  readonly confirmationText?: string;
}

export interface ResolveRolloutDecisionCommand {
  readonly kind: "resolve-rollout-decision";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly optionId: RolloutDecisionOptionId;
}

export interface ResolveContainmentFailureCommand {
  readonly kind: "resolve-containment-failure";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly actionId: ContainmentFailureActionId;
}

export interface ConfigureCandidateRetirementCommand {
  readonly kind: "configure-candidate-retirement";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly procedureId: RetirementProcedureId;
  readonly archiveDisposition: CandidateArchiveDisposition;
}

export interface TransmitCandidateRetirementCommand {
  readonly kind: "transmit-candidate-retirement";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly confirmationText: string;
  /** Required for pre-programme custody; active crises use their reviewed packet. */
  readonly procedureId?: RetirementProcedureId;
  readonly archiveDisposition?: CandidateArchiveDisposition;
}

export interface ChoosePostRetirementPathCommand {
  readonly kind: "choose-post-retirement-path";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  readonly path: "successor-programme" | "durable-moratorium";
}

export interface ChooseFalseDawnPathCommand {
  readonly kind: "choose-false-dawn-path";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  /** Durable modal key prevents a stale outcome screen choosing for a later run. */
  readonly presentationKey: string;
  readonly path: "successor-programme" | "durable-moratorium";
}

export interface TransmitDeploymentCommand {
  readonly kind: "transmit-deployment";
  readonly meta: CommandMeta;
  readonly labId: LabId;
  /** Exact artifact guard: stale dialogs cannot deploy a successor by accident. */
  readonly modelId: ModelId;
  readonly confirmationText: string;
}

export interface AdvanceWorldWaitingCommand {
  readonly kind: "advance-world-waiting";
  readonly meta: CommandMeta;
  readonly labId: LabId;
}

export type GameCommand =
  | SetGpuAllocationCommand
  | BuyGpusCommand
  | SellGpusCommand
  | SetPublicPriceCommand
  | StartFacilityConstructionCommand
  | StartFundraisingCampaignCommand
  | AcceptFundingOfferCommand
  | StartAgiComponentCommand
  | JoinGovernmentProgrammeCommand
  | LeaveGovernmentProgrammeCommand
  | StartLobbyingProjectCommand
  | ConductRivalDiplomacyCommand
  | ProposeCoalitionCommand
  | StartCoalitionProjectCommand
  | RatifyCoalitionCommand
  | ChooseGenericAdvanceCommand
  | ChoosePublicationPolicyCommand
  | StartTrainingRunCommand
  | StartEvaluationCommand
  | DismissAnomalyCommand
  | InvestigateAnomalyCommand
  | RespondToDecisionEventCommand
  | StartProductisationCommand
  | SetModelDeploymentPolicyCommand
  | AssignResearcherCommand
  | RecruitResearcherCommand
  | StartResearcherCommitmentCommand
  | SubmitRetentionOfferCommand
  | ResolveResearcherUltimatumCommand
  | DismissResearcherCommand
  | ReviewRivalRaceCommand
  | SetModelAutonomyCommand
  | SetCandidateAccessCommand
  | IsolateCandidateArtifactCommand
  | ResolveCandidateIncidentCommand
  | NominateCandidateCommand
  | CommitCapabilityProofCommand
  | CommitCandidateSafetyResponseCommand
  | ConfigureCandidateRetirementCommand
  | TransmitCandidateRetirementCommand
  | ChoosePostRetirementPathCommand
  | ChooseFalseDawnPathCommand
  | TransmitDeploymentCommand
  | AdvanceWorldWaitingCommand
  | ResolvePressureCollisionCommand
  | EnterFinalReviewCommand
  | ChooseDeploymentModeCommand
  | ResolveRolloutDecisionCommand
  | ResolveContainmentFailureCommand;

export interface RuleViolation {
  readonly code: string;
  readonly message: string;
}

/**
 * Previews are generated from the same rule functions used by application
 * (TDD section 8.2); the UI must never implement its own cost formula.
 */
export interface CommandPreview {
  readonly summary: string;
  readonly takesEffectAtTick: Tick;
  readonly gpuPurchaseQuote?: GpuPurchaseQuote;
  readonly gpuSaleQuote?: GpuSaleQuote;
  readonly gpuAllocationPlan?: GpuAllocationPlan;
  readonly gpuAllocationConsequences?: {
    readonly netMillionsPerCycle: number;
    readonly servingCapacityTeraflops: number;
    readonly requestedTeraflops: number;
    readonly deliveredTeraflops: number;
    readonly unmetTeraflops: number;
    readonly projectedRevenueMillionsPerCycle: number;
    readonly projectedServingAuraPerCycle: number;
    readonly projectedServingFulfilment: number;
    readonly segments: readonly {
      readonly segmentId: string;
      readonly requestedTeraflops: number;
      readonly deliveredTeraflops: number;
      readonly projectedRevenueMillionsPerCycle: number;
    }[];
  };
  readonly publicPriceTier?: PublicPriceTier;
  readonly constructionQuote?: ConstructionQuote;
  readonly fundraisingCampaign?: FundraisingCampaignQuote;
  readonly fundingOffer?: FundingOfferQuote;
  readonly lobbyingProject?: LobbyingProjectQuote;
  readonly rivalDiplomacy?: RivalDiplomacyQuote;
  readonly coalitionProposal?: CoalitionProposalQuote;
  readonly coalitionProject?: CoalitionProjectQuote;
  readonly coalitionEligibility?: CoalitionEligibility;
  readonly trainingQuote?: TrainingQuote;
  readonly evaluationQuote?: EvaluationQuote;
  readonly productisationQuote?: ProductisationQuote;
  readonly recruitment?: RecruitmentQuote;
  readonly researcherCommitment?: ResearcherCommitmentQuote;
  readonly researcherAssignment?: ResearcherAssignmentQuote;
  readonly retentionOffer?: RetentionOfferPreview;
  readonly ultimatumResponse?: UltimatumResponsePreview;
  readonly dismissal?: DismissalQuote;
  readonly eventOption?: EventOptionPreview;
  readonly candidateAccess?: CandidateAccessQuote;
  readonly candidateIncidentReview?: CandidateIncidentReviewQuote;
  readonly capabilityProof?: CapabilityProofProjectQuote;
  readonly candidateSafetyResponse?: CandidateSafetyResponseQuote;
  readonly deploymentMode?: DeploymentModeQuote;
  readonly deploymentTransmission?: DeploymentTransmissionQuote;
  readonly deploymentPolicy?: {
    readonly policy: DeploymentPolicy;
    readonly displayName: string;
    readonly exposure: number;
    readonly irreversible: boolean;
    readonly auraAward: number;
    readonly marketDemandMultiplier: number;
    readonly revenueMultiplier: number;
  };
}

export type CommandValidation =
  | { readonly ok: true; readonly preview: CommandPreview }
  | { readonly ok: false; readonly errors: readonly RuleViolation[] };
