import { describe, expect, it } from "vitest";

import {
  describeResearcherDeparture,
  parseResearcherDepartureName,
  parseResearcherDepartureReason,
  unacknowledgedCurrentDepartureKey,
} from "./researcher-departure-copy.ts";

describe("researcher departure copy", () => {
  it.each([
    ["Yann LeNet left the lab (voluntary).", "Yann LeNet"],
    ["Stewart Russel departed (poached).", "Stewart Russel"],
  ] as const)("parses the player-facing name from %s", (summary, name) => {
    expect(parseResearcherDepartureName(summary)).toBe(name);
  });

  it("does not expose an internal researcher id as a name", () => {
    expect(
      parseResearcherDepartureName("base:researcher.test left the lab (dismissed)"),
    ).toBeUndefined();
  });

  it.each([
    ["base:researcher.test left the lab (voluntary)", "voluntary"],
    ["base:researcher.test left the lab (poached)", "poached"],
    ["base:researcher.test left the lab (dismissed)", "dismissed"],
    ["base:researcher.test left the lab (ultimatum-expired)", "ultimatum-expired"],
  ] as const)("parses the reason from %s", (summary, reason) => {
    expect(parseResearcherDepartureReason(summary)).toBe(reason);
  });

  it("uses explicit player-facing copy for a rival poach", () => {
    expect(describeResearcherDeparture("poached")).toBe(
      "They accepted an offer from a rival lab.",
    );
  });

  it("falls back safely for a legacy departure entry", () => {
    expect(parseResearcherDepartureReason("A researcher departed")).toBeUndefined();
    expect(describeResearcherDeparture(undefined)).toContain("Lab feed");
  });

  it("only surfaces an unacknowledged departure from the current paused week", () => {
    const current = {
      tick: 12,
      summary: "base:researcher.test left the lab (poached)",
    };
    const key = "12:base:researcher.test left the lab (poached)";

    expect(unacknowledgedCurrentDepartureKey(current, 12, true, new Set())).toBe(key);
    expect(
      unacknowledgedCurrentDepartureKey(current, 13, true, new Set()),
    ).toBeUndefined();
    expect(
      unacknowledgedCurrentDepartureKey(current, 12, false, new Set()),
    ).toBeUndefined();
    expect(
      unacknowledgedCurrentDepartureKey(current, 12, true, new Set([key])),
    ).toBeUndefined();
  });
});
