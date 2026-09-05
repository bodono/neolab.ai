import type { ReactElement } from "react";

import type { CueRequest } from "./audio-types.ts";

export function AudioEventNotices({
  notices,
  onDismiss,
  onDismissAll,
  onInternalAction,
}: {
  readonly notices: readonly CueRequest[];
  readonly onDismiss: (occurrenceKey: string) => void;
  readonly onDismissAll: () => void;
  readonly onInternalAction?: (request: CueRequest) => void;
}): ReactElement | null {
  if (notices.length === 0) return null;

  return (
    <aside
      className="audio-event-notices"
      aria-label="Events announced by sound"
      aria-live="assertive"
      aria-relevant="additions"
    >
      {notices.length > 1 ? (
        <div className="audio-event-notices-toolbar">
          <span>{String(notices.length)} NOTIFICATIONS</span>
          <button type="button" onClick={onDismissAll}>
            Dismiss all
          </button>
        </div>
      ) : null}
      {[...notices].reverse().map((request) => (
        <article
          className={`audio-event-notice tone-${request.notice.tone}`}
          key={request.occurrenceKey}
        >
          <header>
            <span>EVENT CUE // WHAT CHANGED</span>
            <button
              type="button"
              aria-label={`Dismiss ${request.notice.title}`}
              onClick={() => onDismiss(request.occurrenceKey)}
            >
              Dismiss
            </button>
          </header>
          <strong>{request.notice.title}</strong>
          <p>{request.notice.detail}</p>
          {request.notice.externalLink === undefined ? null : (
            <a
              className="audio-event-notice-paper-link"
              href={request.notice.externalLink.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {request.notice.externalLink.label}
            </a>
          )}
          {request.notice.internalAction === undefined ||
          onInternalAction === undefined ? null : (
            <button
              className="audio-event-notice-action"
              type="button"
              onClick={() => onInternalAction(request)}
            >
              {request.notice.internalAction.label}
            </button>
          )}
        </article>
      ))}
    </aside>
  );
}
