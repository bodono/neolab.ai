import { describe, expect, it } from "vitest";

import { advanceWeeklyProgress } from "../progress.ts";

describe("weekly project progress", () => {
  it("completes every quoted duration in exactly that many weeks", () => {
    const late: number[] = [];
    for (let weeks = 1; weeks <= 104; weeks += 1) {
      let progress = 0;
      for (let week = 1; week <= weeks; week += 1) {
        progress = advanceWeeklyProgress(progress, weeks);
        if (week < weeks) expect(progress).toBeLessThan(1);
      }
      if (progress !== 1) late.push(weeks);
    }
    expect(late).toEqual([]);
  });
});
