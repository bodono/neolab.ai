import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../styles/game.css";
import { RivalDeploymentImminentDialog } from "./rival-deployment-imminent-dialog.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("RivalDeploymentImminentDialog", () => {
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
  });

  it("names the rival, candidate, uncertain window, and four possible outcomes", () => {
    const onContinue = vi.fn();
    const onOpenRivalWatch = vi.fn();
    act(() =>
      root.render(
        <RivalDeploymentImminentDialog
          warning={{
            labName: "Humanic",
            modelName: "Maude-9",
            estimateLabel: "2–4 weeks",
            confidence: "medium",
          }}
          onContinue={onContinue}
          onOpenRivalWatch={onOpenRivalWatch}
        />,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>("[role='alertdialog']")!;
    expect(dialog.textContent).toContain("RIVAL DEPLOYMENT IMMINENT");
    expect(dialog.textContent).toContain("Humanic");
    expect(dialog.textContent).toContain("Maude-9");
    expect(dialog.textContent).toContain("2–4 weeks");
    expect(dialog.textContent).toContain("medium confidence");
    for (const outcome of [
      "Rival ascendancy",
      "Global catastrophe",
      "Containment delay",
      "False Dawn",
    ]) {
      expect(dialog.textContent).toContain(outcome);
    }

    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    act(() => buttons[0]?.click());
    expect(onContinue).toHaveBeenCalledOnce();
    act(() => buttons[1]?.click());
    expect(onOpenRivalWatch).toHaveBeenCalledOnce();
  });
});
