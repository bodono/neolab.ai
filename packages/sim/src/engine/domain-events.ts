import type {
  ContentId,
  PublicationPolicy,
  PublicPriceTier,
  DeploymentPolicy,
  ProductisationMode,
  EventSeverity,
} from "@neolab/content-schema";

import type {
  AnomalyId,
  CoalitionId,
  EvaluationId,
  EventInstanceId,
  FundingOfferId,
  GpuLotId,
  LabId,
  ModelId,
  ModelLineageId,
  ProjectId,
  ResearcherId,
} from "../model/ids.ts";
import type {
  AutonomyAccessLevel,
  FundingCampaignType,
  CoalitionProjectType,
  GovernmentCrisisTrigger,
  GovernmentInterventionBand,
  GovernmentInterventionKind,
  GovernmentResponseOutcome,
  LobbyingApproach,
  LobbyingObjective,
  ProjectKind,
  RivalDiplomacyAction,
  RivalIncidentConsequence,
  RivalIncidentSeverity,
  TrainingFailureOutcome,
  CandidateIncidentClass,
  CandidateArchiveDisposition,
  CrisisProjectType,
  DeploymentModeId,
  RetirementProcedureId,
  ResolutionGate,
  RolloutDecisionOptionId,
} from "../model/state.ts";
import type { AuraCategory, AuraChangeKind } from "../model/state.ts";
import type { Tick } from "../model/units.ts";

/**
 * Internal facts emitted by the engine (TDD section 8.4). Domain events are
 * typed signals for rules, UI moments, and autosaves — never canonical state.
 * The union grows with each stage; switches over it must stay exhaustive.
 */
export type DomainEvent =
  | {
      readonly kind: "candidate-deployment-transmitted";
      readonly modelId: ModelId;
      readonly transmittedAt: Tick;
    }
  | {
      readonly kind: "candidate-retirement-configured";
      readonly modelId: ModelId;
      readonly procedureId: RetirementProcedureId;
      readonly archiveDisposition: CandidateArchiveDisposition;
    }
  | {
      readonly kind: "candidate-retirement-transmitted";
      readonly modelId: ModelId;
      readonly attemptNumber: number;
    }
  | {
      readonly kind: "candidate-retirement-verified";
      readonly modelId: ModelId;
      readonly archiveDisposition: CandidateArchiveDisposition;
      readonly contested: boolean;
    }
  | {
      readonly kind: "candidate-retirement-recovery-phase-changed";
      readonly modelId: ModelId;
      readonly phase: "supervised-rebuild";
    }
  | {
      readonly kind: "candidate-retirement-recovery-completed";
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "candidate-moratorium-resolved";
      readonly modelId: ModelId;
      readonly success: boolean;
    }
  | {
      readonly kind: "candidate-remediation-created";
      readonly sourceModelId: ModelId;
      readonly resultModelId: ModelId;
      readonly clearsCandidateGate: boolean;
    }
  | {
      readonly kind: "candidate-remediation-adopted";
      readonly sourceModelId: ModelId;
      readonly resultModelId: ModelId;
      readonly adoptedModelId: ModelId;
    }
  | {
      readonly kind: "crisis-project-started";
      readonly projectId: ProjectId;
      readonly projectType: CrisisProjectType;
    }
  | {
      readonly kind: "crisis-pressure-collision-selected";
      readonly collisionId: ContentId;
      readonly category: "rival" | "political" | "financial" | "institutional";
    }
  | {
      readonly kind: "crisis-pressure-collision-resolved";
      readonly collisionId: ContentId;
      readonly optionId: "delay" | "comply" | "push-ahead";
    }
  | {
      readonly kind: "crisis-final-review-compiled";
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "crisis-deployment-mode-selected";
      readonly modelId: ModelId;
      readonly modeId: DeploymentModeId;
      readonly rolloutEndsAt: Tick;
    }
  | {
      readonly kind: "crisis-rollout-beat-opened";
      readonly beat: "first-operation" | "stress-collision";
    }
  | {
      readonly kind: "crisis-rollout-decision-resolved";
      readonly beat:
        "authorisation" | "first-operation" | "stress-collision" | "settlement";
      readonly optionId: RolloutDecisionOptionId;
    }
  | {
      readonly kind: "crisis-gate-resolved";
      readonly gate: ResolutionGate;
      readonly resultId: string;
    }
  | {
      readonly kind: "crisis-shutdown-cancelled";
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "crisis-shutdown-resolved";
      readonly modelId: ModelId;
      readonly success: boolean;
    }
  | {
      readonly kind: "crisis-shutdown-recovery-completed";
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "crisis-rollout-ready-for-ending";
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "endgame-ending-resolved";
      readonly endingId: ContentId;
      readonly endingClass: "full" | "qualified" | "survival" | "loss";
    }
  | {
      readonly kind: "candidate-access-changed";
      readonly modelId: ModelId;
      readonly previousLevel: import("../model/state.ts").AutonomyAccessLevel;
      readonly level: import("../model/state.ts").AutonomyAccessLevel;
      readonly critical: boolean;
    }
  | {
      readonly kind: "endgame-crisis-started";
      readonly modelId: ModelId;
      readonly checkpointTick: Tick;
    }
  | {
      readonly kind: "aura-changed";
      readonly labId: LabId;
      readonly entryId: string;
      readonly changeKind: AuraChangeKind;
      readonly category: AuraCategory;
      readonly requestedDelta: number;
      readonly appliedDelta: number;
      readonly lifetimeDelta: number;
    }
  | { readonly kind: "order-queued"; readonly labId: LabId; readonly order: string }
  | { readonly kind: "orders-applied"; readonly tick: Tick; readonly count: number }
  | {
      readonly kind: "serving-allocation-capped";
      readonly labId: LabId;
      readonly previousBasisPoints: number;
      readonly maximumBasisPoints: number;
      readonly maximumPhysicalGpus: number;
    }
  | {
      readonly kind: "rival-commands-issued";
      readonly labId: LabId;
      readonly count: number;
    }
  | {
      readonly kind: "rival-plan-selected";
      readonly labId: LabId;
      readonly planId: import("../model/state.ts").RivalStrategicPlanId;
      readonly quarterIndex: number;
    }
  | {
      readonly kind: "rival-public-signal";
      readonly labId: LabId;
      readonly signalId: string;
      readonly signalKind: import("../model/state.ts").RivalPublicSignalKind;
      readonly subjectId: string;
      readonly summary: string;
    }
  | {
      readonly kind: "rival-diplomacy-resolved";
      readonly playerLabId: LabId;
      readonly rivalLabId: LabId;
      readonly action: RivalDiplomacyAction;
      readonly accepted: boolean;
      readonly probability: number;
      readonly draw: number;
    }
  | {
      readonly kind: "rival-incident-resolved";
      readonly labId: LabId;
      readonly incidentId: string;
      readonly severity: RivalIncidentSeverity;
      readonly consequences: readonly RivalIncidentConsequence[];
    }
  | {
      readonly kind: "rival-candidate-countdown-started";
      readonly labId: LabId;
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "rival-candidate-final-year";
      readonly labId: LabId;
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "rival-candidate-countdown-completed";
      readonly labId: LabId;
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "rival-candidate-false-dawn";
      readonly labId: LabId;
      readonly modelId: ModelId;
    }
  | {
      readonly kind: "rival-deployment-crisis-stage";
      readonly labId: LabId;
      readonly modelId: ModelId;
      readonly stage: import("../model/state.ts").RivalDeploymentCrisisStage;
      readonly previousStage?: import("../model/state.ts").RivalDeploymentCrisisStage;
      readonly transition: "entered" | "advanced" | "completed";
    }
  | {
      readonly kind: "world-phase-changed";
      readonly previousPhase: import("../model/state.ts").GamePhase;
      readonly phase: import("../model/state.ts").GamePhase;
      readonly frontierCapability: number;
    }
  | {
      readonly kind: "gpu-generation-unlocked";
      readonly generationId: ContentId;
      readonly nominalYear: number;
    }
  | {
      readonly kind: "coalition-proposed";
      readonly coalitionId: CoalitionId;
      readonly memberLabIds: readonly LabId[];
    }
  | {
      readonly kind: "coalition-project-started" | "coalition-project-resolved";
      readonly coalitionId: CoalitionId;
      readonly projectId: ProjectId;
      readonly projectType: CoalitionProjectType;
    }
  | {
      readonly kind: "coalition-ratification-ready";
      readonly coalitionId: CoalitionId;
    }
  | {
      readonly kind: "coalition-ratified";
      readonly coalitionId: CoalitionId;
      readonly memberLabIds: readonly LabId[];
    }
  | {
      readonly kind: "coalition-betrayal-recorded";
      readonly coalitionId: CoalitionId;
      readonly betrayalId: string;
      readonly labId: LabId;
    }
  | { readonly kind: "tick-completed"; readonly tick: Tick }
  | { readonly kind: "cycle-boundary"; readonly tick: Tick }
  | {
      readonly kind: "delayed-effect-fired";
      readonly scheduledEffectId: string;
      readonly source: import("../model/state.ts").EffectSource;
      readonly effectCount: number;
    }
  | {
      readonly kind: "cycle-settled";
      readonly tick: Tick;
      readonly labId: LabId;
      readonly netMillions: number;
      readonly closingCashMillions: number;
    }
  | {
      readonly kind: "finance-runway-warning";
      readonly labId: LabId;
      readonly band: "warning" | "critical";
      readonly weeks: number;
    }
  | {
      readonly kind: "finance-insolvent";
      readonly labId: LabId;
      readonly cashMillions: number;
    }
  | {
      readonly kind: "finance-insolvency-grace";
      readonly labId: LabId;
      readonly cashMillions: number;
    }
  | {
      readonly kind: "finance-negative-balance-warning";
      readonly labId: LabId;
      readonly cashMillions: number;
      readonly consecutiveWeeks: 26 | 39;
      readonly bankruptcyAtWeeks: 52;
    }
  | {
      readonly kind: "fundraising-campaign-started";
      readonly labId: LabId;
      readonly projectId: ProjectId;
      readonly campaign: FundingCampaignType;
      readonly auraSpent: number;
    }
  | {
      readonly kind: "fundraising-offers-generated";
      readonly labId: LabId;
      readonly projectId: ProjectId;
      readonly campaign: FundingCampaignType;
      readonly offerIds: readonly FundingOfferId[];
    }
  | {
      readonly kind: "funding-offer-accepted";
      readonly labId: LabId;
      readonly offerId: FundingOfferId;
      readonly cashMillions: number;
      readonly conditionCount: number;
      readonly roundOrdinal: number;
      readonly roundLabel: string;
      readonly openingRecapitalisation?: {
        readonly bridgeConversionMillions: number;
        readonly operatingTopUpMillions: number;
        readonly postCloseCashMillions: number;
      };
    }
  | { readonly kind: "funding-offer-expired"; readonly offerId: FundingOfferId }
  | {
      readonly kind: "public-price-scheduled";
      readonly labId: LabId;
      readonly priceTier: PublicPriceTier;
    }
  | {
      readonly kind: "public-price-changed";
      readonly labId: LabId;
      readonly priceTier: PublicPriceTier;
    }
  | {
      readonly kind: "serving-shortage";
      readonly labId: LabId;
      readonly requestedTeraflops: number;
      readonly deliveredTeraflops: number;
    }
  | {
      readonly kind: "market-cycle-settled";
      readonly labId: LabId;
      readonly revenueMillions: number;
    }
  | {
      readonly kind: "project-queued" | "project-started" | "project-completed";
      readonly labId: LabId;
      readonly projectId: ProjectId;
      readonly projectKind: ProjectKind;
    }
  | {
      readonly kind: "facility-completed";
      readonly labId: LabId;
      readonly projectId: ProjectId;
      readonly definitionId: ContentId;
    }
  | { readonly kind: "quarter-boundary"; readonly tick: Tick }
  | {
      readonly kind: "agi-component-completed";
      readonly labId: LabId;
      readonly componentType: import("../model/state.ts").AgiComponentType;
    }
  | {
      readonly kind: "rival-agi-component-started";
      readonly labId: LabId;
      readonly componentType: import("../model/state.ts").AgiComponentType;
    }
  | {
      readonly kind: "rival-agi-component-completed";
      readonly labId: LabId;
      readonly componentType: import("../model/state.ts").AgiComponentType;
    }
  | {
      readonly kind: "autonomy-escalation-detected";
      readonly labId: LabId;
      readonly modelId: ModelId;
      readonly stage: import("../model/state.ts").AutonomyEscalationStage;
    }
  | {
      readonly kind: "autonomy-escalation-resolved";
      readonly labId: LabId;
      readonly stage: import("../model/state.ts").AutonomyEscalationStage;
      readonly response: string;
    }
  | {
      readonly kind: "government-programme-joined";
      readonly labId: LabId;
      readonly programmeId: string;
    }
  | {
      readonly kind: "government-programme-left";
      readonly labId: LabId;
      readonly programmeId: string;
    }
  | {
      readonly kind: "government-quarter-evaluated";
      readonly labId: LabId;
      readonly pressure: number;
      readonly band: GovernmentInterventionBand;
    }
  | {
      readonly kind: "government-intervention-triggered";
      readonly labId: LabId;
      readonly interventionId: string;
      readonly interventionKind: GovernmentInterventionKind;
      readonly trigger: GovernmentCrisisTrigger;
      readonly pressure: number;
    }
  | {
      readonly kind: "government-intervention-resolved";
      readonly labId: LabId;
      readonly interventionId: string;
      readonly response: GovernmentResponseOutcome;
      readonly nationalisationEligible: boolean;
    }
  | {
      readonly kind: "lobbying-project-resolved";
      readonly labId: LabId;
      readonly projectId: ProjectId;
      readonly objective: LobbyingObjective;
      readonly approach: LobbyingApproach;
      readonly success: boolean;
      readonly probability: number;
      readonly draw: number;
    }
  | {
      readonly kind: "gpu-order-placed";
      readonly labId: LabId;
      readonly lotId: GpuLotId;
      readonly arrivesAt: Tick;
    }
  | {
      readonly kind: "gpu-lots-sold";
      readonly labId: LabId;
      readonly generationId: ContentId;
      readonly physicalGpus: number;
      readonly proceedsMillions: number;
    }
  | {
      readonly kind: "gpu-delivered";
      readonly labId: LabId;
      readonly lotId: GpuLotId;
    }
  | {
      readonly kind: "gpu-lot-damaged";
      readonly labId: LabId;
      readonly lotId: GpuLotId;
      readonly physicalGpusLost: number;
    }
  | {
      readonly kind: "gpu-lot-retired";
      readonly labId: LabId;
      readonly lotId: GpuLotId;
      readonly reason: "sold" | "returned" | "lease-expired" | "seized" | "destroyed";
    }
  | {
      readonly kind: "researcher-compact-warning";
      readonly researcherId: ResearcherId;
      readonly compactId: ContentId;
      readonly eventId: ContentId;
      readonly weeksRemaining: number;
    }
  | {
      readonly kind: "researcher-compact-breached";
      readonly researcherId: ResearcherId;
      readonly compactId: ContentId;
      readonly eventId: ContentId;
    }
  | {
      readonly kind: "talent-market-refreshed";
      readonly refreshIndex: number;
      readonly candidateIds: readonly ResearcherId[];
    }
  | {
      readonly kind: "researcher-recruited";
      readonly labId: LabId;
      readonly researcherId: ResearcherId;
    }
  | {
      readonly kind: "researcher-assigned";
      readonly researcherId: ResearcherId;
      readonly assignmentKind: string;
      readonly targetId?: string;
      readonly role: "lead" | "advisor" | "institutional";
    }
  | {
      readonly kind: "researcher-promise-added";
      readonly researcherId: ResearcherId;
      readonly promiseId: string;
      readonly dueAt: Tick;
    }
  | {
      readonly kind: "researcher-promise-kept" | "researcher-promise-broken";
      readonly researcherId: ResearcherId;
      readonly promiseId: string;
      readonly flagrant: boolean;
    }
  | {
      readonly kind: "researcher-ultimatum-issued";
      readonly researcherId: ResearcherId;
      readonly ultimatumId: string;
      readonly reason: "quarterly" | "promise-breach" | "compact-breach" | "provocation";
      readonly expiresAt: Tick;
    }
  | {
      readonly kind: "researcher-ultimatum-resolved";
      readonly researcherId: ResearcherId;
      readonly response: "accept-conditions" | "wish-well";
    }
  | {
      readonly kind: "researcher-departed";
      readonly researcherId: ResearcherId;
      readonly researcherName: string;
      /** Lab whose roster actually lost the researcher. */
      readonly formerLabId: LabId;
      readonly reason: "voluntary" | "poached" | "dismissed" | "ultimatum-expired";
      readonly rivalLabId: string;
    }
  | {
      readonly kind: "researcher-poaching-rumour";
      readonly researcherId: ResearcherId;
      readonly poachingId: string;
      readonly rivalLabId: string;
    }
  | {
      readonly kind: "researcher-poaching-counteroffer";
      readonly researcherId: ResearcherId;
      readonly poachingId: string;
      readonly rivalLabId: string;
      readonly resolvesAt: Tick;
    }
  | {
      readonly kind: "researcher-retention-offer";
      readonly researcherId: ResearcherId;
      readonly strengthGain: number;
    }
  | {
      readonly kind: "researcher-poaching-resolved";
      readonly researcherId: ResearcherId;
      readonly rivalLabId: string;
      readonly departed: boolean;
      readonly probability: number;
      readonly draw: number;
    }
  | {
      readonly kind: "researcher-knowledge-transferred";
      readonly researcherId: ResearcherId;
      readonly rivalLabId: string;
      readonly fraction: number;
    }
  | {
      readonly kind: "research-produced";
      readonly labId: LabId;
      readonly programId: ContentId;
      readonly researchPoints: number;
    }
  | {
      readonly kind: "generic-advance-offered";
      readonly labId: LabId;
      readonly programId: ContentId;
      readonly threshold: number;
    }
  | {
      readonly kind: "generic-advance-chosen";
      readonly labId: LabId;
      readonly programId: ContentId;
      readonly threshold: number;
      readonly optionId: ContentId;
    }
  | {
      readonly kind: "paper-discovered";
      readonly paperId: ContentId;
      readonly labId: string;
      readonly worldFirst: boolean;
    }
  | {
      readonly kind: "paper-publication-policy-chosen";
      readonly paperId: ContentId;
      readonly policy: PublicationPolicy;
    }
  | {
      readonly kind: "training-started";
      readonly labId: LabId;
      readonly projectId: ProjectId;
      readonly futureModelId: ModelId;
    }
  | {
      readonly kind: "training-failure-check";
      readonly labId: LabId;
      readonly projectId: ProjectId;
      readonly checkpoint: number;
      readonly outcome: TrainingFailureOutcome;
      readonly delayWeeks: number;
    }
  | {
      readonly kind: "training-completed";
      readonly labId: LabId;
      readonly projectId: ProjectId;
      readonly modelId: ModelId;
      readonly regressions: readonly string[];
    }
  | {
      readonly kind: "candidate-artifact-qualified";
      readonly modelId: ModelId;
      readonly lineageId: ModelLineageId;
      readonly firstCrossingForLineage: boolean;
    }
  | {
      readonly kind: "candidate-artifact-isolated";
      readonly modelId: ModelId;
      readonly previousAccess: AutonomyAccessLevel;
      readonly maximumAccessEver: AutonomyAccessLevel;
    }
  | {
      readonly kind: "candidate-latent-incident";
      readonly modelId: ModelId;
      readonly incidentClass: CandidateIncidentClass;
      readonly incidentKind: "warning" | "active-incident" | "benign-false-alarm";
    }
  | {
      readonly kind: "capability-tier-reached";
      readonly modelId: ModelId;
      readonly tierId: ContentId;
      readonly level: number;
    }
  | {
      readonly kind: "autonomy-level-unlocked";
      readonly modelId: ModelId;
      readonly level: AutonomyAccessLevel;
    }
  | { readonly kind: "agi-candidate-detected"; readonly modelId: ModelId }
  | {
      readonly kind: "evaluation-completed";
      readonly evaluationId: EvaluationId;
      readonly modelId: ModelId;
      readonly definitionId: ContentId;
      readonly automaticBaseline: boolean;
      readonly anomalyCount: number;
    }
  | {
      readonly kind: "anomaly-detected";
      readonly anomalyId: AnomalyId;
      readonly modelId: ModelId;
      readonly observedSeverity: number;
    }
  | {
      readonly kind: "anomaly-status-changed";
      readonly anomalyId: AnomalyId;
      readonly status:
        | "unresolved"
        | "dismissed"
        | "investigating"
        | "confirmed"
        | "inconclusive"
        | "mitigating"
        | "mitigated"
        | "resolved";
    }
  | {
      readonly kind: "mandatory-safety-review";
      readonly modelId: ModelId;
      readonly unresolvedSevereCount: number;
    }
  | {
      readonly kind: "model-incident";
      readonly modelId: ModelId;
      readonly severity: number;
      readonly category: "minor" | "serious" | "major" | "critical" | "catastrophe";
      readonly contained: boolean;
    }
  | {
      readonly kind: "productisation-started";
      readonly labId: LabId;
      readonly modelId: ModelId;
      readonly projectId: ProjectId;
      readonly mode: ProductisationMode;
    }
  | {
      readonly kind: "productisation-completed";
      readonly labId: LabId;
      readonly modelId: ModelId;
      readonly projectId: ProjectId;
      readonly mode: ProductisationMode;
      readonly productQuality: number;
      readonly reliability: number;
    }
  | {
      readonly kind: "model-deployment-changed";
      readonly labId: LabId;
      readonly modelId: ModelId;
      readonly policy: DeploymentPolicy;
    }
  | {
      readonly kind: "decision-event-instantiated";
      readonly instanceId: EventInstanceId;
      readonly definitionId: ContentId;
      readonly severity: EventSeverity;
      readonly source: "opportunity" | "mandatory";
    }
  | {
      readonly kind: "decision-event-resolved";
      readonly instanceId: EventInstanceId;
      readonly definitionId: ContentId;
      readonly optionId: string;
      readonly resolutionKind: "player" | "default";
    }
  | {
      readonly kind: "decision-event-invalidated";
      readonly instanceId: EventInstanceId;
      readonly reason: string;
    }
  | { readonly kind: "run-ended"; readonly result: "won" | "lost" };
