import { describe, expect, it } from "vitest";

import { SIM_PACKAGE } from "../public.ts";

describe("sim package smoke", () => {
  it("exposes its public surface", () => {
    expect(SIM_PACKAGE).toBe("@neolab/sim");
  });
});
