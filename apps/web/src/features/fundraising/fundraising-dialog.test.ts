import { describe, expect, it } from "vitest";

import { fundraisingAuraShortfallMessage } from "./fundraising-dialog.tsx";

describe("fundraising Aura presentation", () => {
  it("states the exact shortfall when market pressure lifts cost above the balance", () => {
    expect(fundraisingAuraShortfallMessage(25, 22)).toBe(
      "Need 3 more Aura (22 available · 25 required)",
    );
  });

  it("does not report a shortfall when the campaign is affordable", () => {
    expect(fundraisingAuraShortfallMessage(25, 25)).toBeUndefined();
  });
});
