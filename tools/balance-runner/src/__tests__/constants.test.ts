import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import { contentId } from "@neolab/content-schema";
import { seed128 } from "@neolab/sim";

import { applyBalanceConstantOverrides } from "../constants.ts";
import { createPolicy } from "../policies.ts";
import { runBalanceConstantSweep } from "../sweep.ts";

const content = loadCompiledContent();

describe("balance constant overrides", () => {
  it("changes only an allowlisted in-memory clone", () => {
    const changed = applyBalanceConstantOverrides(content, [
      { key: "economy.startingCash", value: 321 },
      { key: "research.baseRpCoefficient", value: 0.123 },
    ]);
    expect(changed.balance.newGame.cash).toBe(321);
    expect(changed.research.rules.baseCoefficient).toBe(0.123);
    expect(content.balance.newGame.cash).not.toBe(321);
    expect(content.research.rules.baseCoefficient).not.toBe(0.123);
    expect(changed.manifest.bundleHash).toBe(content.manifest.bundleHash);
  });

  it("rejects unsafe, duplicate, and unknown-shaped values", () => {
    expect(() =>
      applyBalanceConstantOverrides(content, [
        { key: "economy.startingOwnedGpus", value: 1.5 },
      ]),
    ).toThrow("positive integer");
    expect(() =>
      applyBalanceConstantOverrides(content, [
        { key: "economy.startingCash", value: 1 },
        { key: "economy.startingCash", value: 2 },
      ]),
    ).toThrow("Duplicate override");
  });

  it("sweeps the same seed and policy without rebuilding content", async () => {
    const result = await runBalanceConstantSweep({
      key: "economy.startingCash",
      values: [10, 100],
      baseContent: content,
      runRequest: {
        seeds: [seed128("00000000000000000000000000000001")],
        difficultyIds: [contentId("base:difficulty.standard")],
        leaderIds: [contentId("base:leader.thomas-hassabi")],
        mandateIds: [contentId("base:mandate.build-it-right")],
        policies: [createPolicy("balanced")],
        maxTicks: 1,
        traceSampleRate: 1,
        matrixMode: "paired",
      },
    });
    expect(result.baseContentHash).toBe(content.manifest.bundleHash);
    expect(result.reports).toHaveLength(2);
    expect(
      result.reports.map(({ report }) => report.runs[0]?.trace?.[0]?.cashMillions),
    ).toEqual([37, 127]);
  });
});
