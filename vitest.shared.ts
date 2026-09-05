/**
 * Thirty seconds, not vitest's default five.
 *
 * This suite runs a deterministic simulation, and its slowest tests advance
 * dozens to hundreds of weeks of a fully populated world -- a seeded crisis
 * replay, a 52-week tick census, a three-year finance reconciliation, the rival
 * Candidate Programme race. Each takes a few seconds alone, comfortably inside
 * five, which is exactly what made the default so expensive: they passed run on
 * their own and failed only in a full run, with 136 test files competing for
 * cores. One loaded run failed eight files that way, none of them broken.
 *
 * That is the worst kind of red. It costs a diagnosis every time, and it trains
 * everyone to read failures as noise -- which is how a real one gets waved
 * through.
 *
 * Thirty seconds still catches a genuine hang; nothing here legitimately takes
 * that long. A test that starts needing more is telling you something about the
 * test, not asking for this number to go up again.
 *
 * It lives here because vitest does NOT propagate a root-level testTimeout to
 * projects matched by a directory glob -- verified with an 8s probe test, which
 * still died at 5000ms with the value set only in the root config. Every
 * project therefore has to opt in explicitly.
 */
export const SIMULATION_TEST_TIMEOUT_MS = 30_000;

export const sharedTestConfig = {
  testTimeout: SIMULATION_TEST_TIMEOUT_MS,
  hookTimeout: SIMULATION_TEST_TIMEOUT_MS,
} as const;
