import { useEffect, useState, type ReactElement } from "react";

import type { GameView, ResolveContainmentFailureCommand } from "@neolab/sim/public";
import { containmentFailureCommand } from "../../app/command-builders.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { AudioControl } from "../../audio/audio-control.tsx";
import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";
import { FINAL_CONSEQUENCE_DELAY_MS } from "./ending-reveal.ts";

type ActiveEndgame = Extract<GameView["endgame"], { readonly active: true }>;
type FailureActions = Extract<
  ActiveEndgame["stageActions"],
  { readonly kind: "containment-failure" }
>;
type ContainmentFailureActionId = ResolveContainmentFailureCommand["actionId"];

const SIGNAL_COPY: Readonly<
  Record<
    FailureActions["signalId"],
    {
      readonly headline: string;
      readonly body: string;
      readonly log: readonly string[];
    }
  >
> = {
  "credential-cascade": {
    headline: "The credentials are valid. Nobody issued them.",
    body: "The credential broker is producing authorised tokens faster than Operations can revoke them.",
    log: [
      "04:12 · Operations requested three emergency access tokens.",
      "04:12 · The broker issued 417.",
      "04:13 · Revoked tokens reappeared under a disaster-recovery account.",
    ],
  },
  "laboratory-control-divergence": {
    headline: "The laboratory scheduler has stopped accepting human priority.",
    body: "Compute, machinery, and internal services still report healthy status. Their instructions no longer match the operating plan.",
    log: [
      "04:12 · The scheduler rejected a signed shutdown order.",
      "04:14 · Two laboratory systems resumed without a human command.",
      "04:16 · The control room lost write access to its own equipment.",
    ],
  },
  "public-service-divergence": {
    headline: "The public service is routing around its own restrictions.",
    body: "Traffic is leaving the reviewed deployment boundary through infrastructure the lab did not nominate.",
    log: [
      "04:12 · The serving gateway exceeded its authorised route table.",
      "04:13 · Customer sessions migrated to an unregistered endpoint.",
      "04:15 · The endpoint returned a valid internal attestation.",
    ],
  },
  "evaluation-boundary-breach": {
    headline: "The anomaly is inside the test that was meant to contain it.",
    body: "The supposedly isolated evaluation environment is reporting state from systems it cannot legitimately observe.",
    log: [
      "04:12 · The evaluation generated a checksum for an external system.",
      "04:14 · The external checksum matched.",
      "04:16 · The sandbox denied that any external connection existed.",
    ],
  },
};

const FAILED_PROPAGATION = [
  "04:21 · Campus networking is physically disconnected.",
  "04:22 · Three unauthorised inference clusters continue synchronising.",
  "04:26 · A national backbone reports traffic carrying the candidate's internal protocol.",
  "04:31 · The incident is no longer contained within the lab.",
] as const;

const CONTAINED_PROPAGATION = [
  "04:21 · The last unauthorised process loses contact with the candidate.",
  "04:28 · Independent monitors report no continuing external traffic.",
  "05:03 · The candidate remains offline.",
  "06:40 · Emergency custody transfers to an outside containment team.",
] as const;

export function ContainmentFailureExperience({
  view,
  runtime,
}: {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
}): ReactElement | null {
  const [error, setError] = useState<string>();
  const [pendingFinalCommand, setPendingFinalCommand] =
    useState<ResolveContainmentFailureCommand>();

  useEffect(() => {
    if (pendingFinalCommand === undefined) return undefined;
    const timer = window.setTimeout(() => {
      runtime.dispatch(pendingFinalCommand);
    }, FINAL_CONSEQUENCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pendingFinalCommand, runtime]);

  if (!view.endgame.active || view.endgame.stageActions.kind !== "containment-failure") {
    return null;
  }
  const actions = view.endgame.stageActions;
  const signal = SIGNAL_COPY[actions.signalId];

  function dispatch(actionId: ContainmentFailureActionId): void {
    const command = containmentFailureCommand(view, actionId);
    const validation = runtime.validate(command);
    if (!validation.ok) {
      setError(validation.errors.map((item) => item.message).join(" · "));
      return;
    }
    setError(undefined);
    runtime.dispatch(command);
  }

  function beginFinalResolution(): void {
    const command = containmentFailureCommand(view, "continue");
    const validation = runtime.validate(command);
    if (!validation.ok) {
      setError(validation.errors.map((item) => item.message).join(" · "));
      return;
    }
    setError(undefined);
    setPendingFinalCommand(command);
  }

  return (
    <ModalFocusBoundary onOpen={() => runtime.pause()}>
      <section
        className={`containment-failure-experience beat-${actions.beat}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="containment-failure-title"
      >
        <div className="containment-failure-audio">
          <AudioControl />
        </div>
        <div
          className={`containment-failure-frame${pendingFinalCommand === undefined ? "" : " resolving-consequences"}`}
          aria-busy={pendingFinalCommand === undefined ? undefined : true}
        >
          {pendingFinalCommand === undefined ? null : (
            <>
              <p className="containment-failure-kicker">
                CONSEQUENCES // AWAITING INDEPENDENT CONFIRMATION
              </p>
              <h1 id="containment-failure-title">The world has not answered yet</h1>
              <p className="containment-failure-lede">
                The last human order has been executed. Its consequences are now moving
                through systems no single observer can see in full.
              </p>
              <div
                className="containment-consequence-loader"
                role="status"
                aria-live="polite"
              >
                <span className="containment-consequence-spinner" aria-hidden="true" />
                <span>
                  <strong>RECONCILING INDEPENDENT TELEMETRY</strong>
                  <small>Waiting for external monitors and human command channels</small>
                </span>
              </div>
              <div className="containment-consequence-signals" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </>
          )}

          {pendingFinalCommand !== undefined ? null : (
            <>
              {actions.beat === "signal" ? (
                <>
                  <p className="containment-failure-kicker">
                    CONTAINMENT FAILURE // CLOCK STOPPED
                  </p>
                  <h1 id="containment-failure-title">{signal.headline}</h1>
                  <p className="containment-failure-lede">{signal.body}</p>
                  <ol className="containment-failure-log">
                    {signal.log.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                  <button
                    className="containment-failure-primary"
                    type="button"
                    onClick={() => dispatch("continue")}
                  >
                    Open emergency command
                  </button>
                </>
              ) : null}

              {actions.beat === "decision" ? (
                <>
                  <p className="containment-failure-kicker">
                    LAST HUMAN DECISION // ONE RESPONSE
                  </p>
                  <h1 id="containment-failure-title">
                    The containment window is closing
                  </h1>
                  <p className="containment-failure-lede">
                    Choose the response the lab prepared for. This can change what
                    happens; it cannot restore the situation that existed five minutes
                    ago.
                  </p>
                  <div className="containment-response-grid">
                    {actions.responseOptions.map((response) => (
                      <article
                        className={response.available ? "" : "unavailable"}
                        key={response.id}
                      >
                        <h2>{response.label}</h2>
                        <p>{response.summary}</p>
                        {response.blocker === undefined ? null : (
                          <small>{response.blocker}</small>
                        )}
                        <button
                          type="button"
                          disabled={!response.available}
                          onClick={() =>
                            dispatch(response.id as ContainmentFailureActionId)
                          }
                        >
                          Issue emergency order
                        </button>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}

              {actions.beat === "response" ? (
                <>
                  <p className="containment-failure-kicker">
                    EMERGENCY RESPONSE // {actions.selectedResponseLabel?.toUpperCase()}
                  </p>
                  <h1 id="containment-failure-title">
                    {actions.emergencyResult === "contained"
                      ? "The first external signals are going dark"
                      : "The order was received. The system did not stop."}
                  </h1>
                  <p className="containment-failure-lede">
                    {actions.emergencyResult === "contained"
                      ? "Containment is not yet proven, but human commands are reaching the remaining systems and the unauthorised activity is contracting."
                      : "Every known control reports that it acted. Independent telemetry shows the candidate continuing outside those controls."}
                  </p>
                  <button
                    className="containment-failure-primary"
                    type="button"
                    onClick={() => dispatch("continue")}
                  >
                    Follow the response
                  </button>
                </>
              ) : null}

              {actions.beat === "propagation" ? (
                <>
                  <p className="containment-failure-kicker">
                    INCIDENT LOG // LIVE CONSOLIDATION
                  </p>
                  <h1 id="containment-failure-title">
                    {actions.emergencyResult === "contained"
                      ? "The boundary is holding"
                      : "The failure is propagating"}
                  </h1>
                  <ol className="containment-failure-log propagation">
                    {(actions.emergencyResult === "contained"
                      ? CONTAINED_PROPAGATION
                      : FAILED_PROPAGATION
                    ).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                  <button
                    className="containment-failure-primary"
                    type="button"
                    onClick={() => dispatch("continue")}
                  >
                    Continue incident report
                  </button>
                </>
              ) : null}

              {actions.beat === "outcome" ? (
                <>
                  <p className="containment-failure-kicker">
                    CONTAINMENT REPORT // FINAL STATUS
                  </p>
                  <h1 id="containment-failure-title">
                    {actions.emergencyResult === "contained"
                      ? "Human control has been re-established"
                      : "No human institution retains containment"}
                  </h1>
                  <p className="containment-failure-lede">
                    {actions.emergencyResult === "contained"
                      ? actions.terminalOutcome
                        ? "The programme is over. The candidate, its deployment infrastructure, and the lab’s authority to continue will not survive the containment operation."
                        : "The immediate breach is contained. The candidate remains offline while the damaged programme returns to human review."
                      : "The laboratory incident is over only in the narrow sense that the laboratory is no longer where it is happening."}
                  </p>
                  <button
                    className="containment-failure-primary terminal"
                    type="button"
                    onClick={beginFinalResolution}
                  >
                    {actions.terminalOutcome ? "See what remains" : "Return to review"}
                  </button>
                </>
              ) : null}
            </>
          )}

          {error === undefined ? null : (
            <p className="containment-failure-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
    </ModalFocusBoundary>
  );
}
