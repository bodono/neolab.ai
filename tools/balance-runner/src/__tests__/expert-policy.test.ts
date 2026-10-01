import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import { contentId } from "@neolab/content-schema";
import { seed128 } from "@neolab/sim";

import { EXPERT_POLICY } from "../policies.ts";
import { runBalanceBatch } from "../runner.ts";

const content = loadCompiledContent();

describe("expert policy", () => {
  it(
    "plays the opening through the real runner with only legal commands",
    { timeout: 180_000 },
    async () => {
      const report = await runBalanceBatch({
        seeds: [seed128("00000000000000000000000000000001")],
        difficultyIds: [contentId("base:difficulty.standard")],
        leaderIds: [contentId("base:leader.thomas-hassabi")],
        mandateIds: [contentId("base:mandate.build-it-right")],
        policies: [EXPERT_POLICY],
        maxTicks: 156,
        traceSampleRate: 1,
        matrixMode: "independent",
        content,
      });
      const run = report.runs[0];
      if (run === undefined) throw new Error("expert run missing");
      // Three years in, the lab is solvent and still playing, every command it
      // built from previews was legal when applied, and it has grown: trained
      // several models and housed compute beyond the garage.
      expect(run.status).toBe("incomplete");
      expect(run.rejectedPolicyCommands).toBe(0);
      expect(run.facilities.length).toBeGreaterThanOrEqual(3);
      expect(run.phaseEntryTicks.foundation).toBe(0);
    },
  );

  it("refuses to decide without command previews", () => {
    expect(() =>
      EXPERT_POLICY.decide(
        {
          game: {} as never,
          seed: seed128("00000000000000000000000000000001"),
          policyId: "expert",
        },
        [],
      ),
    ).toThrow("needs command previews");
  });
});
