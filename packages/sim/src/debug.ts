/**
 * Privileged post-run surface. Browser runtime adapters may call this only after
 * `run.status !== "active"`; normal gameplay code imports `@neolab/sim/public`.
 */
export {
  projectPostRunAudit,
  type PostRunAuditView,
} from "./selectors/post-run-audit.ts";
export {
  DEVELOPER_INSPECTOR_BUNDLE_SENTINEL,
  exportDeveloperScenarioFixture,
  lookupDeveloperRandom,
  projectDeveloperInspector,
  type DeveloperInspectorView,
  type DeveloperRandomLookup,
  type DeveloperScenarioFixtureV1,
} from "./selectors/developer-inspector.ts";
export {
  ENDGAME_PLAYTEST_SCENARIOS,
  createEndgamePlaytestState,
  isEndgamePlaytestScenarioId,
  type EndgamePlaytestScenarioId,
} from "./developer/scenarios.ts";
export {
  deriveEndingResolutionInputs,
  type EndingResolutionInputs,
} from "./endgame/endings.ts";
