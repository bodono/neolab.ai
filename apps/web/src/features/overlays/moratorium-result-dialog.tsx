import type { ReactElement } from "react";

import type { MoratoriumResultPresentationQueueItemView } from "@neolab/sim/public";

function archiveConsequence(item: MoratoriumResultPresentationQueueItemView): string {
  switch (item.archiveDisposition) {
    case "destroy-all-weights":
      return "All executable weights and state remain destroyed. The failed negotiation restores nothing.";
    case "filtered-technical-note":
      return "Only the filtered technical record remains. No executable checkpoint has returned to the lab.";
    case "full-archive":
      return "The full archive remains sealed under verified custody at Access 0. It cannot serve, deploy, or assist research.";
  }
}

export function MoratoriumResultDialog({
  item,
  onAcknowledge,
}: {
  readonly item: MoratoriumResultPresentationQueueItemView;
  readonly onAcknowledge: () => void;
}): ReactElement {
  const titleId = `moratorium-result-${item.key}`;
  const descriptionId = `moratorium-result-description-${item.key}`;
  const recoveryComplete = item.recoveryWeeksRemaining === 0;

  return (
    <div className="modal-backdrop endgame-return-backdrop">
      <section
        className="endgame-return-dialog moratorium-failed moratorium-result-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-modal-initial-focus
        tabIndex={-1}
      >
        <header>
          <p className="eyebrow">
            POST-RETIREMENT DIPLOMACY // MORATORIUM RESULT // WEEK {item.createdAtTick}
          </p>
          <span className="endgame-return-status failed">
            BLOCKING RESULT · ACKNOWLEDGEMENT REQUIRED
          </span>
        </header>

        <h2 id={titleId}>The Long Pause was rejected.</h2>
        <p className="endgame-return-deck" id={descriptionId}>
          Negotiations failed. Other programmes remain in the race.
        </p>

        <div className="endgame-return-verdict failed" role="status">
          <strong>NO DURABLE MORATORIUM</strong>
          <span>
            Retirement remains in force; {item.modelDisplayName} is not restored.
          </span>
        </div>

        <div className="endgame-return-grid moratorium-failure-grid">
          <section className="archive">
            <span>RETIRED ARTIFACT</span>
            <strong>{item.archiveDispositionName}</strong>
            <p>{archiveConsequence(item)}</p>
          </section>

          <section className="political-cost">
            <span>POLITICAL CONSEQUENCE</span>
            <strong>
              −{item.governmentTrustLost} trust · +{item.governmentAttentionAdded}{" "}
              attention
            </strong>
            <p>The failed appeal weakened the lab&apos;s standing.</p>
          </section>

          <section className="cooldown">
            <span>{recoveryComplete ? "RECOVERY COMPLETE" : "RECOVERY CONTINUES"}</span>
            <strong>
              {recoveryComplete
                ? "Ordinary lab operations may resume"
                : `${item.recoveryWeeksRemaining} recovery ${item.recoveryWeeksRemaining === 1 ? "week" : "weeks"} remain`}
            </strong>
            <p>
              {recoveryComplete
                ? "Return to the frontier after acknowledging this result."
                : `Quarantine continues until week ${item.recoveryEndsAtTick}. World clocks keep moving.`}
            </p>
          </section>
        </div>

        <footer className="moratorium-failure-action">
          <div>
            <strong>THE PAUSE FAILED · The run continues.</strong>
            <p>Acknowledge the result to continue.</p>
          </div>
          <button className="primary" type="button" onClick={onAcknowledge}>
            Acknowledge and continue
          </button>
        </footer>
      </section>
    </div>
  );
}
