import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameView } from "@neolab/sim/public";

import { AmbientActivityWire } from "./ambient-activity-wire.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function ambientView(
  tick: number,
  notes: readonly { readonly tick: number; readonly summary: string }[],
): GameView {
  return {
    meta: { tick },
    decisionLog: notes.map((note) => ({ ...note, category: "ambient" })),
  } as unknown as GameView;
}

describe("ambient activity wire", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
    vi.useRealTimers();
  });

  it("keeps a note readable while 4x-speed ticks generate newer notes", () => {
    act(() => {
      root.render(
        <AmbientActivityWire
          view={ambientView(5, [{ tick: 5, summary: "First note" }])}
          suppressed={false}
        />,
      );
    });
    expect(mount.textContent).toContain("First note");

    act(() => {
      root.render(
        <AmbientActivityWire
          view={ambientView(12, [
            { tick: 5, summary: "First note" },
            { tick: 12, summary: "Newer note" },
          ])}
          suppressed={false}
        />,
      );
    });
    expect(mount.textContent).toContain("First note");
    expect(mount.textContent).not.toContain("Newer note");

    void act(() => vi.advanceTimersByTime(11_999));
    expect(mount.textContent).toContain("First note");

    void act(() => vi.advanceTimersByTime(1));
    expect(mount.textContent).toContain("Newer note");
  });
});
