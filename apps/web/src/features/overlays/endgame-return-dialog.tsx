import type { ReactElement } from "react";

import type { EndgameReturnPresentationQueueItemView } from "@neolab/sim/public";

import { MoratoriumForecast } from "../endgame/moratorium-forecast.tsx";

export type FalseDawnNextPath = "successor-programme" | "durable-moratorium";

export function EndgameReturnDialog({
  item,
  onChoose,
}: {
  readonly item: EndgameReturnPresentationQueueItemView;
  readonly onChoose: (path: FalseDawnNextPath) => void;
}): ReactElement {
  const titleId = `endgame-return-${item.key}`;
  const descriptionId = `endgame-return-description-${item.key}`;

  if (item.phase === "moratorium-failed") {
    return (
      <div className="modal-backdrop endgame-return-backdrop">
        <section
          className="endgame-return-dialog false-dawn moratorium-failed"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-modal-initial-focus
          tabIndex={-1}
        >
          <header>
            <p className="eyebrow">
              FALSE DAWN // MORATORIUM RESULT // WEEK {item.createdAtTick}
            </p>
            <span className="endgame-return-status failed">
              BLOCKING RESULT · DECISION REQUIRED
            </span>
          </header>

          <h2 id={titleId}>The Long Pause attempt failed</h2>
          <p className="endgame-return-deck" id={descriptionId}>
            The moratorium failed. The race continues without {item.modelDisplayName}.
          </p>

          <div className="endgame-return-verdict failed" role="status">
            <strong>NO INTERNATIONAL PAUSE</strong>
            <span>The archive remains sealed at Access 0.</span>
          </div>

          <div className="endgame-return-grid moratorium-failure-grid">
            <section className="archive">
              <span>ARCHIVE STATUS</span>
              <strong>{item.modelDisplayName} · Sealed at Access 0</strong>
              <p>These weights cannot serve, deploy, or train a successor.</p>
            </section>

            <section className="political-cost">
              <span>POLITICAL COST</span>
              <strong>Government trust fell · Attention rose</strong>
              <p>The failed appeal weakened the lab and drew more scrutiny.</p>
            </section>

            <section className="cooldown">
              <span>THE RACE AND CANDIDACY COOLDOWN CONTINUE</span>
              <strong>
                {item.remainingCooldownWeeks} of {item.cooldownWeeks} cooldown weeks
                remain
              </strong>
              <p>
                Training may resume. Nominations reopen in week {item.cooldownUntilTick}.
              </p>
            </section>
          </div>

          <footer className="moratorium-failure-action">
            <div>
              <strong>THE PAUSE FAILED · Return without the archive.</strong>
            </div>
            <button
              className="primary"
              type="button"
              onClick={() => onChoose("successor-programme")}
            >
              Return to the race
            </button>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-backdrop endgame-return-backdrop">
      <section
        className="endgame-return-dialog false-dawn"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-modal-initial-focus
        tabIndex={-1}
      >
        <header>
          <p className="eyebrow">
            FALSE DAWN // NOT GAME OVER // WEEK {item.createdAtTick}
          </p>
          <span className="endgame-return-status">THE RACE CONTINUES</span>
        </header>

        <h2 id={titleId}>{item.modelDisplayName} was not superintelligence</h2>
        <p className="endgame-return-deck" id={descriptionId}>
          This is powerful Near-AGI, not superintelligence. The crisis ends; the run
          continues.
        </p>

        <div className="endgame-return-verdict" role="status">
          <strong>FALSE DAWN</strong>
          <span>{item.endingSummary}</span>
        </div>

        <div className="endgame-return-grid">
          <section>
            <span>TIME AND MOMENTUM LOST</span>
            <strong>
              {item.crisisWeeksSpent === 0
                ? "No preparation time recovered"
                : `${String(item.crisisWeeksSpent)} crisis ${item.crisisWeeksSpent === 1 ? "week" : "weeks"} spent`}
            </strong>
            <p>
              Spent time and resources are not restored. World clocks are not rewound.
            </p>
          </section>

          <section>
            <span>THE MODEL REMAINS USABLE</span>
            <strong>Regular model · Access {item.restoredAccessLevel}</strong>
            <p>
              {item.modelDisplayName} remains available for serving, productisation,
              evaluations, and RSI. Product Quality: {Math.round(item.productQuality)}
              /100. This artifact cannot be nominated again.
            </p>
          </section>

          <section className="cooldown">
            <span>CANDIDACY COOLDOWN</span>
            <strong>{item.cooldownWeeks}-week nomination cooldown</strong>
            <p>
              {item.remainingCooldownWeeks} weeks remain. Training continues; qualifying
              weights wait in custody.
            </p>
          </section>
        </div>

        <footer>
          <div>
            <strong>NOT GAME OVER · Choose what the lab does next.</strong>
            <p>Build a successor or seek a durable moratorium.</p>
          </div>
        </footer>

        <div className="endgame-return-paths" aria-label="Choose the lab's future">
          <article>
            <span>RETURN TO THE RACE</span>
            <h3>Begin a successor programme</h3>
            <p>
              Train a new lineage now. Nominations remain closed for {item.cooldownWeeks}{" "}
              weeks while rivals keep moving.
            </p>
            <small>Serving, evaluations, and RSI continue during the cooldown.</small>
            <button
              className="primary"
              type="button"
              onClick={() => onChoose("successor-programme")}
            >
              Begin successor programme
            </button>
          </article>
          <article
            className={item.durableMoratoriumAvailable ? undefined : "unavailable"}
          >
            <span>THE LONG PAUSE</span>
            <h3>Seek a durable moratorium</h3>
            {item.durableMoratoriumAvailable ? (
              <>
                <p>
                  Seal {item.modelDisplayName} at Access 0 and begin an eight-week
                  diplomatic campaign. The archive stays sealed even if talks fail.
                </p>
                <small>Trust and verification help; rival readiness hurts.</small>
                <MoratoriumForecast forecast={item.moratoriumForecast} compact />
              </>
            ) : (
              <>
                <p>
                  Released weights cannot be recalled, so this artifact cannot anchor a
                  verified pause.
                </p>
                <small>{item.durableMoratoriumBlocker}</small>
              </>
            )}
            <button
              className="secondary"
              type="button"
              disabled={!item.durableMoratoriumAvailable}
              onClick={() => onChoose("durable-moratorium")}
            >
              {item.durableMoratoriumAvailable
                ? "Surrender model and seek moratorium"
                : "Long Pause unavailable"}
            </button>
          </article>
        </div>
      </section>
    </div>
  );
}
