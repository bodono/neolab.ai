/**
 * One week of progress on a fixed-duration project. Adding 1/N a total of N
 * times can land just below 1 (six steps of 1/6 give 0.9999999999999999),
 * which silently added a week to 6-, 7-, 10-, 13- and many other week
 * durations. Snap to 1 within a tolerance so projects finish on the quoted
 * calendar week.
 */
export function advanceWeeklyProgress(progress: number, durationWeeks: number): number {
  const next = progress + 1 / durationWeeks;
  return next >= 1 - 1e-9 ? 1 : next;
}
