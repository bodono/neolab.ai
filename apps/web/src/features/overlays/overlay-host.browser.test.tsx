import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameView } from "@neolab/sim/public";

import type { BrowserGameRuntime } from "../../runtime/index.ts";
import "../../styles/game.css";
import { OverlayHost } from "./overlay-host.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function completionView(
  isPlayerModel: boolean,
  productisationUnlocked = true,
  comparison?:
    | number
    | {
        readonly kind: "higher-tier" | "lower-tier";
        readonly previousTierLevel: number;
        readonly tierDelta: number;
        readonly frontierCapabilityDelta: number;
      },
): GameView {
  return {
    meta: {
      labMaturity: {
        features: productisationUnlocked ? ["productisation"] : ["compute", "models"],
      },
    },
    eventQueue: { items: [] },
    presentationQueue: [
      {
        key: "capability-tier:model:aquarius-7:7",
        kind: "capability-tier",
        attention: "modal",
        definitionId: "base:capability-tier.7",
        modelId: "model:aquarius-7",
        createdAtTick: 42,
        title: "Frontier intelligence",
        summary: "A new capability tier has been measured.",
        tierLevel: 7,
        modelDisplayName: "Aquarius-7",
        ownerLabId: isPlayerModel ? "lab:player" : "lab:rival",
        ownerLabName: isPlayerModel ? "DeepBrain" : "xMind",
        ownerAiName: "Aquarius",
        isPlayerModel,
        unlockLabels: isPlayerModel ? ["Benchmark Experiments"] : [],
        ...(comparison === undefined
          ? {}
          : {
              previousModelComparison: {
                kind:
                  typeof comparison === "number"
                    ? ("same-tier" as const)
                    : comparison.kind,
                previousModelDisplayName: "DeepSearch-1",
                previousTierLevel:
                  typeof comparison === "number" ? 2 : comparison.previousTierLevel,
                tierDelta: typeof comparison === "number" ? 0 : comparison.tierDelta,
                frontierCapabilityDelta:
                  typeof comparison === "number"
                    ? comparison
                    : comparison.frontierCapabilityDelta,
              },
            }),
      },
    ],
    world: { rivals: [] },
  } as unknown as GameView;
}

describe("OverlayHost training completion actions", () => {
  let root: Root;
  let mount: HTMLDivElement;
  const runtime = { pause: vi.fn() } as unknown as BrowserGameRuntime;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("offers the completed player model as a direct productisation target", () => {
    const onProductisePresentation = vi.fn();
    act(() =>
      root.render(
        <OverlayHost
          view={completionView(true)}
          runtime={runtime}
          deferredEventIds={new Set()}
          requestedEventId={undefined}
          exclusiveSequenceActive={false}
          userOverlay={undefined}
          onAcknowledgePresentation={vi.fn()}
          onDeferEvent={vi.fn()}
          onCloseRequestedEvent={vi.fn()}
          onEventResolved={vi.fn()}
          onResolveEndgameReturn={vi.fn()}
          onInspectPresentation={vi.fn()}
          onProductisePresentation={onProductisePresentation}
        />,
      ),
    );

    const buttons = [...mount.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Configure launch",
      "Inspect Aquarius-7",
      "Continue",
    ]);
    const productise = buttons[0];
    expect(productise?.classList).toContain("primary");
    expect(mount.textContent).toContain("UNLOCKED");
    expect(mount.textContent).toContain("Benchmark Experiments");
    expect(mount.textContent).not.toContain("Why this appeared");
    expect(mount.textContent).not.toContain("What this does not mean");
    act(() => productise?.click());
    expect(onProductisePresentation).toHaveBeenCalledWith(
      "capability-tier:model:aquarius-7:7",
    );
  });

  it("does not offer productisation for a rival model", () => {
    act(() =>
      root.render(
        <OverlayHost
          view={completionView(false)}
          runtime={runtime}
          deferredEventIds={new Set()}
          requestedEventId={undefined}
          exclusiveSequenceActive={false}
          userOverlay={undefined}
          onAcknowledgePresentation={vi.fn()}
          onDeferEvent={vi.fn()}
          onCloseRequestedEvent={vi.fn()}
          onEventResolved={vi.fn()}
          onResolveEndgameReturn={vi.fn()}
          onInspectPresentation={vi.fn()}
          onProductisePresentation={vi.fn()}
        />,
      ),
    );

    expect(mount.textContent).not.toContain("Configure launch");
  });

  it("does not offer productisation before the Product chapter unlocks it", () => {
    const onProductisePresentation = vi.fn();
    act(() =>
      root.render(
        <OverlayHost
          view={completionView(true, false)}
          runtime={runtime}
          deferredEventIds={new Set()}
          requestedEventId={undefined}
          exclusiveSequenceActive={false}
          userOverlay={undefined}
          onAcknowledgePresentation={vi.fn()}
          onDeferEvent={vi.fn()}
          onCloseRequestedEvent={vi.fn()}
          onEventResolved={vi.fn()}
          onResolveEndgameReturn={vi.fn()}
          onInspectPresentation={vi.fn()}
          onProductisePresentation={onProductisePresentation}
        />,
      ),
    );

    const buttons = [...mount.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Inspect Aquarius-7",
      "Continue",
    ]);
    expect(buttons[0]?.classList).toContain("primary");
    expect(onProductisePresentation).not.toHaveBeenCalled();
  });

  it("describes a same-tier capability gain without calling it a match", () => {
    act(() =>
      root.render(
        <OverlayHost
          view={completionView(true, true, 5.3)}
          runtime={runtime}
          deferredEventIds={new Set()}
          requestedEventId={undefined}
          exclusiveSequenceActive={false}
          userOverlay={undefined}
          onAcknowledgePresentation={vi.fn()}
          onDeferEvent={vi.fn()}
          onCloseRequestedEvent={vi.fn()}
          onEventResolved={vi.fn()}
          onResolveEndgameReturn={vi.fn()}
          onInspectPresentation={vi.fn()}
          onProductisePresentation={vi.fn()}
        />,
      ),
    );

    expect(mount.textContent).toContain("SAME CAPABILITY TIER");
    expect(mount.textContent).toContain("5.3 FC above DeepSearch-1.");
    expect(mount.textContent).not.toContain("Matched DeepSearch-1");
  });

  it("shows both tier and FC gains for a new lab best", () => {
    act(() =>
      root.render(
        <OverlayHost
          view={completionView(true, true, {
            kind: "higher-tier",
            previousTierLevel: 1,
            tierDelta: 1,
            frontierCapabilityDelta: 5.3,
          })}
          runtime={runtime}
          deferredEventIds={new Set()}
          requestedEventId={undefined}
          exclusiveSequenceActive={false}
          userOverlay={undefined}
          onAcknowledgePresentation={vi.fn()}
          onDeferEvent={vi.fn()}
          onCloseRequestedEvent={vi.fn()}
          onEventResolved={vi.fn()}
          onResolveEndgameReturn={vi.fn()}
          onInspectPresentation={vi.fn()}
          onProductisePresentation={vi.fn()}
        />,
      ),
    );

    expect(mount.textContent).toContain("NEW LAB BEST");
    expect(mount.textContent).toContain("+1 tier · +5.3 FC vs DeepSearch-1.");
  });
});
