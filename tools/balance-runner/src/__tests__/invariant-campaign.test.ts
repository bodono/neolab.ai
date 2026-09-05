import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import { contentId } from "@neolab/content-schema";
import { seed128 } from "@neolab/sim";

import { runInvariantCampaign } from "../invariant-campaign.ts";

describe("invariant campaign", () => {
  it("is deterministic and replays every random-legal run", async () => {
    const content = loadCompiledContent();
    const request = {
      seeds: [seed128("00000000000000000000000000000001")],
      maxTicks: 16,
      difficultyIds: [contentId("base:difficulty.standard")],
      leaderIds: [contentId("base:leader.thomas-hassabi")],
      mandateIds: [contentId("base:mandate.build-it-right")],
      content,
    } as const;

    const first = await runInvariantCampaign(request);
    const second = await runInvariantCampaign(request);

    expect(first).toEqual(second);
    // Sixteen ticks cannot reach a terminal outcome, and that is not a fault:
    // the run is reported as incomplete and the campaign still passes. Only a
    // stalled endgame stage, a deadlock anomaly, or a run that never accepted a
    // command fails the campaign.
    expect(first).toMatchObject({
      reportFormat: 1,
      policy: "random-legal",
      requestedRuns: 1,
      completedRuns: 0,
      passed: true,
    });
    expect(first.failures).toEqual([]);
    expect(first.runs[0]?.status).toBe("incomplete");
    expect(first.runs[0]?.commands).toBeGreaterThan(0);
    expect(first.totalTicks).toBeGreaterThan(0);
    expect(first.runs[0]?.finalStateHash).toBe(first.runs[0]?.replayStateHash);
  }, 15_000);
});
