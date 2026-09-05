import { describe, expect, it } from "vitest";

import { resolveAutoPauseAction, visibleAutoPauseReasons } from "./auto-pause-action.ts";

describe("resolveAutoPauseAction", () => {
  it("routes every actionable pause to its relevant surface", () => {
    expect(resolveAutoPauseAction(["funding-offers"])?.destination).toBe("fundraising");
    expect(resolveAutoPauseAction(["training-complete"])?.destination).toBe("models");
    expect(resolveAutoPauseAction(["training-failed"])?.destination).toBe("models");
    expect(resolveAutoPauseAction(["anomaly-detected"])?.destination).toBe("evaluations");
    expect(resolveAutoPauseAction(["anomaly-investigation-complete"])).toMatchObject({
      label: "Review investigation result",
      destination: "evaluations",
    });
    expect(resolveAutoPauseAction(["paper-discovered"])?.destination).toBe("research");
    expect(resolveAutoPauseAction(["world-first-paper"])?.destination).toBe("research");
    expect(resolveAutoPauseAction(["research-direction"])?.destination).toBe("research");
    expect(resolveAutoPauseAction(["resignation-ultimatum"])?.destination).toBe("people");
    expect(resolveAutoPauseAction(["government-intervention"])).toMatchObject({
      label: "Continue to formal decision",
      destination: "resume",
    });
    expect(resolveAutoPauseAction(["crisis-stage"])?.destination).toBe("crisis");
    expect(resolveAutoPauseAction(["rival-crisis-stage"])).toMatchObject({
      label: "Review rival crisis stage",
      destination: "world",
    });
  });

  it("prioritises blocking and survival decisions over informational pauses", () => {
    expect(
      resolveAutoPauseAction(["training-complete", "bankruptcy-warning"])?.reason,
    ).toBe("bankruptcy-warning");
    expect(resolveAutoPauseAction(["funding-offers", "critical-event"])?.reason).toBe(
      "critical-event",
    );
    expect(
      resolveAutoPauseAction(["training-complete", "anomaly-detected"])?.reason,
    ).toBe("anomaly-detected");
  });
});

describe("visibleAutoPauseReasons", () => {
  it("hides only bankruptcy warnings while a fundraiser is actively running", () => {
    expect(
      visibleAutoPauseReasons(["bankruptcy-warning", "training-complete"], "active"),
    ).toEqual(["training-complete"]);
    expect(visibleAutoPauseReasons(["bankruptcy-warning"], "queued")).toEqual([
      "bankruptcy-warning",
    ]);
    expect(visibleAutoPauseReasons(["bankruptcy-warning"], "paused")).toEqual([
      "bankruptcy-warning",
    ]);
  });
});
