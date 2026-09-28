import type { ReactElement } from "react";

import type { CaretakerReturnPresentationQueueItemView } from "@neolab/sim/public";

export function CaretakerReturnDialog({
  item,
  onAcknowledge,
}: {
  readonly item: CaretakerReturnPresentationQueueItemView;
  readonly onAcknowledge: () => void;
}): ReactElement {
  const titleId = `caretaker-return-${item.key}`;
  const descriptionId = `caretaker-return-description-${item.key}`;

  return (
    <div className="modal-backdrop endgame-return-backdrop">
      <section
        className="endgame-return-dialog caretaker-return"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-modal-initial-focus
        tabIndex={-1}
      >
        <header>
          <p className="eyebrow">THE CARETAKER // NOT GAME OVER</p>
          <span className="endgame-return-status">THE RACE CONTINUES</span>
        </header>

        <h2 id={titleId}>{item.modelDisplayName} stays in service, bounded</h2>
        <p className="endgame-return-deck" id={descriptionId}>
          Control held, but the promised transformation did not arrive. The crisis ends;
          the run continues.
        </p>

        <div className="endgame-return-verdict" role="status">
          <strong>{item.endingDisplayName.toUpperCase()}</strong>
          <span>{item.mechanicalCause}</span>
        </div>

        <div className="endgame-return-grid">
          <section>
            <span>TIME AND MOMENTUM LOST</span>
            <strong>
              {item.crisisWeeksSpent === 0
                ? "No crisis weeks spent"
                : `${String(item.crisisWeeksSpent)} crisis ${item.crisisWeeksSpent === 1 ? "week" : "weeks"} spent`}
            </strong>
            <p>
              Spent time and resources are not restored. World clocks are not rewound.
            </p>
          </section>

          <section>
            <span>THE SYSTEM STAYS IN SERVICE</span>
            <strong>Regular model · Access {item.accessLevel}</strong>
            <p>
              {item.modelDisplayName} returns to its pre-nomination access. This artifact
              cannot be nominated again.
            </p>
          </section>

          <section className="cooldown">
            <span>CANDIDACY COOLDOWN</span>
            <strong>{item.cooldownWeeks}-week nomination cooldown</strong>
            <p>
              {item.remainingCooldownWeeks} weeks remain. Training continues; qualifying
              successors wait in custody.
            </p>
          </section>
        </div>

        <footer className="moratorium-failure-action">
          <div>
            <strong>NOT GAME OVER · The race continues.</strong>
            <p>Acknowledge the result to return to the lab.</p>
          </div>
          <button className="primary" type="button" onClick={onAcknowledge}>
            Acknowledge and continue
          </button>
        </footer>
      </section>
    </div>
  );
}
