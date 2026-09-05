import { describe, expect, it } from "vitest";

import { safeEndingAftermathTimeline } from "./ending-aftermath.ts";

describe("safeEndingAftermathTimeline", () => {
  it("preserves a projected ending timeline", () => {
    const timeline = [
      {
        horizon: "THE FIRST MONTH",
        title: "The immediate settlement",
        text: "The ending remains readable.",
      },
    ] as const;

    expect(safeEndingAftermathTimeline(timeline)).toBe(timeline);
  });

  it("lets a transitional endgame audit render without a timeline", () => {
    expect(safeEndingAftermathTimeline(undefined)).toEqual([]);
  });
});
