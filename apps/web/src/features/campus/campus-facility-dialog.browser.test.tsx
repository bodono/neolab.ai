import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CampusView, GameView } from "@neolab/sim/public";

import { CampusFacilityDialog } from "./campus-facility-dialog.tsx";
import { CampusStrip } from "./campus-strip.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const building: CampusView["facilities"][number] = {
  facilityId: "run:facility:server-rack:0001",
  definitionId: "base:facility.server-rack",
  displayName: "Server Rack",
  family: "data-centre",
  tier: 1,
  campusModule: "data-centre-low-rise",
  operational: true,
  loadState: "active",
  loadBasisPoints: 5_000,
  loadLabel: "Operational",
  namedResearcherIds: [],
};

const campus: CampusView = {
  facilities: [building],
  construction: [],
  namedPeople: [],
  sceneCues: [],
  decorativeStaffCount: 0,
  overflowFacilityCount: 0,
};

const detail: GameView["facilities"]["catalogue"][number] = {
  definitionId: "base:facility.server-rack",
  displayName: "Server Rack",
  family: "data-centre",
  tier: 1,
  summary: "A converted storage room with one rack and a portable air conditioner.",
  cashCostMillions: 0,
  operatingCostMillionsPerCycle: 0.05,
  durationWeeks: 0,
  majorProjectSlotsRequired: 1,
  bonusMajorProjectSlots: 0,
  supportedOwnedGpuCount: 4_000,
  prerequisiteDisplayNames: [],
  unmetPrerequisiteDisplayNames: [],
  benefits: [
    {
      label: "Knowledge diffusion rate +0.25",
      tone: "positive",
      help: {
        label: "Knowledge diffusion",
        body: "Each colleague contributes relevant skill to other programmes.",
      },
    },
    { label: "Raises incident risk", tone: "tradeoff" },
  ],
  completed: true,
  building: false,
  available: false,
  upcoming: false,
  blockers: [],
};

describe("campus facility inspection in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<main id='dashboard'></main><div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("makes commissioned campus buildings inspectable", () => {
    const onInspectFacility = vi.fn();
    act(() =>
      root.render(
        <CampusStrip
          campus={campus}
          dateLabel="2013 · WEEK 1"
          onInspectFacility={onInspectFacility}
        />,
      ),
    );

    const trigger = mount.querySelector<HTMLButtonElement>(".campus-map-building");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger?.getAttribute("aria-label")).toBe("Inspect Server Rack · Operational");

    act(() => trigger?.click());
    expect(onInspectFacility).toHaveBeenCalledWith(building);
  });

  it("shows the canonical description and benefit ledger in a dismissible dialog", () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <CampusFacilityDialog
          building={building}
          detail={detail}
          completedAtTick={12}
          onClose={onClose}
        />,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Server Rack");
    expect(dialog?.textContent).toContain(detail.summary);
    expect(dialog?.textContent).toContain("Week 12");
    expect(dialog?.textContent).toContain("Knowledge diffusion rate +0.25");
    const help = dialog?.querySelector<HTMLDetailsElement>(".mechanic-help");
    expect(help?.querySelector("summary")?.getAttribute("aria-label")).toBe(
      "Explain Knowledge diffusion",
    );
    act(() => help?.querySelector<HTMLElement>("summary")?.click());
    expect(help?.open).toBe(true);
    expect(help?.querySelector('[role="note"]')?.textContent).toContain(
      "Each colleague contributes relevant skill to other programmes.",
    );
    expect(dialog?.querySelector(".tradeoff")?.textContent).toContain(
      "Raises incident risk",
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
