export const CONTENT_COMPILER_PACKAGE = "@neolab/content-compiler";

export {
  collectReleaseCopyFiles,
  createContentReleaseReport,
  isEventPredicateSatisfiable,
  RETIRED_ENDING_NAMES,
  validateRetiredEndingNames,
  type ContentReleaseReport,
  type LocalisationMessages,
  type ReleaseValidationIssue,
  type ReleaseValidationSeverity,
  type ScannableTextFile,
} from "./release-validation.ts";
