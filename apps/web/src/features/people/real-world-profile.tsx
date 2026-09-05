import type { ReactElement } from "react";

import type { RealPaperCitation } from "@neolab/sim/public";

function sourceLabel(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  const hostname = url.hostname.replace(/^www\./u, "");
  const pathLabel = url.pathname
    .split("/")
    .filter((part) => part.length > 0)
    .at(-1);
  return pathLabel === undefined ? hostname : `${hostname} · ${pathLabel}`;
}

export function RealWorldProfile({
  inspirationName,
  inspirationSummary,
  biography,
  sourceUrls = [],
  realWorldPapers = [],
  compact = false,
  showAttribution = true,
}: {
  readonly inspirationName: string;
  readonly inspirationSummary: string;
  readonly biography?: string | undefined;
  readonly sourceUrls?: readonly string[] | undefined;
  readonly realWorldPapers?: readonly RealPaperCitation[] | undefined;
  readonly compact?: boolean;
  readonly showAttribution?: boolean;
}): ReactElement {
  const biographyParagraphs =
    biography
      ?.split(/\n+/u)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0) ?? [];

  if (compact) {
    return (
      <span
        className="real-world-profile compact"
        aria-label={`Real-world profile: ${inspirationName}. ${inspirationSummary}`}
        title={inspirationSummary}
      >
        <span className="real-world-profile-attribution">
          inspired by <strong>{inspirationName}</strong>
        </span>
      </span>
    );
  }

  return (
    <section
      className="real-world-profile"
      aria-label={`Real-world profile: ${inspirationName}`}
    >
      <header className={showAttribution ? undefined : "marker-only"}>
        <span className="paper-reality real">REAL-WORLD PROFILE</span>
        {showAttribution ? (
          <p>
            Inspired by <strong>{inspirationName}</strong>
            <span className="real-world-profile-summary"> — {inspirationSummary}</span>
          </p>
        ) : null}
      </header>
      {biographyParagraphs.length === 0 ? null : (
        <>
          <div className="dossier-biography">
            {biographyParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {realWorldPapers.length === 0 ? null : (
            <details className="real-world-paper-credits">
              <summary>
                {realWorldPapers.length} real{" "}
                {realWorldPapers.length === 1 ? "paper" : "papers"} represented in the
                game
              </summary>
              <p>
                Real-world publications by {inspirationName}; their in-game discovery
                histories are fictional.
              </p>
              <ol>
                {realWorldPapers.map((paper) => (
                  <li key={paper.paperId}>
                    <a
                      href={paper.primarySourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {paper.title}
                    </a>
                    <span>
                      {paper.authors.join(", ")} · {String(paper.publicationYear)}
                      {paper.venue === undefined ? "" : ` · ${paper.venue}`}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {sourceUrls.length === 0 ? null : (
            <details className="real-world-profile-sources">
              <summary>
                {sourceUrls.length} cited {sourceUrls.length === 1 ? "source" : "sources"}
              </summary>
              <ul>
                {sourceUrls.map((sourceUrl) => (
                  <li key={sourceUrl}>
                    <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                      {sourceLabel(sourceUrl)}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="real-world-profile-boundary">
            This sourced professional profile is factual. The character’s gameplay,
            dialogue, promises, and outcomes are fictional.
          </p>
        </>
      )}
    </section>
  );
}
