import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadCompiledContent } from "@neolab/content";
import { contentId } from "@neolab/content-schema";
import { seed128 } from "@neolab/sim";

import { runInvariantCampaign } from "./invariant-campaign.ts";

function integerArgument(flag: string, fallback: number): number {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  const value = index < 0 ? fallback : Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function stringArgument(flag: string, fallback: string): string {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
}

const runCount = integerArgument("--runs", 240);
const maxTicks = integerArgument("--max-ticks", 260);
const seedStart = integerArgument("--seed-start", 1);
const output = resolve(
  process.cwd(),
  stringArgument("--output", "artifacts/invariants/smoke.json"),
);
const content = loadCompiledContent();
const report = await runInvariantCampaign({
  seeds: Array.from({ length: runCount }, (_, index) =>
    seed128((seedStart + index).toString(16).padStart(32, "0")),
  ),
  maxTicks,
  difficultyIds: Object.keys(content.difficulties).sort().map(contentId),
  leaderIds: Object.keys(content.leaders).sort().map(contentId),
  mandateIds: Object.keys(content.mandates).sort().map(contentId),
  content,
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
// Runs that reach the tick limit are reported rather than failed, so the
// completion split has to stay on this line: it is the only place a rising
// stall rate would be visible before it becomes a real deadlock.
process.stdout.write(
  `invariants: ${String(report.runs.length)} runs ` +
    `(${String(report.completedRuns)} terminal, ` +
    `${String(report.runs.length - report.completedRuns)} still playing at the limit), ` +
    `${String(report.totalTicks)} ticks, ` +
    `${String(report.totalCommands)} commands, ${String(report.failures.length)} failures -> ${output}\n`,
);
if (!report.passed) process.exitCode = 1;
