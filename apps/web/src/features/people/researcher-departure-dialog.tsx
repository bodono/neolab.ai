import type { ReactElement } from "react";

import {
  describeResearcherDeparture,
  type ResearcherDepartureReason,
} from "./researcher-departure-copy.ts";

export function ResearcherDepartureDialog({
  researcherName,
  reason,
  rivalLabName,
  onReviewPeople,
  onResume,
}: {
  readonly researcherName: string;
  readonly reason: ResearcherDepartureReason | undefined;
  readonly rivalLabName?: string;
  readonly onReviewPeople: () => void;
  readonly onResume: () => void;
}): ReactElement {
  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog exit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="researcher-departure-title"
      >
        <p className="eyebrow">PEOPLE ALERT // STAR RESEARCHER DEPARTED</p>
        <h2 id="researcher-departure-title">{researcherName} has left the lab</h2>
        <p>
          {reason === "poached" && rivalLabName !== undefined
            ? `They accepted an offer from ${rivalLabName}.`
            : describeResearcherDeparture(reason)}
        </p>
        <p className="confirmation-warning">
          Their bonuses no longer apply. The Lab feed records why they left.
        </p>
        <div className="exit-dialog-actions">
          <button className="secondary" type="button" onClick={onResume}>
            Acknowledge &amp; resume
          </button>
          <button className="primary" type="button" autoFocus onClick={onReviewPeople}>
            Review People
          </button>
        </div>
      </section>
    </div>
  );
}
