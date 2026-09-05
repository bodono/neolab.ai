import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalFocusBoundary } from "./modal-focus-boundary.tsx";
import "../../styles/game.css";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ModalFocusBoundary in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;
  let launcher: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = [
      "<div id='shell'>",
      "  <main id='dashboard'><button id='launcher'>Open decision</button></main>",
      "  <div id='mount'></div>",
      "</div>",
    ].join("");
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    launcher = document.querySelector<HTMLButtonElement>("#launcher")!;
    launcher.focus();
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-modal-open");
    document.body.removeAttribute("style");
    document.body.replaceChildren();
  });

  it("traps keyboard focus, inerts the dashboard, handles Escape, and restores focus", () => {
    const onOpen = vi.fn();
    const onEscape = vi.fn();
    act(() =>
      root.render(
        <ModalFocusBoundary onOpen={onOpen} onEscape={onEscape}>
          <section role="dialog" aria-modal="true" aria-label="Decision">
            <button type="button" autoFocus>
              First option
            </button>
            <button type="button">Last option</button>
          </section>
        </ModalFocusBoundary>,
      ),
    );

    const dashboard = document.querySelector<HTMLElement>("#dashboard")!;
    const buttons = [...mount.querySelectorAll<HTMLButtonElement>("button")];
    const first = buttons[0]!;
    const last = buttons[1]!;
    expect(document.activeElement).toBe(first);
    expect(dashboard.inert).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.dataset["modalOpen"]).toBe("true");
    expect(onOpen).toHaveBeenCalledOnce();

    last.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(first);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(last);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(onEscape).toHaveBeenCalledOnce();

    act(() => root.unmount());
    expect(dashboard.inert).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.dataset["modalOpen"]).toBeUndefined();
    expect(document.activeElement).toBe(launcher);
    root = createRoot(mount);
  });

  it("fits a long touch-scroll surface inside the visual viewport", () => {
    act(() =>
      root.render(
        <ModalFocusBoundary>
          <div className="modal-backdrop">
            <section
              className="purchase-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Long tablet decision"
            >
              <div style={{ height: "1800px" }}>Long decision content</div>
              <button type="button">Decision at bottom</button>
            </section>
          </div>
        </ModalFocusBoundary>,
      ),
    );

    const boundary = mount.querySelector<HTMLElement>(".modal-focus-boundary")!;
    const backdrop = mount.querySelector<HTMLElement>(".modal-backdrop")!;
    const dialog = mount.querySelector<HTMLElement>("[role='dialog']")!;
    // Locking the document scrollbar changes the visual viewport after the
    // boundary has already measured it, so a mount-time capture and an
    // assertion-time read disagree by the scrollbar. Settle both sides against
    // the same layout before comparing: the contract is that the boundary
    // tracks the viewport, not that it predicts its own side effects.
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const viewportHeight = Math.round(
      window.visualViewport?.height ?? window.innerHeight,
    );
    const viewportWidth = Math.round(window.visualViewport?.width ?? window.innerWidth);
    const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop ?? 0);
    const viewportOffsetLeft = Math.round(window.visualViewport?.offsetLeft ?? 0);
    expect(boundary.style.getPropertyValue("--modal-visual-viewport-height")).toBe(
      `${String(viewportHeight)}px`,
    );
    expect(boundary.style.getPropertyValue("--modal-visual-viewport-width")).toBe(
      `${String(viewportWidth)}px`,
    );
    expect(boundary.style.getPropertyValue("--modal-visual-viewport-offset-top")).toBe(
      `${String(viewportOffsetTop)}px`,
    );
    expect(boundary.style.getPropertyValue("--modal-visual-viewport-offset-left")).toBe(
      `${String(viewportOffsetLeft)}px`,
    );
    expect(Math.round(boundary.getBoundingClientRect().top)).toBe(viewportOffsetTop);
    expect(Math.round(boundary.getBoundingClientRect().left)).toBe(viewportOffsetLeft);
    expect(Math.round(backdrop.getBoundingClientRect().height)).toBe(viewportHeight);
    expect(getComputedStyle(backdrop).overflow).toBe("hidden");
    expect(getComputedStyle(dialog).maxBlockSize).toBe("100%");
    expect(getComputedStyle(dialog).overflowY).toBe("auto");
    expect(getComputedStyle(dialog).overscrollBehaviorY).toBe("contain");
    expect(dialog.scrollHeight).toBeGreaterThan(dialog.clientHeight);
  });

  it("keeps the dialog below an offset tablet visual viewport", () => {
    const visualViewport = window.visualViewport;
    expect(visualViewport).toBeDefined();
    if (visualViewport === null) return;

    const offsetTop = 64;
    const visibleHeight = Math.max(320, window.innerHeight - offsetTop);
    const offsetTopSpy = vi
      .spyOn(visualViewport, "offsetTop", "get")
      .mockReturnValue(offsetTop);
    const heightSpy = vi
      .spyOn(visualViewport, "height", "get")
      .mockReturnValue(visibleHeight);

    try {
      act(() =>
        root.render(
          <ModalFocusBoundary>
            <div className="modal-backdrop">
              <section
                className="purchase-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Tablet decision below browser chrome"
              >
                <h2>Decision heading</h2>
                <button type="button">Top action</button>
              </section>
            </div>
          </ModalFocusBoundary>,
        ),
      );

      const boundary = mount.querySelector<HTMLElement>(".modal-focus-boundary")!;
      const dialog = mount.querySelector<HTMLElement>("[role='dialog']")!;
      expect(boundary.style.getPropertyValue("--modal-visual-viewport-offset-top")).toBe(
        `${String(offsetTop)}px`,
      );
      expect(Math.round(boundary.getBoundingClientRect().top)).toBe(offsetTop);
      expect(Math.round(boundary.getBoundingClientRect().height)).toBe(visibleHeight);
      expect(dialog.getBoundingClientRect().top).toBeGreaterThan(offsetTop);
    } finally {
      offsetTopSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("can initially focus a scrollable dialog at the top", () => {
    act(() =>
      root.render(
        <ModalFocusBoundary>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Long decision"
            data-modal-initial-focus
            tabIndex={-1}
            style={{ height: "120px", overflow: "auto" }}
          >
            <div style={{ height: "600px" }}>Decision context</div>
            <button type="button">Decision at bottom</button>
          </section>
        </ModalFocusBoundary>,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>("[role='dialog']")!;
    const footerButton = mount.querySelector<HTMLButtonElement>("button")!;
    expect(document.activeElement).toBe(dialog);
    expect(dialog.scrollTop).toBe(0);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(footerButton);
  });

  it("applies the same focus and inert boundary to an alert dialog", () => {
    act(() =>
      root.render(
        <ModalFocusBoundary>
          <section
            role="alertdialog"
            aria-modal="true"
            aria-label="Rival candidacy setback"
            data-modal-initial-focus
            tabIndex={-1}
          >
            <button type="button">Acknowledge setback</button>
          </section>
        </ModalFocusBoundary>,
      ),
    );

    const dashboard = document.querySelector<HTMLElement>("#dashboard")!;
    const alert = mount.querySelector<HTMLElement>("[role='alertdialog']")!;
    const button = mount.querySelector<HTMLButtonElement>("button")!;
    expect(document.activeElement).toBe(alert);
    expect(dashboard.inert).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(button);
  });

  it("opens a long informational dialog at the top instead of focusing its footer", () => {
    act(() =>
      root.render(
        <ModalFocusBoundary>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Long paper dossier"
            style={{ height: "120px", overflow: "auto" }}
          >
            <div style={{ height: "600px" }}>Paper context</div>
            <button type="button">Publish at bottom</button>
          </section>
        </ModalFocusBoundary>,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>("[role='dialog']")!;
    expect(document.activeElement).toBe(dialog);
    expect(dialog.scrollTop).toBe(0);
  });

  it("keeps a shell-level modal above dashboard content", () => {
    mount.className = "game-shell";
    act(() =>
      root.render(
        <>
          <ModalFocusBoundary>
            <section role="dialog" aria-modal="true" aria-label="Emergency decision">
              <button type="button">Respond</button>
            </section>
          </ModalFocusBoundary>
          <section data-testid="dashboard-content">Dashboard</section>
        </>,
      ),
    );

    const boundary = mount.querySelector<HTMLElement>(".modal-focus-boundary")!;
    const dashboard = mount.querySelector<HTMLElement>(
      "[data-testid='dashboard-content']",
    )!;

    expect(getComputedStyle(boundary).position).toBe("fixed");
    expect(Number(getComputedStyle(boundary).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(dashboard).zIndex),
    );
  });

  it("lifts a workspace modal above the sticky overview bar", () => {
    mount.className = "game-shell";
    act(() =>
      root.render(
        <>
          <section className="command-status-strip" aria-label="Current lab status">
            <article>
              <span>Cash</span>
              <strong>$26M</strong>
            </article>
          </section>
          <div className="game-console-frame">
            <main className="game-console-main">
              <ModalFocusBoundary>
                <div className="modal-backdrop">
                  <section role="dialog" aria-modal="true" aria-label="Training">
                    <button type="button">Close</button>
                  </section>
                </div>
              </ModalFocusBoundary>
            </main>
          </div>
        </>,
      ),
    );

    const overview = mount.querySelector<HTMLElement>(".command-status-strip")!;
    const consoleFrame = mount.querySelector<HTMLElement>(".game-console-frame")!;
    const boundary = mount.querySelector<HTMLElement>(".modal-focus-boundary")!;

    expect(Number(getComputedStyle(consoleFrame).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(overview).zIndex),
    );
    expect(Number(getComputedStyle(boundary).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(overview).zIndex),
    );
  });

  it("fully unlocks the dashboard when nested modal boundaries close together", () => {
    document.documentElement.setAttribute("data-modal-open", "owned-by-host");
    document.documentElement.style.overflow = "clip";
    document.documentElement.style.overscrollBehavior = "auto";
    document.body.style.overflow = "scroll";
    document.body.style.overscrollBehavior = "contain";
    act(() =>
      root.render(
        <ModalFocusBoundary>
          <section role="dialog" aria-modal="true" aria-label="Crisis decision">
            <button type="button">Choose response</button>
            <ModalFocusBoundary>
              <section role="dialog" aria-modal="true" aria-label="Typed confirmation">
                <input aria-label="Confirmation phrase" autoFocus />
                <button type="button">Confirm</button>
              </section>
            </ModalFocusBoundary>
          </section>
        </ModalFocusBoundary>,
      ),
    );

    const dashboard = document.querySelector<HTMLElement>("#dashboard")!;
    expect(dashboard.inert).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.dataset["modalOpen"]).toBe("true");

    act(() => root.render(<></>));

    expect(dashboard.inert).toBe(false);
    expect(document.querySelectorAll(".modal-focus-boundary")).toHaveLength(0);
    expect(document.documentElement.style.overflow).toBe("clip");
    expect(document.documentElement.style.overscrollBehavior).toBe("auto");
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.body.style.overscrollBehavior).toBe("contain");
    expect(document.documentElement.dataset["modalOpen"]).toBe("owned-by-host");
  });
});
