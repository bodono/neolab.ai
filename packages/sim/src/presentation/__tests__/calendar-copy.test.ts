import { describe, expect, it } from "vitest";

import { calendarFromTick } from "../../model/state.ts";
import { formatGameWeek, formatGameWeekInText } from "../calendar-copy.ts";

describe("calendar week copy", () => {
  it("labels a tick with the calendar week the header shows", () => {
    // Tick 102 is late 2013, not "WEEK 102".
    expect(calendarFromTick(102)).toEqual({ year: 2013, week: 51 });
    expect(formatGameWeek(102)).toBe("2013 · WEEK 51");
    expect(formatGameWeekInText(102)).toBe("week 51 of 2013");
    expect(formatGameWeek(0)).toBe("2012 · WEEK 1");
  });
});
