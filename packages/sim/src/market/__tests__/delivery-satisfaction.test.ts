import { describe, expect, it } from "vitest";

import { DELIVERY_SATISFACTION_GAIN, deliverySatisfactionDelta } from "../market.ts";

describe("the delivery term of customer satisfaction", () => {
  it("never costs a lab standing, however little it manages to serve", () => {
    // The defect this pins: the term used to be 3 - 11 * (1 - fulfilment), so
    // anything under 73% fulfilment subtracted. A lab whose demand outgrew its
    // fleet -- the normal consequence of a product landing -- lost satisfaction
    // for succeeding, and with it the aura that fundraising depends on.
    for (let step = 0; step <= 20; step += 1) {
      expect(deliverySatisfactionDelta(step / 20)).toBeGreaterThanOrEqual(0);
    }
  });

  it("pays in proportion to the share of demand actually met", () => {
    expect(deliverySatisfactionDelta(1)).toBe(DELIVERY_SATISFACTION_GAIN);
    expect(deliverySatisfactionDelta(0.5)).toBeCloseTo(
      DELIVERY_SATISFACTION_GAIN / 2,
      10,
    );
    expect(deliverySatisfactionDelta(0)).toBe(0);
  });

  it("rewards serving more, so capacity still earns its keep", () => {
    // Floored, not removed: fulfilment is still worth building for, it just
    // buys a gain rather than avoiding a punishment.
    for (let step = 1; step <= 20; step += 1) {
      expect(deliverySatisfactionDelta(step / 20)).toBeGreaterThan(
        deliverySatisfactionDelta((step - 1) / 20),
      );
    }
  });

  it("clamps a fulfilment ratio that overshoots or goes negative", () => {
    expect(deliverySatisfactionDelta(1.4)).toBe(DELIVERY_SATISFACTION_GAIN);
    expect(deliverySatisfactionDelta(-0.2)).toBe(0);
  });
});
