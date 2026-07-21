import { isContentId } from "@neolab/content-schema";
import { z } from "zod";

import type { GameState } from "./state.ts";

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
  "training-complete",
  "world-first-paper",
  "resignation-ultimatum",
  "bankruptcy-warning",
  "rival-final-year",
  "crisis-stage",
  "manual",
]);

const idNamespaceSchema = z.enum([
  "lab",
  "model",
  "project",
  "event",
  "modifier",
  "gpu-lot",
  "evaluation",
  "anomaly",
  "coalition",
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
  "engineeringQuality",
  "managementCapacity",
  "researchFreedom",
  "boardPatience",
  "internalCandour",
  "governmentAttention",
  "governmentTrust",
  "strategicDependence",
  "captureConcern",
]);

const effectSchema: z.ZodType = z.lazy(() =>
  z.union([
    z
      .object({
        kind: z.literal("add-resource"),
        subject: effectSubjectSchema,
        resource: z.enum(["cash", "aura-spendable"]),
        amount: z.number().finite(),
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
        kind: z.literal("set-flag"),
        subject: effectSubjectSchema,
        flag: z.string().min(1),
        value: z.union([z.string(), z.number().finite(), z.boolean()]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("add-modifier"),
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
          idNamespaceSchema.options.map((namespace) => [namespace, counterSchema]),
        ),
      )
      .strict(),
  })
  .strict();

const worldSchema = z
  .object({
    fundingClimate: ratingSchema,
    currentGpuGenerationId: contentIdSchema,
    eventCooldowns: z.record(z.string(), tickSchema),
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
  })
  .strict();

export const gpuAllocationSchema = z
  .object({
    servingBasisPoints: basisPointsSchema,
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
  })
  .strict();

const computeSchema = z
  .object({
    lots: z.array(gpuLotSchema),
    allocation: gpuAllocationSchema,
    reservations: z.array(gpuReservationSchema),
    softwareEfficiency: finite.positive(),
  })
  .strict();

const labSchema = z
  .object({
    id: nonEmpty,
    definitionId: contentIdSchema,
    control: z.enum(["player", "rival"]),
    finance: z.object({ cash: finite }).strict(),
    aura: z.object({ spendable: finite.min(0), lifetime: finite.min(0) }).strict(),
    compute: computeSchema,
    research: z
      .object({
        domains: z.record(z.string(), z.object({ level: ratingSchema }).strict()),
      })
      .strict(),
    safety: z
      .object({
        safetyCulture: ratingSchema,
        alignmentScience: ratingSchema,
        evalQuality: ratingSchema,
        controlTheory: ratingSchema,
        practicalControlStrength: ratingSchema,
        securityPosture: ratingSchema,
      })
      .strict(),
    organisation: z
      .object({
        engineeringQuality: ratingSchema,
        managementCapacity: ratingSchema,
        researchFreedom: ratingSchema,
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
          z.object({ definitionId: contentIdSchema, completedAt: tickSchema }).strict(),
        ),
      })
      .strict(),
    market: z.object({ marketShare: fractionSchema }).strict(),
    politics: z
      .object({
        governmentAttention: ratingSchema,
        governmentTrust: ratingSchema,
        strategicDependence: ratingSchema,
        captureConcern: ratingSchema,
      })
      .strict(),
    models: z
      .object({
        currentModelId: nonEmpty.optional(),
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

const modelSchema = z
  .object({
    id: nonEmpty,
    ownerLabId: nonEmpty,
    generationIndex: z.number().int().min(0),
    familyName: nonEmpty,
    displayName: nonEmpty,
    trainedAt: tickSchema,
    trueCapability: capabilityVectorSchema,
    generality: ratingSchema,
    productQuality: ratingSchema,
    reliability: ratingSchema,
    accessLevel: z.number().int().min(0).max(5),
    evaluations: z.array(nonEmpty),
    anomalies: z.array(nonEmpty),
    hiddenSafety: z
      .object({
        trueAlignment: ratingSchema,
        corrigibility: ratingSchema,
        situationalAwareness: ratingSchema,
        deceptiveCapability: ratingSchema,
        generatedByRandomContract: z.number().int().min(1),
      })
      .strict(),
    flags: z.record(z.string(), flagValueSchema),
  })
  .strict();

const projectSchema = z
  .object({
    id: nonEmpty,
    ownerLabId: nonEmpty,
    definitionId: contentIdSchema,
    kind: z.enum(["construction", "training", "evaluation"]),
    status: z.enum(["queued", "active", "paused", "completed", "cancelled", "failed"]),
    createdAt: tickSchema,
    startedAt: tickSchema.optional(),
    expectedDurationWeeks: z.number().int().positive(),
    progress: fractionSchema,
    completionOrder: z.number().int().min(0),
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
    tokens: z.record(z.string(), z.string()),
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

export const gameStateSchema = z
  .object({
    saveVersion: z.literal(1),
    engineRulesVersion: nonEmpty,
    contentVersion: nonEmpty,
    randomContractVersion: z.number().int().positive(),
    run: runSchema,
    world: worldSchema,
    labs: z.record(z.string(), labSchema),
    models: z.record(z.string(), modelSchema),
    projects: z.record(z.string(), projectSchema),
    eventInstances: z.record(z.string(), eventInstanceSchema),
    modifiers: z.record(z.string(), modifierSchema),
    scheduledEffects: z.array(scheduledEffectSchema),
    decisionLog: z.array(z.object({ tick: tickSchema, summary: nonEmpty }).strict()),
    domainLog: z.array(z.object({ tick: tickSchema, code: nonEmpty }).strict()),
    score: scoreSchema,
    endgame: z.object({ stage: z.literal("inactive") }).strict(),
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
