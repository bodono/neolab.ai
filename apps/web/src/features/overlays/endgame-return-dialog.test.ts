import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EndgameReturnPresentationQueueItemView } from "@neolab/sim/public";

import { EndgameReturnDialog } from "./endgame-return-dialog.tsx";

const falseDawn: EndgameReturnPresentationQueueItemView = {
  key: "endgame-return:false-dawn:model:1:140",
  kind: "endgame-return",
  attention: "modal",
  endingId: "base:ending.false-dawn",
  endingDisplayName: "False Dawn",
  endingSummary:
    "The candidate was remarkable and commercially useful, but it was not superintelligence.",
  mechanicalCause:
    "The candidate's capability claim did not support a successful prosperity demonstration.",
  modelId: "model:1",
  modelDisplayName: "Aquarius-7",
  createdAtTick: 140,
  crisisWeeksSpent: 18,
  cooldownUntilTick: 192,
  cooldownWeeks: 52,
  remainingCooldownWeeks: 52,
  restoredAccessLevel: 2,
  productQuality: 91,
  phase: "choice",
  durableMoratoriumAvailable: true,
  moratoriumForecast: {
    probabilityPercent: 50,
    strength: 67,
    difficulty: 67,
    durationWeeks: 8,
    positiveFactors: [],
    pressureFactors: [],
    rivals: [],
  },
};

describe("False Dawn return dialog", () => {
  it("makes clear that the run continues and exposes the complete cost of the setback", () => {
    const markup = renderToStaticMarkup(
      createElement(EndgameReturnDialog, {
        item: falseDawn,
        onChoose: vi.fn(),
      }),
    );

    expect(markup).toContain("NOT GAME OVER");
    expect(markup).toContain("THE RACE CONTINUES");
    expect(markup).toContain("Aquarius-7 was not superintelligence");
    expect(markup).toContain("18 crisis weeks spent");
    expect(markup).toContain("52-week nomination cooldown");
    expect(markup).toContain("52 weeks remain");
    expect(markup).toContain("qualifying weights wait in custody");
    expect(markup).not.toContain("The clock has stopped");
  });

  it("offers exactly the successor and durable-moratorium futures", () => {
    const markup = renderToStaticMarkup(
      createElement(EndgameReturnDialog, {
        item: falseDawn,
        onChoose: vi.fn(),
      }),
    );

    expect(markup).toContain("RETURN TO THE RACE");
    expect(markup).toContain("Begin a successor programme");
    expect(markup).toContain("Nominations remain closed for 52 weeks");
    expect(markup).toContain("Serving, evaluations, and RSI continue");
    expect(markup).toContain("THE LONG PAUSE");
    expect(markup).toContain("Seek a durable moratorium");
    expect(markup).toContain("Seal Aquarius-7 at Access 0");
    expect(markup).toContain("archive stays sealed even if talks fail");
    expect(markup).toContain("An estimate, not a guarantee");
    expect(markup).toContain("50%");
    expect(markup).toContain("8 weeks");
    expect(markup).not.toContain("Continue with the model");
    expect(markup.match(/<button/g)).toHaveLength(2);
  });

  it("does not promise a sealed Long Pause after an irreversible weights release", () => {
    const markup = renderToStaticMarkup(
      createElement(EndgameReturnDialog, {
        item: {
          ...falseDawn,
          durableMoratoriumAvailable: false,
          durableMoratoriumBlocker:
            "These weights have already been released outside the lab. External copies cannot be sealed into a verified Long Pause archive.",
        },
        onChoose: vi.fn(),
      }),
    );

    expect(markup).toContain("Long Pause unavailable");
    expect(markup).toContain("External copies cannot be sealed");
    expect(markup).toContain("disabled");
  });

  it("turns a failed moratorium into a blocking one-action result", () => {
    const markup = renderToStaticMarkup(
      createElement(EndgameReturnDialog, {
        item: {
          ...falseDawn,
          phase: "moratorium-failed",
          restoredAccessLevel: 0,
        },
        onChoose: vi.fn(),
      }),
    );

    expect(markup).toContain("The Long Pause attempt failed");
    expect(markup).toContain("archive remains sealed at Access 0");
    expect(markup).toContain("Government trust fell · Attention rose");
    expect(markup).toContain("52 of 52 cooldown weeks remain");
    expect(markup).toContain("Nominations reopen in week 192");
    expect(markup).toContain("Return to the race");
    expect(markup).not.toContain("THE MODEL REMAINS USABLE");
    expect(markup).not.toContain("Seek durable moratorium");
    expect(markup.match(/<button/g)).toHaveLength(1);
  });
});
