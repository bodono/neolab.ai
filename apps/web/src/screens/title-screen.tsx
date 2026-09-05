import type { ReactElement } from "react";

import type { SaveMetadata } from "@neolab/sim/public";

import {
  FEEDBACK_URL,
  type LocalDiagnosticsSnapshot,
} from "../runtime/local-diagnostics.ts";

// The guided tutorial implementation remains available for later iteration,
// but normal players currently enter through the shared staged campaign opening.
const SHOW_TITLE_TUTORIAL =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has("show-hidden-tutorial");

export function TitleScreen({
  saves,
  persistenceBusy,
  persistenceMessage,
  persistenceError,
  diagnostics,
  onStartWithSound,
  onStartMuted,
  onTutorial,
  onHighScores,
  onLoad,
  onImport,
  onExport,
  onSetDiagnosticsEnabled,
  onExportDiagnostics,
  onClearDiagnostics,
}: {
  readonly saves: readonly SaveMetadata[];
  readonly persistenceBusy: boolean;
  readonly persistenceMessage: string | undefined;
  readonly persistenceError: string | undefined;
  readonly diagnostics: LocalDiagnosticsSnapshot;
  readonly onStartWithSound: () => void;
  readonly onStartMuted: () => void;
  readonly onTutorial: () => void;
  readonly onHighScores: () => void;
  readonly onLoad: (saveId: string) => void;
  readonly onImport: (file: File) => void;
  readonly onExport: (save: SaveMetadata) => void;
  readonly onSetDiagnosticsEnabled: (enabled: boolean) => void;
  readonly onExportDiagnostics: () => void;
  readonly onClearDiagnostics: () => void;
}): ReactElement {
  return (
    <main className="title-screen">
      <div className="title-grid" aria-hidden="true" />
      <section className="title-panel">
        <p className="eyebrow">FRONTIER LAB OPERATIONS SIMULATOR</p>
        <h1>
          NEOLAB<span>.AI</span>
        </h1>
        <p className="title-deck">
          Raise rounds. Train models. Publish papers. Keep your GPUs cool and your
          releases hot. Usher in a new era of aligned prosperity. But whatever you do,
          don&apos;t destroy the world—the board has been very clear about this.
        </p>
        <div className="title-outcomes" aria-label="Possible outcomes">
          <span>WIN: SAFE AGI</span>
          <span>LOSE: RACE / RUIN / REGULATION</span>
        </div>
        <div className="title-primary-actions">
          <button className="primary huge" type="button" onClick={onStartWithSound}>
            Start with sound
          </button>
          <button className="secondary" type="button" onClick={onStartMuted}>
            Start muted
          </button>
          {SHOW_TITLE_TUTORIAL ? (
            <button
              className="secondary title-tutorial"
              type="button"
              onClick={onTutorial}
            >
              Tutorial
            </button>
          ) : null}
          <button className="secondary" type="button" onClick={onHighScores}>
            Local high scores
          </button>
        </div>
        <p className="title-license-notice">
          Copyright © 2026{" "}
          <a href="https://bodono.github.io/" target="_blank" rel="noreferrer">
            Brendan O&apos;Donoghue
          </a>
          . All rights reserved. By starting, continuing, importing, or otherwise using
          Neolab.ai, you accept the{" "}
          <a href={`${import.meta.env.BASE_URL}LICENSE`} target="_blank" rel="noreferrer">
            proprietary licence
          </a>
          .
        </p>
        <p className="title-footnote">
          Alternate history begins in 2012 · Pausable real time
        </p>
        <p className="title-independence-notice">
          Independent fiction &amp; satire · Not affiliated with or endorsed by Google,
          Google DeepMind, or any organisation depicted or parodied.
        </p>
        <details className="independence-panel">
          <summary>Independence &amp; fictionalisation</summary>
          <p>
            Neolab.ai was created in a personal capacity. Its views, scenarios, fictional
            traits, and game mechanics are the creator&apos;s alone and do not represent
            Google, the creator&apos;s employer, or any person or organisation referenced
            or used as inspiration.
          </p>
          <p>
            Historical research descriptions use cited public sources. Alternate history,
            future research, fictional papers, and simulated outcomes are speculative.
          </p>
          <p>
            Some characters are affectionate parodies inspired by real researchers and lab
            leaders. If you are, or represent, someone who inspired a character and would
            rather not be included, email{" "}
            <a href="mailto:bodonoghue85@gmail.com?subject=Neolab.ai%20removal%20request">
              bodonoghue85@gmail.com
            </a>{" "}
            and the character will be removed or renamed — best effort within 30 days, no
            explanation needed.
          </p>
          <a
            href={`${import.meta.env.BASE_URL}DISCLAIMER.md`}
            target="_blank"
            rel="noreferrer"
          >
            Read the full independence notice ↗
          </a>
        </details>
        <details className="legal-panel">
          <summary>Copyright, licence &amp; third-party notices</summary>
          <p>
            A lawfully supplied unmodified build may be used only for personal,
            non-commercial entertainment and evaluation. Repository or source access
            grants no general right to copy, modify, redistribute, publish, or rehost. The
            licence permits contribution-only pull requests and gameplay videos,
            livestreams, screenshots, reviews, and ordinary channel monetisation.
          </p>
          <div>
            <a
              href={`${import.meta.env.BASE_URL}LICENSE`}
              target="_blank"
              rel="noreferrer"
            >
              Proprietary licence ↗
            </a>
            <a
              href={`${import.meta.env.BASE_URL}COPYRIGHT.md`}
              target="_blank"
              rel="noreferrer"
            >
              Copyright notice ↗
            </a>
            <a
              href={`${import.meta.env.BASE_URL}CONTRIBUTING.md`}
              target="_blank"
              rel="noreferrer"
            >
              Contributing ↗
            </a>
            <a
              href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`}
              target="_blank"
              rel="noreferrer"
            >
              Third-party notices ↗
            </a>
          </div>
        </details>
        <details className="privacy-panel">
          <summary>Privacy, diagnostics &amp; feedback</summary>
          <p>
            In a configured published build, Neolab.ai automatically sends anonymous
            gameplay milestones and sanitised crash fingerprints to Hosted Umami Cloud. It
            never sends saves, game seeds, names, hidden model traits, URL query strings,
            raw error messages, or raw stack traces. Hosted Umami may attach the game page
            path and ordinary cookie-free visit metadata to an event. Local diagnostics
            stay in this browser until you explicitly export them.
          </p>
          <label>
            <input
              type="checkbox"
              checked={diagnostics.enabled}
              onChange={(event) => onSetDiagnosticsEnabled(event.currentTarget.checked)}
            />
            Keep a local diagnostic notebook
          </label>
          <div>
            <button
              className="secondary"
              type="button"
              disabled={!diagnostics.enabled || diagnostics.recordCount === 0}
              onClick={onExportDiagnostics}
            >
              Export {diagnostics.recordCount} records
            </button>
            <button
              className="secondary"
              type="button"
              disabled={diagnostics.recordCount === 0}
              onClick={onClearDiagnostics}
            >
              Clear local records
            </button>
            <a href={FEEDBACK_URL} target="_blank" rel="noreferrer">
              Report an issue ↗
            </a>
          </div>
        </details>
      </section>
      <aside className="title-terminal" aria-label="Lab terminal readout">
        <div className="terminal-lights">
          <i />
          <i />
          <i />
        </div>
        <p>&gt; compute market: EXCITABLE</p>
        <p>&gt; talent market: TAKING CALLS</p>
        <p>&gt; alignment confidence: INSUFFICIENT EVIDENCE</p>
        <p>&gt; investor confidence: WE LOVE THE DECK</p>
        <section className="save-terminal" aria-label="Saved labs">
          <div className="save-terminal-heading">
            <strong>SAVED LABS</strong>
            <label className="terminal-file-button">
              Import
              <input
                type="file"
                accept=".json,.neolab-save.json,application/json"
                disabled={persistenceBusy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file !== undefined) onImport(file);
                }}
              />
            </label>
          </div>
          {persistenceBusy && saves.length === 0 ? (
            <small>Reading local save index…</small>
          ) : saves.length === 0 ? (
            <small>
              No local saves yet. Autosaves begin at the first cycle boundary.
            </small>
          ) : (
            <ul className="save-list">
              {saves.map((save) => (
                <li key={save.saveId}>
                  <div>
                    <strong>{save.displayName}</strong>
                    <small>
                      {save.slotType.replaceAll("-", " ")} · {save.updatedAtIso}
                    </small>
                  </div>
                  <div className="save-actions">
                    <button
                      type="button"
                      disabled={persistenceBusy}
                      onClick={() => onLoad(save.saveId)}
                    >
                      Continue
                    </button>
                    <button
                      type="button"
                      disabled={persistenceBusy}
                      onClick={() => onExport(save)}
                    >
                      Export
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {persistenceMessage === undefined ? null : (
            <p className="save-message" role="status">
              {persistenceMessage}
            </p>
          )}
          {persistenceError === undefined ? null : (
            <p className="save-error" role="alert">
              {persistenceError}
            </p>
          )}
        </section>
        <div className="terminal-cursor" aria-hidden="true" />
      </aside>
    </main>
  );
}
