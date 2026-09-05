import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnomalyInvestigationDialog } from "./models-workspace.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type DialogProps = ComponentProps<typeof AnomalyInvestigationDialog>;

describe("AnomalyInvestigationDialog results in Chromium", () => {
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

  it("presents a resolved warning as a complete evidence record", () => {
    const onResume = vi.fn();
    const runtime = {
      validate: () => ({ ok: true, errors: [] }),
      dispatch: vi.fn(),
    } as unknown as DialogProps["runtime"];
    const view = {
      meta: { tick: 24 },
      identity: { labId: "lab:player" },
    } as unknown as DialogProps["view"];
    const anomaly = {
      anomalyId: "anomaly:test",
      sourceEvaluationId: "evaluation:test",
      underlyingCase: "alignment",
      observationCount: 1,
      createdAtTick: 18,
      observedSeverity: 78.4,
      severityLabel: "Critical",
      status: "resolved",
      investigationAttempts: 1,
      actionQuote: {
        cashCostMillions: 50,
        auraCost: 12,
        durationWeeks: 6,
        majorProjectSlots: 1,
        mitigationControlBonus: 5,
        mitigationSecurityBonus: 5,
      },
    } as DialogProps["anomaly"];
    const model = {
      modelId: "model:test",
      displayName: "DeepSearch-3",
      evaluations: [
        { evaluationId: "evaluation:test", displayName: "Alignment interview" },
      ],
    } as unknown as DialogProps["model"];

    act(() =>
      root.render(
        <AnomalyInvestigationDialog
          anomaly={anomaly}
          model={model}
          onDecided={vi.fn()}
          onReviewEvidence={vi.fn()}
          onResume={onResume}
          runtime={runtime}
          view={view}
        />,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>(".anomaly-investigation-dialog");
    expect(dialog?.classList.contains("anomaly-status-resolved")).toBe(true);
    expect(dialog?.querySelector("h2")?.textContent).toBe("Follow-up complete");
    expect(dialog?.querySelector(".anomaly-result-badge")?.textContent).toBe(
      "False alarm",
    );
    expect(dialog?.querySelector(".anomaly-result-card")?.textContent).toContain(
      "Evaluation artefact identified",
    );
    expect(dialog?.textContent).toContain("DeepSearch-3");
    expect(dialog?.textContent).toContain("Alignment interview");
    expect(dialog?.textContent).toContain("Week 18");
    expect(dialog?.textContent).toContain("Critical · 78/100");
    expect(dialog?.textContent).toContain(
      "This false alarm is closed. It does not prove the model is safe.",
    );

    const continueButton = [
      ...dialog!.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.trim() === "Continue time");
    act(() => continueButton?.click());
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("keeps an inconclusive warning open and points to Eval Quality", () => {
    const dispatch = vi.fn();
    const runtime = {
      validate: () => ({ ok: true, errors: [] }),
      dispatch,
    } as unknown as DialogProps["runtime"];
    const view = {
      meta: { tick: 24 },
      identity: { labId: "lab:player" },
    } as unknown as DialogProps["view"];
    const anomaly = {
      anomalyId: "anomaly:test",
      sourceEvaluationId: "evaluation:test",
      underlyingCase: "alignment",
      observationCount: 1,
      createdAtTick: 18,
      observedSeverity: 64,
      severityLabel: "Serious",
      status: "inconclusive",
      investigationAttempts: 1,
      actionQuote: {
        cashCostMillions: 25,
        auraCost: 20,
        durationWeeks: 6,
        majorProjectSlots: 1,
        mitigationControlBonus: 4,
        mitigationSecurityBonus: 4,
      },
    } as DialogProps["anomaly"];
    const model = {
      modelId: "model:test",
      displayName: "DeepSearch-3",
      evaluations: [
        { evaluationId: "evaluation:test", displayName: "Interpretability audit" },
      ],
    } as unknown as DialogProps["model"];

    act(() =>
      root.render(
        <AnomalyInvestigationDialog
          anomaly={anomaly}
          model={model}
          onDecided={vi.fn()}
          onReviewEvidence={vi.fn()}
          onResume={vi.fn()}
          runtime={runtime}
          view={view}
        />,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>(".anomaly-investigation-dialog");
    expect(dialog?.classList.contains("anomaly-status-inconclusive")).toBe(true);
    expect(dialog?.querySelector("h2")?.textContent).toBe(
      "Evidence remains inconclusive",
    );
    expect(dialog?.querySelector(".anomaly-result-badge")?.textContent).toBe(
      "Inconclusive",
    );
    expect(dialog?.textContent).toContain("This warning remains open");
    expect(dialog?.textContent).toContain("Increase Eval Quality");
    expect(dialog?.textContent).toContain("Interpretability & Evals research");
    expect(dialog?.querySelector(".anomaly-retry-quote")?.textContent).toContain(
      "INVESTIGATE AGAIN // QUOTE",
    );
    expect(dialog?.querySelector(".anomaly-retry-quote")?.textContent).toContain("$25M");
    expect(dialog?.querySelector(".anomaly-retry-quote")?.textContent).toContain(
      "Aura20",
    );
    expect(dialog?.querySelector(".anomaly-retry-quote")?.textContent).toContain(
      "Duration6 weeks",
    );
    expect(dialog?.querySelector(".anomaly-retry-quote")?.textContent).toContain(
      "Major project1 slot while active",
    );
    expect(dialog?.textContent).not.toContain("proven safe");

    const retryButton = [...dialog!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Investigate again",
    );
    act(() => retryButton?.click());
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("keeps the legal anomaly response usable when investigation is blocked", () => {
    const dispatch = vi.fn();
    const onDecided = vi.fn();
    const runtime = {
      validate: vi.fn((command: { kind: string }) =>
        command.kind === "investigate-anomaly"
          ? {
              ok: false,
              errors: [{ code: "insufficient-aura", message: "Insufficient Aura" }],
            }
          : { ok: true, errors: [] },
      ),
      dispatch,
    } as unknown as DialogProps["runtime"];
    const view = {
      meta: { tick: 12 },
      identity: { labId: "lab:player" },
      facilities: { capacity: { availableMajorProjectSlots: 1 } },
    } as unknown as DialogProps["view"];
    const anomaly = {
      anomalyId: "anomaly:test",
      sourceEvaluationId: "evaluation:test",
      underlyingCase: "alignment",
      observationCount: 1,
      createdAtTick: 12,
      observedSeverity: 25,
      severityLabel: "Moderate",
      status: "unresolved",
      investigationAttempts: 0,
      actionQuote: {
        cashCostMillions: 10,
        auraCost: 12,
        durationWeeks: 4,
        majorProjectSlots: 1,
        mitigationControlBonus: 2,
        mitigationSecurityBonus: 2,
      },
    } as DialogProps["anomaly"];
    const model = {
      modelId: "model:test",
      displayName: "Aquarius-1",
      evaluations: [
        { evaluationId: "evaluation:test", displayName: "Baseline evaluation" },
      ],
    } as unknown as DialogProps["model"];

    act(() =>
      root.render(
        <AnomalyInvestigationDialog
          anomaly={anomaly}
          model={model}
          onDecided={onDecided}
          onReviewEvidence={vi.fn()}
          onResume={vi.fn()}
          runtime={runtime}
          view={view}
        />,
      ),
    );

    const buttons = [...mount.querySelectorAll<HTMLButtonElement>("button")];
    const investigateButton = buttons.find((button) =>
      button.textContent?.includes("investigation"),
    );
    const dismissButton = buttons.find(
      (button) => button.textContent?.trim() === "Dismiss warning",
    );
    expect(investigateButton?.disabled).toBe(true);
    expect(dismissButton?.disabled).toBe(false);
    expect(mount.textContent).toContain("Insufficient Aura");
    expect(mount.textContent).not.toContain("Cash scales with valuation");

    act(() => dismissButton?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "dismiss-anomaly" }),
    );
    expect(onDecided).toHaveBeenCalledOnce();
  });

  it("attaches an inconclusive retry blocker to its full quote", () => {
    const runtime = {
      validate: () => ({
        ok: false,
        errors: [{ code: "insufficient-aura", message: "Insufficient Aura" }],
      }),
      dispatch: vi.fn(),
    } as unknown as DialogProps["runtime"];
    const view = {
      meta: { tick: 30 },
      identity: { labId: "lab:player" },
    } as unknown as DialogProps["view"];
    const anomaly = {
      anomalyId: "anomaly:retry",
      sourceEvaluationId: "evaluation:retry",
      underlyingCase: "alignment",
      observationCount: 2,
      createdAtTick: 18,
      observedSeverity: 58,
      severityLabel: "Serious",
      status: "inconclusive",
      investigationAttempts: 1,
      actionQuote: {
        cashCostMillions: 25,
        auraCost: 20,
        durationWeeks: 6,
        majorProjectSlots: 1,
        mitigationControlBonus: 4,
        mitigationSecurityBonus: 4,
      },
    } as DialogProps["anomaly"];
    const model = {
      modelId: "model:retry",
      displayName: "Gronk-12",
      evaluations: [
        { evaluationId: "evaluation:retry", displayName: "Alignment Interview" },
      ],
    } as unknown as DialogProps["model"];

    act(() =>
      root.render(
        <AnomalyInvestigationDialog
          anomaly={anomaly}
          model={model}
          onDecided={vi.fn()}
          onReviewEvidence={vi.fn()}
          onResume={vi.fn()}
          runtime={runtime}
          view={view}
        />,
      ),
    );

    const dialog = mount.querySelector<HTMLElement>(".anomaly-investigation-dialog");
    expect(dialog?.querySelector(".anomaly-retry-quote")?.textContent).toContain("$25M");
    expect(dialog?.querySelector(".evaluation-blocker")?.textContent).toBe(
      "Investigate again unavailable: Insufficient Aura",
    );
    expect(
      [...dialog!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Investigate again",
      )?.disabled,
    ).toBe(true);
  });
});
