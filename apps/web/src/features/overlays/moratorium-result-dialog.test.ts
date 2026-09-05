import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MoratoriumResultPresentationQueueItemView } from "@neolab/sim/public";

import { MoratoriumResultDialog } from "./moratorium-result-dialog.tsx";

const result: MoratoriumResultPresentationQueueItemView = {
  key: "moratorium-result:model:1:140",
  kind: "moratorium-result",
  attention: "modal",
  resultId: "moratorium-failed",
  modelId: "model:1",
  modelDisplayName: "Aquarius-7",
  createdAtTick: 140,
  archiveDisposition: "full-archive",
  archiveDispositionName: "Preserve a sealed full archive",
  recoveryEndsAtTick: 153,
  recoveryWeeksRemaining: 13,
  governmentTrustLost: 8,
  governmentAttentionAdded: 10,
};

describe("post-retirement moratorium result", () => {
  it("makes rejection, retained retirement, political cost, and next state explicit", () => {
    const markup = renderToStaticMarkup(
      createElement(MoratoriumResultDialog, {
        item: result,
        onAcknowledge: vi.fn(),
      }),
    );

    expect(markup).toContain("The Long Pause was rejected");
    expect(markup).toContain("NO DURABLE MORATORIUM");
    expect(markup).toContain("full archive remains sealed");
    expect(markup).toContain("−8 trust · +10 attention");
    expect(markup).toContain("13 recovery weeks remain");
    expect(markup).toContain("Acknowledge and continue");
  });

  it("explains that the race resumes immediately when recovery is already complete", () => {
    const markup = renderToStaticMarkup(
      createElement(MoratoriumResultDialog, {
        item: { ...result, recoveryWeeksRemaining: 0 },
        onAcknowledge: vi.fn(),
      }),
    );

    expect(markup).toContain("RECOVERY COMPLETE");
    expect(markup).toContain("Ordinary lab operations may resume");
    expect(markup).toContain("Return to the frontier after acknowledging this result");
  });
});
