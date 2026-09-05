import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GameView } from "@neolab/sim/public";

import { MajorProjectsPanel } from "./major-projects-panel.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function project(
  projectId: string,
  kind: string,
  displayName: string,
): Record<string, unknown> {
  return {
    projectId,
    displayName,
    kind,
    status: "active",
    majorProjectSlotsReserved: 1,
    progressLabel: "3 of 12 weeks",
  };
}

function buildView(
  projects: readonly Record<string, unknown>[],
  recoveryMajorProjectSlots: 0 | 1 = 0,
): GameView {
  return {
    facilities: {
      capacity: {
        baseMajorProjectSlots: 2,
        facilityBonusMajorProjectSlots: 3,
        maximumMajorProjectSlots: 5,
        majorProjectSlots: 5,
        recoveryMajorProjectSlots,
        occupiedMajorProjectSlots: projects.length + recoveryMajorProjectSlots,
        availableMajorProjectSlots: Math.max(
          0,
          5 - projects.length - recoveryMajorProjectSlots,
        ),
      },
      projects,
      completed: [],
      catalogue: [],
    },
  } as unknown as GameView;
}

describe("the major projects panel under crisis surge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders plain slots with no surge cards inside the pool", () => {
    const view = buildView([
      project("p1", "construction", "Data Centre III"),
      project("p2", "training", "Aquarius 4"),
      project("p3", "crisis", "Independent replication"),
    ]);
    act(() => {
      root.render(<MajorProjectsPanel view={view} />);
    });
    expect(container.textContent).toContain("3/5 slots in use");
    expect(container.textContent).toContain("BASE SLOTS");
    expect(container.textContent).toContain("CURRENT CAPACITY");
    expect(container.textContent).not.toContain("These slots limit how many");
    expect(container.textContent).not.toContain("Review facility expansion");
    expect(container.textContent).not.toContain("crisis surge");
    expect(container.querySelectorAll(".major-project-slot-grid > article")).toHaveLength(
      5,
    );
    expect(
      container.querySelectorAll(".major-project-slot-grid > article.surge"),
    ).toHaveLength(0);
    // Crisis work is visibly striking even inside the pool.
    const crisisCards = container.querySelectorAll(
      ".major-project-slot-grid > article.crisis",
    );
    expect(crisisCards).toHaveLength(1);
    expect(crisisCards[0]?.textContent).toContain("CRISIS");
    expect(crisisCards[0]?.textContent).toContain("Independent replication");
  });

  it("renders overflow crisis work as explicit surge cards, never 7/5", () => {
    const view = buildView([
      project("p1", "construction", "Data Centre III"),
      project("p2", "construction", "Time Sphere"),
      project("p3", "training", "Aquarius 4"),
      project("p4", "productisation", "Aquarius 4 rollout"),
      project("p5", "fundraising", "Mega-round Roadshow"),
      project("c1", "crisis", "Independent replication"),
      project("c2", "crisis", "External evaluators"),
    ]);
    act(() => {
      root.render(<MajorProjectsPanel view={view} />);
    });
    expect(container.textContent).toContain("5/5 slots in use · +2 crisis surge");
    expect(container.textContent).not.toContain("7/5");
    const cards = container.querySelectorAll(".major-project-slot-grid > article");
    expect(cards).toHaveLength(7);
    const surgeCards = container.querySelectorAll(
      ".major-project-slot-grid > article.surge",
    );
    expect(surgeCards).toHaveLength(2);
    // Crisis work sits on the surge cards, so the overflow is the crisis.
    expect(surgeCards[0]?.textContent).toContain("SURGE 1");
    expect(surgeCards[0]?.textContent).toContain("CRISIS");
    expect(surgeCards[0]?.textContent).toContain("Independent replication");
    expect(surgeCards[1]?.textContent).toContain("External evaluators");
    // Surge cards carry the crisis styling too.
    expect(
      container.querySelectorAll(".major-project-slot-grid > article.crisis.surge"),
    ).toHaveLength(2);
  });

  it("shows the major-project slot reserved by retirement recovery", () => {
    const view = buildView([project("p1", "training", "Aquarius 4")], 1);
    act(() => {
      root.render(<MajorProjectsPanel view={view} />);
    });

    expect(container.textContent).toContain("2/5 slots in use");
    const recovery = container.querySelector(
      ".major-project-slot-grid > article.recovery",
    );
    expect(recovery?.textContent).toContain("RECOVERY");
    expect(recovery?.textContent).toContain("Post-retirement recovery");
    expect(recovery?.textContent).toContain(
      "Reserved until the recovery obligation is complete",
    );
  });

  it("labels a recovery reservation beyond current capacity as emergency overload", () => {
    const view = buildView(
      [
        project("p1", "training", "Aquarius 4"),
        project("p2", "construction", "Data Centre III"),
        project("p3", "evaluation", "Safety audit"),
        project("p4", "fundraising", "Roadshow"),
        project("p5", "productisation", "Release engineering"),
      ],
      1,
    );
    act(() => {
      root.render(<MajorProjectsPanel view={view} />);
    });

    expect(container.textContent).toContain("5/5 slots in use · +1 emergency overload");
    expect(container.textContent).not.toContain("+1 crisis surge");
    const recovery = container.querySelector(
      ".major-project-slot-grid > article.recovery.surge",
    );
    expect(recovery?.textContent).toContain("OVERFLOW 1");
    expect(recovery?.textContent).toContain("Post-retirement recovery");
  });
});
