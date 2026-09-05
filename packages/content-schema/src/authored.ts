import { z } from "zod";

/**
 * Schemas for the hand-authored draft YAML files under `content/`.
 *
 * These match the files as authored (draft IDs like `leader-thomas-hassabi`);
 * the content compiler canonicalises IDs and reshapes records into the
 * compiled definitions of `compiled.ts`.
 */

export const authoredActivationSchema: z.ZodType<AuthoredActivation> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal("metric-below"),
        metric: z.string().min(1),
        value: z.number().finite(),
      })
      .strict(),
    z.object({ type: z.literal("flag-absent"), flag: z.string().min(1) }).strict(),
    z
      .object({
        type: z.literal("all"),
        items: z.array(authoredActivationSchema).min(1),
      })
      .strict(),
  ]),
);

export type AuthoredActivation =
  | { readonly type: "metric-below"; readonly metric: string; readonly value: number }
  | { readonly type: "flag-absent"; readonly flag: string }
  | { readonly type: "all"; readonly items: readonly AuthoredActivation[] };

export const authoredEffectSchema = z
  .object({
    target: z.string().min(1),
    operation: z.enum(["add", "multiply", "min", "max"]),
    value: z.number().finite(),
    activation: authoredActivationSchema.optional(),
  })
  .strict();

export type AuthoredEffect = z.infer<typeof authoredEffectSchema>;

const portrayalSchema = z
  .object({
    fictionalized: z.literal(true),
    endorsementImplied: z.literal(false),
    /** Absent once no legal-status marker is outstanding against the record. */
    legalStatus: z.string().min(1).optional(),
  })
  .strict();

/** Draft-compatible override; final manifests require every field via the release report. */
const authoredEditorialReviewSchema = z
  .object({
    sourceNotes: z.array(z.string().min(1)).optional(),
    lastReviewed: z
      .union([z.string().min(1), z.date()])
      .nullable()
      .optional(),
    portrayalStatus: z
      .enum(["fictionalized", "historical-record", "fictional-work", "unreviewed"])
      .optional(),
    legalStatus: z.string().min(1).optional(),
  })
  .strict();

const namedEffectGroupSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    effects: z.array(authoredEffectSchema).min(1),
  })
  .strict();

/** `headlineBonus` appears in three shapes; the compiler normalises to effects. */
const headlineBonusSchema = z.union([
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      target: z.string().min(1),
      operation: z.enum(["add", "multiply", "min", "max"]),
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      targets: z.array(z.string().min(1)).min(1),
      operation: z.enum(["add", "multiply", "min", "max"]),
      value: z.number().finite(),
    })
    .strict(),
  namedEffectGroupSchema,
]);

export const launchLeadersFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("launch-leaders-and-labs"),
    status: z.string().min(1),
    leaders: z
      .array(
        z
          .object({
            id: z.string().min(1),
            displayName: z.string().min(1),
            inspirationName: z.string().min(1),
            inspirationSummary: z.string().min(1),
            epithet: z.string().min(1),
            company: z
              .object({ id: z.string().min(1), displayName: z.string().min(1) })
              .strict(),
            aiFamily: z.string().min(1),
            characteristic: z.string().min(1),
            headlineBonus: headlineBonusSchema,
            biography: z.string().min(100),
            labModifiers: z.array(namedEffectGroupSchema).min(1),
            complexity: z.string().min(1),
            sourceNotes: z.array(z.string().url()).min(1),
            portrayal: portrayalSchema,
            editorialReview: authoredEditorialReviewSchema.optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type LaunchLeadersFile = z.infer<typeof launchLeadersFileSchema>;

export const gpuGenerationsFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentType: z.literal("gpu-generations"),
    status: z.string().min(1),
    designContract: z.record(z.string(), z.string()),
    generations: z
      .array(
        z
          .object({
            id: z.string().regex(/^gpu\.[a-z0-9-]+$/),
            displayName: z.string().min(1),
            manufacturer: z.string().min(1),
            historicity: z.enum(["real", "fictional"]),
            label: z.literal("FICTIONAL HARDWARE").optional(),
            nominalYear: z.number().int().min(2012),
            unlockAtWorldFrontierCapability: z.number().min(0).max(100),
            trainingFactor: z.number().positive(),
            servingFactor: z.number().positive(),
            powerPerThousand: z.number().positive(),
            interconnectTier: z.number().int().min(1),
            reliability: z.number().min(0).max(100),
            gameCostMillionsPerThousand: z.number().positive(),
            gameOperatingCostMillionsPerThousandPerCycle: z.number().positive(),
            deliveryWeeks: z.number().int().positive(),
            summary: z.string().min(1),
            education: z.string().min(80),
            announcement: z.string().min(40),
            source: z.string().url().optional(),
          })
          .strict(),
      )
      .min(1),
    review: z.record(z.string(), z.union([z.boolean(), z.string()])),
  })
  .strict();

export type GpuGenerationsFile = z.infer<typeof gpuGenerationsFileSchema>;

const publicPriceTierSchema = z.enum([
  "free-preview",
  "cheap",
  "market",
  "premium",
  "scarcity",
]);

const appealWeightsSchema = z
  .object({
    capability: z.number().min(0).max(1),
    productQuality: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    governmentTrust: z.number().min(0).max(1).default(0),
  })
  .strict();

export const marketFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentType: z.literal("market"),
    status: z.string().min(1),
    softmaxTemperature: z.number().positive(),
    baseGlobalServingDemandTeraflops: z.number().positive(),
    servingDemandCapabilityDivisor: z.number().positive(),
    baseGlobalRevenueMillionsPerCycle: z.number().positive(),
    valuePerDeliveredFlopQuadraticFactor: z.number().nonnegative(),
    startingSatisfaction: z.number().min(0).max(100),
    monetisationEfficiency: z.number().min(0).max(1),
    priceTiers: z
      .array(
        z
          .object({
            id: publicPriceTierSchema,
            displayName: z.string().min(1),
            unitPriceMillions: z.number().nonnegative(),
          })
          .strict(),
      )
      .length(5),
    segments: z
      .array(
        z
          .object({
            id: z.string().regex(/^segment\.[a-z0-9-]+$/),
            displayName: z.string().min(1),
            globalUsagePerCycle: z.number().positive(),
            revenueShare: z.number().min(0).max(1),
            servingComputeShare: z.number().min(0).max(1),
            marketAvailability: z.number().min(0).max(1),
            acquisitionRate: z.number().min(0).max(1),
            capabilityWeights: z.record(z.string(), z.number().min(0).max(1)),
            appealWeights: appealWeightsSchema,
            pricePenalties: z.record(publicPriceTierSchema, z.number().nonnegative()),
            staticRivalAppeals: z.array(z.number().min(0).max(100)).min(1),
            rivalCapabilityBenchmark: z.number().min(0).max(100),
          })
          .strict(),
      )
      .min(2),
  })
  .strict();

export type MarketFile = z.infer<typeof marketFileSchema>;

export const facilitiesFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentType: z.literal("facilities"),
    status: z.string().min(1),
    facilities: z
      .array(
        z
          .object({
            id: z.string().regex(/^facility\.[a-z0-9-]+$/),
            displayName: z.string().min(1),
            family: z.string().min(1),
            tier: z.number().int().positive(),
            cashCostMillions: z.number().nonnegative(),
            operatingCostMillionsPerCycle: z.number().nonnegative(),
            durationWeeks: z.number().int().positive(),
            prerequisiteFacilityIds: z.array(z.string().regex(/^facility\.[a-z0-9-]+$/)),
            bonusMajorProjectSlots: z.number().int().nonnegative().default(0),
            supportedOwnedGpuCount: z.number().int().nonnegative(),
            scoreTag: z.string().min(1),
            tags: z.array(z.string().min(1)).min(1),
            campusModule: z.string().min(1),
            summary: z.string().min(1),
            modifiers: z.array(authoredEffectSchema),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type FacilitiesFile = z.infer<typeof facilitiesFileSchema>;

const researchProgramSchema = z
  .object({
    id: z.string().regex(/^(domain|safety)\.[a-z0-9-]+$/),
    name: z.string().min(1),
    shortName: z.string().min(1).optional(),
    description: z.string().min(1),
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    levelCostMultiplier: z.number().min(0.5).max(2),
    outputModifierTarget: z.string().min(1).optional(),
  })
  .strict();

const genericAdvanceTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    stageNames: z.array(z.string().min(1)).length(10),
    description: z.string().min(1),
    effects: z.array(authoredEffectSchema).min(1),
  })
  .strict();

const varianceRangeSchema = z
  .object({
    min: z.number().positive(),
    mode: z.number().positive(),
    max: z.number().positive(),
  })
  .strict()
  .refine((range) => range.min <= range.mode && range.mode <= range.max, {
    message: "variance range must satisfy min <= mode <= max",
  });

export const researchDomainsFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("research-domains"),
    status: z.string().min(1),
    capabilityDomains: z.array(researchProgramSchema).length(7),
    safetyPrograms: z.array(researchProgramSchema).length(3),
    genericAdvanceOptions: z.record(
      z.string().regex(/^(domain|safety)\.[a-z0-9-]+$/),
      z.array(genericAdvanceTemplateSchema).length(2),
    ),
    rules: z
      .object({
        skillScale: z.object({ min: z.number(), max: z.number() }).strict(),
        visibleDomainScale: z.object({ min: z.literal(0), max: z.literal(100) }).strict(),
        paperDomainWeightTolerance: z.number().positive(),
        unfundedDomainsProduceProgress: z.boolean(),
        production: z
          .object({
            teraflopScaleDivisor: z.number().positive(),
            baseCoefficient: z.number().positive(),
            gpuExponent: z.number().positive(),
            lowLevelRpPerPoint: z.number().positive(),
            levelCostGrowth: z.number().min(1).max(1.5),
            safetyLevelCostGrowth: z.number().min(1).max(1.5),
            levelCostGrowthFromLevel: z.number().int().min(0).max(99),
            levelCostBands: z
              .array(
                z
                  .object({
                    afterLevel: z.number().int().min(0).max(99),
                    multiplier: z.number().positive(),
                  })
                  .strict(),
              )
              .min(1),
            generalResearcherContribution: z.number().nonnegative(),
            talentMultiplier: z
              .object({ min: z.number().positive(), max: z.number().positive() })
              .strict(),
            facilityContribution: z.number().nonnegative(),
            facilityMultiplierMax: z.number().min(1),
            weeklyVariance: varianceRangeSchema,
            modelAssistBase: z.number().positive(),
            contextSwitchMultiplier: z.number().positive().max(1),
          })
          .strict(),
        genericAdvanceThresholds: z.array(z.number().int().min(1).max(100)).length(5),
      })
      .strict(),
  })
  .strict();

export type ResearchDomainsFile = z.infer<typeof researchDomainsFileSchema>;

const authoredPaperEffectSchema = z
  .object({
    target: z.string().min(1),
    operation: z.enum(["unlock", "add", "multiply", "min", "max"]),
    value: z.union([z.boolean(), z.number().finite()]),
  })
  .strict();

const authoredPaperPrerequisiteSchema = z
  .object({
    papers: z.array(z.string().regex(/^paper\.[a-z0-9-]+$/)).optional(),
    anyPapers: z
      .array(z.string().regex(/^paper\.[a-z0-9-]+$/))
      .min(1)
      .optional(),
    domainLevels: z
      .record(
        z.string().regex(/^(domain|safety)\.[a-z0-9-]+$/),
        z.number().min(0).max(100),
      )
      .optional(),
    facilities: z.array(z.string().regex(/^facility\.[a-z0-9-]+$/)).optional(),
  })
  .strict();

const authoredPaperSchema = z
  .object({
    id: z.string().regex(/^paper\.[a-z0-9-]+$/),
    version: z.number().int().positive(),
    historicity: z.enum(["real", "fictional-future"]),
    gameOrder: z.number().int().positive(),
    title: z.string().min(1),
    authors: z.array(z.string().min(1)).optional(),
    publicationYear: z.number().int().min(1900).optional(),
    venue: z.string().min(1).optional(),
    primarySourceUrl: z.string().url().optional(),
    doi: z.string().min(1).optional(),
    arxiv: z.string().min(1).optional(),
    fictionalLabel: z.literal("FICTIONAL FUTURE PAPER").optional(),
    historicalNote: z.string().min(1),
    education: z
      .object({
        playerSummary: z.string().min(100),
        archiveExplanation: z.string().min(300),
        insideBaseball: z.string().min(1),
      })
      .strict(),
    domainWeights: z.record(
      z.string().regex(/^(domain|safety)\.[a-z0-9-]+$/),
      z.number().positive(),
    ),
    prerequisites: authoredPaperPrerequisiteSchema,
    breakthroughRequirement: z
      .object({
        programme: z.string().regex(/^(domain|safety)\.[a-z0-9-]+$/),
        level: z.number().int().min(1).max(100),
      })
      .strict(),
    // Matches the runtime phases exactly. There used to be a fourth authored
    // value, "deep-learning", and the compiler shifted every name up by one:
    // authoring "scaling" produced a FRONTIER-gated paper. That silent
    // off-by-one is how 91 of 134 papers ended up unreachable.
    earliestPhase: z.enum(["foundation", "scaling", "frontier"]).optional(),
    discovery: z.object({ worldFirstAura: z.number().nonnegative() }).strict(),
    unlockEffects: z.array(authoredPaperEffectSchema),
    tags: z.array(z.string().min(1)).min(1),
    review: z
      .object({
        factual: z.string().min(1),
        mechanics: z.string().min(1),
        reviewedOn: z.union([z.string().min(1), z.date()]),
      })
      .strict(),
    editorialReview: authoredEditorialReviewSchema.optional(),
    allowPrerequisiteCycle: z.boolean().optional(),
  })
  .strict();

const paperPublicationPolicySchema = z
  .object({ auraMultiplier: z.number().nonnegative() })
  .strict();

export const landmarkPapersFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("real-landmark-papers"),
    pack: z.string().min(1),
    status: z.string().min(1),
    catalogueRules: z
      .object({
        chronology: z.literal("conceptual-prerequisites-not-calendar"),
        truePublicationYearAlwaysShown: z.literal(true),
        educationalCardAvailableUnderSecrecy: z.literal(true),
        breakthroughChance: z
          .object({
            basePerWeek: z.number().min(0).max(1),
            perLevelAbove: z.number().min(0).max(1),
            maximum: z.number().min(0).max(1),
          })
          .strict(),
        standardPublicationPolicy: z.string().min(1),
        phaseVocabulary: z.array(z.enum(["foundation", "scaling", "frontier"])).length(3),
        publicationPolicies: z
          .object({
            "publish-openly": paperPublicationPolicySchema,
            "controlled-publication": paperPublicationPolicySchema,
            "keep-secret": paperPublicationPolicySchema,
            "release-everything": paperPublicationPolicySchema,
          })
          .strict()
          .optional(),
        rivalStub: z
          .object({
            labId: z.string().regex(/^lab:[a-z0-9-]+$/),
            displayName: z.string().min(1),
            domainLevel: z.number().min(0).max(100),
            publicationPolicy: z.enum([
              "publish-openly",
              "controlled-publication",
              "keep-secret",
              "release-everything",
            ]),
          })
          .strict()
          .optional(),
      })
      .strict(),
    papers: z.array(authoredPaperSchema).min(10),
  })
  .strict();

export type LandmarkPapersFile = z.infer<typeof landmarkPapersFileSchema>;

// ---------------------------------------------------------------------------
// Star researchers (TDD 17.1)
// ---------------------------------------------------------------------------

const researcherAssignmentKindSchema = z.enum([
  "capability-program",
  "safety-program",
  "training-run",
  "productisation",
  "facility-project",
  "science-project",
  "research-council",
  "safety-director",
  "external-council",
  "evaluation-project",
  "robotics-project",
]);

export const researcherActivationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("assignment-domain-in"),
      values: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({ type: z.literal("assignment-id-in"), values: z.array(z.string()).min(1) })
    .strict(),
  z
    .object({
      type: z.literal("assignment-kind-in"),
      values: z.array(researcherAssignmentKindSchema).min(1),
    })
    .strict(),
  z
    .object({ type: z.literal("assignment-tag-in"), values: z.array(z.string()).min(1) })
    .strict(),
  z.object({ type: z.literal("assignment-domain"), value: z.string().min(1) }).strict(),
  z
    .object({ type: z.literal("assignment-programme"), value: z.string().min(1) })
    .strict(),
  z
    .object({ type: z.literal("assigned-project-kind"), value: z.string().min(1) })
    .strict(),
  z
    .object({
      type: z.literal("assigned-training-scale-in"),
      values: z.array(z.enum(["prototype", "product", "frontier"])).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("assignment-domain-or-training"),
      domain: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("assignment-domain-or-discovery"),
      domains: z.array(z.string()).min(1),
      discoveryTag: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("assignment-domain-or-project-tag"),
      domain: z.string().min(1),
      projectTag: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("metric-between-for-weeks"),
      metric: z.string().min(1),
      min: z.number(),
      max: z.number(),
      weeks: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("paired-allocation-at-least"),
      firstTags: z.array(z.string()).min(1),
      secondProgramme: z.string().min(1),
      eachShareOfRd: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("paired-safety-allocation-at-least"),
      programmes: z.array(z.string()).min(2),
      eachShareOfSafety: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("source-model-attribute-at-least"),
      attribute: z.string().min(1),
      value: z.number(),
    })
    .strict(),
  z.object({ type: z.literal("capability-program") }).strict(),
  z.object({ type: z.literal("training-run") }).strict(),
  z.object({ type: z.literal("ui-capacity-available") }).strict(),
  z.object({ type: z.literal("review-not-already-complete") }).strict(),
  z
    .object({ type: z.literal("rival-open-paper-and-player-prerequisites-satisfied") })
    .strict(),
]);

export type AuthoredResearcherActivation = z.infer<typeof researcherActivationSchema>;

export const authoredResearcherModifierSchema = z
  .object({
    target: z.string().min(1),
    operation: z.enum([
      "add",
      "add-percentage-points",
      "add-percentage-points-after-evidence",
      "block",
      "multiply",
      "min",
      "max",
    ]),
    value: z.number().finite(),
    stackingGroup: z.string().min(1).optional(),
    activation: researcherActivationSchema.optional(),
    beforeDiscovery: z.string().min(1).optional(),
    afterDiscovery: z.string().min(1).optional(),
    requiresCompletedProject: z.string().min(1).optional(),
    charges: z.number().int().positive().optional(),
    grantedOn: z.string().min(1).optional(),
    floorSource: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
    explanationKey: z.string().min(1).optional(),
    durationWeeks: z.number().int().positive().optional(),
    duration: z.string().min(1).optional(),
  })
  .strict();

export type AuthoredResearcherModifier = z.infer<typeof authoredResearcherModifierSchema>;

const compactLeafSchema = z
  .object({ metric: z.string().min(1), atLeast: z.number() })
  .strict();

export const researcherCompactCheckSchema: z.ZodType = z.lazy(() =>
  z.union([
    compactLeafSchema,
    z
      .object({
        type: z.literal("tagged-action-within"),
        tags: z.array(z.string()).length(1),
        weeks: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        type: z.literal("conditional-tagged-action-within"),
        condition: z.object({ metric: z.string().min(1), atLeast: z.number() }).strict(),
        tags: z.array(z.string()).length(1),
        weeks: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        type: z.literal("assignment-requires-project-tag"),
        assignmentTag: z.string().min(1),
        projectTag: z.string().min(1),
        weeks: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        type: z.literal("conditional-metric-at-least"),
        condition: z.union([
          z.object({ metric: z.string().min(1), value: z.number() }).strict(),
          z.object({ assignmentDomain: z.string().min(1) }).strict(),
        ]),
        metric: z.string().min(1),
        value: z.number(),
      })
      .strict(),
    z
      .object({
        type: z.literal("conditional-pool-share-at-least"),
        condition: z.object({ modelTrainingOrDeployedFcAtLeast: z.number() }).strict(),
        pool: z.string().min(1),
        target: z.string().min(1),
        value: z.number().min(0).max(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("facility-owned-within"),
        facility: z.string().min(1),
        weeks: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        type: z.literal("minimum-assignment-duration"),
        domain: z.string().min(1),
        weeks: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        type: z.literal("publication-requires-review-tag"),
        paperTag: z.string().min(1),
        reviewTag: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("ratio-at-least"),
        numerator: z.string().min(1),
        denominator: z.string().min(1),
        value: z.number().min(0).max(1),
        graceDiscoveries: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        type: z.literal("release-requires-project"),
        minFc: z.number(),
        projectTag: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("deployment-requires-flag"),
        frontierCapabilityAtLeast: z.number(),
        flag: z.string().min(1),
      })
      .strict(),
  ]),
);

const researcherUnlockSchema = z.union([
  z.object({ yearAtLeast: z.number().int().min(2012) }).strict(),
  z.object({ domainLevelAtLeast: z.number().min(0).max(100) }).strict(),
  z.object({ safetyDomainLevelAtLeast: z.number().min(0).max(100) }).strict(),
  z.object({ modelFcAtLeast: z.number().min(0).max(100) }).strict(),
  z.object({ discoveredTag: z.string().min(1) }).strict(),
  z.object({ domainUnlocked: z.string().min(1) }).strict(),
  z.object({ facilityOwned: z.string().min(1) }).strict(),
  z.object({ facilityCompleted: z.string().min(1) }).strict(),
  z
    .object({ phaseAtLeast: z.enum(["foundation", "scaling", "frontier", "crisis"]) })
    .strict(),
]);

const abilityModeSchema = z
  .object({
    domain: z.string().min(1),
    effects: z.array(authoredResearcherModifierSchema).min(1),
  })
  .strict();

const abilityAssignmentModeSchema = z
  .object({
    assignment: z
      .object({ kind: researcherAssignmentKindSchema, id: z.string().min(1).optional() })
      .strict(),
    effects: z.array(authoredResearcherModifierSchema).min(1),
  })
  .strict();

const researcherAbilitySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    eligibleAssignments: z.array(researcherAssignmentKindSchema).min(1).optional(),
    activation: researcherActivationSchema.optional(),
    effects: z.array(authoredResearcherModifierSchema).min(1).optional(),
    modes: z.array(abilityModeSchema).min(1).optional(),
    mutuallyExclusiveModes: z.array(abilityAssignmentModeSchema).min(1).optional(),
    rampWeeks: z.number().int().positive().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (ability) =>
      [ability.effects, ability.modes, ability.mutuallyExclusiveModes].filter(
        (value) => value !== undefined,
      ).length === 1,
    { message: "ability requires exactly one effects/modes form" },
  );

const researcherFileRecordSchema = z
  .object({
    id: z.string().regex(/^researcher\.[a-z0-9-]+$/),
    version: z.number().int().positive(),
    displayName: z.string().min(1),
    inspirationName: z.string().min(1),
    inspirationSummary: z.string().min(1),
    epithet: z.string().min(1),
    role: z.string().min(1),
    rosterCardSummary: z.string().min(1),
    biography: z.string().min(100),
    availability: z
      .object({
        wave: z.enum(["foundation", "deep-learning", "scaling", "frontier"]),
        earliestYear: z.number().int().min(2012).optional(),
        unlockAny: z.array(researcherUnlockSchema).min(1).optional(),
        poolWeight: z.number().positive(),
      })
      .strict(),
    contract: z
      .object({
        band: z.enum(["focused", "competitive", "major", "lab-defining"]),
        baseSalaryPerCycle: z.number().nonnegative(),
        baseSigningCash: z.number().nonnegative(),
        auraCost: z.number().nonnegative(),
        overrideExplanation: z.string().min(1).optional(),
      })
      .strict(),
    skills: z.record(z.string(), z.number().int().min(0).max(5)),
    traits: z.array(z.string().min(1)).min(1),
    signature: researcherAbilitySchema,
    passive: researcherAbilitySchema,
    compact: z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        requirement: z.string().min(1),
        cadence: z.enum(["rolling", "one-time", "event-driven"]).optional(),
        check: researcherCompactCheckSchema,
        breachEvent: z.string().min(1),
        attachedEffects: z.array(authoredResearcherModifierSchema).optional(),
        fulfilmentEffects: z.array(authoredResearcherModifierSchema).optional(),
      })
      .strict(),
    paperHooks: z.object({ ids: z.array(z.string()) }).strict(),
    eventReactions: z
      .array(
        z.object({ triggerTag: z.string().min(1), line: z.string().min(1) }).strict(),
      )
      .length(3),
    feedLines: z.array(z.string().min(1)).min(6),
    portrait: z
      .object({
        assetId: z.string().min(1),
        brief: z.string().min(20),
        altText: z.string().min(10),
      })
      .strict(),
    sources: z.array(z.string().url()).min(1),
    portrayal: portrayalSchema,
    review: z
      .object({
        biography: z.string().min(1),
        mechanics: z.string().min(1),
        tone: z.string().min(1),
        reviewedOn: z.union([z.string().min(1), z.date()]),
      })
      .strict(),
    editorialReview: authoredEditorialReviewSchema.optional(),
  })
  .strict();

export const starResearchersFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("star-researchers"),
    pack: z.string().min(1),
    availabilityWave: z.enum(["foundation", "deep-learning", "scaling", "frontier"]),
    status: z.string().min(1),
    researchers: z.array(researcherFileRecordSchema).min(1),
  })
  .strict();

export type StarResearchersFile = z.infer<typeof starResearchersFileSchema>;

export const starResearcherRulesFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("star-researcher-rules"),
    status: z.string().min(1),
    skillVocabulary: z
      .object({
        scale: z.object({ min: z.literal(0), max: z.literal(5) }).strict(),
        keys: z.array(z.string().min(1)).min(1),
        unspecifiedValue: z.literal(0),
      })
      .strict(),
    contractBands: z
      .object({
        focused: z
          .object({
            baseSalaryPerCycle: z.number(),
            baseSigningCash: z.number(),
            auraCost: z.number(),
          })
          .strict(),
        competitive: z
          .object({
            baseSalaryPerCycle: z.number(),
            baseSigningCash: z.number(),
            auraCost: z.number(),
          })
          .strict(),
        major: z
          .object({
            baseSalaryPerCycle: z.number(),
            baseSigningCash: z.number(),
            auraCost: z.number(),
          })
          .strict(),
        "lab-defining": z
          .object({
            baseSalaryPerCycle: z.number(),
            baseSigningCash: z.number(),
            auraCost: z.number(),
          })
          .strict(),
        note: z.string().min(1),
      })
      .strict(),
    compensationPolicy: z
      .object({
        // Retired: compensation is priced on measured research strength.
        // Kept optional so existing packs that still declare it validate.
        minimumFemaleAveragePremium: z.number().min(1).optional(),
        femaleResearcherIds: z.array(z.string().regex(/^researcher\.[a-z0-9-]+$/)).min(1),
        maleResearcherIds: z.array(z.string().regex(/^researcher\.[a-z0-9-]+$/)).min(1),
      })
      .strict(),
    abilityRules: z
      .object({
        reassignmentRamp: z.array(z.number().min(0).max(1)).length(4),
        unhousedStrengthMultiplier: z.number().min(0).max(1),
        sabbaticalDisablesSignature: z.boolean(),
        sabbaticalDisablesPassive: z.boolean(),
        initialSlots: z.number().int().positive(),
        hardMaximumSlots: z.number().int().positive(),
      })
      .strict(),
    compactRules: z
      .object({
        defaultRollingWindowWeeks: z.number().int().positive(),
        breachEffects: z.array(authoredResearcherModifierSchema),
        consequenceDelivery: z.literal("visible-event"),
      })
      .strict(),
    portrayalRules: z
      .object({
        fictionalizedDisplayNames: z.boolean(),
        endorsementImplied: z.boolean(),
        compactsAreFictionalGameContracts: z.boolean(),
        releaseRequiresLegalReview: z.boolean(),
        releaseRequiresPortraitReview: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type StarResearcherRulesFile = z.infer<typeof starResearcherRulesFileSchema>;

export const aiCapabilityTiersFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("ai-capability-tiers"),
    status: z.string().min(1),
    // Four sibling rules here were literal `true` values with no reader in the
    // codebase -- design intent frozen into data that could, and did, go stale.
    // It lives in a comment at the top of ai-levels.yaml instead.
    rules: z
      .object({
        progressPresentation: z
          .array(z.enum(["early", "developing", "approaching", "breakthrough-imminent"]))
          .length(4),
      })
      .strict(),
    tiers: z
      .array(
        z
          .object({
            id: z.string().regex(/^capability-tier-[a-z0-9-]+$/),
            level: z.number().int().min(0).max(8),
            name: z.string().min(1),
            nominalFrontierCapability: z
              .object({
                min: z.number().min(0).max(100),
                max: z.number().min(0).max(100),
              })
              .strict(),
            summary: z.string().min(1),
            unlockTags: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .length(9),
  })
  .strict();

export type AiCapabilityTiersFile = z.infer<typeof aiCapabilityTiersFileSchema>;

const startingModelSchema = z
  .object({
    capability: z.record(z.string(), z.number().min(0).max(100)),
    productQuality: z.number().min(0).max(100),
    reliability: z.number().min(0).max(100),
    hiddenSafety: z.record(z.string(), z.number().min(0).max(100)),
  })
  .strict();

export const balanceFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentType: z.literal("balance"),
    status: z.string().min(1),
    newGame: z
      .object({
        cash: z.number().finite(),
        auraSpendable: z.number().min(0),
        auraLifetime: z.number().min(0),
        gpus: z
          .object({
            generation: z.string().min(1),
            owned: z.number().int().positive(),
          })
          .strict(),
        finance: z
          .object({
            generalResearcherCostPerCycle: z.number().nonnegative(),
            engineerAndOpsCostPerCycle: z.number().nonnegative(),
            facilityCostPerInstancePerCycle: z.number().nonnegative(),
            executiveCostPerCycle: z.number().nonnegative(),
          })
          .strict(),
        startingModel: startingModelSchema,
        marketShare: z.number().min(0).max(1),
        starSlots: z.number().int().min(0).max(8),
        generalResearchers: z.number().int().min(0),
        engineersAndOps: z.number().int().min(0),
        ratings: z.record(z.string(), z.number().min(0).max(100)),
        domains: z.record(z.string(), z.number().min(0).max(100)),
        safetyProgramLevels: z.record(z.string(), z.number().min(0).max(100)),
        facilities: z.array(z.string().min(1)).min(1),
        allocation: z
          .object({
            servingFleetShareBasisPoints: z.number().int().min(0).max(10_000),
            capabilityBasisPoints: z.number().int().min(0).max(10_000),
            capabilityDomainWeights: z.record(
              z.string(),
              z.number().int().min(0).max(10_000),
            ),
            safetyProgramWeights: z.record(
              z.string(),
              z.number().int().min(0).max(10_000),
            ),
          })
          .strict(),
      })
      .strict(),
    difficulties: z
      .array(
        z
          .object({
            id: z.string().regex(/^difficulty\.[a-z0-9-]+$/),
            displayName: z.string().min(1),
            revenueMultiplier: z.number().positive(),
            fixedCostMultiplier: z.number().positive(),
            rivalProgressMultiplier: z.number().positive(),
            incidentPressureMultiplier: z.number().positive(),
            displayedEstimateQualityBonus: z.number().int(),
          })
          .strict(),
      )
      .min(1),
    mandates: z
      .array(
        z
          .object({
            id: z.string().regex(/^mandate\.[a-z0-9-]+$/),
            displayName: z.string().min(1),
            tagline: z.string().min(1),
            summary: z.string().min(1),
            effects: z.array(authoredEffectSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type BalanceFile = z.infer<typeof balanceFileSchema>;
