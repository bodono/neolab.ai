import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import { contentId } from "@neolab/content-schema";
import { LAB_MATURITY_STAGES, seed128 } from "@neolab/sim";

import { expertCapabilityWeights, resolveExpertFocus } from "../expert-policy.ts";
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

  it(
    "plays the guided chapters through to the frontier with only legal commands",
    { timeout: 600_000 },
    async () => {
      const report = await runBalanceBatch({
        seeds: [seed128("00000000000000000000000000000001")],
        difficultyIds: [contentId("base:difficulty.standard")],
        leaderIds: [contentId("base:leader.thomas-hassabi")],
        mandateIds: [contentId("base:mandate.build-it-right")],
        policies: [EXPERT_POLICY],
        maxTicks: 280,
        traceSampleRate: 0,
        matrixMode: "independent",
        opening: "guided",
        content,
      });
      const run = report.runs[0];
      if (run === undefined) throw new Error("guided expert run missing");
      // Every chapter's checklist completed, in order, from the garage to the
      // full game, without a single command the validator refused.
      const chapters = run.chapterEntryTicks ?? {};
      const weeks = LAB_MATURITY_STAGES.map((stage) => chapters[stage]);
      expect(weeks.every((week) => week !== undefined)).toBe(true);
      expect(weeks).toEqual([...weeks].sort((left, right) => left! - right!));
      expect(chapters.frontier).toBeLessThan(280);
      expect(run.rejectedPolicyCommands).toBe(0);
      expect(run.status).toBe("incomplete");
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

  describe("research focus", () => {
    const levels = new Map<string, number>([
      ["base:domain.architectures", 30],
      ["base:domain.multimodality", 10],
      ["base:domain.reasoning-tools", 50],
    ]);

    it("resolves a programme from a slug, a domain id or a full id", () => {
      for (const requested of [
        "multimodality",
        "domain.multimodality",
        "base:domain.multimodality",
      ]) {
        expect(resolveExpertFocus(requested)).toBe("base:domain.multimodality");
      }
      expect(() => resolveExpertFocus("alignment-control")).toThrow(
        "not a capability programme",
      );
    });

    it("gives the focus half of capability research and splits the rest as usual", () => {
      const unfocused = expertCapabilityWeights(levels);
      const focused = expertCapabilityWeights(levels, "base:domain.reasoning-tools");
      for (const weights of [unfocused, focused]) {
        expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBe(
          10_000,
        );
        expect(Object.values(weights).every((weight) => weight > 0)).toBe(true);
      }
      expect(focused["base:domain.reasoning-tools"]).toBe(5_000);
      // The others keep their unfocused proportions within the remaining half.
      expect(
        focused["base:domain.multimodality"]! / focused["base:domain.architectures"]!,
      ).toBeCloseTo(
        unfocused["base:domain.multimodality"]! / unfocused["base:domain.architectures"]!,
        2,
      );
      // At the expert's usual 70% capability share that is a paper focus.
      expect(0.7 * 0.5).toBeGreaterThanOrEqual(
        content.papers.rules.playerFocus.researchComputeShare,
      );
    });

    it("keeps the focus a paper focus when capability's share of compute shrinks", () => {
      const threshold = content.papers.rules.playerFocus.researchComputeShare;
      for (const capabilityShare of [7_000, 5_000, 3_000]) {
        const weights = expertCapabilityWeights(
          levels,
          "base:domain.reasoning-tools",
          capabilityShare,
        );
        expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBe(
          10_000,
        );
        const share =
          (capabilityShare / 10_000) * (weights["base:domain.reasoning-tools"]! / 10_000);
        expect(share).toBeGreaterThanOrEqual(threshold);
      }
    });
  });
});
