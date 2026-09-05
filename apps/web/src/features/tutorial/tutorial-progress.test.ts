import { describe, expect, it } from "vitest";

import type { GameView } from "../../runtime/index.ts";
import { tutorialStepForView } from "./tutorial-progress.ts";

function view(
  options: {
    readonly model?: boolean;
    readonly evaluation?: boolean;
    readonly productised?: boolean;
    readonly serving?: boolean;
    readonly revenue?: boolean;
    readonly researcher?: boolean;
    readonly assigned?: boolean;
    readonly boughtGpus?: boolean;
    readonly funded?: boolean;
    readonly facilityCompleted?: boolean;
    readonly project?: "training" | "evaluation" | "productisation" | "construction";
  } = {},
): GameView {
  const model = {
    modelId: "model:tutorial",
    isCurrentModel: true,
    evaluations: options.evaluation
      ? [{ programme: "alignment-interview" }]
      : [{ programme: "baseline" }],
    deployment: {
      productisationRuns: options.productised ? { normal: 1 } : {},
    },
  };
  return {
    meta: {
      labMaturity: {
        stage: options.funded
          ? "startup"
          : options.revenue
            ? "funding"
            : options.serving
              ? "product"
              : "garage",
      },
    },
    models: {
      currentModelId: options.model ? model.modelId : undefined,
      cards: options.model ? [model] : [],
    },
    facilities: {
      projects:
        options.project === undefined
          ? []
          : [
              {
                kind: options.project,
                status: "active",
                definitionId:
                  options.project === "construction"
                    ? "base:facility.server-rack"
                    : `base:tutorial.${options.project}`,
              },
            ],
      completed: options.facilityCompleted
        ? [
            {
              facilityId: "facility:tutorial",
              definitionId: "base:facility.server-rack",
              completedAtTick: 12,
            },
          ]
        : [
            {
              facilityId: "facility:opening",
              definitionId: "base:facility.parents-garage",
              completedAtTick: 0,
            },
          ],
    },
    compute: {
      allocation: { serving: { basisPoints: options.serving ? 2500 : 0 } },
      pendingDeliveries: [],
      totalOwnedPhysicalGpus: options.boughtGpus ? 1000 : 0,
    },
    people: {
      roster: options.researcher
        ? [
            {
              researcherId: "researcher:tutorial",
              status: "employed",
              ...(options.assigned
                ? { assignment: { optionId: "capability:reasoning" } }
                : {}),
            },
          ]
        : [],
    },
    fundraising: {
      offers: options.funded ? [{ status: "accepted" }] : [],
    },
  } as unknown as GameView;
}

describe("tutorial objective progression", () => {
  it("follows the model, people, compute, and facility loop", () => {
    expect(tutorialStepForView(view()).objective).toBe("buy-gpus");
    expect(tutorialStepForView(view({ boughtGpus: true })).objective).toBe("train");
    expect(
      tutorialStepForView(view({ boughtGpus: true, project: "training" })).waiting,
    ).toBe(true);
    expect(tutorialStepForView(view({ boughtGpus: true, model: true })).objective).toBe(
      "evaluate",
    );
    expect(
      tutorialStepForView(view({ boughtGpus: true, model: true, project: "evaluation" }))
        .waiting,
    ).toBe(true);
    expect(
      tutorialStepForView(view({ boughtGpus: true, model: true, evaluation: true }))
        .objective,
    ).toBe("productise");
    expect(
      tutorialStepForView(
        view({
          boughtGpus: true,
          model: true,
          evaluation: true,
          project: "productisation",
        }),
      ).waiting,
    ).toBe(true);
    const servingStep = tutorialStepForView(
      view({ boughtGpus: true, model: true, evaluation: true, productised: true }),
    );
    expect(servingStep.objective).toBe("serve");
    expect(servingStep.title).toBe("Allocate GPUs to serving");
    expect(servingStep.instruction).toContain("allocate some GPUs to Serving");
    const revenueStep = tutorialStepForView(
      view({
        boughtGpus: true,
        model: true,
        evaluation: true,
        productised: true,
        serving: true,
      }),
    );
    expect(revenueStep.objective).toBe("serve");
    expect(revenueStep.waiting).toBe(true);
    expect(
      tutorialStepForView(
        view({
          boughtGpus: true,
          model: true,
          evaluation: true,
          productised: true,
          serving: true,
          revenue: true,
        }),
      ).objective,
    ).toBe("fundraise");
    const facilityStep = tutorialStepForView(
      view({
        boughtGpus: true,
        model: true,
        evaluation: true,
        productised: true,
        serving: true,
        funded: true,
      }),
    );
    expect(facilityStep.objective).toBe("build-facility");
    expect(facilityStep.title).toBe("Build the Server Rack");
    expect(facilityStep.instruction).toContain("commission the Server Rack");
    expect(
      tutorialStepForView(
        view({
          boughtGpus: true,
          model: true,
          evaluation: true,
          productised: true,
          serving: true,
          funded: true,
          facilityCompleted: true,
        }),
      ).objective,
    ).toBe("recruit");
    expect(
      tutorialStepForView(
        view({
          boughtGpus: true,
          model: true,
          evaluation: true,
          productised: true,
          serving: true,
          funded: true,
          facilityCompleted: true,
          researcher: true,
        }),
      ).objective,
    ).toBe("assign");
    expect(
      tutorialStepForView(
        view({
          boughtGpus: true,
          model: true,
          evaluation: true,
          productised: true,
          serving: true,
          funded: true,
          facilityCompleted: true,
          researcher: true,
          assigned: true,
        }),
      ).objective,
    ).toBe("complete");
  });
});
