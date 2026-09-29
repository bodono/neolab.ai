import { describe, expect, it } from "vitest";

import { servingDemandCoverage } from "./allocation-panel.tsx";

describe("servingDemandCoverage", () => {
  it("measures coverage against real demand when demand exceeds the fleet", () => {
    // 24.9 PFLOP/s of demand against a 16 PFLOP/s fleet: half the fleet serves
    // 8 PFLOP/s, which is 32% of demand, not the 50% the capped marker implied.
    const coverage = servingDemandCoverage(8_000, {
      requestedTeraflops: 24_900,
      fullFleetCapacityTeraflops: 16_000,
    });
    expect(coverage.demandCoverage).toBeCloseTo(32.1, 1);
    expect(coverage.demandExceedsFleet).toBe(true);
    expect(coverage.wholeFleetCoverage).toBeCloseTo(64.3, 1);
  });

  it("reaches 100% only when the fleet can serve all demand", () => {
    const coverage = servingDemandCoverage(10_000, {
      requestedTeraflops: 10_000,
      fullFleetCapacityTeraflops: 16_000,
    });
    expect(coverage).toEqual({
      demandCoverage: 100,
      demandExceedsFleet: false,
      wholeFleetCoverage: 100,
    });
  });
});
