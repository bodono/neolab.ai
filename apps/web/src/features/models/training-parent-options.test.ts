import { describe, expect, it } from "vitest";

import { trainingParentOptions } from "./training-parent-options.ts";

function model(
  modelId: string,
  trainingParentEligible: boolean,
): { readonly modelId: string; readonly trainingParentEligible: boolean } {
  return { modelId, trainingParentEligible };
}

describe("trainingParentOptions", () => {
  it("excludes sealed archives and ignores a stale sealed initial selection", () => {
    const sealed = model("model:sealed", false);
    const usable = model("model:usable", true);

    expect(
      trainingParentOptions([usable, sealed], sealed.modelId, sealed.modelId),
    ).toMatchObject({
      eligibleModels: [usable],
      sealedModelCount: 1,
      initialParentModelId: usable.modelId,
    });
  });

  it("selects the fresh-lineage path when every prior checkpoint is sealed", () => {
    expect(
      trainingParentOptions(
        [model("model:one", false), model("model:two", false)],
        undefined,
      ),
    ).toMatchObject({
      eligibleModels: [],
      sealedModelCount: 2,
      initialParentModelId: "",
    });
  });
});
