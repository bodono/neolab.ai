import { useMemo, useState, type ReactElement } from "react";

import {
  exportDeveloperScenarioFixture,
  lookupDeveloperRandom,
  projectDeveloperInspector,
  type DeveloperInspectorView,
  type DeveloperRandomLookup,
} from "@neolab/sim/debug";
import type { GameCommand } from "@neolab/sim/public";

import { useGameSession, useGameStore } from "../../app/runtime-provider.tsx";
import "./development-inspector.css";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([pretty(value)], { type: "application/json;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function SystemTimings({ view }: { readonly view: DeveloperInspectorView }) {
  const { runtime } = useGameSession();
  const transition = runtime.readDevelopmentSnapshot().lastTransition;
  return (
    <details open>
      <summary>Tick phase and system timings</summary>
      <p>
        Current phase:{" "}
        <strong>{runtime.readDevelopmentSnapshot().currentTickPhase}</strong>
        {transition === undefined
          ? " · no transition yet"
          : ` · last ${transition.kind} ${transition.durationMilliseconds.toFixed(2)} ms`}
      </p>
      {transition === undefined ? null : (
        <table>
          <thead>
            <tr>
              <th>Phase</th>
              <th>System</th>
              <th>ms</th>
            </tr>
          </thead>
          <tbody>
            {transition.systemTimings.map((timing) => (
              <tr key={`${timing.phase}:${timing.systemId}`}>
                <td>{timing.phase}</td>
                <td>{timing.systemId}</td>
                <td>{timing.durationMilliseconds.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="developer-inspector-note">
        Canonical campaign phase: {view.run.campaignPhase}; tick {view.run.tick}.
      </p>
    </details>
  );
}

function CommandAudit(): ReactElement {
  const { runtime } = useGameSession();
  const [commandText, setCommandText] = useState(
    '{\n  "kind": "set-public-price",\n  "meta": {\n    "commandId": "command:developer-probe",\n    "expectedTick": 0,\n    "issuedBy": "player"\n  },\n  "labId": "replace-me",\n  "priceTier": "market"\n}',
  );
  const [message, setMessage] = useState<string>();
  const [revision, setRevision] = useState(0);
  const snapshot = runtime.readDevelopmentSnapshot();

  function validateJson(): void {
    try {
      const parsed: unknown = JSON.parse(commandText);
      const validation = runtime.validate(parsed as GameCommand);
      setMessage(validation.ok ? "Accepted" : "Rejected by command rules");
      setRevision((value) => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <details>
      <summary>Command validation and transition audit</summary>
      <label>
        Command JSON
        <textarea
          rows={8}
          spellCheck={false}
          value={commandText}
          onChange={(event) => setCommandText(event.currentTarget.value)}
        />
      </label>
      <button type="button" onClick={validateJson}>
        Validate without dispatching
      </button>
      {message === undefined ? null : <p role="status">{message}</p>}
      <h4>Last validation</h4>
      <pre key={`validation:${String(revision)}`}>
        {pretty(runtime.readDevelopmentSnapshot().lastCommandValidation ?? null)}
      </pre>
      <h4>Last transition</h4>
      <pre>{pretty(snapshot.lastTransition ?? null)}</pre>
    </details>
  );
}

function FinanceLedger({ view }: { readonly view: DeveloperInspectorView }) {
  return (
    <details>
      <summary>Finance ledger ({view.finance.length} labs)</summary>
      {view.finance.map((finance) => (
        <details key={finance.labId}>
          <summary>
            {finance.labDefinitionId} · ${finance.cashMillions.toFixed(2)}m ·{" "}
            {finance.control}
          </summary>
          <pre>{pretty(finance)}</pre>
        </details>
      ))}
    </details>
  );
}

function ModifierBreakdowns({ view }: { readonly view: DeveloperInspectorView }) {
  return (
    <details>
      <summary>Modifier breakdowns ({view.modifiers.length} targets)</summary>
      {view.modifiers.map((target) => (
        <details key={target.target}>
          <summary>
            {target.target} · {target.records.filter((record) => record.activeNow).length}
            /{target.records.length} active
          </summary>
          <pre>{pretty(target)}</pre>
        </details>
      ))}
    </details>
  );
}

function RandomLookup(): ReactElement {
  const { runtime } = useGameSession();
  const [key, setKey] = useState("developer/probe/default");
  const [result, setResult] = useState<DeveloperRandomLookup>();
  const [error, setError] = useState<string>();

  function lookup(): void {
    try {
      const segments = key.split("/").map((segment) => segment.trim());
      setResult(
        lookupDeveloperRandom(runtime.readDevelopmentSnapshot().canonicalState, segments),
      );
      setError(undefined);
    } catch (reason) {
      setResult(undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <details>
      <summary>Random key lookup</summary>
      <label>
        Semantic key segments, separated by /
        <input value={key} onChange={(event) => setKey(event.currentTarget.value)} />
      </label>
      <button type="button" onClick={lookup}>
        Calculate golden values
      </button>
      {error === undefined ? null : <p role="alert">{error}</p>}
      {result === undefined ? null : <pre>{pretty(result)}</pre>}
    </details>
  );
}

function PaperProgress({ view }: { readonly view: DeveloperInspectorView }) {
  return (
    <details>
      <summary>Paper breakthrough levels and weekly chances</summary>
      {view.papers.map((lab) => (
        <details key={lab.labId}>
          <summary>{lab.labId}</summary>
          <table>
            <thead>
              <tr>
                <th>Paper</th>
                <th>Programme</th>
                <th>Level</th>
                <th>Chance</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {lab.papers.map((paper) => (
                <tr key={paper.paperId}>
                  <td title={paper.paperId}>{paper.title}</td>
                  <td>{paper.breakthroughProgrammeId}</td>
                  <td>
                    {paper.currentLevel.toFixed(0)} / {paper.requiredLevel.toFixed(0)}
                  </td>
                  <td>{(paper.weeklyChance * 100).toFixed(0)}%</td>
                  <td>
                    {paper.discovered
                      ? "discovered"
                      : paper.eligible
                        ? "eligible"
                        : "locked"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </details>
  );
}

function JsonSection({
  title,
  value,
}: {
  readonly title: string;
  readonly value: unknown;
}): ReactElement {
  return (
    <details>
      <summary>{title}</summary>
      <pre>{pretty(value)}</pre>
    </details>
  );
}

export function DevelopmentInspector(): ReactElement {
  const { runtime, content } = useGameSession();
  const gameView = useGameStore((state) => state.gameView);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [invariantMessage, setInvariantMessage] = useState<string>();
  const view = useMemo(
    () =>
      open
        ? projectDeveloperInspector(
            runtime.readDevelopmentSnapshot().canonicalState,
            content,
          )
        : undefined,
    [content, gameView, open, revision, runtime],
  );

  function runInvariants(): void {
    const next = projectDeveloperInspector(
      runtime.readDevelopmentSnapshot().canonicalState,
      content,
    );
    setInvariantMessage(
      next.invariants.length === 0
        ? `All invariants pass at tick ${String(next.run.tick)}.`
        : `${String(next.invariants.length)} invariant violation(s) found.`,
    );
    setRevision((value) => value + 1);
  }

  function exportFixture(): void {
    const fixture = exportDeveloperScenarioFixture(
      runtime.readDevelopmentSnapshot().canonicalState,
      content,
    );
    downloadJson(
      `neolab-scenario-tick-${String(fixture.tick).padStart(4, "0")}.json`,
      fixture,
    );
  }

  return (
    <div className="developer-inspector-boundary">
      <button
        className="developer-inspector-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="developer-inspector-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Close dev inspector" : "Dev inspector"}
      </button>
      {!open || view === undefined ? null : (
        <aside
          id="developer-inspector-panel"
          className="developer-inspector-panel"
          aria-label="Privileged simulation inspector"
        >
          <header>
            <div>
              <p>PRIVILEGED DEVELOPMENT SURFACE</p>
              <h2>Simulation inspector</h2>
              <span>
                Tick {view.run.tick} · {view.run.status} · {view.run.campaignPhase}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close inspector"
            >
              ×
            </button>
          </header>

          <section className="developer-inspector-actions">
            <button type="button" onClick={() => setRevision((value) => value + 1)}>
              Refresh snapshot
            </button>
            <button type="button" onClick={runInvariants}>
              Run invariant pack
            </button>
            <button type="button" onClick={exportFixture}>
              Export test fixture
            </button>
          </section>
          {invariantMessage === undefined ? null : (
            <p role="status" className="developer-inspector-status">
              {invariantMessage}
            </p>
          )}

          {runtime.readDevelopmentSnapshot().lastFault === undefined ? null : (
            <JsonSection
              title="Runtime fault diagnostic"
              value={runtime.readDevelopmentSnapshot().lastFault}
            />
          )}
          <SystemTimings view={view} />
          <CommandAudit />
          <FinanceLedger view={view} />
          <ModifierBreakdowns view={view} />
          <RandomLookup />
          <PaperProgress view={view} />
          <JsonSection
            title="Hidden model safety and evaluation error"
            value={view.models}
          />
          <JsonSection
            title="Event eligibility and effective weights"
            value={view.events}
          />
          <JsonSection
            title="Rival plan utilities and exact countdowns"
            value={view.rivals}
          />
          <JsonSection title="Coalition gate inputs" value={view.coalitions} />
          <JsonSection title="Endgame gate inputs" value={view.endgame} />
          <JsonSection
            title="Hidden institution state"
            value={view.playerHiddenInstitution}
          />
          <JsonSection title="Invariant results" value={view.invariants} />
        </aside>
      )}
    </div>
  );
}
