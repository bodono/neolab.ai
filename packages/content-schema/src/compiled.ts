import { z } from "zod";

import {
  assetCatalogueDefinitionSchema,
  type AssetCatalogueDefinition,
} from "./assets.ts";
import type { AuthoredEffect, AuthoredResearcherActivation } from "./authored.ts";
import { isContentId, type ContentId } from "./content-id.ts";
import { authoringManifestSchema, type AuthoringManifest } from "./manifest.ts";
import type { ScoreRulesDefinition } from "./scoring.ts";

/**
 * Canonical compiled definitions (TDD sections 12.1 and 7.2.1).
 *
 * All IDs are canonical `ContentId`s. The compiler is the only producer;
 * the simulation and UI are consumers.
 */

export interface NamedEffectGroup {
  readonly id: string;
  readonly label: string;
  readonly effects: readonly AuthoredEffect[];
}

/** Normalised editorial workflow metadata required on sourced definitions. */
export interface EditorialReviewMetadata {
  readonly sourceNotes: readonly string[];
  /** Null means the authoring record has not yet received a dated review. */
  readonly lastReviewed: string | null;
  readonly portrayalStatus:
    "fictionalized" | "historical-record" | "fictional-work" | "unreviewed";
  readonly legalStatus?: string;
}

export interface LeaderDefinition {
  readonly id: ContentId;
  readonly labId: ContentId;
  readonly displayName: string;
  readonly inspirationName: string;
  readonly inspirationSummary: string;
  readonly epithet: string;
  readonly aiFamily: string;
  readonly characteristic: string;
  readonly biography: string;
  readonly headlineBonus: NamedEffectGroup;
  readonly labModifiers: readonly NamedEffectGroup[];
  readonly complexity: string;
  readonly sourceNotes: readonly string[];
  readonly editorialReview: EditorialReviewMetadata;
}

export interface LabDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly leaderId: ContentId;
  readonly aiFamily: string;
}

export interface GpuGenerationDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly manufacturer: string;
  readonly historicity: "real" | "fictional";
  readonly nominalYear: number;
  /** World max frontier capability at which this generation is announced. */
  readonly unlockAtWorldFrontierCapability: number;
  readonly trainingFactor: number;
  readonly servingFactor: number;
  readonly powerPerThousand: number;
  readonly interconnectTier: number;
  readonly reliability: number;
  readonly gameCostMillionsPerThousand: number;
  readonly gameOperatingCostMillionsPerThousandPerCycle: number;
  readonly deliveryWeeks: number;
  readonly summary: string;
  /** Real-world context (verified) or labelled grounded futurism. */
  readonly education: string;
  /** The fictionalised launch-keynote quote presenting this generation. */
  readonly announcement: string;
}

export type PublicPriceTier =
  "free-preview" | "cheap" | "market" | "premium" | "scarcity";

export interface MarketPriceTierDefinition {
  readonly id: PublicPriceTier;
  readonly displayName: string;
  readonly unitPriceMillions: number;
}

export interface MarketSegmentDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  /** Share of worldwide commercial revenue represented by this segment. */
  readonly revenueShare: number;
  /** Share of worldwide inference compute requested by this segment. */
  readonly servingComputeShare: number;
  /** @deprecated Retained while pre-release market state still carries usage fields. */
  readonly globalUsagePerCycle: number;
  readonly marketAvailability: number;
  readonly acquisitionRate: number;
  readonly capabilityWeights: Readonly<Record<string, number>>;
  readonly appealWeights: {
    readonly capability: number;
    readonly productQuality: number;
    readonly reliability: number;
    readonly governmentTrust: number;
  };
  readonly pricePenalties: Readonly<Record<PublicPriceTier, number>>;
  readonly staticRivalAppeals: readonly number[];
  readonly rivalCapabilityBenchmark: number;
}

export interface MarketDefinition {
  readonly softmaxTemperature: number;
  /** Worldwide serving demand at relevant capability zero, in TFLOP/s. */
  readonly baseGlobalServingDemandTeraflops: number;
  /** Relevant capability divisor in the base-10 serving-demand curve. */
  readonly servingDemandCapabilityDivisor: number;
  /** Worldwide four-week revenue opportunity at relevant capability zero. */
  readonly baseGlobalRevenueMillionsPerCycle: number;
  /** Coefficient in 1 + coefficient * (relevant capability / 100)^2. */
  readonly valuePerDeliveredFlopQuadraticFactor: number;
  readonly startingSatisfaction: number;
  readonly monetisationEfficiency: number;
  readonly priceTiers: Readonly<Record<PublicPriceTier, MarketPriceTierDefinition>>;
  readonly segments: Readonly<Record<string, MarketSegmentDefinition>>;
}

export interface FacilityDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly family: string;
  readonly tier: number;
  readonly cashCostMillions: number;
  readonly operatingCostMillionsPerCycle: number;
  readonly durationWeeks: number;
  readonly prerequisiteFacilityIds: readonly ContentId[];
  readonly bonusMajorProjectSlots: number;
  readonly supportedOwnedGpuCount: number;
  readonly scoreTag: string;
  readonly tags: readonly string[];
  readonly campusModule: string;
  readonly summary: string;
  readonly modifiers: readonly AuthoredEffect[];
}

export type ResearchProgramKind = "capability" | "safety";

export interface ResearchProgramDefinition {
  readonly id: ContentId;
  readonly kind: ResearchProgramKind;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly colour: string;
  readonly levelCostMultiplier: number;
  readonly outputModifierTarget?: string;
  /** Exactly two deterministic choices at every configured threshold. */
  readonly genericAdvanceOptionIds: Readonly<Record<string, readonly ContentId[]>>;
}

export interface GenericAdvanceDefinition {
  readonly id: ContentId;
  readonly programId: ContentId;
  /** Stable authored branch; later thresholds on this path upgrade earlier ones. */
  readonly pathId: string;
  readonly threshold: number;
  readonly name: string;
  readonly description: string;
  readonly effects: readonly AuthoredEffect[];
}

export interface ResearchRulesDefinition {
  readonly unfundedDomainsProduceProgress: boolean;
  readonly teraflopScaleDivisor: number;
  readonly baseCoefficient: number;
  readonly gpuExponent: number;
  readonly lowLevelRpPerPoint: number;
  /**
   * Compounding cost per research level above `levelCostGrowthFromLevel`.
   * Research output scales with fleet size and, far more sharply, with GPU
   * generation (Kepler 1.0 to Kolmogorov 1400), so a flat ladder saturates the
   * moment modern silicon arrives. This is the sink that keeps up with it.
   */
  readonly levelCostGrowth: number;
  /** Compounding cost used by safety programmes above the same pivot. */
  readonly safetyLevelCostGrowth: number;
  /** Levels at or below this cost the flat `lowLevelRpPerPoint`. */
  readonly levelCostGrowthFromLevel: number;
  readonly levelCostBands: readonly {
    readonly afterLevel: number;
    readonly multiplier: number;
  }[];
  readonly generalResearcherContribution: number;
  readonly talentMultiplier: { readonly min: number; readonly max: number };
  readonly facilityContribution: number;
  readonly facilityMultiplierMax: number;
  readonly weeklyVariance: {
    readonly min: number;
    readonly mode: number;
    readonly max: number;
  };
  readonly modelAssistBase: number;
  readonly contextSwitchMultiplier: number;
  readonly genericAdvanceThresholds: readonly number[];
}

export interface ResearchDefinition {
  readonly capabilityDomains: Readonly<Record<string, ResearchProgramDefinition>>;
  readonly safetyPrograms: Readonly<Record<string, ResearchProgramDefinition>>;
  readonly genericAdvances: Readonly<Record<string, GenericAdvanceDefinition>>;
  readonly rules: ResearchRulesDefinition;
}

export type PublicationPolicy =
  "publish-openly" | "controlled-publication" | "keep-secret" | "release-everything";

export type PaperPrerequisitePredicate =
  | { readonly kind: "all"; readonly items: readonly PaperPrerequisitePredicate[] }
  | { readonly kind: "any"; readonly items: readonly PaperPrerequisitePredicate[] }
  | { readonly kind: "paper-known"; readonly paperId: ContentId }
  | {
      readonly kind: "domain-level";
      readonly domainId: ContentId;
      readonly minimumLevel: number;
    }
  | { readonly kind: "facility-complete"; readonly facilityId: ContentId }
  | {
      readonly kind: "phase-at-least";
      readonly phase: "foundation" | "scaling" | "frontier";
    };

export interface PaperUnlockEffectDefinition {
  readonly target: string;
  readonly operation: "unlock" | "add" | "multiply" | "min" | "max";
  readonly value: boolean | number;
}

export interface PaperDefinition {
  readonly id: ContentId;
  readonly version: number;
  readonly historicity: "real" | "fictional-future";
  readonly gameOrder: number;
  readonly title: string;
  readonly authors: readonly string[];
  readonly publicationYear?: number;
  readonly venue?: string;
  readonly primarySourceUrl?: string;
  readonly doi?: string;
  readonly arxiv?: string;
  readonly fictionalLabel?: "FICTIONAL FUTURE PAPER";
  readonly historicalNote: string;
  readonly education: {
    readonly playerSummary: string;
    readonly archiveExplanation: string;
    readonly insideBaseball: string;
  };
  readonly domainWeights: Readonly<Record<string, number>>;
  readonly prerequisites: PaperPrerequisitePredicate;
  readonly breakthroughRequirement: {
    readonly programmeId: ContentId;
    readonly level: number;
  };
  readonly earliestPhase?: "foundation" | "scaling" | "frontier";
  readonly discovery: {
    readonly worldFirstAura: number;
  };
  readonly unlockEffects: readonly PaperUnlockEffectDefinition[];
  readonly tags: readonly string[];
  readonly review: {
    readonly factual: string;
    readonly mechanics: string;
    readonly reviewedOn: string;
  };
  readonly editorialReview: EditorialReviewMetadata;
}

export interface PaperGraphIndex {
  readonly prerequisiteAdjacency: Readonly<Record<string, readonly ContentId[]>>;
  readonly reverseUnlocks: Readonly<Record<string, readonly ContentId[]>>;
  readonly papersByDomain: Readonly<Record<string, readonly ContentId[]>>;
  readonly earliestReachablePhase: Readonly<
    Record<string, "foundation" | "scaling" | "frontier">
  >;
  readonly realHistoryDisplayOrder: readonly ContentId[];
}

export interface PaperRulesDefinition {
  readonly breakthroughChance: {
    readonly basePerWeek: number;
    readonly perLevelAbove: number;
    readonly maximum: number;
  };
  readonly publicationPolicies: Readonly<
    Record<PublicationPolicy, { readonly auraMultiplier: number }>
  >;
  readonly rivalStub: {
    readonly labId: string;
    readonly displayName: string;
    readonly domainLevel: number;
    readonly publicationPolicy: PublicationPolicy;
  };
}

export interface PapersDefinition {
  readonly definitions: Readonly<Record<string, PaperDefinition>>;
  readonly graph: PaperGraphIndex;
  readonly rules: PaperRulesDefinition;
}

export type TrainingScale = "prototype" | "product" | "frontier";
export type TrainingPosture = "conservative" | "normal" | "yolo";

export type CapabilityAttribute =
  | "language"
  | "reasoning"
  | "agency"
  | "toolUse"
  | "multimodality"
  | "scientificAbility"
  | "embodiment";

/**
 * A band a run gets NAMED after, not a recipe the player picks. Size is chosen
 * as FLOP/s and weeks; classifyTrainingRun turns what those add up to into one
 * of these. All that survives is what the name is and how hard a run of that
 * size is to land.
 *
 * The recipe fields are gone: baseDurationWeeks and baseCashCostMillions
 * described a duration and a price the player now sets directly, and
 * minimumEraGpuEquivalents / fixedEraGpuEquivalents were era-relative floors --
 * the same unit the capability rework removed everywhere else, and the reason a
 * "Product run" silently meant 1,400x more compute on late hardware than early.
 */
export interface TrainingScaleDefinition {
  readonly scale: TrainingScale;
  readonly displayName: string;
  /** Checkpoint-complexity anchor at this run class's calibration size. */
  readonly complexity: number;
}

export interface TrainingRulesDefinition {
  readonly recipeVersion: number;
  readonly baselineArchitectureId: ContentId;
  readonly scales: Readonly<Record<TrainingScale, TrainingScaleDefinition>>;
  readonly capabilityDomainWeights: Readonly<
    Record<CapabilityAttribute, Readonly<Record<string, number>>>
  >;
  readonly eraReferencePhysicalGpus: number;
  /**
   * Capability is a Cobb-Douglas product, not a weighted sum: research and
   * compute are complements, so a lab with no research cannot buy capability
   * with GPUs alone.
   *
   * The data term is gone. It was a per-attribute fitness vector chosen for
   * the player by their run posture, and at exponent 0.10 the whole spread
   * between the most and least curated corpus was worth 1.4% capability --
   * an invisible input the player could neither see nor act on. Posture now
   * says what it does in three numbers instead.
   */
  readonly capabilityFormula: {
    /**
     * Multiplies each visible capability-research level before the research
     * exponent is applied. This calibrates the candidacy neighbourhood around
     * broadly level-80 research without changing research speed or compute.
     */
    readonly researchEffectivenessMultiplier: number;
    readonly researchCeilingExponent: number;
    readonly scaleScoreExponent: number;
    /**
     * Holds the old calibration after the data term's removal. Public-web
     * data was effectively a constant x0.955 on every run, so dropping it
     * would have lifted every model by 4.7% and pulled every capability-gated
     * threshold earlier.
     */
    readonly dataTermCalibration: number;
    readonly trainingNoiseMin: number;
    readonly trainingNoiseMode: number;
    readonly trainingNoiseMax: number;
  };
  readonly failureCheckpoints: readonly number[];
}

export type EvaluationTarget =
  | CapabilityAttribute
  | "true-alignment"
  | "corrigibility"
  | "situational-awareness"
  | "deceptive-capability";

export type EvaluationProgramme =
  | "baseline"
  | "alignment-interpretability"
  | "autonomy-containment"
  | "independent-audit";

export interface EvaluationDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly programme: EvaluationProgramme;
  readonly method:
    | "baseline"
    | "alignment-interview"
    | "red-team"
    | "interpretability"
    | "autonomy-trial"
    | "external-audit";
  /**
   * Position on the evaluation ladder. Rung 0 is the free baseline that runs
   * automatically at training; the player climbs 1..N strictly in order, each
   * rung once per model, at dramatically escalating cost.
   */
  readonly ladderRung: number;
  /** The rung immediately below; must have reported on this model first. */
  readonly requiresEvaluationId?: ContentId;
  /**
   * Relative Safety Practice depth weight for this rung. The realised grant
   * is normalised across the full ladder, scaled by the model's capability
   * tier, then reduced when the model adds little capability novelty.
   */
  readonly practiceXp: number;
  readonly durationWeeks: number;
  /**
   * Compute bill as a fraction of the FLOPs that trained the model under
   * examination. Nothing that costs anything is denominated in GPUs: the
   * reservation is derived from this bill against the lab's fleet at quote
   * time, so the cost scales with the model for the whole life of the game --
   * evaluating a Basilica-trained candidate costs Basilica-sized compute.
   */
  readonly trainingRunFlopFraction: number;
  readonly cashCostMillions: number;
  /**
   * Cash floor as a fraction of the lab's valuation mark. An outside audit
   * prices to the client: a flat fee that stings a seed-stage lab is a
   * rounding error to one worth a trillion, so the bill is
   * max(cashCostMillions, mark x this). Zero everywhere the lab's own fleet
   * does the work.
   */
  readonly cashFractionOfMark: number;
  readonly auraCost: number;
  readonly qualityModifier: number;
  readonly independence: number;
  readonly targets: readonly EvaluationTarget[];
  readonly anomalySensitivity: number;
  readonly playerStartable: boolean;
}

export interface EvaluationRulesDefinition {
  readonly definitions: Readonly<Record<string, EvaluationDefinition>>;
  readonly baselineEvaluationId: ContentId;
  readonly investigation: {
    readonly bands: readonly {
      readonly minimumObservedSeverity: number;
      readonly maximumObservedSeverity: number;
      readonly label: "Weak" | "Moderate" | "Serious" | "Critical";
      readonly durationWeeks: number;
      readonly cashCostMillions: number;
      /** Cash floor as a fraction of the lab's current valuation mark. */
      readonly cashFractionOfMark: number;
      /**
       * Upper bound for valuation-linked cash pricing. Investigation capacity
       * cannot plausibly absorb an unlimited fraction of a late-game mark.
       */
      readonly maximumCashCostMillions: number;
      readonly auraCost: number;
    }[];
    readonly severeObservedThreshold: number;
    readonly forcedEventCount: number;
  };
  readonly incident: {
    readonly baseHazardByFrontierCapability: readonly {
      readonly maximum: number;
      readonly weeklyHazard: number;
    }[];
    readonly minimumHazard: number;
    readonly maximumHazard: number;
  };
}

export type DeploymentPolicy =
  "internal-only" | "research-preview" | "guarded-api" | "open-api" | "weights-release";

export interface DeploymentPolicyDefinition {
  readonly policy: DeploymentPolicy;
  readonly displayName: string;
  readonly exposure: number;
  readonly marketDemandMultiplier: number;
  readonly revenueMultiplier: number;
  readonly marketAppealAdjustment: number;
  readonly oneTimeAura: number;
  readonly irreversible: boolean;
}

export type ProductisationMode = "normal" | "hardened" | "rush";

export interface ProductisationRecipeDefinition {
  readonly mode: ProductisationMode;
  readonly displayName: string;
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  /** Fraction of the gap to the model- and lab-specific engineering target. */
  readonly productQualityTowardTarget: number;
  readonly reliabilityTowardTarget: number;
  readonly productQualityFlat: number;
  readonly reliabilityFlat: number;
  readonly exposureMultiplier: number;
  readonly incidentDeploymentFactor: number;
  readonly evidencePenalty: number;
}

export interface DeploymentRulesDefinition {
  readonly policies: Readonly<Record<DeploymentPolicy, DeploymentPolicyDefinition>>;
  readonly productisation: Readonly<
    Record<ProductisationMode, ProductisationRecipeDefinition>
  >;
}

export interface AuraRulesDefinition {
  readonly signalMaximum: number;
  readonly lifetimeSignalPerAura: number;
  readonly publicEventRecoveryWeeks: number;
  readonly paperSignalImpactPerAura: number;
  readonly modelLaunchSignalImpactPerAura: number;
  readonly servingSignalImpactPerAura: number;
  readonly modelLaunchAwards: readonly {
    readonly maximumMeasuredCapability: number;
    readonly aura: number;
  }[];
  readonly incidentAuraLoss: Readonly<
    Record<"minor" | "serious" | "major" | "critical" | "catastrophe", number>
  >;
}

export type FundraisingCampaignType =
  "quiet-bridge" | "competitive-round" | "mega-round-roadshow";

export interface FundraisingCampaignDefinition {
  readonly campaign: FundraisingCampaignType;
  readonly displayName: string;
  readonly auraCost: number;
  readonly durationWeeks: number;
  readonly cooldownWeeks: number;
  readonly offerCount: number;
  readonly offerExpiryWeeks: number;
  /** Campaign-specific scale around the standard fraction of the lab's mark. */
  readonly roundSizeMultiplier: number;
  /** Minimum viable cheque before valuation-driven sizing takes over. */
  readonly baseCashMillions: number;
  /** Per-point lift to the valuation-sized cheque's funding-score factor. */
  readonly fundingScoreCashMultiplier: number;
  readonly attentionBonus: number;
  readonly conditionTier: 1 | 2 | 3;
}

export interface FundraisingRulesDefinition {
  readonly campaigns: Readonly<
    Record<FundraisingCampaignType, FundraisingCampaignDefinition>
  >;
  readonly cashVariance: { readonly minimum: number; readonly maximum: number };
}

export interface CapabilityTierDefinition {
  readonly id: ContentId;
  readonly level: number;
  readonly name: string;
  readonly nominalFrontierCapability: { readonly min: number; readonly max: number };
  readonly summary: string;
  readonly unlockTags: readonly string[];
}

export interface CapabilityTiersDefinition {
  readonly definitions: Readonly<Record<string, CapabilityTierDefinition>>;
  readonly orderedIds: readonly ContentId[];
  readonly progressPresentation: readonly (
    "early" | "developing" | "approaching" | "breakthrough-imminent"
  )[];
}

export interface DifficultyDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly revenueMultiplier: number;
  readonly fixedCostMultiplier: number;
  readonly rivalProgressMultiplier: number;
  readonly incidentPressureMultiplier: number;
  readonly displayedEstimateQualityBonus: number;
}

export interface MandateDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly tagline: string;
  readonly summary: string;
  readonly effects: readonly AuthoredEffect[];
}

export interface NewGameBalance {
  readonly cash: number;
  readonly auraSpendable: number;
  readonly auraLifetime: number;
  readonly gpus: {
    readonly generationId: ContentId;
    readonly owned: number;
  };
  readonly finance: {
    readonly generalResearcherCostPerCycle: number;
    readonly engineerAndOpsCostPerCycle: number;
    readonly facilityCostPerInstancePerCycle: number;
    readonly executiveCostPerCycle: number;
  };
  readonly startingModel: {
    readonly capability: Readonly<Record<string, number>>;
    readonly productQuality: number;
    readonly reliability: number;
    readonly hiddenSafety: Readonly<Record<string, number>>;
  };
  readonly marketShare: number;
  readonly starSlots: number;
  readonly generalResearchers: number;
  readonly engineersAndOps: number;
  readonly ratings: Readonly<Record<string, number>>;
  /** Keyed by canonical domain ContentId. */
  readonly domains: Readonly<Record<string, number>>;
  /** Keyed by canonical safety-program ContentId. */
  readonly safetyProgramLevels: Readonly<Record<string, number>>;
  readonly facilities: readonly ContentId[];
  readonly allocation: {
    readonly servingFleetShareBasisPoints: number;
    readonly capabilityBasisPoints: number;
    readonly capabilityDomainWeights: Readonly<Record<string, number>>;
    readonly safetyProgramWeights: Readonly<Record<string, number>>;
  };
}

export type ResearcherContractBand = "focused" | "competitive" | "major" | "lab-defining";

export type ResearcherAssignmentKind =
  | "capability-program"
  | "safety-program"
  | "training-run"
  | "productisation"
  | "facility-project"
  | "science-project"
  | "research-council"
  | "safety-director"
  | "external-council"
  | "evaluation-project"
  | "robotics-project";

export type ResearcherActivationDefinition = AuthoredResearcherActivation;

export type ResearcherUnlockDefinition =
  | { readonly yearAtLeast: number }
  | { readonly domainLevelAtLeast: number }
  | { readonly safetyDomainLevelAtLeast: number }
  | { readonly modelFcAtLeast: number }
  | { readonly discoveredTag: string }
  | { readonly domainUnlocked: ContentId }
  | { readonly facilityOwned: ContentId }
  | { readonly facilityCompleted: ContentId }
  | { readonly phaseAtLeast: "foundation" | "scaling" | "frontier" | "crisis" };

export type ResearcherCompactCheckDefinition =
  | { readonly metric: string; readonly atLeast: number }
  | {
      readonly type: "tagged-action-within";
      readonly tags: readonly string[];
      readonly weeks: number;
    }
  | {
      readonly type: "conditional-tagged-action-within";
      readonly condition: { readonly metric: string; readonly atLeast: number };
      readonly tags: readonly string[];
      readonly weeks: number;
    }
  | {
      readonly type: "assignment-requires-project-tag";
      readonly assignmentTag: string;
      readonly projectTag: string;
      readonly weeks: number;
    }
  | {
      readonly type: "conditional-metric-at-least";
      readonly condition:
        | { readonly metric: string; readonly value: number }
        | { readonly assignmentDomain: ContentId };
      readonly metric: string;
      readonly value: number;
    }
  | {
      readonly type: "conditional-pool-share-at-least";
      readonly condition: {
        readonly modelTrainingOrDeployedFcAtLeast: number;
      };
      readonly pool: string;
      readonly target: string;
      readonly value: number;
    }
  | {
      readonly type: "facility-owned-within";
      readonly facility: ContentId;
      readonly weeks: number;
    }
  | {
      readonly type: "minimum-assignment-duration";
      readonly domain: ContentId;
      readonly weeks: number;
    }
  | {
      readonly type: "publication-requires-review-tag";
      readonly paperTag: string;
      readonly reviewTag: string;
    }
  | {
      readonly type: "ratio-at-least";
      readonly numerator: string;
      readonly denominator: string;
      readonly value: number;
      readonly graceDiscoveries: number;
    }
  | {
      readonly type: "release-requires-project";
      readonly minFc: number;
      readonly projectTag: string;
    }
  | {
      readonly type: "deployment-requires-flag";
      readonly frontierCapabilityAtLeast: number;
      readonly flag: string;
    };

export interface ResearcherModifierDefinition {
  readonly target: string;
  readonly operation: "add" | "multiply" | "min" | "max";
  readonly value: number;
  readonly stackingGroup?: string;
  readonly activation?: ResearcherActivationDefinition;
  readonly beforeDiscovery?: string;
  readonly afterDiscovery?: string;
  readonly requiresCompletedProject?: string;
  readonly charges?: number;
  readonly grantedOn?: string;
  readonly floorSource?: string;
  readonly note?: string;
  readonly explanationKey?: string;
  readonly durationWeeks?: number;
  readonly duration?: string;
}

export interface ResearcherAbilityDefinition {
  readonly id: ContentId;
  readonly label: string;
  readonly eligibleAssignments: readonly ResearcherAssignmentKind[];
  readonly activation?: ResearcherActivationDefinition;
  readonly effects: readonly ResearcherModifierDefinition[];
  readonly modes: readonly {
    readonly domain?: ContentId;
    readonly assignment?: {
      readonly kind: ResearcherAssignmentKind;
      readonly id?: ContentId;
    };
    readonly effects: readonly ResearcherModifierDefinition[];
  }[];
  readonly rampWeeks: number;
  readonly notes?: string;
}

export interface ResearcherDefinition {
  readonly id: ContentId;
  readonly version: number;
  readonly displayName: string;
  readonly inspirationName: string;
  readonly inspirationSummary: string;
  readonly epithet: string;
  readonly role: string;
  readonly rosterCardSummary: string;
  readonly biography: string;
  readonly portrait: {
    readonly assetId: ContentId;
    readonly brief: string;
    readonly altText: string;
  };
  readonly skills: Readonly<Record<string, number>>;
  readonly traits: readonly ContentId[];
  readonly signature: ResearcherAbilityDefinition;
  readonly passive: ResearcherAbilityDefinition;
  readonly compact: {
    readonly id: ContentId;
    readonly label: string;
    readonly requirement: string;
    readonly cadence: "rolling" | "one-time" | "event-driven";
    readonly check: ResearcherCompactCheckDefinition;
    readonly breachEvent: ContentId;
    readonly attachedEffects: readonly ResearcherModifierDefinition[];
    readonly fulfilmentEffects: readonly ResearcherModifierDefinition[];
  };
  readonly availability: {
    readonly wave: "foundation" | "deep-learning" | "scaling" | "frontier";
    readonly earliestYear?: number;
    readonly unlockAny: readonly ResearcherUnlockDefinition[];
    readonly poolWeight: number;
  };
  readonly contract: {
    readonly band: ResearcherContractBand;
    readonly baseSalaryPerCycle: number;
    readonly baseSigningCash: number;
    readonly auraCost: number;
    readonly overrideExplanation?: string;
  };
  readonly paperHooks: {
    readonly ids: readonly ContentId[];
  };
  readonly eventReactions: readonly {
    readonly triggerTag: string;
    readonly line: string;
  }[];
  readonly feedLines: readonly string[];
  readonly sources: readonly string[];
  readonly portrayal: {
    readonly fictionalized: true;
    readonly endorsementImplied: false;
    readonly legalStatus?: string;
  };
  readonly review: {
    readonly biography: string;
    readonly mechanics: string;
    readonly tone: string;
    readonly reviewedOn: string;
  };
  readonly editorialReview: EditorialReviewMetadata;
}

export interface ResearcherRulesDefinition {
  readonly skillKeys: readonly string[];
  readonly contractBands: Readonly<
    Record<
      ResearcherContractBand,
      {
        readonly baseSalaryPerCycle: number;
        readonly baseSigningCash: number;
        readonly auraCost: number;
      }
    >
  >;
  readonly ability: {
    readonly reassignmentRamp: readonly number[];
    readonly unhousedStrengthMultiplier: number;
    readonly sabbaticalDisablesSignature: boolean;
    readonly sabbaticalDisablesPassive: boolean;
    readonly initialSlots: number;
    readonly hardMaximumSlots: number;
  };
  readonly compact: {
    readonly defaultRollingWindowWeeks: number;
    readonly breachEffects: readonly ResearcherModifierDefinition[];
  };
}

export interface ResearcherCatalogueDefinition {
  readonly definitions: Readonly<Record<string, ResearcherDefinition>>;
  readonly orderedIds: readonly ContentId[];
  readonly rules: ResearcherRulesDefinition;
}

// ---------------------------------------------------------------------------
// Authored decision events (TDD section 13)
// ---------------------------------------------------------------------------

export type EventCategory =
  | "research"
  | "people"
  | "market"
  | "safety"
  | "security"
  | "politics"
  | "rival"
  | "ai"
  | "finance"
  | "facility"
  | "endgame";

export type EventSeverity = "feed" | "decision" | "urgent" | "critical";

/** Closed player-facing probability language from GDD section 42.4. */
export const EVENT_LIKELIHOOD_LABELS = [
  "very-unlikely",
  "unlikely",
  "uncertain",
  "likely",
  "very-likely",
] as const;

export type EventLikelihoodLabel = (typeof EVENT_LIKELIHOOD_LABELS)[number];

export type EventMetricKey =
  | "run.tick"
  | "player.cash"
  | "player.aura.spendable"
  | "player.safety.safetyCulture"
  | "player.safety.evalQuality"
  | "player.safety.practicalControl"
  | "player.safety.securityPosture"
  | "player.organisation.boardPatience"
  | "player.politics.governmentTrust"
  | "player.politics.governmentAttention"
  | "player.politics.strategicDependence"
  | "player.politics.captureConcern"
  | "player.politics.interventionPressure"
  | "player.gpus.total"
  | "player.incidents.recentCount"
  | "player.incidents.recentWorstSeverity";

export type EventPredicateDefinition =
  | { readonly type: "always" }
  | {
      readonly type: "all";
      readonly items: readonly EventPredicateDefinition[];
    }
  | {
      readonly type: "any";
      readonly items: readonly EventPredicateDefinition[];
    }
  | { readonly type: "not"; readonly item: EventPredicateDefinition }
  | {
      readonly type: "compare";
      readonly metric: EventMetricKey;
      readonly op: "lt" | "lte" | "gt" | "gte" | "eq";
      readonly value: number;
    }
  | { readonly type: "has-flag"; readonly flag: string; readonly value?: boolean };

export interface EventWeightModifierDefinition {
  readonly predicate: EventPredicateDefinition;
  readonly multiplier: number;
}

export type MandatoryEventDetector =
  | "critical-runway"
  | "researcher-ultimatum"
  | "agi-candidate"
  | "rival-candidate"
  | "three-severe-anomalies"
  | "government-reporting"
  | "government-licensing"
  | "government-restriction"
  | "government-nationalisation"
  | "autonomy-experiments"
  | "autonomy-intrusion"
  | "autonomy-exfiltration"
  | "autonomy-egress-postmortem"
  | "autonomy-infrastructure";

export type EventTriggerDefinition =
  | { readonly kind: "opportunity" }
  | {
      readonly kind: "mandatory";
      readonly detector: MandatoryEventDetector;
      readonly priority: number;
    };

export interface EventCooldownDefinition {
  readonly group: string;
  readonly weeks: number;
}

export type EventTokenBindingSource =
  | "player-lab-name"
  | "player-leader-name"
  | "player-ai-name"
  | "calendar-year"
  | "trigger-text"
  | "trigger-number";

export interface EventTokenBindingDefinition {
  readonly token: string;
  readonly source: EventTokenBindingSource;
}

export interface EventEvidenceLineDefinition {
  readonly textKey: string;
  readonly metric?: EventMetricKey;
}

export type EventEffectDefinition =
  | {
      readonly kind: "add-resource";
      readonly subject: { readonly type: "player-lab" };
      readonly resource: "cash" | "aura-spendable";
      readonly amount: number;
      readonly auraChangeKind?: "gain" | "spend" | "loss";
      readonly auraCategory?:
        | "paper"
        | "model-launch"
        | "customer-satisfaction"
        | "customer-serving"
        | "safety"
        | "recruitment"
        | "fundraising"
        | "evaluation"
        | "researcher-relations"
        | "institution"
        | "incident"
        | "politics"
        | "other";
      readonly auraSignalImpact?: number;
    }
  | {
      readonly kind: "add-rating";
      readonly subject: { readonly type: "player-lab" };
      readonly rating:
        | "safetyCulture"
        | "alignmentScience"
        | "evalQuality"
        | "controlTheory"
        | "practicalControlStrength"
        | "securityPosture"
        | "boardPatience"
        | "internalCandour"
        | "governmentAttention"
        | "governmentTrust"
        | "strategicDependence"
        | "captureConcern";
      readonly amount: number;
    }
  | {
      readonly kind: "add-coalition-rating";
      readonly rating: "charterClarity" | "sharedProtocolQuality" | "verification";
      readonly amount: number;
    }
  | {
      readonly kind: "set-flag";
      readonly subject: { readonly type: "player-lab" };
      readonly flag: string;
      readonly value: string | number | boolean;
    }
  | {
      readonly kind: "add-modifier";
      readonly target: string;
      readonly operation: "add" | "multiply" | "min" | "max";
      readonly value: number;
      readonly durationWeeks?: number;
      readonly tags?: readonly string[];
    }
  | {
      readonly kind: "schedule-effects";
      readonly dueInWeeks: number;
      readonly effects: readonly EventEffectDefinition[];
    };

export type EventMemorySubjectDefinition =
  { readonly type: "player-lab" } | { readonly type: "token"; readonly token: string };

/**
 * Authored memories carry tags, not sentiment. Every rule that consumes a
 * decision memory dispatches on its tags; the one consumer that reads valence
 * only ever sees memories built at runtime, so an authored score would be
 * inert. Tag the memory for whatever should read it.
 */
export interface EventMemoryDefinition {
  readonly key: string;
  readonly subjects: readonly EventMemorySubjectDefinition[];
  readonly tags: readonly string[];
  readonly expiresInWeeks?: number;
}

export interface EventOutcomeDefinition {
  readonly id: string;
  readonly minimumInclusive: number;
  readonly maximumExclusive: number;
  readonly effects: readonly EventEffectDefinition[];
  readonly memories: readonly EventMemoryDefinition[];
}

export interface EventLikelihoodPromiseDefinition {
  readonly label: EventLikelihoodLabel;
  /** Outcome IDs which count as the promised check succeeding. Never project to UI. */
  readonly successOutcomeIds: readonly string[];
}

export interface EventCheckDefinition {
  readonly id: string;
  readonly outcomes: readonly EventOutcomeDefinition[];
  /** Omit for safety/deception checks whose true probability must stay hidden. */
  readonly likelihoodPromise?: EventLikelihoodPromiseDefinition;
}

export interface EventOptionDefinition {
  readonly id: string;
  readonly labelKey: string;
  readonly requirements: EventPredicateDefinition;
  readonly disabledReasonKey?: string;
  readonly knownCosts: readonly EventEffectDefinition[];
  readonly previewKey: string;
  readonly immediateEffects: readonly EventEffectDefinition[];
  readonly checks: readonly EventCheckDefinition[];
  readonly memories: readonly EventMemoryDefinition[];
  readonly confirmationRequired: boolean;
}

export interface EventFollowUpDefinition {
  readonly eventId: ContentId;
  readonly delayWeeks: number;
  readonly condition?: EventPredicateDefinition;
}

export interface EventDefinition {
  readonly id: ContentId;
  readonly version: number;
  readonly category: EventCategory;
  readonly severity: EventSeverity;
  readonly phase: "foundation" | "scaling" | "frontier" | "crisis" | "any";
  readonly trigger: EventTriggerDefinition;
  readonly prerequisites: EventPredicateDefinition;
  readonly exclusions?: EventPredicateDefinition;
  readonly baseWeight: number;
  readonly weightModifiers: readonly EventWeightModifierDefinition[];
  readonly cooldown: EventCooldownDefinition;
  readonly unique: boolean;
  readonly expiryWeeks?: number;
  readonly defaultOptionId?: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly evidence: readonly EventEvidenceLineDefinition[];
  readonly tokenBindings: readonly EventTokenBindingDefinition[];
  readonly options: readonly EventOptionDefinition[];
  readonly followUps: readonly EventFollowUpDefinition[];
  readonly telemetryTags: readonly string[];
}

export interface EventCatalogueDefinition {
  readonly definitions: Readonly<Record<string, EventDefinition>>;
  readonly orderedIds: readonly ContentId[];
}

const eventContentIdSchema = z.string().refine(isContentId, {
  message: "invalid event content ID",
});
const eventNonEmpty = z.string().min(1);
const eventFinite = z.number().finite();

export const eventPredicateDefinitionSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("always") }).strict(),
    z
      .object({
        type: z.literal("all"),
        items: z.array(eventPredicateDefinitionSchema).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("any"),
        items: z.array(eventPredicateDefinitionSchema).min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("not"),
        item: eventPredicateDefinitionSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("compare"),
        metric: z.enum([
          "run.tick",
          "player.cash",
          "player.aura.spendable",
          "player.safety.safetyCulture",
          "player.safety.evalQuality",
          "player.safety.practicalControl",
          "player.safety.securityPosture",
          "player.organisation.boardPatience",
          "player.politics.governmentTrust",
          "player.politics.governmentAttention",
          "player.politics.strategicDependence",
          "player.politics.captureConcern",
          "player.politics.interventionPressure",
          "player.gpus.total",
          "player.incidents.recentCount",
          "player.incidents.recentWorstSeverity",
        ]),
        op: z.enum(["lt", "lte", "gt", "gte", "eq"]),
        value: eventFinite,
      })
      .strict(),
    z
      .object({
        type: z.literal("has-flag"),
        flag: eventNonEmpty,
        value: z.boolean().optional(),
      })
      .strict(),
  ]),
);

const eventSubjectSchema = z.object({ type: z.literal("player-lab") }).strict();
export const eventEffectDefinitionSchema: z.ZodType = z.lazy(() =>
  z.union([
    z
      .object({
        kind: z.literal("add-resource"),
        subject: eventSubjectSchema,
        resource: z.enum(["cash", "aura-spendable"]),
        amount: eventFinite,
        auraChangeKind: z.enum(["gain", "spend", "loss"]).optional(),
        auraCategory: z
          .enum([
            "paper",
            "model-launch",
            "customer-satisfaction",
            "customer-serving",
            "safety",
            "recruitment",
            "fundraising",
            "evaluation",
            "researcher-relations",
            "institution",
            "incident",
            "politics",
            "other",
          ])
          .optional(),
        auraSignalImpact: eventFinite.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("add-rating"),
        subject: eventSubjectSchema,
        rating: z.enum([
          "safetyCulture",
          "alignmentScience",
          "evalQuality",
          "controlTheory",
          "practicalControlStrength",
          "securityPosture",
          "boardPatience",
          "internalCandour",
          "governmentAttention",
          "governmentTrust",
          "strategicDependence",
          "captureConcern",
        ]),
        amount: eventFinite,
      })
      .strict(),
    z
      .object({
        kind: z.literal("add-coalition-rating"),
        rating: z.enum(["charterClarity", "sharedProtocolQuality", "verification"]),
        amount: eventFinite,
      })
      .strict(),
    z
      .object({
        kind: z.literal("set-flag"),
        subject: eventSubjectSchema,
        flag: eventNonEmpty,
        value: z.union([z.string(), eventFinite, z.boolean()]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("add-modifier"),
        target: eventNonEmpty,
        operation: z.enum(["add", "multiply", "min", "max"]),
        value: eventFinite,
        durationWeeks: z.number().int().nonnegative().optional(),
        tags: z.array(eventNonEmpty).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("schedule-effects"),
        dueInWeeks: z.number().int().nonnegative(),
        effects: z.array(eventEffectDefinitionSchema).min(1),
      })
      .strict(),
  ]),
);

const eventMemoryDefinitionSchema = z
  .object({
    key: eventNonEmpty,
    subjects: z
      .array(
        z.union([
          z.object({ type: z.literal("player-lab") }).strict(),
          z
            .object({
              type: z.literal("token"),
              token: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
            })
            .strict(),
        ]),
      )
      .min(1),
    tags: z.array(eventNonEmpty),
    expiresInWeeks: z.number().int().positive().optional(),
  })
  .strict();

const eventOutcomeDefinitionSchema = z
  .object({
    id: eventNonEmpty,
    minimumInclusive: eventFinite.min(0).max(1),
    maximumExclusive: eventFinite.min(0).max(1),
    effects: z.array(eventEffectDefinitionSchema),
    memories: z.array(eventMemoryDefinitionSchema),
  })
  .strict();

const eventOptionDefinitionSchema = z
  .object({
    id: eventNonEmpty,
    labelKey: eventNonEmpty,
    requirements: eventPredicateDefinitionSchema,
    disabledReasonKey: eventNonEmpty.optional(),
    knownCosts: z.array(eventEffectDefinitionSchema),
    previewKey: eventNonEmpty,
    immediateEffects: z.array(eventEffectDefinitionSchema),
    checks: z.array(
      z
        .object({
          id: eventNonEmpty,
          outcomes: z.array(eventOutcomeDefinitionSchema).min(1),
          likelihoodPromise: z
            .object({
              label: z.enum(EVENT_LIKELIHOOD_LABELS),
              successOutcomeIds: z.array(eventNonEmpty).min(1),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    memories: z.array(eventMemoryDefinitionSchema),
    confirmationRequired: z.boolean(),
  })
  .strict();

export const eventDefinitionSchema = z
  .object({
    id: eventContentIdSchema,
    version: z.number().int().positive(),
    category: z.enum([
      "research",
      "people",
      "market",
      "safety",
      "security",
      "politics",
      "rival",
      "ai",
      "finance",
      "facility",
      "endgame",
    ]),
    severity: z.enum(["feed", "decision", "urgent", "critical"]),
    phase: z.enum(["foundation", "scaling", "frontier", "crisis", "any"]),
    trigger: z.union([
      z.object({ kind: z.literal("opportunity") }).strict(),
      z
        .object({
          kind: z.literal("mandatory"),
          detector: z.enum([
            "critical-runway",
            "researcher-ultimatum",
            "agi-candidate",
            "rival-candidate",
            "three-severe-anomalies",
            "government-reporting",
            "government-licensing",
            "government-restriction",
            "government-nationalisation",
            "autonomy-experiments",
            "autonomy-intrusion",
            "autonomy-exfiltration",
            "autonomy-egress-postmortem",
            "autonomy-infrastructure",
          ]),
          priority: eventFinite,
        })
        .strict(),
    ]),
    prerequisites: eventPredicateDefinitionSchema,
    exclusions: eventPredicateDefinitionSchema.optional(),
    baseWeight: eventFinite.nonnegative(),
    weightModifiers: z.array(
      z
        .object({
          predicate: eventPredicateDefinitionSchema,
          multiplier: eventFinite.nonnegative(),
        })
        .strict(),
    ),
    cooldown: z
      .object({
        group: eventNonEmpty,
        weeks: z.number().int().nonnegative(),
      })
      .strict(),
    unique: z.boolean(),
    expiryWeeks: z.number().int().positive().optional(),
    defaultOptionId: eventNonEmpty.optional(),
    titleKey: eventNonEmpty,
    bodyKey: eventNonEmpty,
    evidence: z.array(
      z
        .object({
          textKey: eventNonEmpty,
          metric: z
            .enum([
              "run.tick",
              "player.cash",
              "player.aura.spendable",
              "player.safety.safetyCulture",
              "player.safety.evalQuality",
              "player.safety.practicalControl",
              "player.safety.securityPosture",
              "player.organisation.boardPatience",
              "player.politics.governmentTrust",
              "player.politics.governmentAttention",
              "player.politics.strategicDependence",
              "player.politics.captureConcern",
              "player.politics.interventionPressure",
              "player.gpus.total",
              "player.incidents.recentCount",
              "player.incidents.recentWorstSeverity",
            ])
            .optional(),
        })
        .strict(),
    ),
    tokenBindings: z.array(
      z
        .object({
          token: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
          source: z.enum([
            "player-lab-name",
            "player-leader-name",
            "player-ai-name",
            "calendar-year",
            "trigger-text",
            "trigger-number",
          ]),
        })
        .strict(),
    ),
    options: z.array(eventOptionDefinitionSchema).min(1),
    followUps: z.array(
      z
        .object({
          eventId: eventContentIdSchema,
          delayWeeks: z.number().int().nonnegative(),
          condition: eventPredicateDefinitionSchema.optional(),
        })
        .strict(),
    ),
    telemetryTags: z.array(eventNonEmpty),
  })
  .strict();

export const eventCatalogueDefinitionSchema = z
  .object({
    definitions: z.record(z.string(), eventDefinitionSchema),
    orderedIds: z.array(eventContentIdSchema),
  })
  .strict();

/**
 * Player-facing copy for authored content, keyed by localisation message key.
 * Events reference copy by key; the bundle carries the resolved catalogue so
 * the UI renders authored prose rather than a humanised key.
 */
export interface CopyCatalogueDefinition {
  readonly locale: string;
  readonly messages: Readonly<Record<string, string>>;
}

export const copyCatalogueDefinitionSchema = z
  .object({
    locale: z.string().min(1),
    messages: z.record(z.string(), z.string().min(1)),
  })
  .strict();

export interface CompiledContent {
  readonly bundleFormat: 2;
  readonly manifest: {
    readonly contentVersion: string;
    readonly bundleHash: string;
  };
  readonly authoringManifest: AuthoringManifest;
  readonly assets: AssetCatalogueDefinition;
  readonly leaders: Readonly<Record<string, LeaderDefinition>>;
  readonly labs: Readonly<Record<string, LabDefinition>>;
  readonly gpuGenerations: Readonly<Record<string, GpuGenerationDefinition>>;
  readonly market: MarketDefinition;
  readonly facilities: Readonly<Record<string, FacilityDefinition>>;
  readonly research: ResearchDefinition;
  readonly papers: PapersDefinition;
  readonly training: TrainingRulesDefinition;
  readonly evaluations: EvaluationRulesDefinition;
  readonly deployment: DeploymentRulesDefinition;
  readonly aura: AuraRulesDefinition;
  readonly fundraising: FundraisingRulesDefinition;
  readonly capabilityTiers: CapabilityTiersDefinition;
  readonly researchers: ResearcherCatalogueDefinition;
  readonly events: EventCatalogueDefinition;
  readonly copy: CopyCatalogueDefinition;
  readonly difficulties: Readonly<Record<string, DifficultyDefinition>>;
  readonly mandates: Readonly<Record<string, MandateDefinition>>;
  readonly balance: {
    readonly newGame: NewGameBalance;
    readonly facilities: { readonly baselineOwnedGpuCapacity: number };
  };
  readonly scoreRules: ScoreRulesDefinition;
}

export const editorialReviewMetadataSchema = z
  .object({
    sourceNotes: z.array(z.string().min(1)),
    lastReviewed: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    portrayalStatus: z.enum([
      "fictionalized",
      "historical-record",
      "fictional-work",
      "unreviewed",
    ]),
    legalStatus: z.string().min(1).optional(),
  })
  .strict();

const sourcedDefinitionSchema = z
  .object({ editorialReview: editorialReviewMetadataSchema })
  .passthrough();

const sourcedCatalogueSchema = z
  .object({ definitions: z.record(z.string(), sourcedDefinitionSchema) })
  .passthrough();

/** Loose structural validation of the emitted bundle (consumer-side guard). */
export const compiledContentSchema = z
  .object({
    bundleFormat: z.literal(2),
    manifest: z
      .object({
        contentVersion: z.string().min(1),
        bundleHash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    authoringManifest: authoringManifestSchema,
    assets: assetCatalogueDefinitionSchema,
    leaders: z.record(z.string(), sourcedDefinitionSchema),
    labs: z.record(z.string(), z.unknown()),
    gpuGenerations: z.record(z.string(), z.unknown()),
    market: z.unknown(),
    facilities: z.record(z.string(), z.unknown()),
    research: z.unknown(),
    papers: sourcedCatalogueSchema,
    training: z.unknown(),
    evaluations: z.unknown(),
    deployment: z.unknown(),
    aura: z.unknown(),
    fundraising: z.unknown(),
    capabilityTiers: z.unknown(),
    researchers: sourcedCatalogueSchema,
    events: eventCatalogueDefinitionSchema,
    copy: copyCatalogueDefinitionSchema,
    difficulties: z.record(z.string(), z.unknown()),
    mandates: z.record(z.string(), z.unknown()),
    balance: z
      .object({
        newGame: z.unknown(),
        facilities: z
          .object({ baselineOwnedGpuCapacity: z.number().int().min(0) })
          .strict(),
      })
      .strict(),
    scoreRules: z.unknown(),
  })
  .strict();

export function validateCompiledContent(value: unknown): CompiledContent {
  const parsed = compiledContentSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid compiled content bundle: ${issues}`);
  }
  return parsed.data as unknown as CompiledContent;
}
