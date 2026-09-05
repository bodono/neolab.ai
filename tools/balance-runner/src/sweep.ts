import type { CompiledContent } from "@neolab/content-schema";

import { applyBalanceConstantOverrides, type BalanceConstantKey } from "./constants.ts";
import { runBalanceBatch } from "./runner.ts";
import type { BalanceReport, BalanceRunRequest } from "./types.ts";

export interface BalanceSweepRequest {
  readonly key: BalanceConstantKey;
  readonly values: readonly number[];
  readonly baseContent: CompiledContent;
  readonly runRequest: Omit<BalanceRunRequest, "content">;
}

export interface BalanceSweepResult {
  readonly sweepFormat: 1;
  readonly baseContentHash: string;
  readonly key: BalanceConstantKey;
  readonly values: readonly number[];
  readonly reports: readonly {
    readonly value: number;
    readonly report: BalanceReport;
  }[];
}

export async function runBalanceConstantSweep(
  request: BalanceSweepRequest,
): Promise<BalanceSweepResult> {
  if (request.values.length === 0) throw new Error("A sweep needs at least one value");
  const reports: { value: number; report: BalanceReport }[] = [];
  for (const value of request.values) {
    const content = applyBalanceConstantOverrides(request.baseContent, [
      { key: request.key, value },
    ]);
    reports.push({
      value,
      report: await runBalanceBatch({ ...request.runRequest, content }),
    });
  }
  return {
    sweepFormat: 1,
    baseContentHash: request.baseContent.manifest.bundleHash,
    key: request.key,
    values: [...request.values],
    reports,
  };
}
