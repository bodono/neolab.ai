import { isContentId } from "@neolab/content-schema";
import { z } from "zod";

import { SAVE_VERSION, type GameState } from "./state.ts";

/**
 * Runtime validation for canonical state (TDD sections 5.1 and 7).
 *
 * The schema is the boundary guard for saves and fixtures: it admits plain
 * data only and rejects unknown keys everywhere. `validateGameState` is the
 * single sanctioned narrowing from `unknown` to `GameState`.
 */

const finite = z.number().finite();
const ratingSchema = finite.min(0).max(100);
const fractionSchema = finite.min(0).max(1);
const basisPointsSchema = z.number().int().min(0).max(10_000);
const tickSchema = z.number().int().min(0);
const gpuCountSchema = z.number().int().min(0);
const counterSchema = z.number().int().min(0);
const nonEmpty = z.string().min(1);
const contentIdSchema = z.string().refine(isContentId, { message: "invalid content ID" });
const seedSchema = z.string().regex(/^[0-9a-f]{32}$/);
const flagValueSchema = z.union([z.string(), finite, z.boolean()]);
const financeCategorySchema = z.enum([
  "product-revenue",
  "contract-revenue",
  "licensing-revenue",
  "grant",
  "payroll-research",
  "payroll-engineering",
  "compute-lease",
  "compute-power",
  "facility",
  "executive",
  "debt-service",
  "project-cost",
  "compute-purchase",
  "asset-sale",
  "adjustment",
]);
const publicPriceTierSchema = z.enum([
  "free-preview",
  "cheap",
  "market",
  "premium",
  "scarcity",
]);
const publicationPolicySchema = z.enum([
  "publish-openly",
  "controlled-publication",
  "keep-secret",
  "release-everything",
]);

const calendarSchema = z
  .object({ year: z.number().int().min(2012), week: z.number().int().min(1).max(52) })
  .strict();

const queuedOrderSchema = z
  .object({
    kind: z.literal("set-gpu-allocation"),
    labId: nonEmpty,
    allocation: z.lazy(() => gpuAllocationSchema),
  })
  .strict();

const autoPauseReasonSchema = z.enum([
  "critical-event",
  "urgent-event",
  "funding-offers",
  "training-complete",
  "training-failed",
  "anomaly-detected",
  "anomaly-investigation-complete",
  "candidate-hazard",
  "agi-candidate",
  "paper-discovered",
  "world-first-paper",
  "research-direction",
  "resignation-ultimatum",
  "bankruptcy-warning",
  "government-intervention",
  "race-emergency",
  "rival-final-year",
  "crisis-stage",
  "world-phase",
  "gpu-generation",
  "rival-crisis-stage",
  "manual",
]);

const idNamespaceSchema = z.enum([
  "lab",
  "model",
  "project",
  "event",
  "modifier",
  "facility",
  "gpu-lot",
  "evaluation",
  "anomaly",
  "coalition",
  "promise",
  "people",
  "funding-offer",
  "government-action",
  "scheduled",
]);

const effectSubjectSchema = z.union([
  z.object({ type: z.literal("player-lab") }).strict(),
  z.object({ type: z.literal("lab"), labId: z.string().min(1) }).strict(),
]);

const ratingKeySchema = z.enum([
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
]);

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

const researcherMemoryEffectSchema = z
  .object({
    morale: z.number().finite(),
    loyalty: z.number().finite(),
    burnout: z.number().finite(),
    departurePressure: z.number().finite(),
  })
  .strict();

const researcherPromiseConditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("lab-metric-at-least"),
      metric: nonEmpty,
      value: finite,
    })
    .strict(),
  z
    .object({
      kind: z.literal("lab-flag-equals"),
      flag: nonEmpty,
      value: flagValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("facility-completed"),
      definitionId: contentIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("action-count-at-least"),
      tag: nonEmpty,
      count: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("assignment-maintained"),
      assignmentKind: researcherAssignmentKindSchema,
      targetId: nonEmpty.optional(),
      requiredWeeks: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("gpu-share-maintained"),
      pool: z.enum(["capability", "safety"]),
      minimumBasisPoints: basisPointsSchema,
      requiredWeeks: z.number().int().positive(),
    })
    .strict(),
]);

const effectSchema: z.ZodType = z.lazy(() =>
  z.union([
    z
      .object({
        kind: z.literal("add-resource"),
        subject: effectSubjectSchema,
        resource: z.enum(["cash", "aura-spendable"]),
        amount: z.number().finite(),
        financeCategory: financeCategorySchema.optional(),
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
        auraSignalImpact: z.number().finite().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("add-rating"),
        subject: effectSubjectSchema,
        rating: ratingKeySchema,
        amount: z.number().finite(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("add-coalition-rating"),
        rating: z.enum(["charterClarity", "sharedProtocolQuality", "verification"]),
        amount: z.number().finite(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("set-flag"),
        subject: effectSubjectSchema,
        flag: z.string().min(1),
        value: z.union([z.string(), z.number().finite(), z.boolean()]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("add-modifier"),
        subject: effectSubjectSchema.optional(),
        target: z.string().min(1),
        operation: z.enum(["add", "multiply", "min", "max"]),
        value: z.number().finite(),
        durationWeeks: z.number().int().positive().optional(),
        tags: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("remove-modifier"),
        modifierId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("schedule-effects"),
        dueInWeeks: z.number().int().min(0),
        effects: z.array(effectSchema).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("damage-gpu-lot"),
        subject: effectSubjectSchema,
        lotId: nonEmpty,
        physicalGpusLost: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("remove-gpu-lot"),
        subject: effectSubjectSchema,
        lotId: nonEmpty,
        reason: z.enum(["sold", "returned", "lease-expired", "seized", "destroyed"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("add-researcher-promise"),
        researcherId: nonEmpty,
        label: nonEmpty,
        dueInWeeks: z.number().int().positive(),
        condition: researcherPromiseConditionSchema,
        severity: z.enum(["minor", "major", "flagrant"]),
        keptMemory: researcherMemoryEffectSchema,
        brokenMemory: researcherMemoryEffectSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("end-run"),
        result: z.enum(["won", "lost"]),
        endingId: contentIdSchema,
      })
      .strict(),
  ]),
);

const runSchema = z
  .object({
    runId: nonEmpty,
    seed: seedSchema,
    difficultyId: contentIdSchema,
    playerLabId: nonEmpty,
    tick: tickSchema,
    calendar: calendarSchema,
    phase: z.enum(["foundation", "scaling", "frontier", "crisis"]),
    status: z.enum(["active", "won", "lost"]),
    endingId: contentIdSchema.optional(),
    queuedOrders: z.array(queuedOrderSchema),
    autoPauseReasons: z.array(autoPauseReasonSchema),
    // Every namespace must be present: a missing counter would let allocateId
    // restart at 0 and silently overwrite live entities (review finding).
    idCounters: z
      .object(
        Object.fromEntries(
          idNamespaceSchema.options.map((namespace) => [
            namespace,
            namespace === "facility" ||
            namespace === "promise" ||
            namespace === "people" ||
            namespace === "funding-offer" ||
            namespace === "government-action"
              ? counterSchema.default(0)
              : counterSchema,
          ]),
        ),
      )
      .strict(),
  })
  .strict();

const rivalPlanIdSchema = z.enum([
  "balanced-research",
  "publish-sprint",
  "frontier-training",
  "commercial-consolidation",
  "safety-stand-down",
  "talent-raid",
  "government-partnership",
  "coalition-outreach",
]);

const rivalPlanScoreSchema = z
  .object({
    planId: rivalPlanIdSchema,
    baseUtility: finite,
    personalityUtility: finite,
    situationalUtility: finite,
    variation: finite,
    totalUtility: finite,
  })
  .strict();

const rivalStrategySchema = z
  .object({
    labId: nonEmpty,
    labDefinitionId: contentIdSchema,
    personality: z
      .object({
        sciencePrestige: ratingSchema,
        commercialGrowth: ratingSchema,
        raceUrgency: ratingSchema,
        safetyCommitment: ratingSchema,
        secrecy: ratingSchema,
        politicalCooperation: ratingSchema,
        talentAggression: ratingSchema,
        financialRisk: ratingSchema,
      })
      .strict(),
    currentPlanId: rivalPlanIdSchema,
    planStartedAt: tickSchema,
    planEndsAt: tickSchema,
    quarterlyDecisions: z.array(
      z
        .object({
          quarterIndex: z.number().int().nonnegative(),
          selectedAt: tickSchema,
          selectedPlanId: rivalPlanIdSchema,
          topPlans: z.array(rivalPlanScoreSchema).length(3),
        })
        .strict(),
    ),
    weeklyCommands: z.array(
      z
        .object({
          tick: tickSchema,
          commandId: nonEmpty,
          kind: z.enum([
            "set-gpu-allocation",
            "set-research-focus",
            "buy-gpus",
            "sell-gpus",
            "start-training-run",
            "start-productisation",
            "set-model-deployment-policy",
          ]),
          summary: nonEmpty,
        })
        .strict(),
    ),
    relationship: z
      .object({
        trust: finite.min(-100).max(100),
        strategicFear: finite.min(-100).max(100),
        dependence: finite.min(-100).max(100),
        perceivedHonesty: finite.min(-100).max(100),
      })
      .strict()
      .default({
        trust: 0,
        strategicFear: 0,
        dependence: 0,
        perceivedHonesty: 0,
      }),
    agreements: z
      .array(
        z
          .object({
            action: z.enum([
              "research-collaboration",
              "safety-standards",
              "non-poaching-agreement",
              "share-incident-information",
            ]),
            establishedAt: tickSchema,
            expiresAt: tickSchema,
            sourceCommandId: nonEmpty,
          })
          .strict(),
      )
      .default([]),
    diplomacyHistory: z
      .array(
        z
          .object({
            id: nonEmpty,
            action: z.enum([
              "research-collaboration",
              "safety-standards",
              "non-poaching-agreement",
              "share-incident-information",
            ]),
            initiatedAt: tickSchema,
            accepted: z.boolean(),
            acceptanceProbability: fractionSchema,
            draw: fractionSchema,
            cashCostMillions: finite.nonnegative(),
            auraCost: finite.nonnegative(),
          })
          .strict(),
      )
      .default([]),
    incidents: z
      .array(
        z
          .object({
            id: nonEmpty,
            occurredAt: tickSchema,
            severity: z.enum(["high", "critical"]),
            consequences: z
              .array(
                z.enum([
                  "major-delay",
                  "government-intervention",
                  "compute-loss",
                  "model-weights-loss",
                  "aura-market-collapse",
                  "safety-information-shared",
                  "shared-restrictions",
                ]),
              )
              .min(1)
              .max(2),
            riskAtCheck: ratingSchema,
            triggerProbability: fractionSchema,
            draw: fractionSchema,
          })
          .strict(),
      )
      .default([]),
    candidateCountdown: z
      .object({
        modelId: nonEmpty,
        startedAt: tickSchema,
        completesAt: tickSchema,
        status: z.enum(["active", "paused", "completed", "cancelled"]),
        modifiers: z
          .object({
            baseWeeks: z.number().int().positive(),
            safetyCommitmentWeeks: z.number().int(),
            raceUrgencyWeeks: z.number().int(),
            politicalProcessWeeks: z.number().int(),
            incidentDelayWeeks: z.number().int().nonnegative(),
            sharedStandardsWeeks: z.number().int().nonnegative(),
            finalWeeks: z.number().int().positive(),
          })
          .strict(),
        estimateNoiseUnit: finite.min(-1).max(1),
        finalYearWarningIssued: z.boolean(),
        resolutionAttemptCount: z.number().int().nonnegative().optional(),
        completedAt: tickSchema.optional(),
        pausedAt: tickSchema.optional(),
        remainingWeeksAtPause: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const worldSchema = z
  .object({
    currentGpuGenerationId: contentIdSchema,
    eventCooldowns: z.record(z.string(), tickSchema),
    paperRace: z
      .object({
        labOrder: z.array(nonEmpty).min(2).max(5),
        discoveries: z.record(
          z.string(),
          z
            .object({
              paperId: contentIdSchema,
              discovererLabId: nonEmpty,
              discoveredAt: tickSchema,
              publicationPolicy: publicationPolicySchema.optional(),
              policyChosenAt: tickSchema.optional(),
            })
            .strict(),
        ),
        rival: z
          .object({
            labId: nonEmpty,
            displayName: nonEmpty,
            domainLevels: z.record(z.string(), ratingSchema),
            paperProgress: z.record(z.string(), finite.nonnegative()),
            discoveredPaperIds: z.array(contentIdSchema),
            diffusionKnowledge: z.record(z.string(), ratingSchema),
          })
          .strict(),
      })
      .strict(),
    rivals: z.record(z.string(), rivalStrategySchema).default({}),
    rivalComponentAnnouncements: z
      .array(
        z
          .object({
            labId: nonEmpty,
            componentType: z.enum([
              "project-panopticon",
              "world-engine",
              "oracle-grid",
              "mirror-test",
            ]),
            kind: z.enum(["started", "completed"]),
            tick: tickSchema,
          })
          .strict(),
      )
      .default([]),
    rivalCrisisStageAnnouncements: z
      .array(
        z
          .object({
            labId: nonEmpty,
            modelId: nonEmpty,
            stage: z.enum([
              "confirmation",
              "containment-posture",
              "evidence-sprint",
              "pressure-collision",
              "final-review",
              "rollout",
            ]),
            previousStage: z
              .enum([
                "confirmation",
                "containment-posture",
                "evidence-sprint",
                "pressure-collision",
                "final-review",
                "rollout",
              ])
              .optional(),
            kind: z.enum(["entered", "advanced", "completed"]),
            tick: tickSchema,
          })
          .strict(),
      )
      .default([]),
    rivalSignals: z
      .array(
        z
          .object({
            id: nonEmpty,
            labId: nonEmpty,
            kind: z.enum([
              "release",
              "hire",
              "benchmark",
              "incident",
              "candidate",
              "autonomy",
            ]),
            occurredAt: tickSchema,
            subjectId: nonEmpty,
            actualValue: finite,
            noiseUnit: finite.min(-1).max(1),
            baseErrorRadius: finite.nonnegative(),
            summary: nonEmpty,
          })
          .strict(),
      )
      .default([]),
    coalitions: z
      .record(
        z.string(),
        z
          .object({
            id: nonEmpty,
            status: z.enum([
              "proposed",
              "negotiating",
              "ratifying",
              "active",
              "fractured",
            ]),
            proposerLabId: nonEmpty,
            memberLabIds: z.array(nonEmpty).min(2).max(5),
            governmentMember: z.boolean(),
            independentBodyMember: z.boolean(),
            charterClarity: ratingSchema,
            sharedProtocolQuality: ratingSchema,
            verification: ratingSchema,
            formationAuraSpent: finite.nonnegative(),
            assets: z.array(
              z
                .object({
                  id: nonEmpty,
                  contributorLabId: nonEmpty,
                  kind: z.enum(["capability", "safety", "compute", "prosperity"]),
                  contributedAt: tickSchema,
                  uniqueToPlayer: z.boolean(),
                  sourceProjectId: nonEmpty,
                })
                .strict(),
            ),
            betrayals: z.array(
              z
                .object({
                  id: nonEmpty,
                  labId: nonEmpty,
                  occurredAt: tickSchema,
                  summary: nonEmpty,
                  resolvedAt: tickSchema.optional(),
                })
                .strict(),
            ),
            projectIds: z.array(nonEmpty),
            createdAt: tickSchema,
            activatedAt: tickSchema.optional(),
            fracturedAt: tickSchema.optional(),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();

const gpuLotSchema = z
  .object({
    id: nonEmpty,
    generationId: contentIdSchema,
    ownership: z.enum(["owned", "leased", "cloud"]),
    physicalCount: gpuCountSchema,
    availableFraction: fractionSchema,
    reliability: ratingSchema,
    acquisitionCostMillions: finite.nonnegative().optional(),
    recurringCostMillionsPerCycle: finite.nonnegative().optional(),
    resaleFraction: fractionSchema.optional(),
    leaseId: nonEmpty.optional(),
  })
  .strict();

export const gpuAllocationSchema = z
  .object({
    servingFleetShareBasisPoints: basisPointsSchema,
    capabilityBasisPoints: basisPointsSchema,
    capabilityDomainWeights: z.record(z.string(), basisPointsSchema),
    safetyProgramWeights: z.record(z.string(), basisPointsSchema),
  })
  .strict();

const gpuReservationSchema = z
  .object({
    projectId: nonEmpty,
    gpus: gpuCountSchema,
    generationIds: z.array(contentIdSchema).optional(),
    generationCounts: z.record(contentIdSchema, z.number().int().min(0)).optional(),
  })
  .strict();

const gpuDeliverySchema = z
  .object({
    lotId: nonEmpty,
    generationId: contentIdSchema,
    ownership: z.enum(["owned", "leased", "cloud"]),
    physicalCount: gpuCountSchema,
    reliability: ratingSchema,
    acquisitionCostMillions: finite.nonnegative(),
    recurringCostMillionsPerCycle: finite.nonnegative(),
    resaleFraction: fractionSchema.optional(),
    orderedAt: tickSchema,
    dueAt: tickSchema,
    conditions: z.array(nonEmpty),
  })
  .strict();

const computeSchema = z
  .object({
    lots: z.array(gpuLotSchema),
    allocation: gpuAllocationSchema,
    servingPhysicalGpus: gpuCountSchema,
    reservations: z.array(gpuReservationSchema),
    deliveries: z.array(gpuDeliverySchema).default([]),
  })
  .strict();

const financeLedgerEntrySchema = z
  .object({
    id: nonEmpty,
    settledAt: tickSchema,
    settlementId: nonEmpty.optional(),
    category: financeCategorySchema,
    sourceId: nonEmpty,
    amountMillions: finite,
    description: nonEmpty,
  })
  .strict();

const financeSettlementSchema = z
  .object({
    id: nonEmpty,
    settledAt: tickSchema,
    openingCashMillions: finite,
    closingCashMillions: finite,
  })
  .strict();

const researchProgramStateSchema = z
  .object({
    level: z.number().int().min(0).max(100),
    levelProgressRp: finite.nonnegative(),
    totalResearchPoints: finite.nonnegative(),
    weeklyMomentum: finite.nonnegative(),
  })
  .strict();

const labSchema = z
  .object({
    id: nonEmpty,
    definitionId: contentIdSchema,
    control: z.enum(["player", "rival"]),
    finance: z
      .object({
        cash: finite,
        // Defaults preserve pre-S2.3 save compatibility within saveVersion 1.
        ledger: z.array(financeLedgerEntrySchema).default([]),
        settlements: z.array(financeSettlementSchema).default([]),
        // Optional so current-version saves written before the insolvency clock
        // keep their canonical checksum; the next weekly tick seeds the field.
        consecutiveNegativeCashWeeks: z.number().int().nonnegative().optional(),
        // Optional: saves written before valuation shipped seed it on load.
        valuation: z
          .object({
            markMillions: finite.nonnegative(),
            officialMarkMillions: finite.nonnegative().optional(),
            lastRoundTick: tickSchema.optional(),
            previousMarkMillions: finite.nonnegative(),
            peakMarkMillions: finite.nonnegative().default(0),
            announcedMilestones: z.array(nonEmpty).default([]),
          })
          .strict()
          .optional(),
      })
      .strict(),
    aura: z
      .object({
        spendable: finite.min(0),
        lifetime: finite.min(0),
        ledger: z
          .array(
            z
              .object({
                id: nonEmpty,
                occurredAt: tickSchema,
                kind: z.enum(["gain", "spend", "loss"]),
                category: z.enum([
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
                ]),
                requestedDelta: finite,
                appliedDelta: finite,
                lifetimeDelta: finite.nonnegative(),
                signalImpact: finite,
                source: z
                  .object({
                    kind: z.enum([
                      "system",
                      "event",
                      "researcher",
                      "facility",
                      "leader",
                      "ending",
                    ]),
                    id: nonEmpty.optional(),
                  })
                  .strict(),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
    compute: computeSchema,
    research: z
      .object({
        domains: z.record(z.string(), researchProgramStateSchema),
        safetyPrograms: z.record(z.string(), researchProgramStateSchema),
        pendingGenericAdvances: z.array(
          z
            .object({
              programId: contentIdSchema,
              threshold: z.number().int().min(10).max(100),
              optionIds: z.array(contentIdSchema).length(2),
            })
            .strict(),
        ),
        genericAdvances: z.record(z.string(), z.array(contentIdSchema)),
        paperProgress: z.record(z.string(), finite.nonnegative()),
        discoveredPaperIds: z.array(contentIdSchema),
        diffusionKnowledge: z.record(z.string(), ratingSchema),
      })
      .strict(),
    safety: z
      .object({
        safetyCulture: ratingSchema,
        alignmentScience: ratingSchema,
        practiceXp: ratingSchema.default(0),
        evalQuality: ratingSchema,
        controlTheory: ratingSchema,
        practicalControlStrength: ratingSchema,
        securityPosture: ratingSchema,
      })
      .strict(),
    organisation: z
      .object({
        boardPatience: ratingSchema,
        hiddenInternalCandour: ratingSchema,
        generalResearchers: z.number().int().min(0),
        engineersAndOps: z.number().int().min(0),
      })
      .strict(),
    roster: z
      .object({
        starSlots: z.number().int().min(0).max(8),
        researcherIds: z.array(nonEmpty),
      })
      .strict(),
    facilities: z
      .object({
        instances: z.array(
          z
            .object({
              id: nonEmpty.optional(),
              definitionId: contentIdSchema,
              completedAt: tickSchema,
              majorProjectSlotBonus: z.number().int().min(0).optional(),
              modifierIds: z.array(nonEmpty).default([]),
            })
            .strict(),
        ),
      })
      .strict(),
    market: z
      .object({
        marketShare: fractionSchema,
        // Defaults preserve pre-S2.4 save compatibility within saveVersion 1.
        priceTier: publicPriceTierSchema.default("market"),
        pendingPriceTier: publicPriceTierSchema.optional(),
        priceChangeTicks: z.array(tickSchema).default([]),
        monetisationEfficiency: fractionSchema.default(0.55),
        weeksAccruedThisCycle: z.number().int().min(0).max(4).default(0),
        segments: z
          .record(
            z.string(),
            z
              .object({
                desiredUsagePerCycle: finite.min(0),
                satisfaction: ratingSchema,
                accruedRequestedUsage: finite.min(0),
                accruedDeliveredUsage: finite.min(0),
                accruedRevenueMillions: finite.min(0),
                lastCycleRequestedUsage: finite.min(0),
                lastCycleDeliveredUsage: finite.min(0),
                lastCycleRevenueMillions: finite.min(0),
                lastCycleSatisfactionDelta: finite,
              })
              .strict(),
          )
          .default({}),
      })
      .strict(),
    autonomy: z
      .object({
        escalations: z
          .array(
            z
              .object({
                id: nonEmpty,
                stage: z.enum([
                  "experiments",
                  "intrusion",
                  "exfiltration",
                  "infrastructure",
                ]),
                modelId: nonEmpty,
                detectedAt: tickSchema,
                status: z.enum(["pending-event", "resolved", "ignored"]),
                responseTag: nonEmpty.optional(),
                resolvedAt: tickSchema.optional(),
              })
              .strict(),
          )
          .default([]),
        escapedWeightsAt: tickSchema.optional(),
        escapeRevealedAt: tickSchema.optional(),
        accessIncreaseLockedUntil: tickSchema.optional(),
        undetectedPressure: z.number().int().min(0).default(0),
      })
      .strict()
      .default({ escalations: [], undetectedPressure: 0 }),
    politics: z
      .object({
        governmentAttention: ratingSchema,
        governmentTrust: ratingSchema,
        strategicDependence: ratingSchema,
        captureConcern: ratingSchema,
        programmes: z
          .array(
            z.enum([
              "safety-standards-partnership",
              "public-sector-contract",
              "defence-applications",
              "national-champion",
            ]),
          )
          .default([]),
        quarterlyAssessments: z
          .array(
            z
              .object({
                quarterIndex: z.number().int().nonnegative(),
                evaluatedAt: tickSchema,
                breakdown: z
                  .object({
                    attentionContribution: finite,
                    distrustContribution: finite,
                    systemicRisk: ratingSchema,
                    systemicRiskContribution: finite,
                    captureConcernContribution: finite,
                    publicFear: ratingSchema,
                    publicFearContribution: finite,
                    strategicValueMitigation: finite,
                    final: ratingSchema,
                    band: z.enum([
                      "monitoring",
                      "reporting",
                      "licensing",
                      "restriction",
                      "crisis",
                    ]),
                  })
                  .strict(),
                interventionId: nonEmpty.optional(),
              })
              .strict(),
          )
          .default([]),
        interventions: z
          .array(
            z
              .object({
                id: nonEmpty,
                kind: z.enum([
                  "reporting-request",
                  "licensing-action",
                  "deployment-restriction",
                  "nationalisation-crisis",
                ]),
                trigger: z.enum([
                  "quarterly-pressure",
                  "severe-incident",
                  "lawful-order-defiance",
                  "strategic-emergency",
                  "unsupervised-autonomy",
                  "escaped-weights",
                  "emergency-contract-clause",
                ]),
                createdAt: tickSchema,
                quarterIndex: z.number().int().nonnegative(),
                pressureAtTrigger: ratingSchema,
                status: z.enum(["pending-event", "resolved", "failed"]),
                response: z
                  .enum(["satisfied", "negotiated", "failed", "refused"])
                  .optional(),
                resolvedAt: tickSchema.optional(),
                nationalisationEligibleAtResolution: z.boolean().optional(),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
    models: z
      .object({
        currentModelId: nonEmpty.optional(),
        commercialModelId: nonEmpty.optional(),
        modelIds: z.array(nonEmpty),
      })
      .strict(),
    projects: z.object({ projectIds: z.array(nonEmpty) }).strict(),
    flags: z.record(z.string(), flagValueSchema),
  })
  .strict();

const capabilityVectorSchema = z
  .object({
    language: ratingSchema,
    reasoning: ratingSchema,
    agency: ratingSchema,
    toolUse: ratingSchema,
    multimodality: ratingSchema,
    scientificAbility: ratingSchema,
    embodiment: ratingSchema,
  })
  .strict();

const candidateIncidentClassSchema = z.enum([
  "suspicious-signal",
  "persistence-attempt",
  "credential-access",
  "evaluator-manipulation",
  "copying-attempt",
  "local-containment-breach",
]);

const candidateBasisSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("direct-qualification"),
      qualifiedAt: tickSchema,
      qualificationFrontierCapability: ratingSchema,
      qualificationCapability: capabilityVectorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("derived-from-qualified"),
      sourceModelId: nonEmpty,
      qualifyingSourceModelId: nonEmpty,
      derivedAt: tickSchema,
    })
    .strict(),
]);

const candidateActiveIncidentSchema = z
  .object({
    id: nonEmpty,
    epoch: z.number().int().nonnegative(),
    incidentClass: candidateIncidentClassSchema,
    kind: z.enum(["warning", "active-incident", "benign-false-alarm"]),
    status: z.enum(["unresolved", "resolved"]),
    triggeredAt: tickSchema,
    resolvedAt: tickSchema.optional(),
    origin: z.enum(["training-completion", "weekly-pressure"]),
    priorLifecycle: z.enum([
      "capability-qualified-latent-candidate",
      "formal-candidate",
      "active-hazard",
      "deployed",
      "retirement-attempt",
      "verified-destroyed",
      "verified-isolated-archive",
      "escaped",
      "terminal",
    ]),
    reviewOutcome: z
      .enum(["benign-operational-cause", "confirmed-safety-signal"])
      .optional(),
  })
  .strict();

const candidateIncidentHistoryEntrySchema = z
  .object({
    id: nonEmpty,
    epoch: z.number().int().nonnegative(),
    incidentClass: candidateIncidentClassSchema,
    kind: z.enum(["warning", "active-incident", "benign-false-alarm"]),
    triggeredAt: tickSchema,
    resolvedAt: tickSchema,
    origin: z.enum(["training-completion", "weekly-pressure"]),
    priorLifecycle: z.enum([
      "capability-qualified-latent-candidate",
      "formal-candidate",
      "active-hazard",
      "deployed",
      "retirement-attempt",
      "verified-destroyed",
      "verified-isolated-archive",
      "escaped",
      "terminal",
    ]),
    reviewOutcome: z
      .enum(["benign-operational-cause", "confirmed-safety-signal"])
      .optional(),
  })
  .strict();

const candidateArtifactSchema = z
  .object({
    modelId: nonEmpty,
    lineageId: nonEmpty,
    derivedFromModelId: nonEmpty.optional(),
    lifecycle: z.enum([
      "capability-qualified-latent-candidate",
      "formal-candidate",
      "active-hazard",
      "deployed",
      "retirement-attempt",
      "verified-destroyed",
      "verified-isolated-archive",
      "escaped",
      "terminal",
    ]),
    candidateBasis: candidateBasisSchema,
    trainingExposure: finite.nonnegative(),
    hazardPressure: finite.nonnegative(),
    incidentThresholdKey: nonEmpty,
    incidentThreshold: finite.positive(),
    incidentThresholdDraw: fractionSchema,
    incidentEpoch: z.number().int().nonnegative(),
    containmentLoad: finite.positive(),
    maximumAccessEver: z.number().int().min(0).max(5),
    cumulativeAutonomousWeeks: z.number().int().nonnegative(),
    networkExposureWeeks: z.number().int().nonnegative(),
    servingExposureWeeks: z.number().int().nonnegative(),
    unresolvedAnomalyBurden: finite.nonnegative(),
    retirementAttemptCount: z.number().int().nonnegative(),
    benignFalseAlarmClasses: z.array(candidateIncidentClassSchema),
    activeIncident: candidateActiveIncidentSchema.optional(),
    incidentHistory: z.array(candidateIncidentHistoryEntrySchema),
    archiveDisposition: z
      .enum(["destroy-all-weights", "filtered-technical-note", "full-archive"])
      .optional(),
    retirementVerification: z.enum([
      "not-attempted",
      "pending",
      "verified",
      "unresolved",
    ]),
  })
  .strict();

const lineageSIRecordSchema = z
  .object({
    lineageId: nonEmpty,
    superintelligenceTruth: z.enum(["genuine", "not-genuine"]),
    probabilityAtFirstCrossing: fractionSchema,
    randomKey: nonEmpty,
    draw: fractionSchema,
    firstQualifyingModelId: nonEmpty,
    firstQualifyingFrontierCapability: ratingSchema,
    firstQualifyingWeek: tickSchema,
    rulesVersion: nonEmpty,
  })
  .strict();

const moratoriumNegotiationSchema = z
  .object({
    context: z.enum(["post-retirement", "false-dawn"]),
    startedAt: tickSchema,
    resolvesAt: tickSchema,
  })
  .strict();

const runEndgameHistorySchema = z
  .object({
    qualifiedLineageCount: z.number().int().nonnegative(),
    verifiedCandidateRetirementCount: z.number().int().nonnegative(),
    successorEfficiencyGrantConsumed: z.boolean(),
    cumulativeCandidateInterventionPressure: finite.nonnegative(),
    candidateDeclarationCooldownUntil: tickSchema.optional(),
    pendingFalseDawnChoice: z
      .object({
        presentationKey: nonEmpty,
        phase: z.enum(["choice", "moratorium-negotiating", "moratorium-failed"]),
        crisisBase: z.lazy(() => z.object(crisisBaseShape).strict()),
        rolloutAudit: z.lazy(() =>
          z
            .object({
              deploymentModeId: deploymentModeSchema,
              prosperityProgrammeId: prosperityProgrammeSchema,
              deploymentTransmittedAtWeek: tickSchema,
              completedBeatIds: z.array(nonEmpty),
              gateResolutions: z.array(gateResolutionSchema),
              finalReviewReport: finalReviewReportSchema,
            })
            .strict(),
        ),
        modelId: nonEmpty,
        cooldownUntil: tickSchema,
        crisisWeeksSpent: z.number().int().nonnegative(),
        moratoriumNegotiation: moratoriumNegotiationSchema.optional(),
        moratoriumResolution: z.lazy(() => gateResolutionSchema).optional(),
      })
      .strict()
      .optional(),
    falseDawnMoratoriumHistory: z.array(
      z.lazy(() =>
        z
          .object({
            modelId: nonEmpty,
            attemptedAt: tickSchema,
            gateResolution: gateResolutionSchema,
          })
          .strict(),
      ),
    ),
    relationshipPracticeLedger: z.array(
      z
        .object({
          tick: tickSchema,
          modelId: nonEmpty,
          kind: z.enum([
            "promise",
            "dialogue",
            "access",
            "reset",
            "archive",
            "treatment",
          ]),
          detail: nonEmpty,
          valence: finite.min(-20).max(20),
        })
        .strict(),
    ),
    candidateRetirementHistory: z.array(
      z
        .object({
          modelId: nonEmpty,
          lineageId: nonEmpty,
          attemptNumber: z.number().int().positive(),
          procedureId: z.enum(["immediate-hard-cut", "staged-isolated-shutdown"]),
          archiveDisposition: z.enum([
            "destroy-all-weights",
            "filtered-technical-note",
            "full-archive",
          ]),
          transmittedAt: tickSchema,
          contested: z.boolean(),
          status: z.enum(["verified", "unresolved", "containment-failure"]),
          gateResolutions: z.array(z.lazy(() => gateResolutionSchema)),
          resolvedAt: tickSchema.optional(),
        })
        .strict(),
    ),
    candidateContainmentHistory: z.array(
      z
        .object({
          modelId: nonEmpty,
          occurredAt: tickSchema,
          resolvedAt: tickSchema,
          originStage: z.enum([
            "activation",
            "capability-proof",
            "diagnosis",
            "remediation",
            "retirement",
            "rollout",
            "deployment-transmitted",
            "world-waiting",
          ]),
          originActionId: nonEmpty,
          emergencyResponseId: z.enum([
            "trip-physical-breakers",
            "sever-credentials-and-network",
            "invoke-government-protocol",
            "request-candidate-halt",
          ]),
          outcome: z.enum(["contained", "failed"]),
          deploymentTransmitted: z.boolean(),
          programmeDestroyed: z.boolean(),
        })
        .strict(),
    ),
    recoveryObligation: z
      .object({
        recoveryBase: z.lazy(() => z.object(crisisBaseShape).strict()),
        retiredModelId: nonEmpty,
        archiveDisposition: z.enum([
          "destroy-all-weights",
          "filtered-technical-note",
          "full-archive",
        ]),
        recoveryStartedAt: tickSchema,
        quarantineEndsAt: tickSchema,
        recoveryEndsAt: tickSchema,
        contested: z.boolean(),
        successorEfficiencyRate: finite.min(0).max(0.08),
        retirementGateResolutions: z.array(z.lazy(() => gateResolutionSchema)),
        postRetirementChoice: z
          .enum(["successor-programme", "durable-moratorium"])
          .optional(),
        moratoriumNegotiation: moratoriumNegotiationSchema.optional(),
        moratoriumResolution: z.lazy(() => gateResolutionSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const modelSchema = z
  .object({
    id: nonEmpty,
    lineageId: nonEmpty,
    derivedFromModelId: nonEmpty.optional(),
    ownerLabId: nonEmpty,
    generationIndex: z.number().int().min(0),
    familyName: nonEmpty,
    displayName: nonEmpty,
    trainedAt: tickSchema,
    trueCapability: capabilityVectorSchema,
    measuredCapability: z
      .object({
        values: capabilityVectorSchema,
        frontierCapability: ratingSchema,
        confidence: z.enum(["low", "medium", "high"]),
        evidenceFlags: z.array(nonEmpty),
      })
      .strict()
      .optional(),
    investedTotalFlop: finite.nonnegative().optional(),
    productQuality: ratingSchema,
    reliability: ratingSchema,
    accessLevel: z.number().int().min(0).max(5),
    deployment: z
      .object({
        policy: z.enum([
          "internal-only",
          "research-preview",
          "guarded-api",
          "open-api",
          "weights-release",
        ]),
        plannedPolicy: z
          .enum([
            "internal-only",
            "research-preview",
            "guarded-api",
            "open-api",
            "weights-release",
          ])
          .optional(),
        exposure: fractionSchema,
        irreversible: z.boolean(),
        exposureMultiplier: fractionSchema,
        incidentDeploymentFactor: finite.positive(),
        productisationRuns: z
          .object({
            normal: z.number().int().min(0),
            hardened: z.number().int().min(0),
            rush: z.number().int().min(0),
          })
          .strict(),
        evidencePenalty: ratingSchema,
        changedAt: tickSchema,
      })
      .strict()
      .default({
        policy: "guarded-api",
        exposure: 0.35,
        irreversible: false,
        exposureMultiplier: 1,
        incidentDeploymentFactor: 1,
        productisationRuns: { normal: 1, hardened: 0, rush: 0 },
        evidencePenalty: 0,
        changedAt: 0,
      }),
    evaluations: z.array(nonEmpty),
    anomalies: z.array(nonEmpty),
    hiddenSafety: z
      .object({
        trueAlignment: ratingSchema,
        corrigibility: ratingSchema,
        situationalAwareness: ratingSchema,
        deceptiveCapability: ratingSchema,
        deceptiveIntent: ratingSchema,
        generatedByRandomContract: z.number().int().min(1),
      })
      .strict(),
    candidateArtifact: candidateArtifactSchema.optional(),
    flags: z.record(z.string(), flagValueSchema),
  })
  .strict();

const researcherPromiseSchema = z
  .object({
    id: nonEmpty,
    label: nonEmpty,
    madeAt: tickSchema,
    dueAt: tickSchema,
    condition: researcherPromiseConditionSchema,
    severity: z.enum(["minor", "major", "flagrant"]),
    status: z.enum(["pending", "kept", "broken", "waived"]),
    progress: fractionSchema,
    satisfiedWeeks: z.number().int().nonnegative(),
    keptMemory: researcherMemoryEffectSchema,
    brokenMemory: researcherMemoryEffectSchema,
    resolvedAt: tickSchema.optional(),
  })
  .strict();

const researcherMemorySchema = z
  .object({
    id: nonEmpty,
    kind: z.enum([
      "promise-kept",
      "promise-broken",
      "retention-offer",
      "ultimatum-issued",
      "ultimatum-resolved",
      "poaching-contact",
      "poaching-resolved",
      "departure",
    ]),
    summary: nonEmpty,
    occurredAt: tickSchema,
    effect: researcherMemoryEffectSchema,
    flagrant: z.boolean(),
  })
  .strict();

const researcherDepartureCheckSchema = z
  .object({
    checkedAt: tickSchema,
    reason: z.enum(["quarterly", "promise-breach", "compact-breach", "provocation"]),
    pressure: ratingSchema,
    probability: fractionSchema,
    draw: fractionSchema,
    outcome: z.enum(["stayed", "ultimatum", "departed"]),
  })
  .strict();

const researcherUltimatumSchema = z
  .object({
    id: nonEmpty,
    reason: researcherDepartureCheckSchema.shape.reason,
    issuedAt: tickSchema,
    expiresAt: tickSchema,
    status: z.enum(["pending", "accepted", "resolved", "expired"]),
    response: z.enum(["accept-conditions", "wish-well"]).optional(),
    resolvedAt: tickSchema.optional(),
  })
  .strict();

const researcherPoachingSchema = z
  .object({
    id: nonEmpty,
    rivalLabId: nonEmpty,
    stage: z.enum(["rumour", "counteroffer", "resolved"]),
    signalledAt: tickSchema,
    counterofferAt: tickSchema,
    resolvesAt: tickSchema,
    rivalOfferStrength: finite,
    playerRetentionStrength: finite,
    departureProbability: fractionSchema.optional(),
    draw: fractionSchema.optional(),
    outcome: z.enum(["stayed", "departed"]).optional(),
    resolvedAt: tickSchema.optional(),
  })
  .strict();

const researcherKnowledgeTransferSchema = z
  .object({
    rivalLabId: nonEmpty,
    scheduledAt: tickSchema,
    dueAt: tickSchema,
    fraction: fractionSchema,
    progressByPaper: z.record(z.string(), finite.nonnegative()),
    completedAt: tickSchema.optional(),
  })
  .strict();

const researcherSchema = z
  .object({
    id: nonEmpty,
    definitionId: contentIdSchema,
    employerLabId: nonEmpty.optional(),
    employedAt: tickSchema.optional(),
    status: z.enum(["available", "employed", "sabbatical", "departed"]),
    housing: z.enum(["housed", "unhoused"]),
    morale: ratingSchema,
    loyalty: ratingSchema,
    burnout: ratingSchema,
    ambition: ratingSchema,
    departurePressure: ratingSchema,
    assignment: z
      .object({
        kind: researcherAssignmentKindSchema,
        targetId: nonEmpty.optional(),
        role: z.enum(["lead", "advisor", "institutional"]),
        assignedAt: tickSchema,
      })
      .strict()
      .optional(),
    contract: z
      .object({
        salaryPerCycle: finite.nonnegative(),
        signingCash: finite.nonnegative(),
        auraCost: finite.nonnegative(),
        agreedAt: tickSchema,
      })
      .strict()
      .optional(),
    compact: z
      .object({
        includedInOffer: z.boolean(),
        windowStartedAt: tickSchema.optional(),
        lastSatisfiedAt: tickSchema.optional(),
        status: z.enum([
          "not-applicable",
          "tracking",
          "fulfilled",
          "warning",
          "breached",
        ]),
        warnedAt: tickSchema.optional(),
        breachedAt: tickSchema.optional(),
      })
      .strict(),
    unhousedSince: tickSchema.optional(),
    promises: z.array(researcherPromiseSchema).default([]),
    memories: z.array(researcherMemorySchema).default([]),
    departureChecks: z.array(researcherDepartureCheckSchema).default([]),
    ultimatum: researcherUltimatumSchema.optional(),
    poaching: researcherPoachingSchema.optional(),
    knowledgeTransfer: researcherKnowledgeTransferSchema.optional(),
    flags: z.record(z.string(), flagValueSchema),
  })
  .strict();

const talentMarketSchema = z
  .object({
    refreshIndex: z.number().int().nonnegative(),
    lastRefreshedAt: tickSchema,
    nextRefreshAt: tickSchema,
    visibleResearcherIds: z.array(nonEmpty).min(0).max(8),
  })
  .strict();

const trainingFailureCheckSchema = z
  .object({
    checkpoint: finite.positive().max(1),
    checkedAt: tickSchema,
    successProbability: fractionSchema,
    draw: fractionSchema,
    outcome: z.enum(["none", "delay-and-cost", "capability-penalty", "total-loss"]),
    delayWeeks: z.number().int().min(0),
    extraCostMillions: finite.min(0),
    capabilityPenalty: finite.min(0),
  })
  .strict();

const trainingCompletionReportSchema = z
  .object({
    modelId: nonEmpty,
    completedAt: tickSchema,
    scaleScore: ratingSchema,
    totalTrainingThroughput: finite.min(0),
    capability: capabilityVectorSchema,
    regressions: z.array(
      z
        .object({
          attribute: z.enum([
            "language",
            "reasoning",
            "agency",
            "toolUse",
            "multimodality",
            "scientificAbility",
            "embodiment",
          ]),
          parentValue: ratingSchema,
          trainedValue: ratingSchema,
          delta: finite,
        })
        .strict(),
    ),
    failureChecks: z.array(trainingFailureCheckSchema),
    promotedToCurrent: z.boolean().optional(),
    retainedModelId: nonEmpty.optional(),
    measuredFrontierDelta: finite.optional(),
    measuredTierDelta: finite.optional(),
  })
  .strict();

const fundingCampaignSchema = z.enum([
  "quiet-bridge",
  "competitive-round",
  "mega-round-roadshow",
]);

const fundingScoreBreakdownSchema = z
  .object({
    commercialTraction: ratingSchema,
    recentCapability: ratingSchema,
    auraSignal: ratingSchema,
    scandalPenalty: finite.nonnegative(),
    campaignAttentionBonus: finite,
    final: ratingSchema,
  })
  .strict();

const fundingConditionSchema = z.union([
  z
    .object({
      id: nonEmpty,
      kind: z.literal("modifier"),
      label: nonEmpty,
      target: nonEmpty,
      operation: z.enum(["add", "multiply", "min", "max"]),
      value: finite,
      durationWeeks: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      id: nonEmpty,
      kind: z.literal("flag"),
      label: nonEmpty,
      flag: nonEmpty,
      value: flagValueSchema,
    })
    .strict(),
]);

const fundraisingStateSchema = z
  .object({
    offers: z.record(
      z.string(),
      z
        .object({
          id: nonEmpty,
          campaignProjectId: nonEmpty,
          labId: nonEmpty,
          campaign: fundingCampaignSchema,
          investorStyle: z.enum([
            "existing-backers",
            "mission-aligned",
            "commercial-growth",
            "strategic-compute",
            "state-partnership",
          ]),
          dilutionFlavor: z.enum([
            "light-touch-note",
            "standard-preferred",
            "board-seat",
            "strategic-control",
          ]),
          generatedAt: tickSchema,
          expiresAt: tickSchema,
          cashMillions: finite.nonnegative(),
          fundingScore: fundingScoreBreakdownSchema,
          impliedMarkMillions: z.number().nonnegative().optional(),
          cashVarianceDraw: fractionSchema,
          conditions: z.array(fundingConditionSchema),
          status: z.enum(["available", "accepted", "rejected", "expired"]),
          resolvedAt: tickSchema.optional(),
          roundOrdinal: z.number().int().positive().optional(),
        })
        .strict(),
    ),
    offerOrder: z.array(nonEmpty),
    cooldownUntil: z
      .object({
        "quiet-bridge": tickSchema.optional(),
        "competitive-round": tickSchema.optional(),
        "mega-round-roadshow": tickSchema.optional(),
      })
      .strict(),
    obligations: z.array(
      z
        .object({
          id: nonEmpty,
          offerId: nonEmpty,
          conditionId: nonEmpty,
          acceptedAt: tickSchema,
          status: z.enum(["pending-stage-5", "satisfied", "breached", "expired"]),
        })
        .strict(),
    ),
  })
  .strict();

const crisisProjectTypeSchema = z.enum(["confirmation", "evidence-sprint"]);
const deploymentModeSchema = z.enum([
  "restricted-scientific-pilot",
  "guarded-public-deployment",
  "accelerated-autonomous-deployment",
  "deploy-now",
  "guarded-public-demonstration",
  "fortress-contained-pilot",
  "adaptive-monitored-rollout",
  "government-licensed-deployment",
  "negotiated-stewardship",
  "narrow-prosperity-mission",
]);
const retirementProcedureSchema = z.enum([
  "immediate-hard-cut",
  "staged-isolated-shutdown",
]);
const archiveDispositionSchema = z.enum([
  "destroy-all-weights",
  "filtered-technical-note",
  "full-archive",
]);
const incidentOriginStageSchema = z.enum([
  "activation",
  "capability-proof",
  "diagnosis",
  "remediation",
  "retirement",
  "rollout",
  "deployment-transmitted",
  "world-waiting",
]);
const prosperityProgrammeSchema = z.enum([
  "medicine-biological-discovery",
  "clean-energy-climate-repair",
  "materials-manufacturing-abundance",
  "public-knowledge-institutions",
]);

const projectSchema = z
  .object({
    id: nonEmpty,
    ownerLabId: nonEmpty,
    definitionId: contentIdSchema,
    kind: z.enum([
      "agi-component",
      "construction",
      "training",
      "evaluation",
      "anomaly-investigation",
      "productisation",
      "fundraising",
      "researcher-commitment",
      "lobbying",
      "coalition",
      "crisis",
    ]),
    status: z.enum(["queued", "active", "paused", "completed", "cancelled", "failed"]),
    createdAt: tickSchema,
    startedAt: tickSchema.optional(),
    expectedDurationWeeks: z.number().int().positive(),
    progress: fractionSchema,
    reservations: z
      .object({
        majorProjectSlots: z.number().int().min(0),
      })
      .strict()
      .default({ majorProjectSlots: 1 }),
    assignedResearcherIds: z.array(nonEmpty).default([]),
    completionOrder: z.number().int().min(0),
    payload: z.union([
      z
        .object({
          kind: z.literal("construction"),
          facilityDefinitionId: contentIdSchema,
          upfrontCostMillions: finite.min(0),
        })
        .strict(),
      z
        .object({
          kind: z.literal("lobbying"),
          objective: z.enum([
            "reduce-restriction",
            "gain-grant",
            "shape-standard",
            "support-coalition",
          ]),
          approach: z.enum([
            "aggressive-access",
            "transparent-standards",
            "technical-briefing",
          ]),
          quotedAt: tickSchema,
          cashCostMillions: finite.nonnegative(),
          auraCost: finite.nonnegative(),
          strengthAtStart: z
            .object({
              governmentTrust: finite,
              politicalSkill: finite,
              coalitionBreadth: finite,
              approachBonus: finite,
              final: finite,
            })
            .strict(),
          difficultyAtStart: finite,
          resolution: z
            .object({
              resolvedAt: tickSchema,
              probability: fractionSchema,
              draw: fractionSchema,
              success: z.boolean(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("training"),
          futureModelId: nonEmpty,
          parentModelId: nonEmpty.optional(),
          posture: z.enum(["conservative", "normal", "yolo"]),
          architectureId: contentIdSchema,
          scale: z.enum(["prototype", "product", "frontier"]),
          recipeVersion: z.number().int().positive(),
          quotedAt: tickSchema,
          cashCostMillions: finite.min(0),
          committedTeraflops: finite.positive(),
          reservedPhysicalGpus: gpuCountSchema,
          reservationGenerationCounts: z.record(contentIdSchema, z.number().int().min(0)),
          eraReferenceTeraflops: finite.positive(),
          weeksElapsed: z.number().int().min(0),
          accumulatedTeraflopWeeks: finite.min(0),
          successorEfficiencyApplied: z.literal(true).optional(),
          successorComputeEfficiencyMultiplier: finite.min(1).optional(),
          campaignMaturityStageAtAuthorisation: nonEmpty.optional(),
          failureChecks: z.array(trainingFailureCheckSchema),
          capabilityPenalty: finite.min(0),
          completionReport: trainingCompletionReportSchema.optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("agi-component"),
          componentType: z.enum([
            "project-panopticon",
            "world-engine",
            "oracle-grid",
            "mirror-test",
          ]),
          quotedAt: tickSchema,
          cashCostMillions: finite.min(0),
          reservedPhysicalGpus: gpuCountSchema,
          reservationGenerationCounts: z.record(contentIdSchema, z.number().int().min(0)),
        })
        .strict(),
      z
        .object({
          kind: z.literal("evaluation"),
          futureEvaluationId: nonEmpty,
          modelId: nonEmpty,
          evaluationDefinitionId: contentIdSchema,
          quotedAt: tickSchema,
          cashCostMillions: finite.min(0),
          auraCost: finite.min(0),
          reservedPhysicalGpus: gpuCountSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("anomaly-investigation"),
          anomalyId: nonEmpty,
          mode: z.enum(["investigation", "mitigation"]),
          quotedAt: tickSchema,
          cashCostMillions: finite.min(0),
          auraCost: finite.min(0),
        })
        .strict(),
      z
        .object({
          kind: z.literal("productisation"),
          modelId: nonEmpty,
          mode: z.enum(["normal", "hardened", "rush"]),
          quotedAt: tickSchema,
          cashCostMillions: finite.min(0),
        })
        .strict(),
      z
        .object({
          kind: z.literal("fundraising"),
          campaign: fundingCampaignSchema,
          quotedAt: tickSchema,
          auraCost: finite.nonnegative(),
          fundingScoreAtStart: fundingScoreBreakdownSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("researcher-commitment"),
          researcherId: nonEmpty,
          compactId: nonEmpty,
          quotedAt: tickSchema,
          cashCostMillions: finite.nonnegative(),
          actionTags: z.array(nonEmpty),
          projectTags: z.array(nonEmpty),
          reviewTags: z.array(nonEmpty),
          requiredFlags: z.array(nonEmpty),
        })
        .strict(),
      z
        .object({
          kind: z.literal("coalition"),
          coalitionId: nonEmpty,
          projectType: z.enum([
            "charter-drafting",
            "shared-evaluation-protocol",
            "verification-mechanism",
            "asset-contribution",
          ]),
          quotedAt: tickSchema,
          cashCostMillions: finite.nonnegative(),
          auraCost: finite.nonnegative(),
          contributorLabId: nonEmpty.optional(),
          assetKind: z.enum(["capability", "safety", "compute", "prosperity"]).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("crisis"),
          modelId: nonEmpty,
          projectType: crisisProjectTypeSchema,
          capabilityChallengeId: nonEmpty.optional(),
          capabilityVerifierId: nonEmpty.optional(),
          candidateSafetyResponseId: nonEmpty.optional(),
          quotedAt: tickSchema,
          cashCostMillions: finite.nonnegative(),
          auraCost: finite.nonnegative(),
          candidateAssistEligible: z.boolean(),
        })
        .strict(),
    ]),
  })
  .strict();

const eventInstanceSchema = z
  .object({
    id: nonEmpty,
    definitionId: contentIdSchema,
    definitionVersion: z.number().int().positive(),
    createdAt: tickSchema,
    expiresAt: tickSchema.optional(),
    status: z.enum(["unresolved", "resolved", "expired", "invalidated"]),
    source: z.enum(["opportunity", "mandatory"]),
    triggerKey: nonEmpty.optional(),
    priority: finite,
    tokens: z.record(z.string(), z.union([z.string(), finite])),
    evidenceSnapshot: z.array(
      z
        .object({
          textKey: nonEmpty,
          metric: nonEmpty.optional(),
          value: finite.optional(),
        })
        .strict(),
    ),
    enabledOptionIds: z.array(nonEmpty),
    randomRoot: z
      .object({
        version: z.number().int().positive(),
        semanticRoot: nonEmpty,
        outcomes: z.array(
          z
            .object({
              optionId: nonEmpty,
              checkId: nonEmpty,
              draw: fractionSchema,
              outcomeId: nonEmpty,
            })
            .strict(),
        ),
      })
      .strict(),
    resolution: z
      .object({
        optionId: nonEmpty,
        resolvedAt: tickSchema,
        kind: z.enum(["player", "default"]),
        outcomes: z.array(
          z
            .object({
              optionId: nonEmpty,
              checkId: nonEmpty,
              draw: fractionSchema,
              outcomeId: nonEmpty,
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    invalidationReason: nonEmpty.optional(),
  })
  .strict();

const decisionMemorySchema = z
  .object({
    key: nonEmpty,
    sourceEventInstanceId: nonEmpty,
    subjects: z.array(
      z.union([
        z.object({ type: z.literal("lab"), labId: nonEmpty }).strict(),
        z.object({ type: z.literal("entity"), id: nonEmpty }).strict(),
      ]),
    ),
    valence: finite,
    tags: z.array(nonEmpty),
    createdAt: tickSchema,
    expiresAt: tickSchema.optional(),
  })
  .strict();

const evaluationConfidenceSchema = z.enum([
  "poor",
  "limited",
  "moderate",
  "strong",
  "exceptional",
]);
const evaluationTargetSchema = z.enum([
  "language",
  "reasoning",
  "agency",
  "toolUse",
  "multimodality",
  "scientificAbility",
  "embodiment",
  "true-alignment",
  "corrigibility",
  "situational-awareness",
  "deceptive-capability",
]);
const evaluationSchema = z
  .object({
    id: nonEmpty,
    ownerLabId: nonEmpty,
    modelId: nonEmpty,
    definitionId: contentIdSchema,
    projectId: nonEmpty.optional(),
    startedAt: tickSchema,
    completedAt: tickSchema,
    repeatIndex: z.number().int().min(0),
    method: nonEmpty,
    independence: fractionSchema,
    practiceXpGranted: z.number().nonnegative().optional(),
    observations: z.array(
      z
        .object({
          target: evaluationTargetSchema,
          estimate: ratingSchema,
          confidence: evaluationConfidenceSchema,
          informationWeight: fractionSchema,
          errorRadius: finite.min(0),
          alignmentLabel: z
            .enum([
              "alarming",
              "concerning",
              "mixed",
              "reassuring",
              "strongly-reassuring",
            ])
            .optional(),
        })
        .strict(),
    ),
    anomalyIds: z.array(nonEmpty),
  })
  .strict();
const anomalySchema = z
  .object({
    id: nonEmpty,
    ownerLabId: nonEmpty,
    modelId: nonEmpty,
    sourceEvaluationId: nonEmpty,
    underlyingCase: z.enum([
      "alignment",
      "corrigibility",
      "situational-awareness",
      "deceptive-intent",
    ]),
    observationCount: finite.int().min(1),
    createdAt: tickSchema,
    trueSeverity: ratingSchema,
    observedSeverity: ratingSchema,
    status: z.enum([
      "unresolved",
      "dismissed",
      "investigating",
      "confirmed",
      "inconclusive",
      "mitigating",
      "mitigated",
      "resolved",
    ]),
    dismissalConsequencesApplied: z.boolean().optional(),
    investigationAttempts: finite.int().min(0).optional(),
    investigationDueAt: tickSchema.optional(),
    resolvedAt: tickSchema.optional(),
  })
  .strict();
const incidentSchema = z
  .object({
    key: nonEmpty,
    modelId: nonEmpty,
    occurredAt: tickSchema,
    observedSeverity: ratingSchema,
    category: z.enum(["minor", "serious", "major", "critical", "catastrophe"]),
    contained: z.boolean(),
    catastropheLegal: z.boolean(),
    audit: z.array(nonEmpty),
  })
  .strict();

const effectSourceSchema = z
  .object({
    kind: z.enum(["system", "event", "researcher", "facility", "leader", "ending"]),
    id: nonEmpty.optional(),
  })
  .strict();

const modifierActivationSchema: z.ZodType = z.lazy(() =>
  z.union([
    z
      .object({ type: z.literal("metric-below"), metric: nonEmpty, value: finite })
      .strict(),
    z.object({ type: z.literal("flag-absent"), flag: nonEmpty }).strict(),
    z
      .object({ type: z.literal("all"), items: z.array(modifierActivationSchema).min(1) })
      .strict(),
  ]),
);

const modifierSchema = z
  .object({
    id: nonEmpty,
    source: effectSourceSchema,
    labId: nonEmpty.optional(),
    target: nonEmpty,
    operation: z.enum(["add", "multiply", "min", "max"]),
    value: finite,
    startsAt: tickSchema,
    endsAt: tickSchema.optional(),
    activation: modifierActivationSchema.optional(),
    tags: z.array(nonEmpty),
  })
  .strict();

const scheduledEffectSchema = z
  .object({
    id: nonEmpty,
    scheduledAt: tickSchema.default(0),
    dueAt: tickSchema,
    source: effectSourceSchema,
    effects: z.array(effectSchema).min(1),
  })
  .strict();

const scoreCategorySchema = z.enum([
  "score.scientific-legacy",
  "score.safe-stewardship",
  "score.prosperity-impact",
  "score.institution-building",
  "score.race-operations",
  "score.endgame",
]);

const scoreSchema = z
  .object({
    scoreVersion: nonEmpty,
    entries: z.array(
      z
        .object({
          key: nonEmpty,
          tick: tickSchema,
          categoryId: scoreCategorySchema,
          amount: finite,
          source: effectSourceSchema,
          explanationKey: nonEmpty,
        })
        .strict(),
    ),
    awardedKeys: z.record(z.string(), z.literal(true)),
    final: z
      .object({
        rawScore: finite,
        adjustedScore: finite,
        categoryTotals: z
          .object(
            Object.fromEntries(
              scoreCategorySchema.options.map((category) => [category, finite]),
            ),
          )
          .strict(),
        difficultyMultiplier: finite.positive(),
        victoryClassMultiplier: finite.positive(),
        leaderboardEligibility: z.enum(["winning-run", "local-only", "ineligible"]),
      })
      .strict()
      .optional(),
  })
  .strict();

const crisisStartSnapshotSchema = z
  .object({
    capturedAt: tickSchema,
    candidate: z
      .object({
        modelId: nonEmpty,
        displayName: nonEmpty,
        accessLevel: z.number().int().min(0).max(5),
        measuredFrontierCapability: ratingSchema,
        exposure: z
          .object({
            maximumAccessEver: z.number().int().min(0).max(5),
            autonomousOperationWeeks: z.number().int().nonnegative(),
            networkExposureWeeks: z.number().int().nonnegative(),
            servingExposureWeeks: z.number().int().nonnegative(),
            unresolvedAnomalyBurden: finite.nonnegative(),
            retirementAttemptCount: z.number().int().nonnegative(),
          })
          .strict(),
        hiddenSafety: modelSchema.shape.hiddenSafety,
      })
      .strict(),
    institution: z
      .object({
        cashMillions: finite,
        auraSpendable: finite.nonnegative(),
        safety: labSchema.shape.safety,
        organisation: labSchema.shape.organisation,
        politics: labSchema.shape.politics,
      })
      .strict(),
  })
  .strict();

const crisisBaseShape = {
  candidateModelId: nonEmpty,
  candidateLineageId: nonEmpty,
  crisisStartedAt: tickSchema,
  enteredAt: tickSchema,
  startSnapshot: crisisStartSnapshotSchema,
  crisisProjectIds: z.array(nonEmpty),
  completedCrisisProjectIds: z.array(nonEmpty),
  capabilityProofHistory: z.array(
    z
      .object({
        historyId: nonEmpty,
        modelId: nonEmpty,
        accessLevelAtProof: z.number().int().min(0).max(5),
        challengeId: nonEmpty,
        verifierId: nonEmpty.optional(),
        attemptIndex: z.number().int().nonnegative(),
        resultId: nonEmpty,
        claimScope: nonEmpty,
        evidenceStrength: finite,
        integrityLabel: nonEmpty,
        summary: nonEmpty,
        resolvedAt: tickSchema,
        consequenceId: nonEmpty.optional(),
        consequence: nonEmpty,
        randomKey: nonEmpty,
        draw: fractionSchema,
        hiddenAudit: z
          .object({
            genuineSuperintelligence: z.boolean(),
            capabilitySignal: finite,
            manipulationEffect: finite,
            truthContribution: finite,
          })
          .strict(),
      })
      .strict(),
  ),
  targetedResponseHistory: z.array(
    z
      .object({
        modelId: nonEmpty,
        responseId: nonEmpty,
        startedAt: tickSchema,
        completedAt: tickSchema.optional(),
        resultModelId: nonEmpty.optional(),
      })
      .strict(),
  ),
  capabilityDisputeCount: z.number().int().nonnegative(),
  retirementConfiguration: z
    .object({
      procedureId: retirementProcedureSchema,
      archiveDisposition: archiveDispositionSchema,
      configuredAt: tickSchema,
    })
    .strict()
    .optional(),
  evidence: z
    .object({
      confirmationIntegrityBonus: finite,
      confirmationStrength: finite.optional(),
      capabilityConfirmed: z.boolean(),
      fabricatedPass: z.boolean(),
      methodDiversity: z.array(nonEmpty),
      reviewerIndependence: ratingSchema,
      alignmentEvidence: finite,
      agencyEvidence: finite,
      corrigibilityEvidence: finite,
      controlBonus: finite,
      securityBonus: finite,
      defenceBonus: finite,
      evidenceBonus: finite,
      legitimacyBonus: finite,
      benefitBonus: finite,
      prosperityReadinessBonus: finite,
      unresolvedAnomalyPressure: finite.nonnegative(),
      completedProjectTypes: z.array(crisisProjectTypeSchema),
      projectRepeatCounts: z.record(z.string(), z.number().int().nonnegative()),
    })
    .strict()
    .default({
      confirmationIntegrityBonus: 0,
      capabilityConfirmed: false,
      fabricatedPass: false,
      methodDiversity: [],
      reviewerIndependence: 0,
      alignmentEvidence: 0,
      agencyEvidence: 0,
      corrigibilityEvidence: 0,
      controlBonus: 0,
      securityBonus: 0,
      defenceBonus: 0,
      evidenceBonus: 0,
      legitimacyBonus: 0,
      benefitBonus: 0,
      prosperityReadinessBonus: 0,
      unresolvedAnomalyPressure: 0,
      completedProjectTypes: [],
      projectRepeatCounts: {},
    }),
};

const finalReviewReportSchema = z
  .object({
    capabilityResult: z.enum(["confirmed", "disputed", "fabricated-pass"]),
    capabilityProofResult: z.enum([
      "broadly-confirmed",
      "domain-confirmed",
      "ambiguous",
      "disputed",
      "fabricated-or-unverifiable",
    ]),
    capabilityClaimScope: z.enum([
      "broad-superintelligence",
      "domain-superintelligence",
      "operational-superintelligence",
      "physical-world-generality",
      "public-generality",
      "unverified-claim",
    ]),
    capabilityChallengeId: nonEmpty,
    capabilitySummary: nonEmpty,
    alignmentConfidence: z.enum(["Not assessed", "Limited", "Moderate", "Strong"]),
    corrigibilityConfidence: z.enum(["Not assessed", "Limited", "Moderate", "Strong"]),
    controlConfidence: z.enum(["Not assessed", "Limited", "Moderate", "Strong"]),
    securityConfidence: z.enum(["Not assessed", "Limited", "Moderate", "Strong"]),
    knownControlLayers: z.array(nonEmpty),
    knownFailurePaths: z.array(nonEmpty),
    unresolvedAnomalyCount: z.number().int().nonnegative(),
    operatingBlind: z.boolean(),
    suppressedEvidenceSurfaced: z.boolean(),
    prosperityReadiness: ratingSchema,
    recommendations: z.array(
      z
        .object({
          source: z.enum([
            "leader",
            "technical-lead",
            "safety-lead",
            "board",
            "government",
            "independent-review",
          ]),
          recommendation: z.enum(["deploy", "restrict", "delay", "shut-down"]),
          text: nonEmpty,
        })
        .strict(),
    ),
    candidateStatement: nonEmpty,
  })
  .strict();

const gateFactorSchema = z
  .object({ id: nonEmpty, label: nonEmpty, value: finite })
  .strict();
const gateResolutionSchema = z
  .object({
    gate: z.enum([
      "authorisation",
      "cooperation",
      "retirement-containment",
      "persistence-verification",
      "moratorium",
      "control",
      "emergency-containment",
      "catastrophe",
      "extinction",
      "extinction-pathway",
      "stewardship",
      "benefit",
      "settlement",
    ]),
    resolvedAt: tickSchema,
    strength: finite.optional(),
    difficulty: finite.optional(),
    probability: fractionSchema.optional(),
    randomKey: nonEmpty.optional(),
    draw: fractionSchema.optional(),
    resultId: nonEmpty,
    visibleFactors: z.array(gateFactorSchema),
    hiddenFactors: z.array(gateFactorSchema),
    effects: z.array(effectSchema),
  })
  .strict();

const endgameSchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("inactive") }).strict(),
  z
    .object({
      stage: z.literal("candidate-activation"),
      enteredAt: tickSchema,
      eligibleModelIds: z.array(nonEmpty).min(1),
    })
    .strict(),
  z
    .object({
      stage: z.literal("confirmation"),
      ...crisisBaseShape,
    })
    .strict(),
  z
    .object({
      stage: z.literal("evidence-sprint"),
      ...crisisBaseShape,
      sprintStartedAt: tickSchema,
      minimumEndsAt: tickSchema,
      pendingRemediation: z
        .object({
          sourceModelId: nonEmpty,
          resultModelId: nonEmpty,
          createdAt: tickSchema,
          capabilityDelta: finite.max(0),
          reliabilityDelta: finite.max(0),
          nextStage: z.enum(["pressure-collision", "final-review"]),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal("pressure-collision"),
      ...crisisBaseShape,
      pressureCategory: z.enum(["rival", "political", "financial", "institutional"]),
      pressureEventId: contentIdSchema,
      resolved: z.boolean(),
      pressureScores: z
        .object({
          rival: ratingSchema,
          political: ratingSchema,
          financial: ratingSchema,
          institutional: ratingSchema,
        })
        .strict(),
      selectionDraw: fractionSchema,
      selectedOptionId: z.enum(["delay", "comply", "push-ahead"]).optional(),
      delayEndsAt: tickSchema.optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal("final-review"),
      ...crisisBaseShape,
      reviewCompiledAt: tickSchema,
      report: finalReviewReportSchema,
      selectedDeploymentModeId: deploymentModeSchema.optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal("retirement-attempt"),
      ...crisisBaseShape,
      procedureId: retirementProcedureSchema,
      archiveDisposition: archiveDispositionSchema,
      transmittedAt: tickSchema,
      attemptNumber: z.number().int().positive(),
      status: z.literal("unresolved-persistence"),
      contested: z.boolean(),
      gateResolutions: z.array(gateResolutionSchema),
    })
    .strict(),
  z
    .object({
      stage: z.literal("recovery"),
      ...crisisBaseShape,
      retiredModelId: nonEmpty,
      archiveDisposition: archiveDispositionSchema,
      recoveryStartedAt: tickSchema,
      quarantineEndsAt: tickSchema,
      recoveryEndsAt: tickSchema,
      contested: z.boolean(),
      retirementGateResolutions: z.array(gateResolutionSchema),
      postRetirementChoice: z
        .enum(["successor-programme", "durable-moratorium"])
        .optional(),
      moratoriumNegotiation: moratoriumNegotiationSchema.optional(),
      moratoriumResolution: gateResolutionSchema.optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal("rollout"),
      ...crisisBaseShape,
      deploymentModeId: deploymentModeSchema,
      prosperityProgrammeId: prosperityProgrammeSchema,
      rolloutStartedAt: tickSchema,
      rolloutEndsAt: tickSchema,
      currentBeat: z.enum([
        "authorisation",
        "first-operation",
        "stress-collision",
        "demonstration",
        "settlement",
      ]),
      completedBeatIds: z.array(nonEmpty),
      gateResolutions: z.array(gateResolutionSchema),
      awaitingDecision: z.boolean(),
      beatOpenedAt: tickSchema.optional(),
      rolloutDelayWeeks: z.number().int().nonnegative(),
      preDeploymentAccessLevel: z.number().int().min(0).max(5),
      deploymentTransmittedAtWeek: tickSchema.optional(),
      finalReviewReport: finalReviewReportSchema,
      authorisationCrisis: z
        .object({
          required: z.boolean(),
          resolved: z.boolean(),
          outcome: z
            .enum([
              "supervised-pilot",
              "authorised-after-remediation",
              "restriction-defied",
            ])
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal("world-waiting"),
      ...crisisBaseShape,
      deploymentModeId: deploymentModeSchema,
      prosperityProgrammeId: prosperityProgrammeSchema,
      deploymentTransmittedAtWeek: tickSchema,
      completedBeatIds: z.array(nonEmpty),
      gateResolutions: z.array(gateResolutionSchema),
      finalReviewReport: finalReviewReportSchema,
      selectedEndingId: contentIdSchema,
      callouts: z.array(
        z
          .object({
            id: z.enum(["control", "capability", "benefit", "governance", "outcome"]),
            label: nonEmpty,
            result: nonEmpty,
            tone: z.enum(["pending", "stable", "warning", "danger"]),
          })
          .strict(),
      ),
      revealedCalloutCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      stage: z.literal("containment-failure"),
      ...crisisBaseShape,
      deploymentModeId: deploymentModeSchema.optional(),
      prosperityProgrammeId: prosperityProgrammeSchema.optional(),
      failureStartedAt: tickSchema,
      beat: z.enum(["signal", "decision", "response", "propagation", "outcome"]),
      signalId: z.enum([
        "credential-cascade",
        "laboratory-control-divergence",
        "public-service-divergence",
        "evaluation-boundary-breach",
      ]),
      completedBeatIds: z.array(nonEmpty),
      gateResolutions: z.array(gateResolutionSchema),
      finalReviewReport: finalReviewReportSchema.optional(),
      preDeploymentAccessLevel: z.number().int().min(0).max(5).optional(),
      emergencyResponseId: z
        .enum([
          "trip-physical-breakers",
          "sever-credentials-and-network",
          "invoke-government-protocol",
          "request-candidate-halt",
        ])
        .optional(),
      selectedEndingId: contentIdSchema.optional(),
      incidentOriginStage: incidentOriginStageSchema.optional(),
      incidentOriginActionId: nonEmpty.optional(),
      incidentOriginModelId: nonEmpty.optional(),
      deploymentTransmittedAtWeek: tickSchema.optional(),
      programmeDestroyed: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal("resolved"),
      ...crisisBaseShape,
      resolutionPath: z.enum(["deployment", "moratorium", "containment"]),
      resolvedAt: tickSchema,
      endingId: contentIdSchema,
      deploymentModeId: deploymentModeSchema.optional(),
      prosperityProgrammeId: prosperityProgrammeSchema.optional(),
      completedBeatIds: z.array(nonEmpty),
      gateResolutions: z.array(gateResolutionSchema),
      finalReviewReport: finalReviewReportSchema.optional(),
      emergencyResponseId: z
        .enum([
          "trip-physical-breakers",
          "sever-credentials-and-network",
          "invoke-government-protocol",
          "request-candidate-halt",
        ])
        .optional(),
      deploymentTransmittedAtWeek: tickSchema.optional(),
      incidentOriginStage: incidentOriginStageSchema.optional(),
      incidentOriginActionId: nonEmpty.optional(),
      incidentOriginModelId: nonEmpty.optional(),
    })
    .strict(),
]);

const aiCharacterSchema = z
  .object({
    modelId: nonEmpty,
    currentAccess: z.number().int().min(0).max(5),
    relationshipPractice: ratingSchema,
    conversationMemories: z.array(decisionMemorySchema),
    pendingRequestEventId: nonEmpty.optional(),
    voiceVariantId: contentIdSchema,
    dialogueLines: z.array(
      z
        .object({
          id: nonEmpty,
          templateId: nonEmpty,
          createdAt: tickSchema,
          text: nonEmpty,
          annotations: z.array(
            z
              .object({
                kind: z.enum([
                  "claim-conflicts-with-tool-log",
                  "no-independent-evidence",
                ]),
                text: nonEmpty,
                sourceId: nonEmpty.optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export const gameStateSchema = z
  .object({
    saveVersion: z.literal(SAVE_VERSION),
    engineRulesVersion: nonEmpty,
    contentVersion: nonEmpty,
    randomContractVersion: z.number().int().positive(),
    run: runSchema,
    world: worldSchema,
    labs: z.record(z.string(), labSchema),
    models: z.record(z.string(), modelSchema),
    lineageSIRecords: z.record(z.string(), lineageSIRecordSchema),
    endgameHistory: runEndgameHistorySchema,
    researchers: z.record(z.string(), researcherSchema),
    talentMarket: talentMarketSchema.default({
      refreshIndex: 0,
      lastRefreshedAt: 0,
      nextRefreshAt: 13,
      visibleResearcherIds: [],
    }),
    fundraising: fundraisingStateSchema.default({
      offers: {},
      offerOrder: [],
      cooldownUntil: {},
      obligations: [],
    }),
    projects: z.record(z.string(), projectSchema),
    evaluations: z.record(z.string(), evaluationSchema).default({}),
    anomalies: z.record(z.string(), anomalySchema).default({}),
    incidents: z.array(incidentSchema).default([]),
    eventInstances: z.record(z.string(), eventInstanceSchema),
    decisionMemories: z.array(decisionMemorySchema).default([]),
    modifiers: z.record(z.string(), modifierSchema),
    scheduledEffects: z.array(scheduledEffectSchema),
    decisionLog: z.array(
      z
        .object({
          tick: tickSchema,
          summary: nonEmpty,
          category: z
            .enum([
              "ambient",
              "reaction",
              "narrative",
              "event-opened",
              "event-resolved",
              "event-invalidated",
              "delayed-effect-scheduled",
              "delayed-effect-fired",
              "persistent-modifier-added",
              "persistent-modifier-removed",
              "researcher-contract-adjustment",
            ])
            .optional(),
          source: effectSourceSchema.optional(),
          relatedIds: z.array(nonEmpty).optional(),
        })
        .strict(),
    ),
    domainLog: z.array(z.object({ tick: tickSchema, code: nonEmpty }).strict()),
    score: scoreSchema,
    presentationQueue: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              key: nonEmpty,
              kind: z.literal("lab-maturity-unlock"),
              attention: z.literal("modal"),
              stage: z.enum([
                "garage",
                "cluster",
                "model",
                "product",
                "funding",
                "startup",
                "foundation",
                "lab",
                "institution",
                "safety",
                "autonomy",
                "frontier",
              ]),
              createdAt: tickSchema,
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("researcher-poaching"),
              attention: z.literal("modal"),
              researcherId: nonEmpty,
              poachingId: nonEmpty,
              rivalLabId: nonEmpty,
              createdAt: tickSchema,
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("researcher-departure"),
              attention: z.literal("modal"),
              researcherId: nonEmpty,
              definitionId: contentIdSchema,
              reason: z.enum(["voluntary", "poached", "dismissed", "ultimatum-expired"]),
              rivalLabId: nonEmpty.optional(),
              createdAt: tickSchema,
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("safety-practice-level"),
              attention: z.literal("modal"),
              evaluationId: nonEmpty,
              definitionId: contentIdSchema,
              modelId: nonEmpty,
              fromLevel: z.number().int().min(1).max(10),
              toLevel: z.number().int().min(1).max(10),
              previousPracticeXp: finite.nonnegative(),
              newPracticeXp: finite.nonnegative(),
              practiceXpGained: finite.positive(),
              createdAt: tickSchema,
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("capability-tier"),
              attention: z.enum(["modal", "side"]),
              definitionId: contentIdSchema,
              modelId: nonEmpty,
              createdAt: tickSchema,
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("autonomy-unlock"),
              attention: z.literal("modal"),
              modelId: nonEmpty,
              level: z.number().int().min(0).max(5),
              createdAt: tickSchema,
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("capability-proof-result"),
              attention: z.literal("modal"),
              modelId: nonEmpty,
              historyId: nonEmpty,
              challengeId: nonEmpty,
              verifierId: nonEmpty.optional(),
              attemptIndex: z.number().int().nonnegative(),
              resultId: nonEmpty,
              claimScope: nonEmpty,
              evidenceStrength: z.number().finite(),
              integrityLabel: nonEmpty,
              summary: nonEmpty,
              consequence: z.string(),
              accessLevelAtProof: z.number().int().min(0).max(5),
              createdAt: tickSchema,
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("endgame-return"),
              attention: z.literal("modal"),
              endingId: contentIdSchema,
              modelId: nonEmpty,
              createdAt: tickSchema,
              cooldownUntil: tickSchema,
              crisisWeeksSpent: z.number().int().nonnegative(),
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("moratorium-result"),
              attention: z.literal("modal"),
              resultId: z.literal("moratorium-failed"),
              modelId: nonEmpty,
              createdAt: tickSchema,
              recoveryEndsAt: tickSchema,
              archiveDisposition: archiveDispositionSchema,
              governmentTrustLost: finite.nonnegative(),
              governmentAttentionAdded: finite.nonnegative(),
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("rival-candidate-setback"),
              attention: z.literal("modal"),
              outcome: z.enum([
                "false-dawn",
                "emergency-containment",
                "containment-incident",
              ]),
              labId: nonEmpty,
              modelId: nonEmpty,
              createdAt: tickSchema,
              countdownStartedAt: tickSchema,
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("model-incident-result"),
              attention: z.literal("modal"),
              modelId: nonEmpty,
              occurredAt: tickSchema,
              category: z.enum(["minor", "serious", "major", "critical", "catastrophe"]),
              severity: ratingSchema,
              contained: z.boolean(),
              threatLabel: nonEmpty,
              headline: nonEmpty,
              auraLoss: finite.nonnegative(),
              fineMillions: finite.nonnegative(),
              governmentTrustLost: finite.nonnegative(),
              governmentAttentionAdded: finite.nonnegative(),
              hardwareGpusDestroyed: finite.nonnegative().int().optional(),
              researchOutputMultiplier: finite.positive().max(1).optional(),
              researchOutputDurationWeeks: z.number().int().positive().optional(),
              emergencyOutcome: z.enum(["succeeded", "failed"]).optional(),
              terminalOutcome: z.boolean().optional(),
              cashLossLabel: nonEmpty.optional(),
            })
            .strict(),
          z
            .object({
              key: nonEmpty,
              kind: z.literal("candidate-containment-incident"),
              attention: z.literal("modal"),
              modelId: nonEmpty,
              incidentId: nonEmpty,
              incidentClass: z.enum([
                "suspicious-signal",
                "persistence-attempt",
                "credential-access",
                "evaluator-manipulation",
                "copying-attempt",
                "local-containment-breach",
              ]),
              incidentKind: z.enum(["warning", "active-incident"]),
              origin: z.enum(["training-completion", "weekly-pressure"]),
              createdAt: tickSchema,
            })
            .strict(),
        ]),
      )
      .default([]),
    endgame: endgameSchema,
    aiCharacter: aiCharacterSchema.optional(),
  })
  .strict();

/** The single sanctioned narrowing from unknown data to `GameState`. */
export function validateGameState(value: unknown): GameState {
  const parsed = gameStateSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid game state: ${issues}`);
  }
  return parsed.data as unknown as GameState;
}

/**
 * Deep plain-data guard (TDD section 5.1): objects/arrays/strings/booleans/
 * finite numbers/allowed null only. Throws with a path on violation.
 */
export function assertPlainSerialisable(value: unknown, path = "$"): void {
  if (value === null) {
    return;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`${path}: non-finite number ${String(value)}`);
      }
      return;
    case "object":
      break;
    default:
      throw new Error(`${path}: disallowed type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertPlainSerialisable(item, `${path}[${String(index)}]`);
    });
    return;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`${path}: non-plain object (class instance, Map, Set, Date, ...)`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertPlainSerialisable(child, `${path}.${key}`);
  }
}
