export { CONTENT_SCHEMA_PACKAGE } from "./meta.ts";
export type { Brand } from "./brand.ts";
export { contentId, isContentId, type ContentId } from "./content-id.ts";
export { authoringManifestSchema, type AuthoringManifest } from "./manifest.ts";
export {
  authoredActivationSchema,
  authoredEffectSchema,
  balanceFileSchema,
  gpuGenerationsFileSchema,
  launchLeadersFileSchema,
  type AuthoredActivation,
  type AuthoredEffect,
  type BalanceFile,
  type GpuGenerationsFile,
  type LaunchLeadersFile,
} from "./authored.ts";
export {
  GRANT_TARGET_LIST,
  isKnownEffectTarget,
  MODIFIER_TARGET_LIST,
  STARTING_TARGET_LIST,
} from "./effect-targets.ts";
export {
  scoringFileSchema,
  SCORE_CATEGORY_IDS,
  type ScoreCategoryDefinition,
  type ScoreCategoryId,
  type ScoreRulesDefinition,
  type ScoringFile,
} from "./scoring.ts";
export {
  compiledContentSchema,
  validateCompiledContent,
  type CompiledContent,
  type DifficultyDefinition,
  type GpuGenerationDefinition,
  type LabDefinition,
  type LeaderDefinition,
  type MandateDefinition,
  type NamedEffectGroup,
  type NewGameBalance,
} from "./compiled.ts";
