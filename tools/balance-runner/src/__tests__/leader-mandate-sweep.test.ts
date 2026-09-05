import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Manual balance sweep, skipped in ordinary suite runs. Invoke with:
 *   SWEEP_RUN=1 [SWEEP_SEEDS=1] [SWEEP_LEADERS=a,b] [SWEEP_MANDATES=x,y] \
 *     npx vitest run tools/balance-runner/src/__tests__/leader-mandate-sweep.test.ts
 * Writes per-leader / per-mandate score averages to SWEEP_OUT (or the default
 * table path below) for leader and mandate rebalancing rounds.
 */

import { loadCompiledContent } from "@neolab/content";
import { contentId } from "@neolab/content-schema";
import { seed128 } from "@neolab/sim";

import { INITIAL_POLICIES } from "../policies.ts";
import { runBalanceBatch } from "../runner.ts";
import { CORE_STRATEGY_POLICY_IDS } from "../types.ts";

const content = loadCompiledContent();

describe("leader and mandate balance sweep", () => {
  it.runIf(process.env["SWEEP_RUN"] === "1")(
    "writes per-leader and per-mandate score averages",
    { timeout: 1_800_000 },
    async () => {
      const policies = INITIAL_POLICIES.filter((p) =>
        CORE_STRATEGY_POLICY_IDS.includes(p.id),
      );
      const seeds =
        process.env["SWEEP_SEEDS"] === "1"
          ? [seed128("00000000000000000000000000000001")]
          : [
              seed128("00000000000000000000000000000001"),
              seed128("00000000000000000000000000000002"),
              seed128("00000000000000000000000000000003"),
            ];
      const report = await runBalanceBatch({
        seeds,
        difficultyIds: [contentId("base:difficulty.standard")],
        leaderIds: (
          process.env["SWEEP_LEADERS"]?.split(",") ?? Object.keys(content.leaders).sort()
        ).map(contentId),
        mandateIds: (
          process.env["SWEEP_MANDATES"]?.split(",") ?? ["base:mandate.build-the-science"]
        ).map(contentId),
        policies,
        maxTicks: 156,
        traceSampleRate: 0,
        matrixMode: "cartesian",
        content,
      });
      const byKey = new Map<string, { scores: number[]; wins: number }>();
      const record = (key: string, run: (typeof report.runs)[number]): void => {
        const entry = byKey.get(key) ?? { scores: [], wins: 0 };
        entry.scores.push(run.score);
        if (run.status === "won") entry.wins += 1;
        byKey.set(key, entry);
      };
      for (const run of report.runs) {
        record(`mandate ${run.mandateId}`, run);
        record(`${run.mandateId} × ${run.leaderId}`, run);
      }
      const lines: string[] = [];
      for (const [key, e] of [...byKey.entries()].sort()) {
        const avg = e.scores.reduce((a, b) => a + b, 0) / e.scores.length;
        lines.push(
          `${key.padEnd(70)} n=${e.scores.length} avgScore=${avg.toFixed(0)} wins=${e.wins}`,
        );
      }
      writeFileSync(
        process.env["SWEEP_OUT"] ?? "/tmp/neolab-sweep-table.txt",
        `LEADER SWEEP\n${lines.join("\n")}\n`,
      );
      expect(byKey.size).toBeGreaterThan(0);
    },
  );
});
