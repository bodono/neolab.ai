import type { ReactElement } from "react";

import type { RivalCandidateSetbackPresentationQueueItemView } from "@neolab/sim/public";

interface SetbackCopy {
  readonly verdict: string;
  readonly status: string;
  readonly title: string;
  readonly deck: string;
  readonly resultLabel: string;
  readonly result: string;
  readonly raceEffect: string;
  readonly survivingCapacity: string;
}

function possessive(name: string): string {
  return `${name}${name.endsWith("s") ? "’" : "’s"}`;
}

function setbackCopy(item: RivalCandidateSetbackPresentationQueueItemView): SetbackCopy {
  const elapsed = `${String(item.elapsedWeeks)}-week`;
  switch (item.outcome) {
    case "false-dawn":
      return {
        verdict: "RIVAL FALSE DAWN",
        status: "COUNTDOWN WITHDRAWN",
        title: `${possessive(item.rivalLabName)} superintelligence claim has collapsed.`,
        deck: `${item.modelDisplayName} completed a ${elapsed} candidate process, but the result did not establish general superintelligence. ${item.rivalLabName} has withdrawn this candidate.`,
        resultLabel: "WHAT FAILED",
        result:
          "The deployment review did not demonstrate the general superintelligence they claimed.",
        raceEffect:
          "Their active candidate countdown is gone. No rival victory was recorded. The race continues.",
        survivingCapacity: `${item.rivalLabName} keeps its programme, infrastructure, and whatever it learned. It may train and nominate a successor.`,
      };
    case "emergency-containment":
      return {
        verdict: "EMERGENCY CONTAINMENT",
        status: "WEIGHTS DESTROYED",
        title: `${item.rivalLabName} destroyed ${item.modelDisplayName} at the deployment boundary.`,
        deck: `Final deployment exposed a control failure. ${item.rivalLabName} halted the process and destroyed the candidate weights under emergency containment rather than risk an uncontrolled release.`,
        resultLabel: "WHAT HAPPENED",
        result:
          "The candidate weights were destroyed under verified emergency containment.",
        raceEffect: `Their ${elapsed} candidate process is over. The frontier race remains active.`,
        survivingCapacity: `${item.rivalLabName} retains its major works and infrastructure. It can build another candidate.`,
      };
    case "containment-incident":
      return {
        verdict: "CANDIDACY HALTED",
        status: "CONTAINMENT SIGNAL",
        title: `${possessive(item.rivalLabName)} candidate process has been stopped.`,
        deck: `A reported containment incident involving ${item.modelDisplayName} interrupted the process before deployment. The active countdown has been withdrawn while the rival investigates.`,
        resultLabel: "WHAT HAPPENED",
        result:
          "A containment signal made the nominated artifact ineligible to continue its deployment process.",
        raceEffect: `The ${elapsed} candidate process is no longer advancing toward deployment.`,
        survivingCapacity: `The artifact may remain under restricted custody. ${item.rivalLabName} keeps its programme and may train a successor.`,
      };
  }
}

export function RivalCandidateSetbackDialog({
  item,
  onAcknowledge,
}: {
  readonly item: RivalCandidateSetbackPresentationQueueItemView;
  readonly onAcknowledge: () => void;
}): ReactElement {
  const copy = setbackCopy(item);
  const titleId = `rival-candidate-setback-${item.key}`;
  const descriptionId = `${titleId}-description`;

  return (
    <div className={`modal-backdrop rival-setback-backdrop outcome-${item.outcome}`}>
      <section
        className={`rival-candidate-setback-dialog outcome-${item.outcome}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-modal-initial-focus
        tabIndex={-1}
      >
        <header className="rival-setback-header">
          <p className="eyebrow">
            GLOBAL INTELLIGENCE FLASH // RIVAL CANDIDACY FAILURE // WEEK{" "}
            {item.createdAtTick}
          </p>
          <span className="rival-setback-status">{copy.status}</span>
        </header>

        <div className="rival-setback-signal" aria-hidden="true">
          <span>SIGNAL INTERRUPTED</span>
          <i />
          <span>{item.rivalAiName.toUpperCase()} PROGRAMME</span>
        </div>

        <p className="rival-setback-verdict">{copy.verdict}</p>
        <h2 id={titleId}>{copy.title}</h2>
        <p className="rival-setback-deck" id={descriptionId}>
          {copy.deck}
        </p>

        <dl className="rival-setback-facts">
          <div className="result">
            <dt>{copy.resultLabel}</dt>
            <dd>{copy.result}</dd>
          </div>
          <div className="race">
            <dt>RACE EFFECT</dt>
            <dd>{copy.raceEffect}</dd>
          </div>
          <div className="capacity">
            <dt>WHAT SURVIVES</dt>
            <dd>{copy.survivingCapacity}</dd>
          </div>
        </dl>

        <footer className="rival-setback-footer">
          <div>
            <strong>SETBACK, NOT DEFEAT</strong>
            <p>You have more time. You have not won.</p>
          </div>
          <button className="primary" type="button" onClick={onAcknowledge}>
            Return to the race
          </button>
        </footer>
      </section>
    </div>
  );
}
