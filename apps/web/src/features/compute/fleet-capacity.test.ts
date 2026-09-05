import { describe, expect, it } from "vitest";

import { summarizeFleetCapacity } from "./fleet-capacity.ts";

describe("fleet capacity summary", () => {
  it("shows full capacity at a glance", () => {
    expect(
      summarizeFleetCapacity({
        ownedPhysicalGpus: 30_000,
        incomingPhysicalGpus: 0,
        supportedPhysicalGpus: 30_000,
      }),
    ).toMatchObject({
      state: "full",
      freePhysicalGpus: 0,
      label: "Capacity 30,000 / 30,000 GPUs · Full",
    });
  });

  it("counts incoming deliveries as committed capacity", () => {
    expect(
      summarizeFleetCapacity({
        ownedPhysicalGpus: 20_000,
        incomingPhysicalGpus: 5_000,
        supportedPhysicalGpus: 30_000,
      }),
    ).toMatchObject({
      committedPhysicalGpus: 25_000,
      state: "available",
      freePhysicalGpus: 5_000,
      label: "Capacity 25,000 / 30,000 GPUs · 5,000 free",
    });
  });

  it("makes an over-capacity fleet visible", () => {
    expect(
      summarizeFleetCapacity({
        ownedPhysicalGpus: 32_000,
        incomingPhysicalGpus: 0,
        supportedPhysicalGpus: 30_000,
      }),
    ).toMatchObject({
      state: "over",
      freePhysicalGpus: 0,
      label: "Capacity 32,000 / 30,000 GPUs · 2,000 over",
    });
  });
});
