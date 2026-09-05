import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";
import { seed128, type GameView, type NewGameConfig } from "@neolab/sim/public";

import { acceptFundingOfferCommand } from "../../app/command-builders.ts";
import type { AnimationFrameScheduler } from "../../runtime/index.ts";
import { BrowserGameRuntime } from "../../runtime/index.ts";
import { FundraisingDialog } from "./fundraising-dialog.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const content = loadBrowserCompiledContent();
const inertScheduler: AnimationFrameScheduler = {
  now: () => 0,
  requestFrame: () => 1,
  cancelFrame: () => undefined,
};

function firstId<T>(record: Readonly<Record<string, T>>): string {
  const id = Object.keys(record)[0];
  if (id === undefined) throw new Error("Required content is missing");
  return id;
}

function config(): NewGameConfig {
  return {
    seed: seed128("0123456789abcdef0123456789abcdef"),
    difficultyId: firstId(content.difficulties) as NewGameConfig["difficultyId"],
    leaderId: firstId(content.leaders) as NewGameConfig["leaderId"],
    mandateId: firstId(content.mandates) as NewGameConfig["mandateId"],
  };
}

function viewWithOffer(base: GameView): GameView {
  return {
    ...base,
    fundraising: {
      ...base.fundraising,
      offers: [
        {
          offerId: "offer:test",
          campaign: "quiet-bridge",
          investorStyle: "patient-capital",
          dilutionFlavor: "ordinary-equity",
          cashMillions: 12,
          expiresAtTick: base.meta.tick + 4,
          expiresInWeeks: 4,
          status: "available",
          impliedMarkMillions: 60,
          conditions: [],
        },
      ],
    },
  };
}

describe("fundraising offer acceptance in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;
  let runtime: BrowserGameRuntime;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
    runtime = BrowserGameRuntime.createNew(config(), content, {
      scheduler: inertScheduler,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    runtime.dispose();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("closes the fundraising window after accepting an offer", () => {
    const view = viewWithOffer(runtime.getSnapshot().gameView);
    const command = acceptFundingOfferCommand(view, "offer:test");
    const onClose = vi.fn();
    vi.spyOn(runtime, "validate").mockReturnValue({
      ok: true,
      preview: {
        summary: "Accept test offer",
        takesEffectAtTick: command.meta.expectedTick,
      },
    });
    const dispatch = vi.spyOn(runtime, "dispatch").mockReturnValue({
      tick: view.meta.tick,
      description: "accepted funding offer",
      domainEvents: [],
      autoPauseReasons: [],
      autosaveTriggers: [],
    });

    act(() =>
      root.render(<FundraisingDialog runtime={runtime} view={view} onClose={onClose} />),
    );
    act(() =>
      mount
        .querySelector<HTMLButtonElement>("[data-testid='accept-funding-offer']")
        ?.click(),
    );

    expect(dispatch).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the window open if acceptance faults", () => {
    const view = viewWithOffer(runtime.getSnapshot().gameView);
    const command = acceptFundingOfferCommand(view, "offer:test");
    const onClose = vi.fn();
    vi.spyOn(runtime, "validate").mockReturnValue({
      ok: true,
      preview: {
        summary: "Accept test offer",
        takesEffectAtTick: command.meta.expectedTick,
      },
    });
    vi.spyOn(runtime, "dispatch").mockReturnValue({
      tick: view.meta.tick,
      description: "acceptance fault",
      domainEvents: [],
      autoPauseReasons: [],
      autosaveTriggers: [],
      fault: {
        faultId: "runtime-fault:test",
        kind: "simulation",
        scope: "command-transition",
        code: "simulation-transition-failed",
        tick: view.meta.tick,
      },
    });

    act(() =>
      root.render(<FundraisingDialog runtime={runtime} view={view} onClose={onClose} />),
    );
    act(() =>
      mount
        .querySelector<HTMLButtonElement>("[data-testid='accept-funding-offer']")
        ?.click(),
    );

    expect(onClose).not.toHaveBeenCalled();
  });
});
