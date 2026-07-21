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
    legalStatus: z.string().min(1),
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
            aiNamingStyle: z.string().min(1),
            sourceNotes: z.array(z.string().url()).min(1),
            portrayal: portrayalSchema,
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
            trainingFactor: z.number().positive(),
            servingFactor: z.number().positive(),
            powerPerThousand: z.number().positive(),
            interconnectTier: z.number().int().min(1),
            reliability: z.number().min(0).max(100),
            gameCostMillionsPerThousand: z.number().positive(),
            gameOperatingCostMillionsPerThousandPerCycle: z.number().positive(),
            deliveryWeeks: z.number().int().positive(),
            summary: z.string().min(1),
            source: z.string().url().optional(),
          })
          .strict(),
      )
      .min(1),
    review: z.record(z.string(), z.union([z.boolean(), z.string()])),
  })
  .strict();

export type GpuGenerationsFile = z.infer<typeof gpuGenerationsFileSchema>;

const startingModelSchema = z
  .object({
    familyGenerationIndex: z.number().int().min(0),
    capability: z.record(z.string(), z.number().min(0).max(100)),
    generality: z.number().min(0).max(100),
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
        startYear: z.number().int(),
        cash: z.number().finite(),
        auraSpendable: z.number().min(0),
        auraLifetime: z.number().min(0),
        gpus: z
          .object({
            generation: z.string().min(1),
            owned: z.number().int().positive(),
            leased: z.number().int().positive(),
          })
          .strict(),
        softwareEfficiency: z.number().positive(),
        startingModel: startingModelSchema,
        marketShare: z.number().min(0).max(1),
        starSlots: z.number().int().min(0).max(8),
        generalResearchers: z.number().int().min(0),
        engineersAndOps: z.number().int().min(0),
        ratings: z.record(z.string(), z.number().min(0).max(100)),
        domains: z.record(z.string(), z.number().min(0).max(100)),
        facilities: z.array(z.string().min(1)).min(1),
        allocation: z
          .object({
            servingBasisPoints: z.number().int().min(0).max(10_000),
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
        fundingClimate: z.number().min(0).max(100),
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
            effects: z.array(authoredEffectSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type BalanceFile = z.infer<typeof balanceFileSchema>;
