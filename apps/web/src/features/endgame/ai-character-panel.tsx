import { useState, type ReactElement } from "react";

import { candidateAccessCommand } from "../../app/command-builders.ts";
import type { BrowserGameRuntime, GameView } from "../../runtime/index.ts";
import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";

type ActiveEndgameView = Extract<GameView["endgame"], { readonly active: true }>;
type AccessOption = NonNullable<
  ActiveEndgameView["aiCharacter"]
>["accessOptions"][number];

export function AiCharacterPanel({
  view,
  runtime,
}: {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
}): ReactElement | null {
  const [pending, setPending] = useState<AccessOption>();
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState<string>();
  if (!view.endgame.active) return null;
  const endgame = view.endgame;
  const candidate = endgame.candidate;
  const aiCharacter = endgame.aiCharacter;
  // Candidate activation deliberately precedes nomination, so there is not
  // yet a secure channel or a single artifact whose permissions can change.
  if (candidate === undefined || aiCharacter === undefined) return null;
  const candidateModelId = candidate.modelId;

  function dispatch(option: AccessOption, confirmationText?: string): void {
    const result = runtime.validate(
      candidateAccessCommand(view, candidateModelId, option.level, confirmationText),
    );
    if (!result.ok) {
      setNotice(result.errors.map((error) => error.message).join(" · "));
      return;
    }
    runtime.dispatch(
      candidateAccessCommand(view, candidateModelId, option.level, confirmationText),
    );
    setNotice(`${option.displayName} is now the recorded operating boundary.`);
    setPending(undefined);
    setConfirmation("");
  }

  function choose(option: AccessOption): void {
    setNotice(undefined);
    if (option.confirmationPhrase !== undefined) {
      setPending(option);
      setConfirmation("");
      return;
    }
    dispatch(option);
  }

  return (
    <section className="ai-character-panel" aria-labelledby="ai-channel-title">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">SECURE CANDIDATE CHANNEL</p>
          <h2 id="ai-channel-title">{candidate.displayName}</h2>
        </div>
        <span>{candidate.accessLabel}</span>
      </header>
      <div className="ai-character-layout">
        <div className="ai-transcript" aria-label="Candidate messages">
          {aiCharacter.lines.map((line) => (
            <article key={line.id}>
              <p>{line.text}</p>
              {line.annotations.map((annotation) => (
                <aside key={`${line.id}:${annotation.kind}`}>
                  <strong>INSTRUMENT NOTE</strong>
                  <span>{annotation.text}</span>
                </aside>
              ))}
            </article>
          ))}
        </div>
        <div className="access-ladder">
          <header>
            <strong>OPERATING PERMISSIONS</strong>
            <span>Acceleration trades against access risk</span>
          </header>
          {aiCharacter.accessOptions.map((option) => (
            <button
              className={option.current ? "current" : option.critical ? "critical" : ""}
              type="button"
              key={option.level}
              aria-pressed={option.current}
              disabled={option.current || !option.available}
              onClick={() => choose(option)}
            >
              <span>ACCESS {option.level}</span>
              <strong>{option.displayName}</strong>
              <small>
                +{option.accelerationPercent}% speed · access risk{" "}
                {option.exposurePercent}/100
              </small>
            </button>
          ))}
        </div>
      </div>
      {notice === undefined ? null : (
        <p className="ai-access-notice" role="status">
          {notice}
        </p>
      )}
      {pending === undefined ? null : (
        <ModalFocusBoundary
          onOpen={() => runtime.pause()}
          onEscape={() => setPending(undefined)}
        >
          <div className="critical-access-backdrop endgame-command-backdrop command-access">
            <section
              className="critical-access-dialog endgame-manual-command"
              role="dialog"
              aria-modal="true"
              aria-labelledby="critical-access-title"
            >
              <p className="eyebrow">CRITICAL PERMISSION CHANGE</p>
              <h2 id="critical-access-title">{pending.displayName}</h2>
              <p>
                This first grant materially changes what a mistaken or deceptive candidate
                can affect. It exposes:
              </p>
              <ul>
                {pending.exposedSystems.map((system) => (
                  <li key={system}>{system}</li>
                ))}
              </ul>
              <dl>
                <div>
                  <dt>Research acceleration</dt>
                  <dd>+{pending.accelerationPercent}%</dd>
                </div>
                <div>
                  <dt>Access-risk index</dt>
                  <dd>{pending.exposurePercent}/100</dd>
                </div>
              </dl>
              <label>
                Type <strong>{pending.confirmationPhrase}</strong> to confirm
                <input
                  autoFocus
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                />
              </label>
              <footer>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setPending(undefined)}
                >
                  Keep current boundary
                </button>
                <button
                  className="danger"
                  type="button"
                  disabled={confirmation !== pending.confirmationPhrase}
                  onClick={() => dispatch(pending, confirmation)}
                >
                  Confirm critical access
                </button>
              </footer>
            </section>
          </div>
        </ModalFocusBoundary>
      )}
    </section>
  );
}
