const WEEKS_PER_OPERATING_YEAR = 52;

export interface OperatingMilestone {
  readonly completedYears: number;
  readonly label: string;
}

export function operatingMilestoneForTick(tick: number): OperatingMilestone | undefined {
  const completedYears = Math.floor(Math.max(0, tick) / WEEKS_PER_OPERATING_YEAR);
  if (completedYears === 0) return undefined;
  return {
    completedYears,
    label: `OPERATING MILESTONE: survived ${String(completedYears)} ${
      completedYears === 1 ? "year" : "years"
    }`,
  };
}

export function shouldShowOperatingMilestone(
  milestone: OperatingMilestone | undefined,
  dismissedYear: number | undefined,
): milestone is OperatingMilestone {
  return milestone !== undefined && milestone.completedYears !== dismissedYear;
}
