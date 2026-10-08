// Balance drift: summarise an expert-ladder report and compare it with a
// committed baseline. The ladder plays fixed seeds and the simulation is
// deterministic, so unchanged code reproduces the baseline exactly; any
// movement comes from a code or content change. The allowances ask how far a
// change moved the numbers compared with re-rolling the same seeds, so a
// failure means "this moved more than chance would", not "anything changed".
import type { BalanceReport, BalanceRunResult } from "./types.ts";

export const BALANCE_BASELINE_FORMAT = 1;

/** One difficulty's ladder statistics, or the whole ladder's under `all`. */
export interface LadderStatistics {
  readonly runs: number;
  readonly wins: number;
  readonly crisisReached: number;
  readonly emergencyShutdowns: number;
  readonly rivalAscendance: number;
  readonly medianEndWeek: number;
  readonly meanOrdinaryEvents: number;
  readonly meanPlayerWorldFirstShare: number;
  readonly meanRivalCrossingCapability: number | null;
}

export interface BalanceBaseline {
  readonly format: typeof BALANCE_BASELINE_FORMAT;
  /** Commit the baseline was measured at, for the reader; never compared. */
  readonly measuredAt: string;
  readonly contentHash: string;
  readonly ladder: {
    readonly seeds: number;
    readonly maxTicks: number;
    /** Absent from baselines written before it was recorded. */
    readonly difficulties?: number;
    readonly policies: number;
    readonly leaders: number;
    readonly mandates: number;
  };
  readonly statistics: Readonly<Record<string, LadderStatistics>>;
}

export interface DriftRow {
  readonly scope: string;
  readonly metric: keyof LadderStatistics;
  readonly baseline: number | null;
  readonly current: number | null;
  readonly allowed: number;
  readonly drifted: boolean;
}

/**
 * A count out of n runs has noise sqrt(n p (1 - p)) per ladder, and both the
 * baseline and the new ladder are draws, so their difference has noise
 * sqrt(2 n p (1 - p)). A change that re-rolls the random streams without
 * moving balance must almost never fail the weekly run, across about twenty
 * count rows at once, so the allowance is three standard deviations of that
 * difference, and never under three games for rare outcomes.
 */
const COUNT_METRICS = [
  "wins",
  "crisisReached",
  "emergencyShutdowns",
  "rivalAscendance",
] as const;
const COUNT_NOISE_MULTIPLE = 3;
const MINIMUM_COUNT_ALLOWANCE = 3;
const FIXED_ALLOWANCES = {
  // A difficulty's median end week has moved by up to about 60 weeks between
  // versions without a balance change in sight.
  medianEndWeek: 80,
  meanOrdinaryEvents: 4,
  meanPlayerWorldFirstShare: 0.1,
  meanRivalCrossingCapability: 2,
} as const;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function ladderStatistics(runs: readonly BalanceRunResult[]): LadderStatistics {
  const crossings = runs
    .map(
      (run) => run.rivalCompetitiveness.candidateOutcomes.firstQualifyingCapabilityMean,
    )
    .filter((value): value is number => value !== undefined);
  return {
    runs: runs.length,
    wins: runs.filter((run) => run.status === "won").length,
    crisisReached: runs.filter((run) => run.endgame.crisisStartedAt !== undefined).length,
    emergencyShutdowns: runs.filter((run) => run.endingId.endsWith("emergency-shutdown"))
      .length,
    rivalAscendance: runs.filter((run) => run.lossFamily === "rival-ascendance").length,
    medianEndWeek: median(runs.map((run) => run.ticks)),
    meanOrdinaryEvents: round(
      mean(runs.map((run) => run.events.ordinaryDecisionCount)),
      1,
    ),
    meanPlayerWorldFirstShare: round(
      mean(runs.map((run) => run.playerWorldFirstShare)),
      3,
    ),
    meanRivalCrossingCapability:
      crossings.length === 0 ? null : round(mean(crossings), 1),
  };
}

/** Statistics per difficulty slug, plus the whole ladder under `all`. */
export function summariseLadder(
  report: BalanceReport,
): Readonly<Record<string, LadderStatistics>> {
  const byDifficulty = new Map<string, BalanceRunResult[]>();
  for (const run of report.runs) {
    const slug = run.difficultyId.split(".").pop() ?? run.difficultyId;
    byDifficulty.set(slug, [...(byDifficulty.get(slug) ?? []), run]);
  }
  const statistics: Record<string, LadderStatistics> = {};
  for (const slug of [...byDifficulty.keys()].sort()) {
    statistics[slug] = ladderStatistics(byDifficulty.get(slug) ?? []);
  }
  statistics["all"] = ladderStatistics(report.runs);
  return statistics;
}

export function baselineFromReport(
  report: BalanceReport,
  measuredAt: string,
): BalanceBaseline {
  return {
    format: BALANCE_BASELINE_FORMAT,
    measuredAt,
    contentHash: report.content.hash,
    ladder: {
      seeds: report.matrix.seeds,
      maxTicks: report.requestedMaxTicks,
      policies: report.matrix.policies,
      difficulties: report.matrix.difficulties,
      leaders: report.matrix.leaders,
      mandates: report.matrix.mandates,
    },
    statistics: summariseLadder(report),
  };
}

/** Why a report cannot be compared with the baseline, if it cannot. */
export function ladderMismatch(
  baseline: BalanceBaseline,
  report: BalanceReport,
): string | undefined {
  const current = baselineFromReport(report, "").ladder;
  for (const key of Object.keys(current) as (keyof BalanceBaseline["ladder"])[]) {
    if (baseline.ladder[key] === undefined) continue;
    if (baseline.ladder[key] !== current[key]) {
      return `ladder ${key} is ${String(current[key])}, baseline has ${String(baseline.ladder[key])}`;
    }
  }
  const missing = Object.keys(baseline.statistics).filter(
    (scope) => !(scope in summariseLadder(report)),
  );
  return missing.length === 0 ? undefined : `report lacks ${missing.join(", ")}`;
}

function countAllowance(baselineCount: number, runs: number): number {
  const p = runs === 0 ? 0 : baselineCount / runs;
  return Math.max(
    MINIMUM_COUNT_ALLOWANCE,
    Math.ceil(COUNT_NOISE_MULTIPLE * Math.sqrt(2 * runs * p * (1 - p))),
  );
}

export function compareWithBaseline(
  baseline: BalanceBaseline,
  current: Readonly<Record<string, LadderStatistics>>,
): readonly DriftRow[] {
  const rows: DriftRow[] = [];
  for (const [scope, expected] of Object.entries(baseline.statistics)) {
    const actual = current[scope];
    if (actual === undefined) continue;
    for (const metric of COUNT_METRICS) {
      const allowed = countAllowance(expected[metric], expected.runs);
      rows.push({
        scope,
        metric,
        baseline: expected[metric],
        current: actual[metric],
        allowed,
        drifted: Math.abs(actual[metric] - expected[metric]) > allowed,
      });
    }
    for (const [metric, allowed] of Object.entries(FIXED_ALLOWANCES) as [
      keyof typeof FIXED_ALLOWANCES,
      number,
    ][]) {
      const before = expected[metric];
      const after = actual[metric];
      rows.push({
        scope,
        metric,
        baseline: before,
        current: after,
        allowed,
        drifted:
          before === null || after === null
            ? before !== after
            : Math.abs(after - before) > allowed + 1e-9,
      });
    }
  }
  return rows;
}

export function driftMarkdown(
  baseline: BalanceBaseline,
  rows: readonly DriftRow[],
): string {
  const drifted = rows.filter((row) => row.drifted);
  const format = (value: number | null): string => (value === null ? "-" : String(value));
  const lines = [
    "## Balance drift",
    "",
    drifted.length === 0
      ? `Every statistic is within its allowance of the baseline measured at ${baseline.measuredAt}.`
      : `${String(drifted.length)} statistic(s) moved further than chance would from the baseline measured at ${baseline.measuredAt}. If the change was intended, refresh the baseline (see tools/balance-runner/README.md).`,
    "",
    "| Scope | Metric | Baseline | Now | Change | Allowed | |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) => {
      const change =
        row.baseline === null || row.current === null
          ? "-"
          : String(round(row.current - row.baseline, 3));
      return `| ${row.scope} | ${row.metric} | ${format(row.baseline)} | ${format(row.current)} | ${change} | ±${String(row.allowed)} | ${row.drifted ? "**drifted**" : "ok"} |`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}
