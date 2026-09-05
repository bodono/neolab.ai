import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameView } from "@neolab/sim/public";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { ContainmentFailureExperience } from "./containment-failure-experience.tsx";
import { FINAL_CONSEQUENCE_DELAY_MS } from "./ending-reveal.ts";

vi.mock("../../audio/audio-control.tsx", () => ({ AudioControl: () => null }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function outcomeView(terminalOutcome = true): GameView {
  return {
    meta: { tick: 91 },
    identity: { labId: "lab:player" },
    endgame: {
      active: true,
      stageActions: {
        kind: "containment-failure",
        terminalOutcome,
        beat: "outcome",
        signalId: "credential-cascade",
        emergencyResult: terminalOutcome ? "failed" : "contained",
        responseOptions: [],
      },
    },
  } as unknown as GameView;
}

describe("ContainmentFailureExperience in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "<main id='game'></main><div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("holds the final command while consequences are reconciled", () => {
    const dispatch = vi.fn();
    const runtime = {
      dispatch,
      pause: vi.fn(),
      validate: vi.fn(() => ({ ok: true, errors: [] })),
    } as unknown as BrowserGameRuntime;

    act(() =>
      root.render(
        <ContainmentFailureExperience view={outcomeView()} runtime={runtime} />,
      ),
    );

    const finish = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "See what remains",
    );
    expect(finish).toBeDefined();

    act(() => finish?.click());

    expect(dispatch).not.toHaveBeenCalled();
    expect(document.querySelector("[role='status']")?.textContent).toContain(
      "RECONCILING INDEPENDENT TELEMETRY",
    );
    expect(
      document.querySelector(".containment-failure-frame")?.getAttribute("aria-busy"),
    ).toBe("true");

    act(() => {
      vi.advanceTimersByTime(FINAL_CONSEQUENCE_DELAY_MS - 1);
    });
    expect(dispatch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      kind: "resolve-containment-failure",
      actionId: "continue",
    });
  });

  it("distinguishes recoverable pre-command containment from a terminal shutdown", () => {
    const runtime = {
      dispatch: vi.fn(),
      pause: vi.fn(),
      validate: vi.fn(() => ({ ok: true, errors: [] })),
    } as unknown as BrowserGameRuntime;

    act(() =>
      root.render(
        <ContainmentFailureExperience view={outcomeView(false)} runtime={runtime} />,
      ),
    );

    expect(document.body.textContent).toContain("returns to human review");
    expect(document.body.textContent).toContain("Return to review");
    expect(document.body.textContent).not.toContain("The programme is over");
  });
});
