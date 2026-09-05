import { useState, type ReactElement } from "react";

import type { HighScoreBoard, HighScoreEntry } from "@neolab/sim/public";

function formatScore(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

export function HighScoresScreen({
  boards,
  busy,
  error,
  onBack,
  onDelete,
}: {
  readonly boards: Readonly<Record<HighScoreBoard, readonly HighScoreEntry[]>>;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onBack: () => void;
  readonly onDelete: (runId: string) => void;
}): ReactElement {
  return (
    <main className="high-scores-screen">
      <header className="high-scores-header">
        <div>
          <p className="eyebrow">LOCAL RECORDS // NO NETWORK SUBMISSION</p>
          <h1>High scores</h1>
          <p>
            These records live only in this browser. Deleting a game save does not erase
            its score; score deletion is a separate action here.
          </p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          Return to title
        </button>
      </header>

      <HighScoreBoards boards={boards} busy={busy} error={error} onDelete={onDelete} />
    </main>
  );
}

export function HighScoreBoards({
  boards,
  busy,
  error,
  onDelete,
}: {
  readonly boards: Readonly<Record<HighScoreBoard, readonly HighScoreEntry[]>>;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onDelete: (runId: string) => void;
}): ReactElement {
  const [board, setBoard] = useState<HighScoreBoard>("winning-runs");
  const entries = boards[board];
  return (
    <>
      <nav className="high-score-tabs" aria-label="High-score board">
        {(
          [
            ["winning-runs", "Winning runs"],
            ["all-finished-runs", "All finished runs"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={board === id ? "active" : undefined}
            aria-pressed={board === id}
            onClick={() => setBoard(id)}
          >
            {label} <span>{boards[id].length}</span>
          </button>
        ))}
      </nav>

      {error === undefined ? null : (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      {busy && entries.length === 0 ? (
        <p className="high-score-empty">Reading the local leaderboard…</p>
      ) : entries.length === 0 ? (
        <p className="high-score-empty">
          No qualifying records yet. The leaderboard remains admirably uncorrupted.
        </p>
      ) : (
        <ol className="high-score-list">
          {entries.map((entry, index) => (
            <li key={entry.runId}>
              <strong className="high-score-rank">#{String(index + 1)}</strong>
              <div className="high-score-identity">
                <strong>{entry.leaderName}</strong>
                <span>
                  {entry.labName} · {entry.endingName}
                </span>
                <small>
                  {entry.difficultyId
                    .replace("base:difficulty.", "")
                    .replaceAll("-", " ")}{" "}
                  · week {entry.totalTicks} · {entry.scoreVersion}
                </small>
              </div>
              <div className="high-score-total">
                <strong>{formatScore(entry.adjustedScore)}</strong>
                <span>raw {formatScore(entry.rawScore)}</span>
              </div>
              <button
                type="button"
                className="danger subtle"
                disabled={busy}
                aria-label={`Delete score for ${entry.leaderName}, ${entry.endingName}`}
                onClick={() => onDelete(entry.runId)}
              >
                Delete score
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
