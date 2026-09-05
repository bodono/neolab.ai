import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CandidateContainmentIncidentPresentationQueueItemView,
  ModelIncidentPresentationQueueItemView,
} from "@neolab/sim/public";

import "../../styles/game.css";
import {
  CandidateContainmentIncidentAlertDialog,
  ModelIncidentAlertDialog,
} from "./incident-alert-dialog.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ordinary: ModelIncidentPresentationQueueItemView = {
  key: "model-incident-result:test",
  kind: "model-incident-result",
  attention: "modal",
  modelId: "model:test",
  modelDisplayName: "Aquarius-6",
  createdAtTick: 120,
  category: "critical",
  severity: 79,
  contained: false,
  threatLabel: "COORDINATED CYBER ATTACK",
  headline: "The model probed critical infrastructure.",
  auraLoss: 18,
  fineMillions: 42,
  governmentTrustLost: 15,
  governmentAttentionAdded: 20,
  hardwareGpusDestroyed: 0,
  researchOutputReductionPercent: 4,
};

const candidate: CandidateContainmentIncidentPresentationQueueItemView = {
  key: "candidate-containment-incident:test",
  kind: "candidate-containment-incident",
  attention: "modal",
  modelId: "model:candidate",
  modelDisplayName: "Aquarius-7",
  incidentId: "candidate-incident:test",
  incidentClass: "local-containment-breach",
  incidentKind: "active-incident",
  origin: "weekly-pressure",
  createdAtTick: 140,
  classLabel: "CONTAINMENT BREACH",
  headline: "The candidate crossed a local containment boundary.",
  consequence: "Control and security have been damaged.",
  localBreach: true,
};

describe("incident alarm dialogs", () => {
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

  it("renders an ordinary incident as a severity-specific red alarm", () => {
    const acknowledge = vi.fn();
    const review = vi.fn();
    act(() =>
      root.render(
        <ModelIncidentAlertDialog
          item={ordinary}
          onAcknowledge={acknowledge}
          onReview={review}
        />,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>("[role='alertdialog']")!;
    expect(dialog.classList).toContain("severity-critical");
    expect(dialog.textContent).toContain("COORDINATED CYBER ATTACK");
    expect(dialog.textContent).toContain("WARNING: Aquarius-6 caused an incident.");
    expect(dialog.textContent).toContain("−18 Aura");
    expect(dialog.textContent).toContain("$42M regulatory fine");
    expect(dialog.textContent).toContain("−15 Government trust");
    expect(dialog.textContent).toContain("+20 Government attention");
    expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(13, 9, 9)");
    expect(getComputedStyle(dialog).boxShadow).not.toBe("none");

    const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
    act(() => buttons[1]?.click());
    expect(review).toHaveBeenCalledOnce();
  });

  it("names hardware destroyed by a successful emergency shutdown", () => {
    act(() =>
      root.render(
        <ModelIncidentAlertDialog
          item={{
            ...ordinary,
            contained: true,
            threatLabel: "EMERGENCY SHUTDOWN HELD",
            headline: "Physical breakers contained the model.",
            hardwareGpusDestroyed: 412_000,
          }}
          onAcknowledge={vi.fn()}
          onReview={vi.fn()}
        />,
      ),
    );

    expect(mount.textContent).toContain("412,000 installed GPUs destroyed");
  });

  it("renders a candidate breach as a critical custody alarm", () => {
    act(() =>
      root.render(
        <CandidateContainmentIncidentAlertDialog
          item={candidate}
          onAcknowledge={vi.fn()}
          onReview={vi.fn()}
        />,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>("[role='alertdialog']")!;
    expect(dialog.classList).toContain("local-breach");
    expect(dialog.textContent).toContain("CONTAINMENT ALERT: Aquarius-7");
    expect(dialog.textContent).toContain("CANDIDACY HALTED");
    expect(dialog.textContent).toContain("Control and security systems were damaged");
    expect(dialog.querySelector(".incident-alarm-mark")).not.toBeNull();
  });
});
