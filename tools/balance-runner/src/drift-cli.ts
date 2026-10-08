// Compare an expert-ladder aggregate with the committed balance baseline.
//
//   node src/drift-cli.ts --input <report.json> [--baseline <baseline.json>]
//   node src/drift-cli.ts --input <report.json> --write-baseline --measured-at <commit>
//
// Exits 1 when any statistic moved further than chance would from the
// baseline, or when the report's ladder (seeds, tick cap, setups) differs from
// the one the baseline measured. With no baseline yet it writes one beside the
// report and only warns. Appends the table to $GITHUB_STEP_SUMMARY
// when it is set.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  baselineFromReport,
  compareWithBaseline,
  driftMarkdown,
  ladderMismatch,
  summariseLadder,
  type BalanceBaseline,
} from "./drift.ts";
import type { BalanceReport } from "./types.ts";

const args = process.argv.slice(2);
const read = (flag: string): string | undefined => {
  const index = args.lastIndexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};

const inputPath = read("--input");
if (inputPath === undefined) throw new Error("--input <report.json> is required");
const baselinePath = resolve(
  process.cwd(),
  read("--baseline") ?? "baselines/expert-ladder.json",
);
const report = JSON.parse(
  readFileSync(resolve(process.cwd(), inputPath), "utf8"),
) as BalanceReport;

if (args.includes("--write-baseline")) {
  const baseline = baselineFromReport(report, read("--measured-at") ?? "unknown");
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`balance drift: wrote baseline ${baselinePath}`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  // First run of a new ladder: leave a baseline beside the report to commit.
  // A missing baseline is a setup step, not a balance failure, so warn only.
  // Named after the missing file (expert-ladder.json gives
  // expert-ladder-baseline.json), so each ladder's bootstrap says where it goes.
  const bootstrap = resolve(
    process.cwd(),
    inputPath,
    "..",
    `${basename(baselinePath, ".json")}-baseline.json`,
  );
  const baseline = baselineFromReport(report, read("--measured-at") ?? "unknown");
  writeFileSync(bootstrap, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `::warning::balance drift: no baseline at ${baselinePath}; wrote ${bootstrap} to commit there`,
  );
  process.exit(0);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as BalanceBaseline;
const mismatch = ladderMismatch(baseline, report);
if (mismatch !== undefined) {
  console.error(`balance drift: not comparable with the baseline: ${mismatch}`);
  process.exit(1);
}
const rows = compareWithBaseline(baseline, summariseLadder(report));
const markdown = driftMarkdown(baseline, rows);
console.log(markdown);
const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary !== undefined && summary !== "") appendFileSync(summary, markdown);
process.exit(rows.some((row) => row.drifted) ? 1 : 0);
