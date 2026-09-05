import type { ReactElement } from "react";

import { formatCapabilityScore } from "../models/capability-format.ts";

import type { GameView } from "../../runtime/index.ts";

type ActiveEndgame = Extract<GameView["endgame"], { readonly active: true }>;
export type CandidatePrior = GameView["models"]["candidateCustody"]["artifacts"][number];

function capabilityLabel(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function CandidatePriorNotice({
  artifact,
}: {
  readonly artifact: CandidatePrior;
}): ReactElement {
  return (
    <aside
      className="manual-command-target candidate-prior-notice"
      aria-label="Candidate lineage prior"
    >
      <span>SI BASE PRIOR // FIRST QUALIFICATION</span>
      <strong>
        {artifact.firstCrossingPriorPercent}% at FC{" "}
        {capabilityLabel(artifact.firstCrossingFrontierCapability)}
      </strong>
      <small>
        This lineage first qualified at FC{" "}
        {capabilityLabel(artifact.firstCrossingFrontierCapability)}, fixing a{" "}
        {artifact.firstCrossingPriorPercent}% public base chance of genuine
        superintelligence. It is a prior, not a finding.{" "}
        {artifact.currentFrontierCapability === undefined
          ? "Later variants and higher capability do not redraw it."
          : `Current FC ${capabilityLabel(artifact.currentFrontierCapability)} does not redraw it.`}
      </small>
    </aside>
  );
}

export function ConfirmationDecisionContext({
  endgame,
  currentTick,
  actionCost,
}: {
  readonly endgame?: ActiveEndgame;
  readonly currentTick?: number;
  readonly actionCost: string;
}): ReactElement {
  const clocks =
    endgame?.clocks
      .map((clock) => `${clock.label}: ${clock.estimateLabel}`)
      .join(" · ") ?? "";
  return (
    <div className="manual-command-target endgame-decision-context" role="status">
      <span>DECISION CONTEXT // CLOCKS AND COST</span>
      <strong>{actionCost}</strong>
      <small>
        {endgame === undefined
          ? `Week ${String(currentTick ?? 0)} · ordinary clocks are held while this order awaits you; they resume if you return`
          : `Crisis week ${String(endgame.weeksInCrisis)} · clocks held while this order awaits you; they resume if you return${clocks.length === 0 ? " · no external clock estimate" : ` · ${clocks}`}`}
      </small>
    </div>
  );
}

export function CandidateNominationConfirmationContent({
  accessLevel,
  artifact,
  currentTick,
  displayName,
  endgame,
  measuredFrontierCapability,
  inFlightTraining = [],
  onCancel,
  onConfirm,
  trainedAtTick,
}: {
  readonly accessLevel: number;
  readonly artifact: CandidatePrior;
  readonly currentTick?: number;
  readonly displayName: string;
  readonly endgame?: ActiveEndgame;
  readonly measuredFrontierCapability?: number;
  readonly inFlightTraining?: readonly {
    readonly projectId: string;
    readonly displayName: string;
    readonly progressLabel: string;
    readonly status: string;
  }[];
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly trainedAtTick: number;
}): ReactElement {
  return (
    <>
      <p className="eyebrow">FORMAL CANDIDACY // EXACT ARTIFACT</p>
      <h2 id="endgame-command-title">Nominate {displayName}?</h2>
      <p>
        This designates one specific weight artifact. Other qualifying models remain
        hazardous objects, but cannot be deployed for victory unless nominated later.
      </p>
      <div className="manual-command-target">
        <span>NOMINATION TARGET</span>
        <strong>{displayName}</strong>
        <small>
          Training record · week {String(trainedAtTick)} · Frontier capability{" "}
          {measuredFrontierCapability === undefined
            ? "unmeasured"
            : formatCapabilityScore(measuredFrontierCapability)}{" "}
          · Access {String(accessLevel)}/5
        </small>
      </div>
      <CandidatePriorNotice artifact={artifact} />
      {inFlightTraining.length === 0 ? null : (
        <aside
          className="manual-command-warnings candidate-training-commitment"
          role="alert"
        >
          <strong>TRAINING PROGRAMME STILL IN FLIGHT</strong>
          <p>
            Formal nomination commits the lab to these exact weights. Continuing with
            nomination abandons the following work with no refund:
          </p>
          <ul>
            {inFlightTraining.map((project) => (
              <li key={project.projectId}>
                {project.displayName} · {project.status} · {project.progressLabel}
              </li>
            ))}
          </ul>
        </aside>
      )}
      <ConfirmationDecisionContext
        actionCost={
          inFlightTraining.length === 0
            ? "No incremental preparation time or resource cost"
            : "Abandons all ordinary training now · spent cash and elapsed work are lost"
        }
        {...(endgame === undefined ? {} : { endgame })}
        {...(currentTick === undefined ? {} : { currentTick })}
      />
      <footer>
        <button type="button" className="secondary" onClick={onCancel}>
          {inFlightTraining.length === 0
            ? "Return to custody"
            : "Return and finish training"}
        </button>
        <button type="button" className="nomination-order" onClick={onConfirm}>
          {inFlightTraining.length === 0
            ? "Nominate exact artifact"
            : "Abandon training and nominate"}
        </button>
      </footer>
    </>
  );
}
