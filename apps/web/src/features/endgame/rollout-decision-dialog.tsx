import type { ReactElement } from "react";

import type { GameView } from "../../runtime/index.ts";

type ActiveEndgame = Extract<GameView["endgame"], { readonly active: true }>;
type RolloutAction = Extract<ActiveEndgame["stageActions"], { readonly kind: "rollout" }>;

const HAZARDOUS_OPTIONS = new Set([
  "defy-restriction",
  "allow-full-archive",
  "cancel-shutdown",
  "delegate-operation",
  "push-through",
]);

function humanLabel(value: string): string {
  return value.replaceAll("-", " ");
}

export function RolloutDecisionDialog({
  actions,
  onChoose,
  onDefer,
}: {
  readonly actions: RolloutAction;
  readonly onChoose: (id: string) => void;
  readonly onDefer: () => void;
}): ReactElement {
  const context = actions.decisionContext;
  const tone = context?.tone ?? "operational";

  return (
    <div className={`modal-backdrop rollout-decision-backdrop tone-${tone}`}>
      <section
        className={`rollout-decision-dialog rollout-decision-dialog-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rollout-decision-dialog-title"
      >
        <header>
          <div>
            <p className="eyebrow">
              {context?.eyebrow ?? "MID-ROLLOUT TWIST // DECISION REQUIRED"}
            </p>
            <h2 id="rollout-decision-dialog-title">
              {context?.title ?? "The route has met the world."}
            </h2>
            <p>
              {context?.body ??
                "Commitment did not remove human judgement. The route is held here while world clocks may continue."}
            </p>
          </div>
          <span>ROUTE DECISION OPEN</span>
        </header>

        <div className="rollout-decision-clock-warning">
          <span>{humanLabel(actions.currentBeat)} · route held</span>
          <strong>Decide now or defer. World clocks resume after this window.</strong>
        </div>

        <div className="rollout-decision-options">
          {actions.options.map((option, index) => (
            <button
              className={HAZARDOUS_OPTIONS.has(option.id) ? "hazardous" : undefined}
              key={option.id}
              type="button"
              onClick={() => onChoose(option.id)}
            >
              <span className="rollout-option-number">
                OPTION {String(index + 1).padStart(2, "0")}
              </span>
              <strong>{option.label}</strong>
              <small>{option.consequence}</small>
              <span className="rollout-option-action">Commit response →</span>
            </button>
          ))}
        </div>

        <footer>
          <p>Deferred choices remain in the crisis command room.</p>
          <button
            className="secondary rollout-decision-defer"
            type="button"
            onClick={onDefer}
          >
            Decide later
          </button>
        </footer>
      </section>
    </div>
  );
}
