import { z } from "zod";

import type { ContentId } from "./content-id.ts";

/**
 * Authored schema and compiled form of `content/scoring.yaml` (GDD section
 * 41.5, TDD section 18.5). Score amounts and multipliers live HERE — system
 * code never contains paper titles or ending point tables.
 *
 * The award tables consumed by later stages are carried through validated but
 * loosely typed (`awardTables`); each consuming stage tightens its own table.
 */

export const SCORE_CATEGORY_IDS = [
  "score.scientific-legacy",
  "score.safe-stewardship",
  "score.prosperity-impact",
  "score.institution-building",
  "score.race-operations",
  "score.endgame",
] as const;

export type ScoreCategoryId = (typeof SCORE_CATEGORY_IDS)[number];

const categorySchema = z
  .object({
    id: z.enum(SCORE_CATEGORY_IDS),
    name: z.string().min(1),
    colour: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .strict();

export const scoringFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("scoring-rules"),
    status: z.string().min(1),
    scoreVersion: z.string().min(1),
    principles: z.record(z.string(), z.union([z.boolean(), z.number()])),
    categories: z.array(categorySchema).length(SCORE_CATEGORY_IDS.length),
    paperAwards: z.record(z.string(), z.unknown()),
    researchAwards: z.record(z.string(), z.unknown()),
    safetyAwards: z.record(z.string(), z.unknown()),
    prosperityAwards: z.record(z.string(), z.unknown()),
    institutionAwards: z.record(z.string(), z.unknown()),
    raceAwards: z.record(z.string(), z.unknown()),
    endingAwards: z
      .object({
        category: z.literal("score.endgame"),
        basePoints: z.record(z.string().regex(/^ending\.[a-z0-9-]+$/), z.number().min(0)),
        victoryClassMultiplier: z
          .object({
            full: z.number().positive(),
            qualified: z.number().positive(),
            survival: z.number().positive(),
            loss: z.number().positive(),
          })
          .strict(),
      })
      .strict(),
    difficultyMultiplier: z.record(z.string().min(1), z.number().positive()),
    finalisation: z.record(z.string(), z.unknown()),
    antiFarmingRules: z.array(z.string().min(1)).min(1),
    leaderboards: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ScoringFile = z.infer<typeof scoringFileSchema>;

export interface ScoreCategoryDefinition {
  readonly id: ScoreCategoryId;
  readonly name: string;
  readonly colour: string;
}

export interface ScoreRulesDefinition {
  readonly scoreVersion: string;
  readonly categories: readonly ScoreCategoryDefinition[];
  /** Keyed by canonical ending ContentId. */
  readonly endingBasePoints: Readonly<Record<string, number>>;
  readonly victoryClassMultiplier: Readonly<{
    full: number;
    qualified: number;
    survival: number;
    loss: number;
  }>;
  /** Keyed by difficulty short name (matching `difficulty.<name>`). */
  readonly difficultyMultiplier: Readonly<Record<string, number>>;
  /** Stage-specific award tables, tightened by their consuming stages. */
  readonly awardTables: {
    readonly paperAwards: Readonly<Record<string, unknown>>;
    readonly researchAwards: Readonly<Record<string, unknown>>;
    readonly safetyAwards: Readonly<Record<string, unknown>>;
    readonly prosperityAwards: Readonly<Record<string, unknown>>;
    readonly institutionAwards: Readonly<Record<string, unknown>>;
    readonly raceAwards: Readonly<Record<string, unknown>>;
  };
}

export type ScoreEndingId = ContentId;
