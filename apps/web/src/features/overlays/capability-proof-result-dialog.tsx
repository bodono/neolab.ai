import type { ReactElement } from "react";

import type { CapabilityProofResultPresentationQueueItemView } from "@neolab/sim/public";

function headline(
  outcome: CapabilityProofResultPresentationQueueItemView["outcome"],
): string {
  if (outcome === "confirmed") return "Capability proof confirmed";
  if (outcome === "inconclusive") return "Capability proof inconclusive";
  return "Capability claim disputed";
}

function nextStep(
  outcome: CapabilityProofResultPresentationQueueItemView["outcome"],
): string {
  if (outcome === "confirmed") {
    return "Capability is established. Safety and deployment remain open.";
  }
  if (outcome === "inconclusive") {
    return "Capability remains uncertain. Continue, retire, or deploy with that uncertainty.";
  }
  return "The dispute is now part of the record. Another attempt costs more time.";
}

export function CapabilityProofResultDialog({
  item,
  onContinue,
}: {
  readonly item: CapabilityProofResultPresentationQueueItemView;
  readonly onContinue: () => void;
}): ReactElement {
  const titleId = `capability-proof-result-${item.historyId}`;
  return (
    <div className={`modal-backdrop proof-result-backdrop outcome-${item.outcome}`}>
      <section
        className={`capability-proof-result-dialog outcome-${item.outcome}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-summary`}
        tabIndex={-1}
        data-modal-initial-focus
      >
        <header>
          <p className="eyebrow">
            CAPABILITY PROOF // ATTEMPT {item.attemptNumber} // RESULT RECORDED
          </p>
          <h2 id={titleId}>{headline(item.outcome)}</h2>
          <p id={`${titleId}-summary`}>
            {item.modelDisplayName} · {item.summary}
          </p>
        </header>

        <div className="proof-result-verdict" role="status">
          <span>{item.resultId.replaceAll("-", " ")}</span>
          <strong>
            {item.outcome === "confirmed"
              ? `${item.claimScope} supported`
              : `${item.claimScope} not established`}
          </strong>
        </div>

        <dl className="proof-result-facts">
          <div>
            <dt>Challenge</dt>
            <dd>{item.challengeName}</dd>
          </div>
          <div>
            <dt>Verifier</dt>
            <dd>{item.verifierName}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{Math.round(item.evidenceStrength)}/100</dd>
          </div>
          <div>
            <dt>Integrity</dt>
            <dd>{item.integrityLabel}</dd>
          </div>
          <div>
            <dt>Access used</dt>
            <dd>{item.accessLevelAtProof}/5</dd>
          </div>
          <div>
            <dt>Resolved</dt>
            <dd>Week {item.createdAtTick}</dd>
          </div>
        </dl>

        <section className="proof-result-explanation">
          <p className="eyebrow">WHY THIS RESULT</p>
          <p>{item.explanation}</p>
        </section>

        {item.consequence === undefined ? null : (
          <section className="proof-result-consequence">
            <p className="eyebrow">IMMEDIATE CONSEQUENCE</p>
            <p>{item.consequence}</p>
          </section>
        )}

        <section className="proof-result-next">
          <p className="eyebrow">WHAT HAPPENS NEXT</p>
          <p>{nextStep(item.outcome)}</p>
        </section>

        <footer>
          <small>Saved to the proof record.</small>
          <button type="button" className="primary" onClick={onContinue}>
            Acknowledge result
          </button>
        </footer>
      </section>
    </div>
  );
}
