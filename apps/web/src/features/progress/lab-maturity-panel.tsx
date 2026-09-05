import type { ReactElement } from "react";

import type { GameView } from "@neolab/sim/public";

export function LabMaturityPanel({
  view,
}: {
  readonly view: GameView;
}): ReactElement | null {
  const maturity = view.meta.labMaturity;
  if (maturity === undefined || !maturity.showOverviewPanel) return null;
  const completed = maturity.checklist.filter((item) => item.complete).length;
  const awaitingWeekBoundary =
    maturity.stage !== "frontier" && completed === maturity.checklist.length;
  return (
    <section
      className={`lab-maturity-panel stage-${maturity.stage}`}
      aria-labelledby="lab-maturity-title"
    >
      <header>
        <div>
          <p className="eyebrow">{maturity.chapter}</p>
          <h2 id="lab-maturity-title">{maturity.title}</h2>
        </div>
        <span>
          {maturity.ordinal}/{maturity.total} · {completed}/{maturity.checklist.length}{" "}
          objectives
        </span>
      </header>
      <div className="lab-maturity-panel-body">
        <p>
          {awaitingWeekBoundary
            ? "Objective complete. Advance one week to begin the next chapter."
            : maturity.directive}
        </p>
        <ol>
          {maturity.checklist.map((item) => (
            <li className={item.complete ? "complete" : undefined} key={item.label}>
              <span aria-hidden="true">{item.complete ? "✓" : "○"}</span>
              {item.label}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
