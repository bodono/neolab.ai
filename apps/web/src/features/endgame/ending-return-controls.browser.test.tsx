import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EndingReturnControls } from "./ending-screen.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("EndingReturnControls in Chromium", () => {
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

  it("replaces the initial button with an explicit confirm-or-cancel choice", () => {
    const onArm = vi.fn();
    const onCancel = vi.fn();

    act(() =>
      root.render(
        <EndingReturnControls
          armed={false}
          onArm={onArm}
          onCancel={onCancel}
          onRestart={vi.fn()}
        />,
      ),
    );

    const returnButton = document.querySelector<HTMLButtonElement>(
      ".ending-return-button",
    );
    expect(returnButton?.textContent).toBe("Return to title");
    expect(document.querySelector(".ending-return-confirm")).toBeNull();
    act(() => returnButton?.click());
    expect(onArm).toHaveBeenCalledTimes(1);

    act(() =>
      root.render(
        <EndingReturnControls
          armed={true}
          onArm={onArm}
          onCancel={onCancel}
          onRestart={vi.fn()}
        />,
      ),
    );

    expect(document.querySelector(".ending-return-button")).toBeNull();
    expect(document.querySelector(".ending-return-confirm")?.textContent).toBe(
      "Yes, return to title",
    );
    expect(document.querySelector(".ending-return-cancel")?.textContent).toBe(
      "Stay here",
    );

    act(() =>
      document.querySelector<HTMLButtonElement>(".ending-return-cancel")?.click(),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("returns immediately without opening credits", async () => {
    const onRestart = vi.fn(() => Promise.resolve(undefined));
    act(() =>
      root.render(
        <EndingReturnControls
          armed={true}
          onArm={vi.fn()}
          onCancel={vi.fn()}
          onRestart={onRestart}
        />,
      ),
    );

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".ending-return-confirm")?.click();
      await Promise.resolve();
    });

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='credits-roll']")).toBeNull();
  });

  it("shows a save failure and allows the player to try again or stay", async () => {
    const onRestart = vi.fn(() => Promise.resolve("save failed"));
    act(() =>
      root.render(
        <EndingReturnControls
          armed={true}
          onArm={vi.fn()}
          onCancel={vi.fn()}
          onRestart={onRestart}
        />,
      ),
    );

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".ending-return-confirm")?.click();
      await Promise.resolve();
    });

    expect(document.querySelector("[role='alert']")?.textContent).toContain(
      "save failed",
    );
    expect(
      document.querySelector<HTMLButtonElement>(".ending-return-confirm")?.disabled,
    ).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>(".ending-return-cancel")?.disabled,
    ).toBe(false);
  });
});
