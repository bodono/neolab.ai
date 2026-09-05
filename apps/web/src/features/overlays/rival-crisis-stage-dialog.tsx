import type { ReactElement } from "react";

interface RivalCrisisStageAnnouncement {
  readonly labName: string;
  readonly modelName: string;
  readonly stage: string;
  readonly stageLabel: string;
  readonly previousStageLabel?: string;
  readonly kind: "entered" | "advanced" | "completed";
}

const STAGE_COPY: Readonly<Record<string, string>> = {
  confirmation: "Independent teams are testing the candidate's capability claim.",
  "containment-posture": "The lab is setting access and containment boundaries.",
  "evidence-sprint": "Evaluators and red teams are racing to build a safety case.",
  "pressure-collision":
    "Safety review has collided with political and commercial pressure.",
  "final-review":
    "Their institutions are turning the evidence into a final recommendation.",
  rollout: "The candidate is moving from testing into real operations.",
};

function headline(announcement: RivalCrisisStageAnnouncement): string {
  if (announcement.kind === "entered") {
    return `${announcement.labName} has entered the Deployment Crisis`;
  }
  if (announcement.kind === "completed") {
    return `${announcement.labName} has completed rollout`;
  }
  return `${announcement.labName} advances to ${announcement.stageLabel}`;
}

function transitionSummary(announcement: RivalCrisisStageAnnouncement): string {
  if (announcement.kind === "entered") {
    return `${announcement.modelName} has entered ${announcement.stageLabel}, the first stage of the rival's endgame deployment process.`;
  }
  if (announcement.kind === "completed") {
    return `${announcement.modelName} has left the final rollout stage. Their deployment process is complete.`;
  }
  return `${announcement.previousStageLabel ?? "The previous stage"} is complete. ${announcement.modelName} has now entered ${announcement.stageLabel}.`;
}

export function RivalCrisisStageDialog({
  announcement,
  onOpenRivalWatch,
  onContinue,
}: {
  readonly announcement: RivalCrisisStageAnnouncement;
  readonly onOpenRivalWatch: () => void;
  readonly onContinue: () => void;
}): ReactElement {
  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog rival-crisis-stage-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rival-crisis-stage-title"
      >
        <p className="eyebrow">RACE EMERGENCY // RIVAL DEPLOYMENT CRISIS</p>
        <h2 id="rival-crisis-stage-title">{headline(announcement)}</h2>
        <div className="rival-crisis-stage-transition">
          <span>{announcement.stageLabel}</span>
          <strong>{transitionSummary(announcement)}</strong>
        </div>
        <p>{STAGE_COPY[announcement.stage] ?? STAGE_COPY["confirmation"]}</p>
        <div className="exit-dialog-actions">
          <button className="secondary" type="button" onClick={onContinue}>
            Continue
          </button>
          <button className="primary" type="button" autoFocus onClick={onOpenRivalWatch}>
            Open rival watch
          </button>
        </div>
      </section>
    </div>
  );
}
