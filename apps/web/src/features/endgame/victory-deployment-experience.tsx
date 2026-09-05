import { useEffect, useRef, useState, type ReactElement } from "react";

import type { GameView } from "@neolab/sim/public";
import {
  advanceWorldWaitingCommand,
  transmitDeploymentCommand,
} from "../../app/command-builders.ts";
import { AudioControl } from "../../audio/audio-control.tsx";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";

type ActiveEndgame = Extract<GameView["endgame"], { readonly active: true }>;
type RolloutActions = Extract<
  ActiveEndgame["stageActions"],
  { readonly kind: "rollout" }
>;
type WaitingActions = Extract<
  ActiveEndgame["stageActions"],
  { readonly kind: "world-waiting" }
>;

function finalPreparedRollout(actions: RolloutActions): boolean {
  return (
    actions.currentBeat === "settlement" &&
    actions.completedBeats.includes("settlement") &&
    actions.remainingWeeks === 0
  );
}

function dispatchValidated(
  runtime: BrowserGameRuntime,
  command: Parameters<BrowserGameRuntime["validate"]>[0],
  setError: (error: string | undefined) => void,
): boolean {
  const validation = runtime.validate(command);
  if (!validation.ok) {
    setError(validation.errors.map((item) => item.message).join(" · "));
    return false;
  }
  setError(undefined);
  runtime.dispatch(command);
  return true;
}

function PreparedDeployment({
  view,
  endgame,
  runtime,
  actions,
}: {
  readonly view: GameView;
  readonly endgame: ActiveEndgame;
  readonly runtime: BrowserGameRuntime;
  readonly actions: RolloutActions;
}): ReactElement {
  const [screen, setScreen] = useState<"briefing" | "command">("briefing");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const candidate = endgame.candidate;
  const phrase = endgame.commandRail.deployNow.confirmationPhrase;

  function deploy(): void {
    if (candidate === undefined || phrase === undefined) return;
    dispatchValidated(
      runtime,
      transmitDeploymentCommand(view, candidate.modelId, confirmation),
      setError,
    );
  }

  return (
    <ModalFocusBoundary onOpen={() => runtime.pause()}>
      <section
        className={`victory-deployment-experience screen-${screen}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="victory-deployment-title"
      >
        <div className="victory-deployment-audio">
          <AudioControl />
        </div>
        <div className="victory-deployment-frame" key={screen}>
          {screen === "briefing" ? (
            <>
              <p className="victory-deployment-kicker">
                FINAL DEPLOYMENT // ROUTE COMPLETE
              </p>
              <h1 id="victory-deployment-title">The last decision is still yours.</h1>
              <p className="victory-deployment-lede">
                {candidate?.displayName ?? "The candidate"} has completed the reviewed
                rollout. Every scheduled gate has reported. No committee, clock, or
                automatic process will issue the final order.
              </p>
              <div className="victory-deployment-summary">
                <article>
                  <span>Candidate</span>
                  <strong>{candidate?.displayName}</strong>
                  <small>{candidate?.accessLabel}</small>
                </article>
                <article>
                  <span>Deployment route</span>
                  <strong>{actions.deploymentModeName}</strong>
                  <small>{actions.totalWeeks}-week route complete</small>
                </article>
                <article>
                  <span>First public mandate</span>
                  <strong>{actions.prosperityProgrammeName}</strong>
                  <small>Readiness {actions.prosperityReadiness}/100</small>
                </article>
              </div>
              <div className="victory-deployment-record" role="status">
                <span>FINAL RECORD SEALED</span>
                <strong>{actions.gateResults.length} public gates reconciled</strong>
                <small>
                  The hidden outcome will not answer until the deployment order reaches
                  independent systems.
                </small>
              </div>
              <button
                className="victory-deployment-primary"
                type="button"
                autoFocus
                onClick={() => setScreen("command")}
              >
                Open final deployment command
              </button>
            </>
          ) : (
            <>
              <p className="victory-deployment-kicker">
                FINAL HUMAN ORDER // CLOCK STOPPED
              </p>
              <h1 id="victory-deployment-title">
                Deploy {candidate?.displayName ?? "the candidate"}.
              </h1>
              <p className="victory-deployment-lede">
                This authorises {candidate?.displayName ?? "the candidate"} to cross the
                final boundary through {actions.deploymentModeName}. The consequences
                remain sealed until world systems answer.
              </p>
              <div className="victory-deployment-order">
                <span>DEPLOYMENT TARGET</span>
                <strong>{candidate?.displayName}</strong>
                <small>
                  {actions.deploymentModeName} · {actions.prosperityProgrammeName}
                </small>
              </div>
              <section className="victory-deployment-context" role="status">
                <header>
                  <div>
                    <span>FINAL ORDER STATUS</span>
                    <strong>Clocks held for transmission</strong>
                  </div>
                  <b>NO ADDED COST</b>
                </header>
                <dl>
                  <div>
                    <dt>Crisis week</dt>
                    <dd>{String(endgame.weeksInCrisis)}</dd>
                  </div>
                  {endgame.clocks.length === 0 ? (
                    <div>
                      <dt>External clocks</dt>
                      <dd>No current estimate</dd>
                    </div>
                  ) : (
                    endgame.clocks.map((clock) => (
                      <div key={clock.kind}>
                        <dt>{clock.label}</dt>
                        <dd>{clock.estimateLabel}</dd>
                      </div>
                    ))
                  )}
                </dl>
                <p>
                  No incremental time, cash, or Aura cost. The clocks remain stopped until
                  you transmit or return to the briefing.
                </p>
              </section>
              <p className="victory-deployment-warning">
                Transmission is terminal. There is no automatic launch and no later cancel
                command.
              </p>
              <label className="victory-command-input">
                Type <strong>{phrase}</strong> to transmit
                <input
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                />
              </label>
              {error === undefined ? null : (
                <p className="victory-deployment-error" role="alert">
                  {error}
                </p>
              )}
              <div className="victory-deployment-actions">
                <button
                  className="victory-deployment-secondary"
                  type="button"
                  onClick={() => {
                    setScreen("briefing");
                    setConfirmation("");
                  }}
                >
                  Return to briefing
                </button>
                <button
                  className="victory-deployment-primary final"
                  type="button"
                  disabled={confirmation !== phrase}
                  data-testid="deploy-superintelligence"
                  onClick={deploy}
                >
                  Transmit DEPLOY order
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </ModalFocusBoundary>
  );
}

function WorldWaiting({
  view,
  runtime,
  actions,
}: {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly actions: WaitingActions;
}): ReactElement {
  const [error, setError] = useState<string>();
  const dispatchedBeat = useRef<string | undefined>(undefined);

  useEffect(() => {
    const beat = `${String(actions.revealedCount)}:${String(actions.allCalloutsRevealed)}`;
    if (dispatchedBeat.current === beat) return;
    const reducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const delay = actions.allCalloutsRevealed
      ? reducedMotion
        ? 600
        : 2600
      : actions.revealedCount === 0
        ? reducedMotion
          ? 250
          : 1800
        : reducedMotion
          ? 300
          : 1450;
    const timeout = window.setTimeout(() => {
      dispatchedBeat.current = beat;
      dispatchValidated(runtime, advanceWorldWaitingCommand(view), setError);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [actions.allCalloutsRevealed, actions.revealedCount, runtime, view]);

  const pendingCount = Math.max(0, actions.totalCalloutCount - actions.revealedCount);
  return (
    <ModalFocusBoundary onOpen={() => runtime.pause()}>
      <section
        className="world-waiting-experience"
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-waiting-title"
      >
        <div className="world-waiting-audio">
          <AudioControl />
        </div>
        <div className="world-waiting-scanlines" aria-hidden="true" />
        <header>
          <p>FINAL ORDER TRANSMITTED // INDEPENDENT SYSTEMS RESPONDING</p>
          <span>
            {actions.revealedCount}/{actions.totalCalloutCount} CHANNELS
          </span>
        </header>
        <main>
          <p className="world-waiting-kicker">THE COMMAND HAS LEFT THE LAB</p>
          <h1 id="world-waiting-title">{actions.title}</h1>
          <p className="world-waiting-silence">
            Status lines remain quiet. No animation, voice, or colour will answer the
            hidden question before the simulation does.
          </p>
          <div className="launch-control-callouts" aria-live="polite" aria-atomic="false">
            {actions.revealedCallouts.map((callout, index) => (
              <article className={`tone-${callout.tone}`} key={callout.id}>
                <span>
                  {String(index + 1).padStart(2, "0")} · {callout.label}
                </span>
                <strong>{callout.result}</strong>
              </article>
            ))}
            {Array.from({ length: pendingCount }, (_, index) => (
              <article
                className="tone-pending"
                aria-hidden="true"
                key={`pending:${String(index)}`}
              >
                <span>
                  {String(actions.revealedCount + index + 1).padStart(2, "0")} · STATUS
                  CHANNEL
                </span>
                <strong>……………………</strong>
              </article>
            ))}
          </div>
          <div
            className={`world-waiting-pulse ${actions.allCalloutsRevealed ? "final-beat" : ""}`}
            role="status"
          >
            <span />
            {actions.allCalloutsRevealed
              ? "FINAL RECORD COMMITTED"
              : "AWAITING INDEPENDENT CONFIRMATION"}
          </div>
          {error === undefined ? null : (
            <p className="victory-deployment-error" role="alert">
              {error}
            </p>
          )}
        </main>
      </section>
    </ModalFocusBoundary>
  );
}

export function VictoryDeploymentExperience({
  view,
  runtime,
}: {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
}): ReactElement | null {
  if (!view.endgame.active) return null;
  const actions = view.endgame.stageActions;
  if (actions.kind === "world-waiting") {
    return <WorldWaiting view={view} runtime={runtime} actions={actions} />;
  }
  if (actions.kind !== "rollout" || !finalPreparedRollout(actions)) return null;
  return (
    <PreparedDeployment
      view={view}
      endgame={view.endgame}
      runtime={runtime}
      actions={actions}
    />
  );
}
