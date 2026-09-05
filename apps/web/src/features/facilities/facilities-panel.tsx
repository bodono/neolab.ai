import { type ReactElement } from "react";

import { formatValuation, type GameView } from "@neolab/sim/public";

import { facilityCommand } from "../../app/command-builders.ts";
import { majorProjectActionLabel } from "../../app/major-projects.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { FacilityBenefitItem } from "./facility-benefit-item.tsx";
import { FacilityPixelIcon } from "./facility-pixel-icon.tsx";

type FacilityCatalogueItem = GameView["facilities"]["catalogue"][number];

function compactSummary(value: string): string {
  return value.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? value;
}

function FacilityCatalogueCard({
  facility,
  runtime,
  view,
}: {
  readonly facility: FacilityCatalogueItem;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
}): ReactElement {
  const command = facilityCommand(view, facility.definitionId);
  const validation = facility.upcoming ? undefined : runtime.validate(command);
  const blockers = facility.blockers;
  const needsFunding = blockers.some((blocker) =>
    blocker.toLowerCase().includes("insufficient cash"),
  );
  const unlockRequirement = facility.unmetPrerequisiteDisplayNames.join(" + ");
  const buttonLabel = facility.upcoming
    ? "Upcoming"
    : facility.completed
      ? "Built"
      : facility.building
        ? "Building"
        : facility.available
          ? majorProjectActionLabel(
              view,
              "Build",
              "Add to build queue",
              facility.majorProjectSlotsRequired,
            )
          : needsFunding
            ? "Need funds"
            : "Locked";
  const statusClass = facility.upcoming
    ? "upcoming"
    : facility.completed
      ? "facility-built"
      : facility.available
        ? "facility-buildable"
        : facility.building
          ? "facility-building"
          : "facility-locked";
  return (
    <article className={statusClass}>
      <FacilityPixelIcon
        family={facility.family}
        displayName={facility.displayName}
        tier={facility.tier}
        variantId={facility.definitionId}
      />
      <div>
        {facility.upcoming ? (
          <span className="facility-upcoming-chip">NEXT WAVE</span>
        ) : null}
        <h3>{facility.displayName}</h3>
        <p>{compactSummary(facility.summary)}</p>
        {facility.upcoming ? (
          <div className="facility-unlock-requirement">
            <strong>Unlocks after</strong>
            <span>{unlockRequirement} commissioned</span>
          </div>
        ) : null}
        <div className="facility-benefits">
          <strong>Effects</strong>
          <ul>
            {facility.benefits.map((benefit) => (
              <FacilityBenefitItem benefit={benefit} key={benefit.label} />
            ))}
          </ul>
        </div>
        <small>
          {formatValuation(facility.cashCostMillions)} up front ·{" "}
          {formatValuation(facility.operatingCostMillionsPerCycle)} / cycle ·{" "}
          {facility.durationWeeks} weeks · {facility.majorProjectSlotsRequired} project
          slot{facility.majorProjectSlotsRequired === 1 ? "" : "s"}
        </small>
        {facility.upcoming ||
        facility.completed ||
        facility.building ||
        blockers.length === 0 ? null : (
          <small className="facility-blocker-line">{blockers.join(" · ")}</small>
        )}
      </div>
      <button
        className="secondary"
        type="button"
        data-tutorial-target={
          facility.available
            ? facility.definitionId === "base:facility.server-rack"
              ? "build-server-rack"
              : "build-facility"
            : undefined
        }
        disabled={facility.upcoming || validation?.ok !== true || !facility.available}
        title={
          facility.upcoming
            ? `Complete ${unlockRequirement} to unlock this facility`
            : validation?.ok === true
              ? validation.preview.summary
              : blockers.join(" · ")
        }
        onClick={() => runtime.dispatch(command)}
      >
        {buttonLabel}
      </button>
    </article>
  );
}

export function FacilitiesPanel({
  runtime,
  view,
}: {
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
}): ReactElement {
  const constructionProjects = view.facilities.projects.filter(
    (project) =>
      project.kind === "construction" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  // Completed facilities live on the campus map. Keep this catalogue focused
  // on choices the player can still act on: buildable first, then in-progress,
  // then blocked. Ties keep catalogue order so the list is otherwise stable.
  const facilityActionRank = (facility: FacilityCatalogueItem): number =>
    facility.available ? 0 : facility.building ? 1 : 2;
  const currentWave = view.facilities.catalogue
    .filter((facility) => !facility.upcoming && !facility.completed)
    .map((facility, index) => ({ facility, index }))
    .sort(
      (left, right) =>
        facilityActionRank(left.facility) - facilityActionRank(right.facility) ||
        left.index - right.index,
    )
    .map((entry) => entry.facility);
  const nextWave = view.facilities.catalogue.filter((facility) => facility.upcoming);
  return (
    <section
      className="console-panel facilities-panel"
      aria-labelledby="facilities-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">PHYSICAL PLANT</p>
          <h2 id="facilities-title">Facilities & construction</h2>
        </div>
        <span>
          {view.facilities.capacity.availableMajorProjectSlots}/
          {view.facilities.capacity.majorProjectSlots} major-project slots free ·{" "}
          {view.facilities.capacity.installedOwnedGpuCount.toLocaleString("en-US")}/
          {view.facilities.capacity.supportedOwnedGpuCount.toLocaleString("en-US")} owned
          GPUs housed
        </span>
      </header>
      {constructionProjects.length === 0 ? null : (
        <div className="project-list">
          {constructionProjects.map((project) => (
            <article key={project.projectId}>
              <div>
                <strong>{project.displayName}</strong>
                <span>{project.status}</span>
              </div>
              <div className="project-track">
                <i
                  style={{
                    width: `${String((project.constructionProgressBasisPoints ?? 0) / 100)}%`,
                  }}
                />
              </div>
              <small>
                {project.progressLabel} · nominal {project.expectedDurationWeeks} weeks
              </small>
            </article>
          ))}
        </div>
      )}
      <div className="facility-catalogue">
        {currentWave.map((facility) => (
          <FacilityCatalogueCard
            facility={facility}
            key={facility.definitionId}
            runtime={runtime}
            view={view}
          />
        ))}
      </div>
      {nextWave.length === 0 ? null : (
        <section className="facility-next-wave" aria-labelledby="next-wave-title">
          <header>
            <div>
              <p className="eyebrow">CONSTRUCTION PIPELINE // ONE STEP AHEAD</p>
              <h3 id="next-wave-title">Next wave of facilities</h3>
            </div>
            <span>Preview</span>
          </header>
          <div className="facility-catalogue upcoming-wave">
            {nextWave.map((facility) => (
              <FacilityCatalogueCard
                facility={facility}
                key={facility.definitionId}
                runtime={runtime}
                view={view}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
