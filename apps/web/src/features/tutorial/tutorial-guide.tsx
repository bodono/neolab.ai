import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { GameView } from "../../runtime/index.ts";
import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";
import { tutorialStepForView } from "./tutorial-progress.ts";

type TutorialDestination = "models" | "evaluations" | "compute" | "people" | "facilities";

function visibleTarget(targetIds: readonly string[]): HTMLElement | undefined {
  for (const id of targetIds) {
    const candidates = document.querySelectorAll<HTMLElement>(
      `[data-tutorial-target="${id}"]`,
    );
    for (const candidate of candidates) {
      if (candidate.getClientRects().length > 0 && !candidate.hasAttribute("disabled")) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function TutorialGuide({
  view,
  onNavigate,
  onExit,
}: {
  readonly view: GameView;
  readonly onNavigate: (destination: TutorialDestination) => void;
  readonly onExit: () => void;
}): ReactElement {
  const [introductionOpen, setIntroductionOpen] = useState(true);
  const [completionAcknowledged, setCompletionAcknowledged] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const step = tutorialStepForView(view);

  const refreshSpotlight = useCallback((): void => {
    document
      .querySelectorAll<HTMLElement>(".tutorial-focus")
      .forEach((element) => element.classList.remove("tutorial-focus"));
    if (introductionOpen || completionAcknowledged) return;
    visibleTarget(step.targetIds)?.classList.add("tutorial-focus");
  }, [completionAcknowledged, introductionOpen, step.targetIds]);

  useEffect(() => {
    refreshSpotlight();
    const observer = new MutationObserver(refreshSpotlight);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document
        .querySelectorAll<HTMLElement>(".tutorial-focus")
        .forEach((element) => element.classList.remove("tutorial-focus"));
    };
  }, [refreshSpotlight]);

  const showNext = (): void => {
    if (step.destination !== undefined) onNavigate(step.destination);
    window.requestAnimationFrame(() => {
      const target = visibleTarget(step.targetIds);
      target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      target?.focus({ preventScroll: true });
      refreshSpotlight();
    });
  };

  return (
    <>
      {introductionOpen ? (
        <ModalFocusBoundary>
          <div className="modal-backdrop tutorial-intro-backdrop">
            <section
              className="tutorial-intro-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tutorial-intro-title"
            >
              <p className="eyebrow">GUIDED RUN // ABOUT 20 MINUTES</p>
              <h2 id="tutorial-intro-title">Welcome to Neolab.ai</h2>
              <p>
                This is a controlled version of the real game. Rival moves and unrelated
                events are held quiet while you learn the core operating loop.
              </p>
              <ol>
                <li>Buy the lab's first GPUs</li>
                <li>Train a model</li>
                <li>Evaluate its safety</li>
                <li>Prepare and launch it</li>
                <li>Allocate GPUs to serving</li>
                <li>Raise the lab's first funding round</li>
                <li>Build the Server Rack</li>
                <li>Recruit and assign a researcher</li>
              </ol>
              <p>
                The clock starts paused. Follow the objective card; use{" "}
                <strong>Show me</strong> whenever you lose the thread.
              </p>
              <button
                className="primary huge"
                type="button"
                autoFocus
                onClick={() => setIntroductionOpen(false)}
              >
                Begin tutorial
              </button>
            </section>
          </div>
        </ModalFocusBoundary>
      ) : null}

      {!introductionOpen && !completionAcknowledged ? (
        <aside
          className={`tutorial-guide${collapsed ? " tutorial-guide-collapsed" : ""}`}
          aria-live="polite"
        >
          <header>
            <div>
              <p className="eyebrow">
                TUTORIAL //{" "}
                {step.objective === "complete"
                  ? "COMPLETE"
                  : `OBJECTIVE ${String(step.ordinal)} OF 9`}
              </p>
              <strong className="tutorial-current-title">{step.title}</strong>
            </div>
            <button
              type="button"
              className="tutorial-collapse"
              aria-label={
                collapsed ? "Expand tutorial guidance" : "Collapse tutorial guidance"
              }
              onClick={() => setCollapsed((current) => !current)}
            >
              {collapsed ? "+" : "−"}
            </button>
          </header>
          {collapsed ? null : (
            <>
              <h2>{step.title}</h2>
              <p>{step.instruction}</p>
              <p className="tutorial-why">WHY THIS MATTERS // {step.why}</p>
              <div className="tutorial-guide-actions">
                {step.objective === "complete" ? (
                  <button
                    className="primary"
                    type="button"
                    onClick={() => setCompletionAcknowledged(true)}
                  >
                    Continue exploring
                  </button>
                ) : (
                  <button className="primary" type="button" onClick={showNext}>
                    Show me
                  </button>
                )}
                <button className="secondary" type="button" onClick={onExit}>
                  Save &amp; exit tutorial
                </button>
              </div>
            </>
          )}
        </aside>
      ) : null}
    </>
  );
}
