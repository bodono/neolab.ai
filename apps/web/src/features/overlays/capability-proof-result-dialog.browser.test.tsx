import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapabilityProofResultPresentationQueueItemView } from "@neolab/sim/public";

import "../../styles/game.css";
import { CapabilityProofResultDialog } from "./capability-proof-result-dialog.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const base: CapabilityProofResultPresentationQueueItemView = {
  key: "capability-proof-result:proof:aquarius:0",
  kind: "capability-proof-result",
  attention: "modal",
  historyId: "proof:aquarius:0",
  modelId: "model:aquarius-7",
  modelDisplayName: "Aquarius-7",
  createdAtTick: 36,
  attemptNumber: 1,
  resultId: "broadly-confirmed",
  outcome: "confirmed",
  challengeName: "Generalist gauntlet",
  verifierName: "Independent institutional verification",
  claimScope: "Broad superintelligence",
  accessLevelAtProof: 2,
  evidenceStrength: 84,
  integrityLabel: "Durable",
  summary: "Novel generalist tasks support a broad superintelligence claim.",
  explanation: "Durable evidence reached 84/100. This supports capability, not safety.",
};

describe("CapabilityProofResultDialog", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    document.documentElement.removeAttribute("data-theme");
  });

  it.each(["light", "dark"] as const)(
    "keeps the result surface fully opaque in %s mode",
    (theme) => {
      document.documentElement.setAttribute("data-theme", theme);
      act(() =>
        root.render(<CapabilityProofResultDialog item={base} onContinue={vi.fn()} />),
      );

      const dialog = mount.querySelector<HTMLElement>(".capability-proof-result-dialog");
      expect(dialog).not.toBeNull();
      expect(getComputedStyle(dialog!).backgroundColor).toBe("rgb(16, 28, 26)");
    },
  );

  it.each([
    ["broadly-confirmed", "confirmed", "Capability proof confirmed"],
    ["domain-confirmed", "confirmed", "Capability proof confirmed"],
    ["ambiguous", "inconclusive", "Capability proof inconclusive"],
    ["disputed", "disputed", "Capability claim disputed"],
    ["fabricated-or-unverifiable", "disputed", "Capability claim disputed"],
  ] as const)("renders %s as an explicit %s verdict", (resultId, outcome, title) => {
    const onContinue = vi.fn();
    const item: CapabilityProofResultPresentationQueueItemView = {
      ...base,
      resultId,
      outcome,
      ...(outcome === "confirmed"
        ? {}
        : { consequence: "The failed attempt increased external scrutiny." }),
    };
    act(() =>
      root.render(<CapabilityProofResultDialog item={item} onContinue={onContinue} />),
    );

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.querySelector("h2")?.textContent).toBe(title);
    expect(dialog?.textContent).toContain("WHY THIS RESULT");
    expect(dialog?.textContent).toContain("Generalist gauntlet");
    expect(dialog?.textContent).toContain("Independent institutional verification");
    expect(dialog?.textContent).toContain("84/100");
    expect(dialog?.textContent).toContain("WHAT HAPPENS NEXT");
    expect(dialog?.textContent).toContain("Saved to the proof record.");

    const button = document.querySelector<HTMLButtonElement>("button");
    act(() => button?.click());
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
