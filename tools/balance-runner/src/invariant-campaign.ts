import type { CompiledContent, ContentId } from "@neolab/content-schema";
import type { Seed128 } from "@neolab/sim";

import { createPolicy } from "./policies.ts";
import { replayBalanceRun, runBalanceBatch } from "./runner.ts";
import type { BalanceAnomalyCounts, BalanceRunSpecification } from "./types.ts";

export interface InvariantCampaignRequest {
  readonly seeds: readonly Seed128[];
  readonly maxTicks: number;
  readonly difficultyIds: readonly ContentId[];
  readonly leaderIds: readonly ContentId[];
  readonly mandateIds: readonly ContentId[];
  readonly content: CompiledContent;
}

export interface InvariantCampaignRun {
  readonly runKey: string;
  readonly ticks: number;
  readonly status: "won" | "lost" | "incomplete";
  readonly commands: number;
  readonly rejectedPolicyCommands: number;
  readonly anomalies: BalanceAnomalyCounts;
  readonly catastrophes: number;
  readonly illegalCatastrophes: number;
  readonly finalStateHash: string;
  readonly replayStateHash: string;
}

export interface InvariantCampaignReport {
  readonly reportFormat: 1;
  readonly policy: "random-legal";
  readonly requestedRuns: number;
  readonly maxTicks: number;
  readonly totalTicks: number;
  readonly totalCommands: number;
  readonly completedRuns: number;
  readonly failures: readonly string[];
  readonly passed: boolean;
  readonly runs: readonly InvariantCampaignRun[];
}

function anomalyFailures(
  runKey: string,
  anomalies: Readonly<BalanceAnomalyCounts>,
): readonly string[] {
  return Object.entries(anomalies)
    .filter(([, count]) => count !== 0)
    .map(([kind, count]) => `${runKey}: ${kind}=${String(count)}`);
}

/**
 * Executes legal commands selected by the deterministic random policy. Every
 * production command and tick commits through the full invariant pack; the
 * runner additionally guards every player projection against hidden keys.
 */
export async function runInvariantCampaign(
  request: InvariantCampaignRequest,
): Promise<InvariantCampaignReport> {
  const policy = createPolicy("random-legal");
  const balance = await runBalanceBatch({
    seeds: request.seeds,
    difficultyIds: request.difficultyIds,
    leaderIds: request.leaderIds,
    mandateIds: request.mandateIds,
    policies: [policy],
    maxTicks: request.maxTicks,
    traceSampleRate: 1,
    matrixMode: "paired",
    content: request.content,
  });
  const failures: string[] = [];
  const runs: InvariantCampaignRun[] = [];

  for (const run of balance.runs) {
    const replay = run.replay;
    if (replay === undefined) {
      failures.push(`${run.runKey}: trace/replay evidence missing`);
      continue;
    }
    const specification: BalanceRunSpecification = {
      ordinal: run.ordinal,
      runKey: run.runKey,
      seed: run.seed,
      policyId: run.policyId,
      difficultyId: run.difficultyId,
      leaderId: run.leaderId,
      mandateId: run.mandateId,
    };
    const replayStateHash = replayBalanceRun(
      specification,
      replay.commands,
      request.content,
      request.maxTicks,
    );
    if (replayStateHash !== replay.finalStateHash) {
      failures.push(
        `${run.runKey}: replay ${replayStateHash} != ${replay.finalStateHash}`,
      );
    }
    failures.push(...anomalyFailures(run.runKey, run.anomalies));
    for (const stage of run.endgame.stalledStageIds) {
      failures.push(`${run.runKey}: endgame stage ${stage} exceeded its dwell allowance`);
    }
    const illegalCatastrophes =
      run.hiddenInformation.catastrophes - run.hiddenInformation.fairCatastrophes;
    if (illegalCatastrophes !== 0) {
      failures.push(
        `${run.runKey}: ${String(illegalCatastrophes)} catastrophe record(s) were illegal`,
      );
    }
    // Reaching the tick limit is not itself a fault. A random-legal policy does
    // not pursue a win condition, so roughly forty per cent of runs are still
    // playing healthily at 260 weeks, issuing more commands than the runs that
    // finished. The wedge this campaign has to catch -- a run trapped on a
    // blocking screen -- is caught precisely by the stage-aware dwell allowance
    // above and by deadlockedEvents in the anomaly counts.
    //
    // What remains worth failing is a run that reached the limit having never
    // been able to act at all: the policy found no legal command for the whole
    // campaign, which no healthy configuration produces.
    if (run.status === "incomplete" && replay.commands.length === 0) {
      failures.push(
        `${run.runKey}: reached the ${String(request.maxTicks)}-tick campaign limit without accepting a single command`,
      );
    }
    runs.push({
      runKey: run.runKey,
      ticks: run.ticks,
      status: run.status,
      commands: replay.commands.length,
      rejectedPolicyCommands: run.rejectedPolicyCommands,
      anomalies: structuredClone(run.anomalies),
      catastrophes: run.hiddenInformation.catastrophes,
      illegalCatastrophes,
      finalStateHash: replay.finalStateHash,
      replayStateHash,
    });
  }

  return {
    reportFormat: 1,
    policy: "random-legal",
    requestedRuns: request.seeds.length,
    maxTicks: request.maxTicks,
    totalTicks: runs.reduce((sum, run) => sum + run.ticks, 0),
    totalCommands: runs.reduce((sum, run) => sum + run.commands, 0),
    completedRuns: runs.filter((run) => run.status !== "incomplete").length,
    failures,
    passed: failures.length === 0 && runs.length === request.seeds.length,
    runs,
  };
}
