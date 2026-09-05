import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "../../styles/game.css";
import { HowToPlayDialog } from "./how-to-play-dialog.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="opener" type="button" onClick={() => setOpen(true)}>
        How to play
      </button>
      {open ? <HowToPlayDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

describe("HowToPlayDialog", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  function openDialog(): HTMLElement {
    const opener = mount.querySelector<HTMLButtonElement>("#opener")!;
    opener.focus();
    act(() => opener.click());
    return mount.querySelector<HTMLElement>("[role='dialog']")!;
  }

  it("explains the complete first-run loop and candidacy gates", () => {
    const dialog = openDialog();
    expect(dialog.textContent).toContain("Build the lab. Win the race.");
    expect(dialog.textContent).toContain("88+");
    expect(dialog.textContent).toContain("80+");
    expect(dialog.textContent).toContain("4 / 4");
    expect(dialog.textContent).toContain("There is no separate raw-FLOP requirement");
    expect(dialog.textContent).toContain(
      "Train a new model, launch it for revenue, and evaluate its capability and safety.",
    );
  });

  it("is opaque, closes with Escape, and restores focus", () => {
    const dialog = openDialog();
    expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(16, 28, 27)");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(mount.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(mount.querySelector("#opener"));
  });
});
