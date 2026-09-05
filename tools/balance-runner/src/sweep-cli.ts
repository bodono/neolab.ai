import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadCompiledContent } from "@neolab/content";
import { contentId } from "@neolab/content-schema";
import { seed128 } from "@neolab/sim";

import { BALANCE_CONSTANT_KEYS, type BalanceConstantKey } from "./constants.ts";
import { INITIAL_POLICIES } from "./policies.ts";
import { runBalanceConstantSweep } from "./sweep.ts";

function readArgument(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

function positiveInteger(
  raw: string | undefined,
  flag: string,
  fallback: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

const args = process.argv.slice(2);
const key = readArgument(args, "--key") as BalanceConstantKey | undefined;
if (key === undefined || !BALANCE_CONSTANT_KEYS.includes(key)) {
  throw new Error(`--key must be one of: ${BALANCE_CONSTANT_KEYS.join(", ")}`);
}
const values = (readArgument(args, "--values") ?? "")
  .split(",")
  .filter((value) => value.length > 0)
  .map(Number);
if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
  throw new Error("--values must be a comma-separated list of finite numbers");
}
const runs = positiveInteger(readArgument(args, "--runs"), "--runs", 100);
if (runs % INITIAL_POLICIES.length !== 0) {
  throw new Error(`--runs must be divisible by ${String(INITIAL_POLICIES.length)}`);
}
const maxTicks = positiveInteger(readArgument(args, "--max-ticks"), "--max-ticks", 520);
const output = resolve(
  process.cwd(),
  readArgument(args, "--output") ?? "../../artifacts/balance/sweep",
);
const content = loadCompiledContent();
const seedCount = runs / INITIAL_POLICIES.length;
const result = await runBalanceConstantSweep({
  key,
  values,
  baseContent: content,
  runRequest: {
    seeds: Array.from({ length: seedCount }, (_, index) =>
      seed128((index + 1).toString(16).padStart(32, "0")),
    ),
    difficultyIds: [contentId("base:difficulty.standard")],
    leaderIds: [contentId("base:leader.thomas-hassabi")],
    mandateIds: [contentId("base:mandate.build-it-right")],
    policies: INITIAL_POLICIES,
    maxTicks,
    traceSampleRate: 0.01,
    matrixMode: "paired",
  },
});
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "sweep.json"), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(
  resolve(output, "summary.csv"),
  [
    "key,value,runs,wins,losses,incomplete,mean_ticks,flags",
    ...result.reports.map(({ value, report }) =>
      [
        result.key,
        String(value),
        String(report.runCount),
        String(report.winFunnel.won),
        String(report.winFunnel.lost),
        String(report.winFunnel.incomplete),
        String(
          report.runCount === 0
            ? 0
            : report.runs.reduce((sum, run) => sum + run.ticks, 0) / report.runCount,
        ),
        String(report.flags.length),
      ].join(","),
    ),
    "",
  ].join("\n"),
);
process.stdout.write(
  `balance sweep: ${result.key} across ${String(result.values.length)} values -> ${output}\n`,
);
