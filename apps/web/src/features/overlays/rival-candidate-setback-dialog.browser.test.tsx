import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RivalCandidateSetbackPresentationQueueItemView } from "@neolab/sim/public";

import "../../styles/game.css";
import { RivalCandidateSetbackDialog } from "./rival-candidate-setback-dialog.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const base: RivalCandidateSetbackPresentationQueueItemView = {
  key: "rival-candidate-setback:lab:rival:model:rival:80",
  kind: "rival-candidate-setback",
  attention: "modal",
  outcome: "false-dawn",
  rivalLabId: "lab:rival",
  rivalLabName: "Kestrel Systems",
  rivalAiName: "DeepSearch",
  modelId: "model:rival",
  modelDisplayName: "DeepSearch-9",
  createdAtTick: 80,
  countdownStartedAtTick: 54,
  elapsedWeeks: 26,
};

describe("RivalCandidateSetbackDialog", () => {
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

  it.each([
    [
      "false-dawn",
      "RIVAL FALSE DAWN",
      "Kestrel Systems’ superintelligence claim has collapsed.",
      "COUNTDOWN WITHDRAWN",
      "did not establish general superintelligence",
    ],
    [
      "emergency-containment",
      "EMERGENCY CONTAINMENT",
      "Kestrel Systems destroyed DeepSearch-9 at the deployment boundary.",
      "WEIGHTS DESTROYED",
      "destroyed the candidate weights under emergency containment",
    ],
    [
      "containment-incident",
      "CANDIDACY HALTED",
      "Kestrel Systems’ candidate process has been stopped.",
      "CONTAINMENT SIGNAL",
      "interrupted the process before deployment",
    ],
  ] as const)(
    "renders the %s setback as a distinct intelligence flash",
    (outcome, verdict, title, status, detail) => {
      const onAcknowledge = vi.fn();
      act(() =>
        root.render(
          <RivalCandidateSetbackDialog
            item={{ ...base, outcome }}
            onAcknowledge={onAcknowledge}
          />,
        ),
      );

      const dialog = mount.querySelector<HTMLElement>("[role='alertdialog']")!;
      expect(dialog.classList).toContain("rival-candidate-setback-dialog");
      expect(dialog.classList).toContain(`outcome-${outcome}`);
      expect(dialog.classList).not.toContain("purchase-dialog");
      expect(dialog.classList).not.toContain("rival-crisis-stage-dialog");
      expect(dialog.querySelector("h2")?.textContent).toBe(title);
      expect(dialog.textContent).toContain(verdict);
      expect(dialog.textContent).toContain(status);
      expect(dialog.textContent).toContain(detail);
      expect(dialog.textContent).toContain("SETBACK, NOT DEFEAT");
      expect(dialog.textContent).toContain("You have more time. You have not won.");

      const button = dialog.querySelector<HTMLButtonElement>("button")!;
      expect(button.textContent?.trim()).toBe("Return to the race");
      const buttonStyle = getComputedStyle(button);
      expect(buttonStyle.boxShadow).not.toBe("none");
      expect(buttonStyle.transitionProperty).toContain("transform");
      expect(buttonStyle.transitionProperty).toContain("box-shadow");
      act(() => button.click());
      expect(onAcknowledge).toHaveBeenCalledOnce();
    },
  );

  it("keeps its fixed-dark bulletin treatment legible in dark mode", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    act(() =>
      root.render(<RivalCandidateSetbackDialog item={base} onAcknowledge={vi.fn()} />),
    );

    const backdrop = mount.querySelector<HTMLElement>(".rival-setback-backdrop")!;
    const dialog = mount.querySelector<HTMLElement>(".rival-candidate-setback-dialog")!;
    const heading = dialog.querySelector<HTMLHeadingElement>("h2")!;
    expect(Number(getComputedStyle(backdrop).zIndex)).toBeGreaterThan(16);
    expect(getComputedStyle(dialog).borderTopWidth).toBe("10px");
    expect(getComputedStyle(dialog).boxShadow).not.toBe("none");
    expect(getComputedStyle(heading).color).toBe("rgb(244, 255, 255)");
  });
});
