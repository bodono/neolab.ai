import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameView } from "@neolab/sim/public";

import { ActivityNoticeLane } from "./activity-notice-lane.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function rivalProjectView(): GameView {
  return {
    meta: { tick: 12 },
    people: { roster: [] },
    presentationQueue: [],
    world: {
      componentAnnouncements: [
        {
          labId: "lab:rival:humanic",
          labName: "Humanic",
          componentType: "project-panopticon",
          componentName: "Project Panopticon",
          kind: "completed",
          tick: 12,
        },
      ],
    },
  } as unknown as GameView;
}

describe("ActivityNoticeLane", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
  });

  it("shows rival AGI project updates as a side notice", () => {
    const onInspectRival = vi.fn();
    act(() => {
      root.render(
        <ActivityNoticeLane
          view={rivalProjectView()}
          suppressed={false}
          onAcknowledgePresentation={vi.fn()}
          onInspectRival={onInspectRival}
          onInspectResearcher={vi.fn()}
        />,
      );
    });

    const notice = mount.querySelector<HTMLElement>(".rival-component-update")!;
    expect(notice).not.toBeNull();
    expect(mount.querySelector("[role='dialog']")).toBeNull();
    expect(notice.textContent).toContain("RIVAL AGI PROGRAMME");
    expect(notice.textContent).toContain("Humanic completed Project Panopticon");

    const openButton = [...notice.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Open rival intelligence"),
    );
    act(() => openButton?.click());
    expect(onInspectRival).toHaveBeenCalledWith("lab:rival:humanic");
  });
});
