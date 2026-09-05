import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGamePauseShortcut } from "./use-game-pause-shortcut.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function ShortcutHarness({
  paused,
  onPause,
  onResume,
}: {
  readonly paused: boolean;
  readonly onPause: () => void;
  readonly onResume: () => void;
}): null {
  useGamePauseShortcut({
    enabled: true,
    paused,
    onPause,
    onResume,
  });
  return null;
}

function spaceKeydown(target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "Space",
    key: " ",
  });
  target.dispatchEvent(event);
  return event;
}

describe("useGamePauseShortcut in Chromium", () => {
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

  it("toggles the running state and prevents page scrolling", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    act(() => root.render(<ShortcutHarness paused={false} {...{ onPause, onResume }} />));

    const pauseEvent = spaceKeydown();
    expect(pauseEvent.defaultPrevented).toBe(true);
    expect(onPause).toHaveBeenCalledOnce();
    expect(onResume).not.toHaveBeenCalled();

    act(() => root.render(<ShortcutHarness paused {...{ onPause, onResume }} />));
    const resumeEvent = spaceKeydown();
    expect(resumeEvent.defaultPrevented).toBe(true);
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("leaves Space alone in form controls and modal dialogs", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    act(() => root.render(<ShortcutHarness paused={false} {...{ onPause, onResume }} />));

    const input = document.createElement("input");
    document.body.append(input);
    const inputEvent = spaceKeydown(input);
    expect(inputEvent.defaultPrevented).toBe(false);

    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    const dialogEvent = spaceKeydown();
    expect(dialogEvent.defaultPrevented).toBe(false);

    expect(onPause).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });
});
