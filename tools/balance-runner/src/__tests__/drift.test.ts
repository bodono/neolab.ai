import { describe, expect, it } from "vitest";

import {
  baselineFromReport,
  compareWithBaseline,
  ladderMismatch,
  summariseLadder,
} from "../drift.ts";
import type { BalanceReport, BalanceRunResult } from "../types.ts";

function run(
  difficulty: string,
  overrides: { won?: boolean; ending?: string; ticks?: number } = {},
): BalanceRunResult {
  const won = overrides.won ?? false;
  return {
    difficultyId: `base:difficulty.${difficulty}`,
    status: won ? "won" : "lost",
    endingId:
      overrides.ending ?? (won ? "base:ending.won" : "base:ending.rival-ascendance"),
    lossFamily: won ? "none" : "rival-ascendance",
    ticks: overrides.ticks ?? 900,
    playerWorldFirstShare: 0.1,
    events: { ordinaryDecisionCount: 30 },
    endgame: { crisisStartedAt: won ? 850 : undefined },
    rivalCompetitiveness: { candidateOutcomes: { firstQualifyingCapabilityMean: 95 } },
  } as unknown as BalanceRunResult;
}

function report(runs: readonly BalanceRunResult[], seeds = 20): BalanceReport {
  const difficulties = new Set(runs.map((run) => run.difficultyId)).size;
  return {
    requestedMaxTicks: 1500,
    content: { hash: "test" },
    matrix: { seeds, policies: 1, difficulties, leaders: 1, mandates: 1 },
    runs,
  } as unknown as BalanceReport;
}

/** Twenty Standard runs, `wins` of them won. */
function standard(wins: number): BalanceRunResult[] {
  return Array.from({ length: 20 }, (_, index) => run("standard", { won: index < wins }));
}

describe("balance drift", () => {
  it("summarises each difficulty and the whole ladder", () => {
    const statistics = summariseLadder(
      report([...standard(6), run("frontier", { won: true }), run("frontier")]),
    );
    expect(statistics["standard"]?.wins).toBe(6);
    expect(statistics["standard"]?.rivalAscendance).toBe(14);
    expect(statistics["frontier"]?.runs).toBe(2);
    expect(statistics["all"]?.wins).toBe(7);
  });

  it("passes an identical ladder and anything within chance of it", () => {
    const baseline = baselineFromReport(report(standard(6)), "abc");
    expect(
      compareWithBaseline(baseline, summariseLadder(report(standard(6)))).some(
        (row) => row.drifted,
      ),
    ).toBe(false);
    // Six wins in twenty, re-rolled against a baseline that was itself a
    // draw: the difference has noise of about 2.9, and three of those is nine.
    expect(
      compareWithBaseline(baseline, summariseLadder(report(standard(10)))).some(
        (row) => row.drifted,
      ),
    ).toBe(false);
  });

  it("fails when a statistic moves further than chance would", () => {
    const baseline = baselineFromReport(report(standard(6)), "abc");
    const drifted = compareWithBaseline(baseline, summariseLadder(report(standard(16))))
      .filter((row) => row.drifted)
      .map((row) => `${row.scope}:${row.metric}`);
    expect(drifted).toContain("standard:wins");
    expect(drifted).toContain("standard:rivalAscendance");
  });

  it("refuses a ladder of a different shape", () => {
    const baseline = baselineFromReport(report(standard(6)), "abc");
    expect(ladderMismatch(baseline, report(standard(6), 10))).toMatch(/seeds/);
    expect(ladderMismatch(baseline, report(standard(6)))).toBeUndefined();
    const twoDifficulties = report([...standard(6), run("frontier")]);
    expect(ladderMismatch(baseline, twoDifficulties)).toMatch(/difficulties/);
    // A baseline written before difficulties were recorded still compares.
    const { difficulties: _omitted, ...older } = baseline.ladder;
    expect(
      ladderMismatch({ ...baseline, ladder: older }, report(standard(6))),
    ).toBeUndefined();
  });
});
