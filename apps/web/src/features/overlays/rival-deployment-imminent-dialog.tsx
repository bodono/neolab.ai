import type { ReactElement } from "react";

interface RivalDeploymentImminentWarning {
  readonly labName: string;
  readonly modelName: string;
  readonly estimateLabel: string;
  readonly confidence: "low" | "medium" | "high";
}

const POSSIBLE_OUTCOMES = [
  {
    title: "Rival ascendancy",
    detail: "A successful deployment ends the race in their favour.",
  },
  {
    title: "Global catastrophe",
    detail: "An unsafe deployment could escape control.",
  },
  {
    title: "Containment delay",
    detail: "A control failure may force delay or destruction of the candidate.",
  },
  {
    title: "False Dawn",
    detail:
      "The candidate may fail to demonstrate superintelligence and return them to the race.",
  },
] as const;

export function RivalDeploymentImminentDialog({
  warning,
  onOpenRivalWatch,
  onContinue,
}: {
  readonly warning: RivalDeploymentImminentWarning;
  readonly onOpenRivalWatch: () => void;
  readonly onContinue: () => void;
}): ReactElement {
  return (
    <div className="modal-backdrop rival-deployment-imminent-backdrop">
      <section
        className="purchase-dialog rival-deployment-imminent-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rival-deployment-imminent-title"
      >
        <p className="eyebrow">RACE EMERGENCY // FINAL DEPLOYMENT WINDOW</p>
        <h2 id="rival-deployment-imminent-title">RIVAL DEPLOYMENT IMMINENT</h2>
        <p className="rival-deployment-imminent-lede">
          <strong>{warning.labName}</strong> is preparing to deploy {warning.modelName}.
        </p>

        <div className="rival-deployment-window">
          <span>Estimated resolution</span>
          <strong>{warning.estimateLabel}</strong>
          <small>{warning.confidence} confidence · the deadline remains uncertain</small>
        </div>

        <div className="rival-deployment-outcomes">
          <p className="eyebrow">POSSIBLE OUTCOMES</p>
          <ul>
            {POSSIBLE_OUTCOMES.map((outcome) => (
              <li key={outcome.title}>
                <strong>{outcome.title}</strong>
                <span>{outcome.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="rival-deployment-imminent-warning">
          Their next result could end the race—or give you more time. None of these
          outcomes is guaranteed.
        </p>
        <div className="exit-dialog-actions">
          <button className="secondary" type="button" onClick={onContinue}>
            Resume the race
          </button>
          <button
            className="primary danger"
            type="button"
            autoFocus
            onClick={onOpenRivalWatch}
          >
            Open rival watch
          </button>
        </div>
      </section>
    </div>
  );
}
