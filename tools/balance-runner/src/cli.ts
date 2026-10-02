import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadCompiledContent } from "@neolab/content";
import { contentId, type ContentId } from "@neolab/content-schema";
import { seed128 } from "@neolab/sim";

import { EXPERT_POLICY, INITIAL_POLICIES } from "./policies.ts";
import {
  dimensionSummaryCsv,
  eventSummaryCsv,
  facilitySummaryCsv,
  policySummaryCsv,
  resourceCurvesCsv,
  runSummaryCsv,
  targetSummaryCsv,
} from "./report.ts";
import { replayBalanceRun, runBalanceBatch } from "./runner.ts";
import {
  CORE_STRATEGY_POLICY_IDS,
  type BalanceMatrixMode,
  type BalanceRunSpecification,
} from "./types.ts";

interface CliOptions {
  readonly runs: number;
  readonly maxTicks: number;
  readonly output: string;
  readonly traceSampleRate: number;
  readonly matrixMode: BalanceMatrixMode;
  readonly shardIndex?: number;
  readonly shardCount?: number;
  readonly verifyReplays: boolean;
  readonly coreStrategies: boolean;
  readonly expert: boolean;
  readonly difficulties: string | undefined;
  readonly leaders: string | undefined;
  readonly mandates: string | undefined;
}

function parseInteger(
  value: string | undefined,
  name: string,
  allowZero = false,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(
      `${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`,
    );
  }
  return parsed;
}

function parseArgs(args: readonly string[]): CliOptions {
  const read = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const traceSampleRate = Number(read("--trace-sample-rate") ?? "0.01");
  if (!Number.isFinite(traceSampleRate) || traceSampleRate < 0 || traceSampleRate > 1) {
    throw new Error("--trace-sample-rate must be in [0, 1]");
  }
  const matrixMode = read("--matrix") ?? "paired";
  if (
    matrixMode !== "independent" &&
    matrixMode !== "paired" &&
    matrixMode !== "cartesian"
  ) {
    throw new Error("--matrix must be independent, paired, or cartesian");
  }
  const shardIndexRaw = read("--shard-index");
  const shardCountRaw = read("--shard-count");
  if ((shardIndexRaw === undefined) !== (shardCountRaw === undefined)) {
    throw new Error("--shard-index and --shard-count must be supplied together");
  }
  return {
    runs: parseInteger(read("--runs") ?? "30", "--runs"),
    maxTicks: parseInteger(read("--max-ticks") ?? "104", "--max-ticks"),
    output: read("--output") ?? "artifacts/balance/latest",
    traceSampleRate,
    matrixMode,
    ...(shardIndexRaw === undefined
      ? {}
      : {
          shardIndex: parseInteger(shardIndexRaw, "--shard-index", true),
          shardCount: parseInteger(shardCountRaw, "--shard-count"),
        }),
    verifyReplays: !args.includes("--skip-replay-verification"),
    coreStrategies: args.includes("--core-strategies"),
    expert: args.includes("--expert"),
    difficulties: read("--difficulties"),
    leaders: read("--leaders"),
    mandates: read("--mandates"),
  };
}

/**
 * One matrix dimension: every authored ID for a Cartesian matrix, the standard
 * launch setup otherwise, or an explicit `--flag` list of IDs or bare slugs
 * (`fellowship`, `base:difficulty.fellowship`), or `all`.
 */
function dimension(
  flag: string,
  requested: string | undefined,
  authored: Readonly<Record<string, unknown>>,
  prefix: string,
  standard: string,
): ContentId[] {
  const all = Object.keys(authored).sort();
  if (requested === undefined) {
    return (options.matrixMode === "cartesian" ? all : [standard]).map(contentId);
  }
  if (requested === "all") return all.map(contentId);
  return requested.split(",").map((entry) => {
    const id = entry.includes(":") ? entry : `${prefix}${entry}`;
    if (!all.includes(id)) throw new Error(`${flag}: unknown ID ${entry}`);
    return contentId(id);
  });
}

const options = parseArgs(process.argv.slice(2));
const content = loadCompiledContent();
const policies = options.expert
  ? [EXPERT_POLICY]
  : options.coreStrategies
    ? INITIAL_POLICIES.filter((policy) => CORE_STRATEGY_POLICY_IDS.includes(policy.id))
    : INITIAL_POLICIES;
const difficulties = dimension(
  "--difficulties",
  options.difficulties,
  content.difficulties,
  "base:difficulty.",
  "base:difficulty.standard",
);
const leaders = dimension(
  "--leaders",
  options.leaders,
  content.leaders,
  "base:leader.",
  "base:leader.thomas-hassabi",
);
const mandates = dimension(
  "--mandates",
  options.mandates,
  content.mandates,
  "base:mandate.",
  "base:mandate.build-it-right",
);
const configurationsPerSeed =
  options.matrixMode === "independent"
    ? 1
    : policies.length * difficulties.length * leaders.length * mandates.length;
if (options.runs % configurationsPerSeed !== 0) {
  throw new Error(
    `--runs must be divisible by ${String(configurationsPerSeed)} for a complete ${options.matrixMode} matrix`,
  );
}
const seedCount = options.runs / configurationsPerSeed;
const seeds = Array.from({ length: seedCount }, (_, index) =>
  seed128((index + 1).toString(16).padStart(32, "0")),
);
const shard =
  options.shardIndex === undefined || options.shardCount === undefined
    ? undefined
    : { index: options.shardIndex, count: options.shardCount };
const report = await runBalanceBatch({
  seeds,
  difficultyIds: difficulties,
  leaderIds: leaders,
  mandateIds: mandates,
  policies,
  maxTicks: options.maxTicks,
  traceSampleRate: options.traceSampleRate,
  matrixMode: options.matrixMode,
  ...(shard === undefined ? {} : { shard }),
  content,
});

const replayResults = report.runs.flatMap((run) => {
  if (run.replay === undefined) return [];
  const specification: BalanceRunSpecification = {
    ordinal: run.ordinal,
    runKey: run.runKey,
    seed: run.seed,
    policyId: run.policyId,
    difficultyId: run.difficultyId,
    leaderId: run.leaderId,
    mandateId: run.mandateId,
  };
  const actualHash = options.verifyReplays
    ? replayBalanceRun(
        specification,
        run.replay.commands,
        content,
        report.requestedMaxTicks,
      )
    : null;
  if (actualHash !== null && actualHash !== run.replay.finalStateHash) {
    throw new Error(
      `Replay mismatch for ${run.runKey}: ${actualHash} != ${run.replay.finalStateHash}`,
    );
  }
  return [
    {
      runKey: run.runKey,
      commandCount: run.replay.commands.length,
      expectedHash: run.replay.finalStateHash,
      actualHash,
      verified: actualHash === run.replay.finalStateHash,
    },
  ];
});

const output = resolve(process.cwd(), options.output);
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
  resolve(output, "replay-verification.json"),
  `${JSON.stringify(
    {
      verified: options.verifyReplays,
      sampledRuns: replayResults.length,
      results: replayResults,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `balance: ${String(report.runCount)}/${String(report.matrix.totalConfigurations)} runs ` +
    `in ${String(report.elapsedMilliseconds)}ms; ${String(report.winFunnel.won)} won, ` +
    `${String(report.winFunnel.lost)} lost, ${String(report.winFunnel.incomplete)} incomplete; ` +
    `${String(replayResults.length)} replay(s) verified; ` +
    `${String(report.flags.length)} flags -> ${output}\n`,
);
