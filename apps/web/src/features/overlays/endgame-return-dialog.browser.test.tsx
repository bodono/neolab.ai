import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EndgameReturnPresentationQueueItemView } from "@neolab/sim/public";

import "../../styles/game.css";
import { EndgameReturnDialog } from "./endgame-return-dialog.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const falseDawn: EndgameReturnPresentationQueueItemView = {
  key: "endgame-return:false-dawn:model:1:140",
  kind: "endgame-return",
  attention: "modal",
  endingId: "base:ending.false-dawn",
  endingDisplayName: "False Dawn",
  endingSummary: "The candidate was not superintelligence.",
  mechanicalCause: "The capability claim failed.",
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

describe("False Dawn choices in Chromium", () => {
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

  it("dispatches each visible future through a distinct typed path", () => {
    const onChoose = vi.fn();
    act(() => root.render(<EndgameReturnDialog item={falseDawn} onChoose={onChoose} />));

    const buttons = [...mount.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Begin successor programme",
      "Surrender model and seek moratorium",
    ]);
    for (const button of buttons) {
      const style = getComputedStyle(button);
      expect(style.boxShadow).not.toBe("none");
      expect(style.transitionProperty).toContain("transform");
      expect(style.transitionProperty).toContain("box-shadow");
    }

    act(() => buttons[0]?.click());
    expect(onChoose).toHaveBeenLastCalledWith("successor-programme");

    act(() => buttons[1]?.click());
    expect(onChoose).toHaveBeenLastCalledWith("durable-moratorium");
    expect(onChoose).toHaveBeenCalledTimes(2);
  });

  it("keeps the paper dossier readable when the surrounding game uses dark mode", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    act(() => root.render(<EndgameReturnDialog item={falseDawn} onChoose={vi.fn()} />));

    const dialog = mount.querySelector<HTMLElement>(".endgame-return-dialog")!;
    const heading = dialog.querySelector<HTMLHeadingElement>("h2")!;
    expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(248, 248, 244)");
    expect(getComputedStyle(heading).color).toBe("rgb(24, 32, 37)");
  });

  it("disables the Long Pause when released copies cannot be sealed", () => {
    const onChoose = vi.fn();
    act(() =>
      root.render(
        <EndgameReturnDialog
          item={{
            ...falseDawn,
            durableMoratoriumAvailable: false,
            durableMoratoriumBlocker:
              "These weights have already been released outside the lab.",
          }}
          onChoose={onChoose}
        />,
      ),
    );

    const button = [...mount.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Long Pause unavailable",
    );
    expect(button?.disabled).toBe(true);
    act(() => button?.click());
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("acknowledges a failed moratorium through the successor path only", () => {
    const onChoose = vi.fn();
    document.documentElement.setAttribute("data-theme", "dark");
    act(() =>
      root.render(
        <EndgameReturnDialog
          item={{ ...falseDawn, phase: "moratorium-failed", restoredAccessLevel: 0 }}
          onChoose={onChoose}
        />,
      ),
    );

    const buttons = [...mount.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Return to the race",
    ]);
    expect(mount.textContent).toContain("Government trust fell · Attention rose");
    expect(mount.textContent).toContain("Sealed at Access 0");
    expect(getComputedStyle(buttons[0]!).backgroundColor).toBe("rgb(114, 42, 35)");
    expect(getComputedStyle(buttons[0]!).color).toBe("rgb(255, 255, 255)");

    act(() => buttons[0]?.click());
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith("successor-programme");
  });
});
