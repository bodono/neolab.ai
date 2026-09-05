import { describe, expect, it } from "vitest";

import {
  operatingMilestoneForTick,
  shouldShowOperatingMilestone,
} from "./operating-milestone.ts";

describe("annual operating milestones", () => {
  it("starts after one full year and advances at every 52-week anniversary", () => {
    expect(operatingMilestoneForTick(0)).toBeUndefined();
    expect(operatingMilestoneForTick(51)).toBeUndefined();
    expect(operatingMilestoneForTick(52)).toEqual({
      completedYears: 1,
      label: "OPERATING MILESTONE: survived 1 year",
    });
    expect(operatingMilestoneForTick(103)).toEqual({
      completedYears: 1,
      label: "OPERATING MILESTONE: survived 1 year",
    });
    expect(operatingMilestoneForTick(104)).toEqual({
      completedYears: 2,
      label: "OPERATING MILESTONE: survived 2 years",
    });
    expect(operatingMilestoneForTick(260)).toEqual({
      completedYears: 5,
      label: "OPERATING MILESTONE: survived 5 years",
    });
  });

  it("dismisses only the current year rather than all future anniversaries", () => {
    const yearTwo = operatingMilestoneForTick(104);
    const yearThree = operatingMilestoneForTick(156);

    expect(shouldShowOperatingMilestone(yearTwo, undefined)).toBe(true);
    expect(shouldShowOperatingMilestone(yearTwo, 2)).toBe(false);
    expect(shouldShowOperatingMilestone(yearThree, 2)).toBe(true);
  });
});
