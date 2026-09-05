import { describe, expect, it } from "vitest";

import type { GameView } from "@neolab/sim/public";

import { servingModelLabel } from "./allocation-panel.tsx";

describe("serving model identity", () => {
  it("uses the commercial model rather than the current internal model", () => {
    const view = {
      models: {
        currentModelId: "model:new-internal",
        commercialModelId: "model:older-commercial",
        cards: [
          {
            modelId: "model:new-internal",
            displayName: "Aquarius-4",
            deployment: { displayName: "Internal only" },
          },
          {
            modelId: "model:older-commercial",
            displayName: "Aquarius-3",
            deployment: { displayName: "Guarded API" },
          },
        ],
      },
    } as unknown as GameView;

    expect(servingModelLabel(view)).toBe("Serving Aquarius-3 · Guarded API");
  });

  it("states clearly when no model is deployed to customers", () => {
    const view = {
      models: {
        currentModelId: "model:internal",
        cards: [],
      },
    } as unknown as GameView;

    expect(servingModelLabel(view)).toBe("No customer-facing model deployed");
  });
});
