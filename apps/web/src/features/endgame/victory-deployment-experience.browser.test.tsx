import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameView } from "@neolab/sim/public";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { VictoryDeploymentExperience } from "./victory-deployment-experience.tsx";

vi.mock("../../audio/audio-control.tsx", () => ({ AudioControl: () => null }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function activeBase() {
  return {
    active: true,
    stage: "rollout",
    stageLabel: "EXECUTION · The route is live",
    crisisStartedAtTick: 80,
    weeksInCrisis: 24,
    candidate: {
      modelId: "model:aquarius-9",
      displayName: "Aquarius-9",
      accessLevel: 3,
      accessLabel: "Access 3 of 5",
    },
    capacity: { maximumProjects: 2, activeProjects: 0, availableProjects: 2 },
    clocks: [],
    commandRail: {
      deployNow: {
        available: true,
        confirmationPhrase: "DEPLOY Aquarius-9",
        blockers: [],
        warning: "Zero preparation weeks.",
      },
      retirement: {
        available: true,
        blockers: [],
        procedures: [],
        dispositions: [],
        quotes: [],
      },
    },
    maxClockSpeed: "paused",
  } as const;
}

function deploymentView(): GameView {
  return {
    meta: { tick: 104 },
    identity: { labId: "lab:player" },
    endgame: {
      ...activeBase(),
      clocks: [
        {
          kind: "rival",
          label: "Rival window",
          estimateRangeWeeks: [4, 9],
          estimateLabel: "4–9 weeks",
          urgency: "urgent",
          confidence: "medium",
        },
        {
          kind: "political",
          label: "Political window",
          estimateRangeWeeks: [12, 25],
          estimateLabel: "12–25 weeks",
          urgency: "watch",
          confidence: "low",
        },
        {
          kind: "financial",
          label: "Financial window",
          estimateRangeWeeks: [],
          estimateLabel: "Cashflow currently self-sustaining",
          urgency: "stable",
          confidence: "high",
        },
      ],
      stageActions: {
        kind: "rollout",
        deploymentModeName: "Guarded public demonstration",
        prosperityProgrammeName: "Medicine and biological discovery",
        prosperityReadiness: 84,
        currentBeat: "settlement",
        completedBeats: [
          "authorisation",
          "first-operation",
          "stress-collision",
          "demonstration",
          "settlement",
        ],
        elapsedWeeks: 12,
        remainingWeeks: 0,
        totalWeeks: 12,
        progressPercent: 100,
        awaitingDecision: true,
        options: [],
        gateResults: [
          {
            gate: "settlement",
            result: "durable-settlement",
            resolvedAtTick: 104,
            visibleFactors: [],
          },
        ],
      },
    },
  } as unknown as GameView;
}

function waitingView(revealedCount = 1): GameView {
  const allCallouts = [
    {
      id: "control",
      label: "CONTROL",
      result: "Human authority remains effective.",
      tone: "stable" as const,
    },
    {
      id: "capability",
      label: "CAPABILITY",
      result: "The system is a genuine superintelligence.",
      tone: "stable" as const,
    },
  ];
  return {
    meta: { tick: 104 },
    identity: { labId: "lab:player" },
    endgame: {
      ...activeBase(),
      stage: "world-waiting",
      stageLabel: "THE WORLD IS WAITING",
      stageActions: {
        kind: "world-waiting",
        title: "The world is waiting",
        transmittedAtTick: 104,
        revealedCallouts: allCallouts.slice(0, revealedCount),
        revealedCount,
        totalCalloutCount: 5,
        allCalloutsRevealed: revealedCount === 5,
      },
    },
  } as unknown as GameView;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.bind(input);
  if (setter === undefined) throw new Error("HTML input value setter unavailable");
  act(() => {
    setter(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("VictoryDeploymentExperience in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<main id='game'></main><div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("requires the exact typed deployment order after the prepared rollout", () => {
    const dispatch = vi.fn();
    const runtime = {
      dispatch,
      pause: vi.fn(),
      validate: vi.fn(() => ({ ok: true, preview: { summary: "ready" } })),
    } as unknown as BrowserGameRuntime;

    act(() =>
      root.render(
        <VictoryDeploymentExperience view={deploymentView()} runtime={runtime} />,
      ),
    );
    expect(document.body.textContent).toContain("The last decision is still yours");

    const open = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Open final deployment command",
    );
    act(() => open?.click());
    expect(document.body.textContent).toContain("Deploy Aquarius-9.");
    expect(document.body.textContent).not.toContain("Deploy the superintelligence.");
    expect(document.body.textContent).toContain("FINAL ORDER STATUS");
    expect(document.body.textContent).toContain("Clocks held for transmission");
    expect(document.body.textContent).toContain(
      "No incremental time, cash, or Aura cost",
    );
    expect(
      document.querySelectorAll(".victory-deployment-context dl > div"),
    ).toHaveLength(4);
    expect(document.body.textContent).toContain("Cashflow currently self-sustaining");

    const deploy = document.querySelector<HTMLButtonElement>(
      "[data-testid='deploy-superintelligence']",
    )!;
    expect(deploy.disabled).toBe(true);
    setInputValue(
      document.querySelector<HTMLInputElement>(".victory-command-input input")!,
      "DEPLOY Aquarius-9",
    );
    expect(deploy.disabled).toBe(false);
    act(() => deploy.click());

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "transmit-deployment",
        modelId: "model:aquarius-9",
        confirmationText: "DEPLOY Aquarius-9",
      }),
    );
  });

  it("renders only the revealed callout prefix and advances it mechanically", async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const runtime = {
      dispatch,
      pause: vi.fn(),
      validate: vi.fn(() => ({ ok: true, preview: { summary: "advance" } })),
    } as unknown as BrowserGameRuntime;

    act(() =>
      root.render(
        <VictoryDeploymentExperience view={waitingView(1)} runtime={runtime} />,
      ),
    );

    expect(document.body.textContent).toContain("Human authority remains effective");
    expect(document.body.textContent).not.toContain("genuine superintelligence");
    expect(document.body.textContent).not.toContain("selectedEndingId");

    await act(async () => vi.advanceTimersByTimeAsync(301));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "advance-world-waiting" }),
    );
  });
});
