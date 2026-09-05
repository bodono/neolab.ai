import type { ReactElement } from "react";

import type { PresentationQueueItemView } from "@neolab/sim/public";

type ResearcherPoachingPresentation = Extract<
  PresentationQueueItemView,
  { readonly kind: "researcher-poaching" }
>;

export function ResearcherPoachingDialog({
  item,
  onReview,
  onDefer,
}: {
  readonly item: ResearcherPoachingPresentation;
  readonly onReview: () => void;
  readonly onDefer: () => void;
}): ReactElement {
  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog exit-dialog researcher-poaching-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="researcher-poaching-title"
      >
        <p className="eyebrow">RIVAL APPROACH // RETENTION DECISION</p>
        <h2 id="researcher-poaching-title">
          {item.rivalLabName} is recruiting {item.researcherDisplayName}
        </h2>
        <p>
          {item.stage === "counteroffer"
            ? "A formal rival offer is now on the table."
            : "A competitor has opened a private recruitment channel."}{" "}
          The approach resolves in {item.resolvesInWeeks} week
          {item.resolvesInWeeks === 1 ? "" : "s"}.
        </p>
        <p className="confirmation-warning">
          {item.responseRecorded
            ? "Your retention response is recorded. The outcome is still uncertain."
            : "Review their dossier to submit a retention offer, or accept the risk that they leave."}
        </p>
        <div className="exit-dialog-actions">
          <button className="secondary" type="button" onClick={onDefer}>
            Decide later
          </button>
          <button className="primary" type="button" autoFocus onClick={onReview}>
            Review rival approach
          </button>
        </div>
      </section>
    </div>
  );
}
