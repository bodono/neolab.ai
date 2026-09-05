import { describe, expect, it } from "vitest";

import { deceptiveActionPressure } from "../deception.ts";

describe("deceptive action pressure", () => {
  it("requires both strategic capability and deceptive intent", () => {
    expect(deceptiveActionPressure(100, 0)).toBe(0);
    expect(deceptiveActionPressure(0, 100)).toBe(0);
    expect(deceptiveActionPressure(80, 50)).toBe(40);
    expect(deceptiveActionPressure(100, 100)).toBe(100);
  });

  it("clamps ratings to their published 0–100 range", () => {
    expect(deceptiveActionPressure(120, 120)).toBe(100);
    expect(deceptiveActionPressure(-10, 90)).toBe(0);
  });
});
