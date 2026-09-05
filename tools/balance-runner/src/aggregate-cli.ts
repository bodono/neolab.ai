import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { loadCompiledContent } from "@neolab/content";

import { mergeBalanceReports } from "./aggregate.ts";
import {
  dimensionSummaryCsv,
  eventSummaryCsv,
  facilitySummaryCsv,
  policySummaryCsv,
  resourceCurvesCsv,
  runSummaryCsv,
  targetSummaryCsv,
} from "./report.ts";
import type { BalanceReport } from "./types.ts";

function readArgument(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

function reportPaths(root: string): readonly string[] {
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === "report.json") paths.push(path);
    }
  };
  visit(root);
  return paths.sort();
}

const args = process.argv.slice(2);
const input = resolve(
  process.cwd(),
  readArgument(args, "--input") ?? "artifacts/balance/shards",
);
const output = resolve(
  process.cwd(),
  readArgument(args, "--output") ?? "artifacts/balance/release",
);
const paths = reportPaths(input);
const reports = paths.map(
  (path) => JSON.parse(readFileSync(path, "utf8")) as BalanceReport,
);
const report = mergeBalanceReports(reports, loadCompiledContent());
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(output, "policies.csv"), policySummaryCsv(report));
writeFileSync(resolve(output, "runs.csv"), runSummaryCsv(report));
writeFileSync(resolve(output, "dimensions.csv"), dimensionSummaryCsv(report));
writeFileSync(resolve(output, "targets.csv"), targetSummaryCsv(report));
writeFileSync(resolve(output, "resource-curves.csv"), resourceCurvesCsv(report));
writeFileSync(resolve(output, "facilities.csv"), facilitySummaryCsv(report));
writeFileSync(resolve(output, "events.csv"), eventSummaryCsv(report));
writeFileSync(
  resolve(output, "shards.json"),
  `${JSON.stringify(
    {
      input,
      reports: paths.map((path) => basename(resolve(path, ".."))),
      count: reports.length,
      runCount: report.runCount,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `balance aggregate: ${String(reports.length)} shards, ${String(report.runCount)} runs, ` +
    `${String(report.flags.length)} flags -> ${output}\n`,
);
