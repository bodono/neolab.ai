import { useState, type ReactElement } from "react";

import {
  type EventQueueItemView,
  type EventQueueOptionView,
  type GameCommand,
  type GameView,
} from "@neolab/sim/public";

import type { BrowserGameRuntime } from "../../runtime/index.ts";
import {
  describeEventEffect,
  eventLikelihoodCopy,
  formatEventEvidenceValue,
} from "./decision-event-formatters.ts";
import { useEventCopy } from "./event-copy.ts";

const CANDIDATE_DECLARATION_EVENT_ID = "base:event.endgame.candidate-declaration";
const AUTONOMY_ESCALATION_EVENT_PREFIX = "base:event.autonomy.";

function candidatePostureEffects(optionId: string): readonly string[] {
  if (optionId === "quiet-review") {
    return ["First capability proof: +2 weeks for deeper internal review"];
  }
  if (optionId === "rapid-push") {
    return [
      "Candidate access: raised immediately to Access 3/5",
      "First capability proof: up to 2 weeks faster (never below zero)",
    ];
  }
  if (optionId === "notify-regulators") {
    return ["Candidate access unchanged · normal capability-proof schedule"];
  }
  return [];
}

export function DecisionEventDialog({
  item,
  view,
  runtime,
  closable,
  onClose,
  onResolved,
}: {
  readonly item: EventQueueItemView;
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly closable: boolean;
  readonly onClose: () => void;
  readonly onResolved: () => void;
}): ReactElement {
  const [pendingConfirmation, setPendingConfirmation] = useState<string>();
  const [error, setError] = useState<string>();
  const copy = useEventCopy();
  const isCandidateDeclaration = item.definitionId === CANDIDATE_DECLARATION_EVENT_ID;
  const isAutonomyEscalation = item.definitionId.startsWith(
    AUTONOMY_ESCALATION_EVENT_PREFIX,
  );

  function resolve(option: EventQueueOptionView): void {
    if (option.confirmationRequired && pendingConfirmation !== option.optionId) {
      setPendingConfirmation(option.optionId);
      setError(undefined);
      return;
    }
    const command = {
      kind: "respond-to-decision-event",
      meta: {
        commandId: `command:event:${item.instanceId}:${option.optionId}:${String(view.meta.tick)}`,
        expectedTick: view.meta.tick,
        issuedBy: "player",
      },
      instanceId: item.instanceId,
      optionId: option.optionId,
    } as GameCommand;
    try {
      runtime.dispatch(command);
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div
      className={`modal-backdrop event-backdrop severity-${item.severity}${
        isCandidateDeclaration ? " candidate-declaration-backdrop" : ""
      }${isAutonomyEscalation ? " autonomy-escalation-backdrop" : ""}`}
    >
      <section
        className={`event-dialog${
          isCandidateDeclaration ? " candidate-declaration-dialog" : ""
        }${isAutonomyEscalation ? " autonomy-escalation-dialog" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`event-title-${item.instanceId}`}
        data-testid={`decision-event-${item.severity}`}
        data-modal-initial-focus={isCandidateDeclaration ? "" : undefined}
        tabIndex={isCandidateDeclaration ? -1 : undefined}
      >
        <header className="event-dialog-header">
          <div>
            <p className="eyebrow">
              {isCandidateDeclaration
                ? "SUPERINTELLIGENCE ENDGAME // FINAL STAGE"
                : isAutonomyEscalation
                  ? `⚠ ROGUE AI // ${item.severity.toUpperCase()} SECURITY INCIDENT`
                  : item.tokens["INTERVENTION_ID"] === undefined
                    ? `${item.severity.toUpperCase()} // ${item.category.toUpperCase()}`
                    : "GOVERNMENT INTERVENTION // DECISION"}
            </p>
            <h2 id={`event-title-${item.instanceId}`}>
              {copy(item.titleKey, item.tokens, "title")}
            </h2>
          </div>
          <span className="event-deadline">{item.deadlineLabel}</span>
        </header>

        {isCandidateDeclaration ? (
          <section
            className="candidate-endgame-arrival"
            aria-label="Entering the singularity"
          >
            <p className="candidate-endgame-kicker">
              {copy("event.endgame.candidate.arrival.kicker", item.tokens, "title")}
            </p>
            <h3>{copy("event.endgame.candidate.arrival.title", item.tokens, "title")}</h3>
            <p>{copy("event.endgame.candidate.arrival.body", item.tokens, "body")}</p>
            <div className="candidate-victory-objective">
              <strong>
                {copy("event.endgame.candidate.objective.title", item.tokens, "title")}
              </strong>
              <p>{copy("event.endgame.candidate.objective.body", item.tokens, "body")}</p>
            </div>
          </section>
        ) : null}

        <p className="event-body">{copy(item.bodyKey, item.tokens, "body")}</p>

        {isCandidateDeclaration ? (
          <section className="candidate-next-steps" aria-label="What happens next">
            <h3>{copy("event.endgame.candidate.next.title", item.tokens, "title")}</h3>
            <ol>
              <li>{copy("event.endgame.candidate.next.confirm", item.tokens, "body")}</li>
              <li>{copy("event.endgame.candidate.next.contain", item.tokens, "body")}</li>
              <li>{copy("event.endgame.candidate.next.decide", item.tokens, "body")}</li>
            </ol>
          </section>
        ) : null}

        {item.evidence.length === 0 ? null : (
          <section className="event-evidence" aria-label="Available evidence">
            <h3>Available evidence</h3>
            <ul>
              {item.evidence.map((evidence, index) => (
                <li key={`${evidence.textKey}:${String(index)}`}>
                  <span>{copy(evidence.textKey, item.tokens, "evidence")}</span>
                  {evidence.value === undefined ? null : (
                    <strong>
                      {formatEventEvidenceValue(evidence.metric, evidence.value)}
                    </strong>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="event-options">
          {item.options.map((option) => {
            const label = copy(option.labelKey, item.tokens, "label");
            const confirming = pendingConfirmation === option.optionId;
            const guaranteedEffects = [...option.knownCosts, ...option.immediateEffects];
            const postureEffects = isCandidateDeclaration
              ? candidatePostureEffects(option.optionId)
              : [];
            return (
              <article key={option.optionId} className="event-option-card">
                <div>
                  <h3>{label}</h3>
                  <p>{copy(option.previewKey, item.tokens, "preview")}</p>
                </div>
                <span className="uncertainty-tag">{eventLikelihoodCopy(option)}</span>
                <section className="guaranteed-effects">
                  <strong>Guaranteed effects</strong>
                  {guaranteedEffects.length === 0 && postureEffects.length === 0 ? (
                    <p>No immediate stat change.</p>
                  ) : (
                    <ul>
                      {guaranteedEffects.map((effect, index) => (
                        <li key={`${effect.kind}:${String(index)}`}>
                          {describeEventEffect(effect)}
                        </li>
                      ))}
                      {postureEffects.map((effect) => (
                        <li key={effect}>{effect}</li>
                      ))}
                    </ul>
                  )}
                </section>
                {option.blockers.length === 0 ? null : (
                  <p className="validation-error">
                    {option.blockers
                      .map((blocker) => copy(blocker, item.tokens, "body"))
                      .join(" · ")}
                  </p>
                )}
                {confirming ? (
                  <p className="confirmation-warning">
                    This option asked for explicit confirmation. Review the known costs,
                    then confirm once more.
                  </p>
                ) : null}
                <button
                  className={confirming ? "primary danger" : "secondary"}
                  type="button"
                  disabled={!option.enabled}
                  onClick={() => resolve(option)}
                >
                  {confirming ? `Confirm: ${label}` : label}
                </button>
              </article>
            );
          })}
        </div>
        {error === undefined ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {closable ? (
          <footer className="event-dialog-actions">
            <button className="secondary event-defer" type="button" onClick={onClose}>
              Decide later — find this in the Lab feed
            </button>
          </footer>
        ) : (
          <p className="critical-lock">
            Critical decisions must be resolved before time advances.
          </p>
        )}
      </section>
    </div>
  );
}
