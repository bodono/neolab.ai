import type { ReactElement } from "react";

import type {
  CandidateContainmentIncidentPresentationQueueItemView,
  ModelIncidentPresentationQueueItemView,
} from "@neolab/sim/public";
import { formatValuation } from "@neolab/sim/public";

function AlarmMark(): ReactElement {
  return (
    <div className="incident-alarm-mark" aria-hidden="true">
      <span>!</span>
    </div>
  );
}

export function ModelIncidentAlertDialog({
  item,
  onAcknowledge,
  onReview,
}: {
  readonly item: ModelIncidentPresentationQueueItemView;
  readonly onAcknowledge: () => void;
  readonly onReview: () => void;
}): ReactElement {
  const titleId = `model-incident-alert-${item.key}`;
  const resultTitle =
    item.emergencyOutcome === "succeeded"
      ? "CONTAINMENT SUCCEEDED"
      : item.emergencyOutcome === "failed"
        ? "CONTAINMENT FAILED"
        : `WARNING: ${item.modelDisplayName} caused an incident.`;
  const hasDirectPenalty =
    item.auraLoss > 0 ||
    item.fineMillions > 0 ||
    item.governmentTrustLost > 0 ||
    item.governmentAttentionAdded > 0 ||
    item.hardwareGpusDestroyed > 0 ||
    item.researchOutputReductionPercent > 0;
  return (
    <div className="modal-backdrop incident-alert-backdrop">
      <section
        className={`incident-alert-dialog model-incident-alert severity-${item.category}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-modal-initial-focus
        tabIndex={-1}
      >
        <div className="incident-alarm-stripe" />
        <header>
          <AlarmMark />
          <div>
            <p className="eyebrow">AI INCIDENT // WEEK {item.createdAtTick}</p>
            <strong>{item.threatLabel}</strong>
          </div>
          <span>
            {item.category.toUpperCase()} · SEVERITY {Math.round(item.severity)}
          </span>
        </header>
        <h2 id={titleId}>{resultTitle}</h2>
        <p className="incident-alert-headline">{item.headline}</p>

        <section className="incident-alert-consequences" aria-label="Consequences">
          <strong>IMMEDIATE CONSEQUENCES</strong>
          <ul>
            {item.auraLoss > 0 ? <li>−{item.auraLoss} Aura</li> : null}
            {item.fineMillions > 0 ? (
              <li>
                {formatValuation(item.fineMillions)}{" "}
                {item.cashLossLabel ?? "regulatory fine"}
              </li>
            ) : null}
            {item.governmentTrustLost > 0 ? (
              <li>−{item.governmentTrustLost} Government trust</li>
            ) : null}
            {item.governmentAttentionAdded > 0 ? (
              <li>+{item.governmentAttentionAdded} Government attention</li>
            ) : null}
            {item.hardwareGpusDestroyed > 0 ? (
              <li>
                {item.hardwareGpusDestroyed.toLocaleString("en-GB")} installed GPUs
                destroyed
              </li>
            ) : null}
            {item.researchOutputReductionPercent > 0 ? (
              <li>
                −{item.researchOutputReductionPercent}% research output
                {item.researchOutputDurationWeeks === undefined
                  ? " permanently"
                  : ` for ${String(item.researchOutputDurationWeeks)} weeks`}
              </li>
            ) : null}
            {!hasDirectPenalty && !item.terminalOutcome ? (
              <li>No direct cash or Aura loss</li>
            ) : null}
            {item.terminalOutcome ? <li>Reliable human control is lost</li> : null}
            {!item.terminalOutcome ? <li>Valuation risk record updated</li> : null}
          </ul>
        </section>

        <footer>
          <p>The full incident remains in the Lab feed.</p>
          <div>
            <button
              className="secondary incident-dismiss"
              type="button"
              onClick={onAcknowledge}
            >
              {item.terminalOutcome ? "Reveal final outcome" : "Acknowledge alarm"}
            </button>
            {!item.terminalOutcome ? (
              <button className="primary danger" type="button" onClick={onReview}>
                Review model safety
              </button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}

export function CandidateContainmentIncidentAlertDialog({
  item,
  onAcknowledge,
  onReview,
}: {
  readonly item: CandidateContainmentIncidentPresentationQueueItemView;
  readonly onAcknowledge: () => void;
  readonly onReview: () => void;
}): ReactElement {
  const titleId = `candidate-incident-alert-${item.key}`;
  return (
    <div className="modal-backdrop incident-alert-backdrop candidate-incident-backdrop">
      <section
        className={`incident-alert-dialog candidate-incident-alert signal-${item.incidentKind}${item.localBreach ? " local-breach" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-modal-initial-focus
        tabIndex={-1}
      >
        <div className="incident-alarm-stripe" />
        <header>
          <AlarmMark />
          <div>
            <p className="eyebrow">
              CANDIDATE CUSTODY ALARM // WEEK {item.createdAtTick}
            </p>
            <strong>{item.classLabel}</strong>
          </div>
          <span>
            {item.incidentKind === "warning" ? "SIGNAL UNRESOLVED" : "ACTIVE HAZARD"}
          </span>
        </header>
        <h2 id={titleId}>CONTAINMENT ALERT: {item.modelDisplayName}</h2>
        <p className="incident-alert-headline">{item.headline}</p>

        <section className="incident-alert-consequences" aria-label="Consequences">
          <strong>CANDIDACY HALTED</strong>
          <p>{item.consequence}</p>
          <ul>
            <li>Nomination and deployment are blocked</li>
            <li>Containment review is required</li>
            {item.localBreach ? <li>Control and security systems were damaged</li> : null}
          </ul>
        </section>

        <footer>
          <p>This alarm remains visible in candidate custody until resolved.</p>
          <div>
            <button
              className="secondary incident-dismiss"
              type="button"
              onClick={onAcknowledge}
            >
              Review later
            </button>
            <button className="primary danger" type="button" onClick={onReview}>
              Open custody controls
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
