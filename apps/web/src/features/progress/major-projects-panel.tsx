import { type ReactElement } from "react";

import type { GameView } from "@neolab/sim/public";

import { MechanicHelp } from "../help/mechanic-help.tsx";

type ProjectView = GameView["facilities"]["projects"][number];

function projectKindLabel(kind: ProjectView["kind"]): string {
  switch (kind) {
    case "agi-component":
      return "Candidate Programme";
    case "training":
      return "Model training";
    case "evaluation":
      return "Model evaluation";
    case "anomaly-investigation":
      return "Anomaly follow-up";
    case "productisation":
      return "Release engineering";
    case "fundraising":
      return "Fundraising";
    case "lobbying":
      return "Government work";
    case "coalition":
      return "Coalition work";
    case "construction":
      return "Construction";
    case "crisis":
      return "Crisis response";
    case "researcher-commitment":
      return "Researcher promise";
  }
}

export function MajorProjectsPanel({ view }: { readonly view: GameView }): ReactElement {
  const capacity = view.facilities.capacity;
  const activeProjects = view.facilities.projects
    .filter(
      (project) =>
        project.majorProjectSlotsReserved > 0 &&
        (project.status === "active" || project.status === "paused"),
    )
    .sort(
      (left, right) => Number(left.kind === "crisis") - Number(right.kind === "crisis"),
    );
  // The crisis floor can commit the lab beyond its slot total; the overflow
  // renders as explicit surge cards rather than vanishing or reading "7/5".
  const surgeSlots = Math.max(
    0,
    capacity.occupiedMajorProjectSlots - capacity.majorProjectSlots,
  );
  const queuedProjects = view.facilities.projects.filter(
    (project) => project.majorProjectSlotsReserved > 0 && project.status === "queued",
  );
  const slotAssignments = [
    ...activeProjects
      .filter((project) => project.kind !== "crisis")
      .flatMap((project) =>
        Array.from(
          { length: project.majorProjectSlotsReserved },
          (_, reservationIndex) => ({
            kind: "project" as const,
            project,
            reservationIndex,
          }),
        ),
      ),
    ...(capacity.recoveryMajorProjectSlots === 1 ? [{ kind: "recovery" as const }] : []),
    ...activeProjects
      .filter((project) => project.kind === "crisis")
      .flatMap((project) =>
        Array.from(
          { length: project.majorProjectSlotsReserved },
          (_, reservationIndex) => ({
            kind: "project" as const,
            project,
            reservationIndex,
          }),
        ),
      ),
  ];
  const overflowAssignments = slotAssignments.slice(capacity.majorProjectSlots);
  const overflowIsCrisisSurge =
    overflowAssignments.length > 0 &&
    overflowAssignments.every(
      (assignment) =>
        assignment.kind === "project" && assignment.project.kind === "crisis",
    );
  const capacityState =
    capacity.occupiedMajorProjectSlots === 0
      ? "idle"
      : capacity.occupiedMajorProjectSlots >= capacity.majorProjectSlots
        ? "full"
        : "active";
  const capacityStatus =
    capacityState === "idle"
      ? "ALL SLOTS FREE"
      : capacityState === "full"
        ? "ALL SLOTS BUSY"
        : "WORK IN PROGRESS";

  return (
    <section
      className={`console-panel major-projects-panel capacity-${capacityState}`}
      aria-labelledby="major-projects-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">EXECUTIVE CAPACITY // CONCURRENT WORK</p>
          <h2 id="major-projects-title">Major projects</h2>
        </div>
        <div className="panel-heading-tools">
          <div className={`major-project-capacity-status ${capacityState}`}>
            <strong>{capacityStatus}</strong>
            <span>
              {Math.min(capacity.occupiedMajorProjectSlots, capacity.majorProjectSlots)}/
              {capacity.majorProjectSlots} slots in use
              {surgeSlots === 0
                ? ""
                : ` · +${String(surgeSlots)} ${overflowIsCrisisSurge ? "crisis surge" : "emergency overload"}`}
              {queuedProjects.length === 0
                ? ""
                : ` · ${String(queuedProjects.length)} queued`}
            </span>
          </div>
          <MechanicHelp label="Major-project slots">
            Training, evaluations, construction, fundraising, and crisis work use slots
            while active. Queued work starts when a slot opens.
          </MechanicHelp>
        </div>
      </header>

      <div className="major-project-capacity-explainer">
        <dl>
          <div>
            <dt>BASE SLOTS</dt>
            <dd>
              {capacity.baseMajorProjectSlots} slot
              {capacity.baseMajorProjectSlots === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt>FACILITY SLOTS</dt>
            <dd>+{capacity.facilityBonusMajorProjectSlots} slots</dd>
          </div>
          <div>
            <dt>CURRENT CAPACITY</dt>
            <dd>
              {capacity.majorProjectSlots} of {capacity.maximumMajorProjectSlots} possible
            </dd>
          </div>
        </dl>
      </div>

      <div className="major-project-slot-grid">
        {Array.from(
          { length: capacity.majorProjectSlots + surgeSlots },
          (_, slotIndex) => {
            const assignment = slotAssignments[slotIndex];
            const isSurge = slotIndex >= capacity.majorProjectSlots;
            const isCrisis =
              assignment?.kind === "project" && assignment.project.kind === "crisis";
            const isRecovery = assignment?.kind === "recovery";
            return (
              <article
                className={`${assignment === undefined ? "free" : "occupied"}${isCrisis ? " crisis" : ""}${isRecovery ? " recovery" : ""}${isSurge ? " surge" : ""}`}
                key={slotIndex}
              >
                <header>
                  <span>
                    {isSurge
                      ? `${isCrisis ? "SURGE" : "OVERFLOW"} ${String(slotIndex - capacity.majorProjectSlots + 1)}`
                      : `SLOT ${String(slotIndex + 1)}`}
                  </span>
                  <strong>
                    {assignment === undefined
                      ? "FREE"
                      : isCrisis
                        ? "CRISIS"
                        : isRecovery
                          ? "RECOVERY"
                          : "IN USE"}
                  </strong>
                </header>
                {assignment === undefined ? (
                  <>
                    <h3>Ready for a major project</h3>
                    <p>Available</p>
                  </>
                ) : assignment.kind === "recovery" ? (
                  <>
                    <h3>Post-retirement recovery</h3>
                    <p>Quarantine and supervised rebuilding</p>
                    <small>Reserved until the recovery obligation is complete</small>
                  </>
                ) : (
                  <>
                    <h3>{assignment.project.displayName}</h3>
                    <p>
                      {projectKindLabel(assignment.project.kind)}
                      {assignment.project.majorProjectSlotsReserved > 1
                        ? ` · reservation ${String(assignment.reservationIndex + 1)} of ${String(assignment.project.majorProjectSlotsReserved)}`
                        : ""}
                    </p>
                    <small>{assignment.project.progressLabel}</small>
                  </>
                )}
              </article>
            );
          },
        )}
      </div>

      {queuedProjects.length === 0 ? null : (
        <section className="major-project-queue" aria-labelledby="project-queue-title">
          <header>
            <h3 id="project-queue-title">Waiting queue</h3>
            <span>Crisis first · then queue order</span>
          </header>
          <div>
            {queuedProjects.map((project, index) => (
              <article key={project.projectId}>
                <span>#{index + 1}</span>
                <div>
                  <strong>{project.displayName}</strong>
                  <small>{projectKindLabel(project.kind)}</small>
                </div>
                <em>{project.progressLabel}</em>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
