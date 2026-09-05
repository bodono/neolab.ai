import type { CompiledContent } from "@neolab/content-schema";

import { buildBalanceReport } from "./report.ts";
import type { BalanceReport, BalanceRunResult } from "./types.ts";

function requireEqual<T>(values: readonly T[], label: string): T {
  const first = values[0];
  if (first === undefined) throw new Error(`No ${label} values to aggregate`);
  if (values.some((value) => value !== first)) {
    throw new Error(`Balance shards disagree on ${label}`);
  }
  return first;
}

/**
 * Rebuilds every aggregate from raw per-run records. Shard-level summaries are
 * intentionally ignored so a partial or duplicated shard cannot skew a rate.
 */
export function mergeBalanceReports(
  reports: readonly BalanceReport[],
  content: CompiledContent,
  generatedAt = new Date().toISOString(),
): BalanceReport {
  if (reports.length === 0) throw new Error("At least one balance shard is required");
  if (reports.some((report) => report.reportFormat !== 2)) {
    throw new Error("Only balance report format 2 can be aggregated");
  }
  const contentHash = requireEqual(
    reports.map((report) => report.content.hash),
    "content hash",
  );
  if (contentHash !== content.manifest.bundleHash) {
    throw new Error(
      `Shard content ${contentHash} does not match loaded content ${content.manifest.bundleHash}`,
    );
  }
  const requestedMaxTicks = requireEqual(
    reports.map((report) => report.requestedMaxTicks),
    "max tick",
  );
  const traceSampleRate = requireEqual(
    reports.map((report) => report.traceSampleRate),
    "trace sample rate",
  );
  const mode = requireEqual(
    reports.map((report) => report.matrix.mode),
    "matrix mode",
  );
  const totalConfigurations = requireEqual(
    reports.map((report) => report.matrix.totalConfigurations),
    "matrix size",
  );
  for (const dimension of [
    "seeds",
    "policies",
    "difficulties",
    "leaders",
    "mandates",
  ] as const) {
    requireEqual(
      reports.map((report) => report.matrix[dimension]),
      `matrix ${dimension}`,
    );
  }

  const shardCounts = reports.flatMap((report) =>
    report.matrix.shard === undefined ? [] : [report.matrix.shard.count],
  );
  if (shardCounts.length > 0) {
    if (shardCounts.length !== reports.length) {
      throw new Error("Cannot mix sharded and unsharded reports");
    }
    const shardCount = requireEqual(shardCounts, "shard count");
    const indexes = reports
      .map((report) => report.matrix.shard?.index)
      .filter((index): index is number => index !== undefined)
      .sort((left, right) => left - right);
    const expected = Array.from({ length: shardCount }, (_, index) => index);
    if (JSON.stringify(indexes) !== JSON.stringify(expected)) {
      throw new Error(
        `Incomplete shard set: received [${indexes.join(", ")}], expected [${expected.join(", ")}]`,
      );
    }
  }

  const runs: BalanceRunResult[] = reports.flatMap((report) => report.runs);
  const ordinals = runs.map((run) => run.ordinal);
  if (new Set(ordinals).size !== ordinals.length) {
    throw new Error("Duplicate run ordinal across balance shards");
  }
  if (new Set(runs.map((run) => run.runKey)).size !== runs.length) {
    throw new Error("Duplicate run key across balance shards");
  }
  if (runs.length !== totalConfigurations) {
    throw new Error(
      `Aggregated ${String(runs.length)} runs, expected ${String(totalConfigurations)}`,
    );
  }
  const sortedOrdinals = [...ordinals].sort((left, right) => left - right);
  if (sortedOrdinals.some((ordinal, index) => ordinal !== index)) {
    throw new Error("Balance matrix ordinals are not a complete zero-based sequence");
  }

  const first = reports[0];
  if (first === undefined) throw new Error("Missing first balance shard");
  return buildBalanceReport(runs, {
    elapsedMilliseconds: reports.reduce(
      (sum, report) => sum + report.elapsedMilliseconds,
      0,
    ),
    requestedMaxTicks,
    traceSampleRate,
    content,
    matrix: {
      mode,
      totalConfigurations,
      seeds: first.matrix.seeds,
      policies: first.matrix.policies,
      difficulties: first.matrix.difficulties,
      leaders: first.matrix.leaders,
      mandates: first.matrix.mandates,
    },
    generatedAt,
  });
}
