import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameView } from "@neolab/sim/public";
import "../../styles/game.css";
import { CandidateCustodyPanel } from "./models-workspace.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type CandidateCustody = GameView["models"]["candidateCustody"];

const custody = {
  usedContainment: 11,
  maximumContainment: 8,
  overloaded: true,
  overload: 3,
  artifacts: [
    {
      modelId: "model:aquarius-9",
      displayName: "Aquarius-9 Extended Verification and Deliberately Long Artifact Name",
      lineageLabel: "Independent training lineage",
      lifecycle: "active-hazard",
      lifecycleLabel: "Active hazard",
      custodyLabel: "Active weights · exposed",
      firstCrossingFrontierCapability: 92,
      firstCrossingPriorPercent: 20,
      currentFrontierCapability: 97,
      containmentLoad: 7,
      isolated: false,
      maximumAccessEver: 5,
      currentAccess: 3,
      unresolvedAnomalyCount: 2,
      dismissedAnomalyCount: 1,
      activeSignal: {
        incidentClass: "credential-access",
        kind: "active-incident",
        triggeredAtTick: 104,
      },
      legalActions: [
        "inspect",
        "evaluate",
        "isolate",
        "review-incident",
        "retire",
        "nominate",
      ],
      retirement: {
        confirmationPhrase:
          "RETIRE Aquarius-9 Extended Verification and Deliberately Long Artifact Name",
        procedures: [],
        dispositions: [],
        quotes: [],
      },
      incidentReview: {
        evaluationQuality: 84,
        practicalControl: 78,
        securityPosture: 92,
        preparedness: 86.2,
        requiredPreparedness: 70,
        cashCostMillions: 2_000,
        auraCost: 12,
        blockers: [],
      },
      superintelligenceTruth: "ONTIC-GENUINE",
    },
    {
      modelId: "model:aquarius-8",
      displayName: "Aquarius-8",
      lineageLabel: "Derived from Aquarius-7",
      lifecycle: "verified-isolated-archive",
      lifecycleLabel: "Verified isolated archive",
      custodyLabel: "Verified isolated archive",
      firstCrossingFrontierCapability: 89,
      firstCrossingPriorPercent: 1,
      currentFrontierCapability: 91,
      containmentLoad: 4,
      isolated: true,
      maximumAccessEver: 1,
      currentAccess: 0,
      unresolvedAnomalyCount: 0,
      dismissedAnomalyCount: 0,
      lastReviewedSignal: {
        incidentClass: "storage-controller-drift",
        outcome: "benign-operational-cause",
        triggeredAtTick: 101,
        resolvedAtTick: 102,
      },
      legalActions: ["inspect", "evaluate"],
      superintelligenceTruth: "ONTIC-NOT-GENUINE",
    },
  ],
} as unknown as CandidateCustody;

describe("CandidateCustodyPanel in Chromium", () => {
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

  it("renders grave custody state without exposing hidden lineage truth", () => {
    const onInspect = vi.fn();
    const onEvaluate = vi.fn();
    const onIsolate = vi.fn();
    const onNominate = vi.fn();
    const onResolveIncident = vi.fn();
    const onRetire = vi.fn();
    act(() =>
      root.render(
        <CandidateCustodyPanel
          custody={custody}
          formalProgrammeReady={true}
          onEvaluate={onEvaluate}
          onIsolate={onIsolate}
          onInspect={onInspect}
          onNominate={onNominate}
          onResolveIncident={onResolveIncident}
          onRetire={onRetire}
          selectedModelId="model:aquarius-9"
        />,
      ),
    );

    const panel = document.querySelector<HTMLElement>(".candidate-custody-panel")!;
    expect(panel.classList.contains("capacity-critical")).toBe(true);
    expect(panel.textContent).toContain("Capability-qualified artifacts");
    expect(panel.textContent).toContain("Qualified ≠ confirmed");
    expect(panel.textContent).toContain("Formal candidacy");
    expect(panel.textContent).toContain("OVER CAPACITY BY 3.0");
    expect(panel.textContent).not.toContain("ONTIC-GENUINE");
    expect(panel.textContent).not.toContain("ONTIC-NOT-GENUINE");

    expect(document.querySelectorAll(".candidate-custody-card")).toHaveLength(2);
    expect(
      document.querySelector(".candidate-custody-card.tone-critical"),
    ).not.toBeNull();
    expect(
      document.querySelector(".candidate-custody-card.tone-false-alarm"),
    ).not.toBeNull();
    expect(
      document.querySelectorAll(".candidate-custody-signal[role='alert']"),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(".candidate-custody-signal.reviewed[role='status']"),
    ).toHaveLength(1);
    expect(panel.textContent).toContain(
      "this resolves the signal, not the candidate's safety",
    );
    expect(panel.textContent).toContain("20% at FC 92");
    expect(panel.textContent).toContain(
      "The public chance fixed when this lineage first qualified",
    );
    expect(panel.textContent).toContain("Later capability does not redraw it");
    expect(panel.textContent).toContain("proof can still update the claim");
    expect(panel.textContent).toContain("Dismissed signals");
    expect(panel.textContent).toContain("DETERMINISTIC CONTAINMENT REVIEW");
    expect(panel.textContent).toContain("Preparedness 86.2 / 70.0");
    expect(panel.textContent).toContain("$2B · 12 Aura");
    const dismissedSignals = [...panel.querySelectorAll(".candidate-custody-facts div")]
      .find((fact) => fact.querySelector("dt")?.textContent === "Dismissed signals")
      ?.querySelector("dd")?.textContent;
    expect(dismissedSignals).toBe("1");

    const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button")];
    const inspect = buttons.find((button) => button.textContent === "Inspect artifact");
    const evaluate = buttons.find((button) => button.textContent === "Review evidence");
    const isolate = buttons.find((button) => button.textContent === "Emergency isolate");
    const retire = buttons.find(
      (button) => button.textContent === "Open RETIRE controls",
    );
    const resolveIncident = buttons.find(
      (button) => button.textContent === "Resolve containment signal",
    );
    const nominate = buttons.find(
      (button) => button.textContent === "Nominate exact artifact",
    );
    act(() => inspect?.click());
    act(() => evaluate?.click());
    act(() => isolate?.click());
    act(() => retire?.click());
    act(() => resolveIncident?.click());
    act(() => nominate?.click());
    expect(onInspect).toHaveBeenCalledWith("model:aquarius-9");
    expect(onEvaluate).toHaveBeenCalledWith("model:aquarius-9");
    expect(onIsolate).toHaveBeenCalledWith("model:aquarius-9");
    expect(onRetire).toHaveBeenCalledWith("model:aquarius-9");
    expect(onResolveIncident).toHaveBeenCalledWith("model:aquarius-9");
    expect(onNominate).toHaveBeenCalledWith("model:aquarius-9");
  });

  it("does not reserve empty space before any artifact qualifies", () => {
    act(() =>
      root.render(
        <CandidateCustodyPanel
          custody={{
            usedContainment: 0,
            maximumContainment: 8,
            overloaded: false,
            overload: 0,
            artifacts: [],
          }}
          formalProgrammeReady={false}
          onEvaluate={() => undefined}
          onIsolate={() => undefined}
          onInspect={() => undefined}
          onNominate={() => undefined}
          onResolveIncident={() => undefined}
          onRetire={() => undefined}
        />,
      ),
    );
    expect(mount.childElementCount).toBe(0);
  });

  it("never offers retirement again for a verified isolated archive", () => {
    const archivedArtifact = custody.artifacts[1];
    if (archivedArtifact === undefined) {
      throw new Error("Fixture lacks candidate artifacts");
    }
    const inconsistentArchivedView = {
      ...archivedArtifact,
      // Exercise defense in depth against a stale projection retained by an
      // already-open browser after the retirement transition.
      legalActions: [...archivedArtifact.legalActions, "retire"],
      retirement: {
        confirmationPhrase: "RETIRE Aquarius-8",
        procedures: [],
        dispositions: [],
        quotes: [],
      },
    } as CandidateCustody["artifacts"][number];
    const onRetire = vi.fn();
    act(() =>
      root.render(
        <CandidateCustodyPanel
          custody={{ ...custody, artifacts: [inconsistentArchivedView] }}
          formalProgrammeReady={true}
          onEvaluate={() => undefined}
          onIsolate={() => undefined}
          onInspect={() => undefined}
          onNominate={() => undefined}
          onResolveIncident={() => undefined}
          onRetire={onRetire}
        />,
      ),
    );

    expect(mount.textContent).toContain("Verified isolated archive");
    expect(mount.textContent).not.toContain("Open RETIRE controls");
    expect(onRetire).not.toHaveBeenCalled();
  });

  it("uses the full canvas for one artifact and keeps every action tactile", () => {
    const sourceArtifact = custody.artifacts[0];
    if (sourceArtifact === undefined) {
      throw new Error("Fixture lacks an artifact");
    }
    mount.style.width = "1200px";
    act(() =>
      root.render(
        <CandidateCustodyPanel
          custody={{ ...custody, artifacts: [sourceArtifact] }}
          formalProgrammeReady={true}
          onEvaluate={() => undefined}
          onIsolate={() => undefined}
          onInspect={() => undefined}
          onNominate={() => undefined}
          onResolveIncident={() => undefined}
          onRetire={() => undefined}
        />,
      ),
    );

    const grid = mount.querySelector<HTMLElement>(".candidate-custody-grid")!;
    const card = mount.querySelector<HTMLElement>(".candidate-custody-card")!;
    const prior = card.querySelector<HTMLElement>(".candidate-custody-prior")!;
    const facts = card.querySelector<HTMLElement>(".candidate-custody-facts")!;
    const reviewActions = card.querySelector<HTMLElement>(
      ".candidate-custody-review-actions",
    )!;
    const commandActions = card.querySelector<HTMLElement>(
      ".candidate-custody-command-actions",
    )!;
    const gridRect = grid.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const priorRect = prior.getBoundingClientRect();
    const factsRect = facts.getBoundingClientRect();
    const reviewRect = reviewActions.getBoundingClientRect();
    const commandRect = commandActions.getBoundingClientRect();

    expect(cardRect.width / gridRect.width).toBeGreaterThan(0.98);
    expect(getComputedStyle(card).gridColumnEnd).toBe("-1");
    if (window.innerWidth > 1040) {
      expect(priorRect.right).toBeLessThan(factsRect.left);
      expect(getComputedStyle(facts).gridTemplateColumns.split(" ")).toHaveLength(3);
      expect(Math.abs(reviewRect.top - commandRect.top)).toBeLessThan(4);
      expect(reviewRect.right).toBeLessThan(commandRect.right);
    } else {
      expect(priorRect.bottom).toBeLessThanOrEqual(factsRect.top);
    }

    for (const button of card.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    )) {
      const style = getComputedStyle(button);
      expect(style.minHeight).toBe("44px");
      expect(style.borderStyle).toBe("solid");
      expect(style.boxShadow).not.toBe("none");
      expect(style.transitionProperty).toContain("transform");
      expect(style.transitionProperty).toContain("box-shadow");
    }
  });

  it("chooses artifact columns from available panel width and spans an odd final card", () => {
    const secondArtifact = custody.artifacts[1];
    if (secondArtifact === undefined) {
      throw new Error("Fixture lacks a second artifact");
    }
    const renderArtifacts = (artifacts: CandidateCustody["artifacts"]): void => {
      act(() =>
        root.render(
          <CandidateCustodyPanel
            custody={{ ...custody, artifacts }}
            formalProgrammeReady={true}
            onEvaluate={() => undefined}
            onIsolate={() => undefined}
            onInspect={() => undefined}
            onNominate={() => undefined}
            onResolveIncident={() => undefined}
            onRetire={() => undefined}
          />,
        ),
      );
    };

    mount.style.width = "1000px";
    renderArtifacts(custody.artifacts);
    let cards = [...mount.querySelectorAll<HTMLElement>(".candidate-custody-card")];
    let firstRect = cards[0]!.getBoundingClientRect();
    let secondRect = cards[1]!.getBoundingClientRect();
    expect(Math.abs(firstRect.left - secondRect.left)).toBeLessThan(1);
    expect(secondRect.top).toBeGreaterThan(firstRect.bottom);

    mount.style.width = "1200px";
    cards = [...mount.querySelectorAll<HTMLElement>(".candidate-custody-card")];
    firstRect = cards[0]!.getBoundingClientRect();
    secondRect = cards[1]!.getBoundingClientRect();
    expect(Math.abs(firstRect.top - secondRect.top)).toBeLessThan(1);
    expect(secondRect.left).toBeGreaterThan(firstRect.right);
    expect(firstRect.width).toBeGreaterThanOrEqual(560);
    expect(secondRect.width).toBeGreaterThanOrEqual(560);

    const thirdArtifact = {
      ...secondArtifact,
      modelId: "model:aquarius-7-variant",
      displayName: "Aquarius-7 Variant",
    } as typeof secondArtifact;
    renderArtifacts([...custody.artifacts, thirdArtifact]);
    const threeCardGrid = mount.querySelector<HTMLElement>(".candidate-custody-grid")!;
    cards = [...mount.querySelectorAll<HTMLElement>(".candidate-custody-card")];
    firstRect = cards[0]!.getBoundingClientRect();
    secondRect = cards[1]!.getBoundingClientRect();
    const thirdRect = cards[2]!.getBoundingClientRect();
    expect(Math.abs(firstRect.top - secondRect.top)).toBeLessThan(1);
    expect(thirdRect.top).toBeGreaterThan(firstRect.bottom);
    expect(thirdRect.width / threeCardGrid.getBoundingClientRect().width).toBeGreaterThan(
      0.98,
    );
  });

  it("discloses why an incident review is unavailable without offering a reroll", () => {
    const sourceArtifact = custody.artifacts[0];
    if (sourceArtifact === undefined || sourceArtifact.incidentReview === undefined) {
      throw new Error("Fixture lacks an incident review");
    }
    const blockedArtifact = {
      ...sourceArtifact,
      legalActions: sourceArtifact.legalActions.filter(
        (action) => action !== "review-incident",
      ),
      incidentReview: {
        ...sourceArtifact.incidentReview,
        preparedness: 52.4,
        blockers: ["Requires containment-review preparedness 70; current 52.4"],
      },
    };
    const onResolveIncident = vi.fn();
    act(() =>
      root.render(
        <CandidateCustodyPanel
          custody={{ ...custody, artifacts: [blockedArtifact] }}
          formalProgrammeReady={true}
          onEvaluate={() => undefined}
          onIsolate={() => undefined}
          onInspect={() => undefined}
          onNominate={() => undefined}
          onResolveIncident={onResolveIncident}
          onRetire={() => undefined}
        />,
      ),
    );
    expect(mount.textContent).toContain(
      "Requires containment-review preparedness 70; current 52.4",
    );
    const review = [...mount.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Resolve containment signal",
    );
    expect(review?.disabled).toBe(true);
    act(() => review?.click());
    expect(onResolveIncident).not.toHaveBeenCalled();
  });
});
