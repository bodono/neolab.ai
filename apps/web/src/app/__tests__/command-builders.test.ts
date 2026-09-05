import { describe, expect, it } from "vitest";

import type { GameView } from "@neolab/sim/public";

import { allocationCommand, chooseFalseDawnPathCommand } from "../command-builders.ts";

function allocationView(): GameView {
  return {
    meta: { tick: 12 },
    identity: { labId: "lab:player" },
    compute: {
      allocation: {
        capabilityPrograms: [
          { id: "domain.architectures", basisPoints: 5000 },
          { id: "domain.optimisation", basisPoints: 5000 },
        ],
        safetyPrograms: [
          { id: "safety.alignment", basisPoints: 5000 },
          { id: "safety.security", basisPoints: 5000 },
        ],
      },
      queuedAllocation: {
        servingFleetShareBasisPoints: 1000,
        capabilityBasisPoints: 7000,
        capabilityDomainWeights: {
          "domain.architectures": 7500,
          "domain.optimisation": 2500,
        },
        safetyProgramWeights: {
          "safety.alignment": 7500,
          "safety.security": 2500,
        },
      },
    },
  } as unknown as GameView;
}

describe("allocationCommand", () => {
  it("preserves a queued research posture when a later scheduler order is built", () => {
    const command = allocationCommand(allocationView(), 2000, 6000);

    expect(command.allocation.capabilityDomainWeights).toEqual({
      "domain.architectures": 7500,
      "domain.optimisation": 2500,
    });
    expect(command.allocation.safetyProgramWeights).toEqual({
      "safety.alignment": 7500,
      "safety.security": 2500,
    });
  });

  it("allows an explicit research posture to replace the queued posture", () => {
    const command = allocationCommand(allocationView(), 2000, 6000, {
      capabilityDomainWeights: {
        "domain.architectures": 5000,
        "domain.optimisation": 5000,
      },
      safetyProgramWeights: {
        "safety.alignment": 5000,
        "safety.security": 5000,
      },
    });

    expect(command.allocation.capabilityDomainWeights).toEqual({
      "domain.architectures": 5000,
      "domain.optimisation": 5000,
    });
    expect(command.allocation.safetyProgramWeights).toEqual({
      "safety.alignment": 5000,
      "safety.security": 5000,
    });
  });
});

describe("chooseFalseDawnPathCommand", () => {
  it.each(["successor-programme", "durable-moratorium"] as const)(
    "binds the durable presentation key to the %s decision",
    (path) => {
      const command = chooseFalseDawnPathCommand(
        allocationView(),
        "endgame-return:false-dawn:model:1:140",
        path,
      );

      expect(command).toMatchObject({
        kind: "choose-false-dawn-path",
        labId: "lab:player",
        presentationKey: "endgame-return:false-dawn:model:1:140",
        path,
        meta: {
          expectedTick: 12,
          issuedBy: "player",
        },
      });
    },
  );
});
