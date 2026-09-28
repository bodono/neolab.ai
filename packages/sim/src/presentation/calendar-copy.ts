import { calendarFromTick } from "../model/state.ts";

/**
 * A simulation tick as the calendar week the header shows, e.g.
 * "2013 · WEEK 52". Labelling the raw tick "WEEK 102" disagreed with the
 * header once the first year had passed.
 */
export function formatGameWeek(tick: number): string {
  const { year, week } = calendarFromTick(tick);
  return `${String(year)} · WEEK ${String(week)}`;
}

/** The same week for running prose, e.g. "week 52 of 2013". */
export function formatGameWeekInText(tick: number): string {
  const { year, week } = calendarFromTick(tick);
  return `week ${String(week)} of ${String(year)}`;
}
