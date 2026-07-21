import { z } from "zod";

import type { AuthoredEffect } from "./authored.ts";
import type { ContentId } from "./content-id.ts";
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

export interface LeaderDefinition {
  readonly id: ContentId;
  readonly labId: ContentId;
  readonly displayName: string;
  readonly inspirationName: string;
  readonly epithet: string;
  readonly aiFamily: string;
  readonly characteristic: string;
  readonly biography: string;
  readonly headlineBonus: NamedEffectGroup;
  readonly labModifiers: readonly NamedEffectGroup[];
  readonly complexity: string;
  readonly aiNamingStyle: string;
  readonly sourceNotes: readonly string[];
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
  readonly trainingFactor: number;
  readonly servingFactor: number;
  readonly powerPerThousand: number;
  readonly interconnectTier: number;
  readonly reliability: number;
  readonly gameCostMillionsPerThousand: number;
  readonly gameOperatingCostMillionsPerThousandPerCycle: number;
  readonly deliveryWeeks: number;
  readonly summary: string;
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
  readonly effects: readonly AuthoredEffect[];
}

export interface NewGameBalance {
  readonly startYear: number;
  readonly cash: number;
  readonly auraSpendable: number;
  readonly auraLifetime: number;
  readonly gpus: {
    readonly generationId: ContentId;
    readonly owned: number;
    readonly leased: number;
  };
  readonly softwareEfficiency: number;
  readonly startingModel: {
    readonly familyGenerationIndex: number;
    readonly capability: Readonly<Record<string, number>>;
    readonly generality: number;
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
  readonly facilities: readonly ContentId[];
  readonly allocation: {
    readonly servingBasisPoints: number;
    readonly capabilityBasisPoints: number;
    readonly capabilityDomainWeights: Readonly<Record<string, number>>;
    readonly safetyProgramWeights: Readonly<Record<string, number>>;
  };
  readonly fundingClimate: number;
}

export interface CompiledContent {
  readonly bundleFormat: 2;
  readonly manifest: {
    readonly contentVersion: string;
    readonly bundleHash: string;
  };
  readonly authoringManifest: AuthoringManifest;
  readonly leaders: Readonly<Record<string, LeaderDefinition>>;
  readonly labs: Readonly<Record<string, LabDefinition>>;
  readonly gpuGenerations: Readonly<Record<string, GpuGenerationDefinition>>;
  readonly difficulties: Readonly<Record<string, DifficultyDefinition>>;
  readonly mandates: Readonly<Record<string, MandateDefinition>>;
  readonly balance: { readonly newGame: NewGameBalance };
  readonly scoreRules: ScoreRulesDefinition;
}

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
    leaders: z.record(z.string(), z.unknown()),
    labs: z.record(z.string(), z.unknown()),
    gpuGenerations: z.record(z.string(), z.unknown()),
    difficulties: z.record(z.string(), z.unknown()),
    mandates: z.record(z.string(), z.unknown()),
    balance: z.object({ newGame: z.unknown() }).strict(),
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
