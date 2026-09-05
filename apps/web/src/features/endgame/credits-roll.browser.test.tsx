import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreditsRoll } from "./credits-roll.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("CreditsRoll in Chromium", () => {
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

  it("credits the rubber stamper once and the five lab AIs for every role", () => {
    const onDone = vi.fn();
    act(() => root.render(<CreditsRoll onDone={onDone} reduceMotion={false} />));

    const overlay = document.querySelector("[data-testid='credits-roll']");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("Brendan O'Donoghue");
    expect(overlay?.textContent).toContain("Creator · Director · Rubber Stamper");
    const creatorLinks = overlay?.querySelectorAll<HTMLAnchorElement>(
      'a[href="https://bodono.github.io/"]',
    );
    expect(creatorLinks).toHaveLength(2);

    const roles = [...document.querySelectorAll(".credits-role")];
    expect(roles.length).toBeGreaterThan(40);
    const names = [...document.querySelectorAll(".credits-names")];
    expect(names).toHaveLength(roles.length);
    for (const line of names) {
      expect(line.textContent).toBe("Claude · ChatGPT · Gemini · Grok · DeepSeek");
    }
    expect(overlay?.textContent).toContain("The gradients are still flowing.");
  });

  it("dismisses on the skip button and on Escape", () => {
    const onDone = vi.fn();
    act(() => root.render(<CreditsRoll onDone={onDone} reduceMotion={false} />));
    const skip = document.querySelector<HTMLButtonElement>(".credits-skip");
    expect(skip?.textContent).toBe("Skip credits");
    act(() => skip?.click());
    expect(onDone).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("renders a static scrollable list under reduced motion", () => {
    const onDone = vi.fn();
    act(() => root.render(<CreditsRoll onDone={onDone} reduceMotion={true} />));
    expect(document.querySelector(".credits-overlay.credits-static")).not.toBeNull();
  });
});
