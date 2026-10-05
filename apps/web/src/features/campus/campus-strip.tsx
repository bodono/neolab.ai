import type { CSSProperties, ReactElement } from "react";

import type { CampusView } from "@neolab/sim/public";

import { FacilityPixelIcon } from "../facilities/facility-pixel-icon.tsx";
import { PixelPortrait } from "../portraits/pixel-portrait.tsx";

const CAMPUS_RENDER_LIMITS = {
  facilities: 16,
  constructionProjects: 4,
  namedPeople: 8,
  decorativeStaff: 30,
  sceneCues: 3,
} as const;

type CampusVisualKind =
  | "headquarters"
  | "compute"
  | "utilities"
  | "safety"
  | "research"
  | "robotics"
  | "commons"
  | "general";

type PlotStyle = CSSProperties &
  Readonly<Record<"--plot-dx" | "--plot-dy" | "--plot-tilt", string>>;

type PersonStyle = CSSProperties &
  Readonly<
    Record<
      | "--campus-person-x"
      | "--campus-person-y"
      | "--campus-person-delay"
      | "--campus-person-distance"
      | "--campus-person-drift-y"
      | "--campus-person-duration",
      string
    >
  >;

type CampusFacility = CampusView["facilities"][number];
type CampusProject = CampusView["construction"][number];
type CampusPerson = CampusView["namedPeople"][number];

/**
 * The campus is a town plan: a north-south avenue and an east-west street
 * cross in the middle, and every building stands on its own plot in one of the
 * four quarters between them. Plots are grid cells, so buildings and their
 * labels cannot overlap however many the lab owns; the jitter only nudges each
 * tile inside its own plot so the estate does not look ruled.
 */
const QUADRANTS = ["north-west", "north-east", "south-west", "south-east"] as const;

type Quadrant = (typeof QUADRANTS)[number];

type CampusPlot =
  | {
      readonly kind: "facility";
      readonly key: string;
      readonly facility: CampusFacility;
      readonly people: readonly CampusPerson[];
    }
  | {
      readonly kind: "construction";
      readonly key: string;
      readonly project: CampusProject;
    }
  | {
      /** Star researchers whose building is not drawn gather on the lawn. */
      readonly kind: "lawn";
      readonly key: string;
      readonly people: readonly CampusPerson[];
    };

type WalkerRoute = "street" | "avenue" | "lawn";

const PLOT_TILTS = [-1, 0.8, -0.4, 1.1, -1.3] as const;

function visualKind(family: string, module: string): CampusVisualKind {
  const source = `${family} ${module}`;
  if (/data|inference|compute/.test(source)) return "compute";
  if (/power|cooling/.test(source)) return "utilities";
  if (/alignment|eval|security|bunker|containment/.test(source)) return "safety";
  if (/robot/.test(source)) return "robotics";
  if (/scientific|research|interpret/.test(source)) return "research";
  if (/commons|staff/.test(source)) return "commons";
  if (/headquarters|office/.test(source)) return "headquarters";
  return "general";
}

function sceneClass(campus: CampusView): string {
  return campus.sceneCues
    .slice(0, CAMPUS_RENDER_LIMITS.sceneCues)
    .map((cue) => `scene-${cue.kind}`)
    .join(" ");
}

function plotStyle(index: number): PlotStyle {
  return {
    "--plot-dx": `${String(((index * 37) % 11) - 5)}px`,
    "--plot-dy": `${String(((index * 23) % 9) - 4)}px`,
    "--plot-tilt": `${String(PLOT_TILTS[index % PLOT_TILTS.length])}deg`,
  };
}

/** Each star researcher stands at the first drawn building on their module. */
function campusPlots(
  buildings: readonly CampusFacility[],
  projects: readonly CampusProject[],
  people: readonly CampusPerson[],
): readonly CampusPlot[] {
  const buildingByModule = new Map<string, CampusFacility>();
  for (const building of buildings) {
    if (!buildingByModule.has(building.campusModule)) {
      buildingByModule.set(building.campusModule, building);
    }
  }
  const lawn = people.filter((person) => !buildingByModule.has(person.locationModule));
  return [
    ...buildings.map((facility, index): CampusPlot => ({
      kind: "facility",
      key: facility.facilityId ?? `${facility.definitionId}:${String(index)}`,
      facility,
      people:
        buildingByModule.get(facility.campusModule) === facility
          ? people.filter((person) => person.locationModule === facility.campusModule)
          : [],
    })),
    ...projects.map((project): CampusPlot => ({
      kind: "construction",
      key: project.projectId,
      project,
    })),
    ...(lawn.length === 0 ? [] : [{ kind: "lawn" as const, key: "lawn", people: lawn }]),
  ];
}

/** Plots are dealt round the quarters so a young lab spreads across the map. */
function plotsByQuadrant(
  plots: readonly CampusPlot[],
): ReadonlyMap<
  Quadrant,
  readonly { readonly plot: CampusPlot; readonly index: number }[]
> {
  const quadrants = new Map<Quadrant, { plot: CampusPlot; index: number }[]>(
    QUADRANTS.map((quadrant) => [quadrant, []]),
  );
  plots.forEach((plot, index) => {
    quadrants.get(QUADRANTS[index % QUADRANTS.length]!)?.push({ plot, index });
  });
  return quadrants;
}

/** Staff walk the street and the avenue; a few cut across the lawns behind the buildings. */
function walkerRoute(index: number): WalkerRoute {
  return index % 3 === 0 ? "street" : index % 3 === 1 ? "avenue" : "lawn";
}

function personStyle(index: number, route: WalkerRoute): PersonStyle {
  const along = 3 + ((index * 23) % 94);
  const motion = {
    "--campus-person-delay": `${String(-((index * 1.9) % 13))}s`,
    "--campus-person-distance": `${String((index % 2 === 0 ? 1 : -1) * (18 + ((index * 11) % 42)))}px`,
    "--campus-person-duration": "12s",
  };
  switch (route) {
    case "street":
      return {
        "--campus-person-x": `${String(along)}%`,
        "--campus-person-y": index % 2 === 0 ? "3px" : "9px",
        "--campus-person-drift-y": "0px",
        ...motion,
      };
    case "avenue":
      return {
        "--campus-person-x": index % 2 === 0 ? "7px" : "20px",
        "--campus-person-y": `${String(along)}%`,
        "--campus-person-drift-y": "0px",
        ...motion,
      };
    case "lawn":
      return {
        "--campus-person-x": `${String(12 + ((index * 23) % 73))}%`,
        "--campus-person-y": `${String(25 + ((index * 17) % 61))}%`,
        "--campus-person-drift-y": "8px",
        ...motion,
      };
  }
}

/** Star researchers sway on the spot, so a badge never leaves its own plot. */
function namedPersonStyle(index: number): PersonStyle {
  return {
    "--campus-person-x": "0px",
    "--campus-person-y": "0px",
    "--campus-person-delay": `${String(-((index * 2.7) % 17))}s`,
    "--campus-person-distance": `${String(index % 2 === 0 ? 4 : -4)}px`,
    "--campus-person-drift-y": "0px",
    "--campus-person-duration": `${String(13 + ((index * 3) % 8))}s`,
  };
}

function Walkers({
  route,
  count,
}: {
  readonly route: WalkerRoute;
  readonly count: number;
}): ReactElement {
  return (
    <>
      {Array.from({ length: count }, (_, index) => index)
        .filter((index) => walkerRoute(index) === route)
        .map((index) => (
          <span
            className={`campus-map-staff staff-${String(index % 6)} on-${route}`}
            key={`staff:${String(index)}`}
            style={personStyle(index, route)}
            aria-hidden="true"
          >
            <i />
          </span>
        ))}
    </>
  );
}

export function CampusStrip({
  campus,
  dateLabel,
  paused = false,
  onInspectFacility,
  onInspectResearcher,
}: {
  readonly campus: CampusView;
  readonly dateLabel: string;
  readonly paused?: boolean;
  readonly onInspectFacility?: (facility: CampusView["facilities"][number]) => void;
  readonly onInspectResearcher?: (researcherId: string) => void;
}): ReactElement {
  const buildings = campus.facilities.slice(0, CAMPUS_RENDER_LIMITS.facilities);
  const projects = campus.construction.slice(
    0,
    CAMPUS_RENDER_LIMITS.constructionProjects,
  );
  const namedPeople = campus.namedPeople.slice(0, CAMPUS_RENDER_LIMITS.namedPeople);
  const namedPersonIndex = new Map(
    namedPeople.map((person, index) => [person.researcherId, index]),
  );
  const quadrants = plotsByQuadrant(campusPlots(buildings, projects, namedPeople));
  const decorativeStaffCount = Math.min(
    CAMPUS_RENDER_LIMITS.decorativeStaff,
    Math.max(
      8,
      campus.decorativeStaffCount * 2 + buildings.length * 2 + projects.length * 2,
    ),
  );
  const cues = campus.sceneCues.slice(0, CAMPUS_RENDER_LIMITS.sceneCues);
  const activityLabel = paused
    ? "Campus paused"
    : buildings.length < 4
      ? "Early lab activity"
      : buildings.length < 9
        ? "Growing research campus"
        : "Frontier campus at full tempo";

  function renderResearcher(person: CampusPerson): ReactElement {
    const index = namedPersonIndex.get(person.researcherId) ?? 0;
    return (
      <button
        className={`campus-map-researcher researcher-${String(index % 5)}`}
        type="button"
        key={person.researcherId}
        style={namedPersonStyle(index)}
        title={`Inspect ${person.displayName} · ${person.assignmentLabel}`}
        onClick={() => onInspectResearcher?.(person.researcherId)}
      >
        <span className="campus-researcher-star" aria-hidden="true">
          ★
        </span>
        <PixelPortrait
          className="campus-researcher-portrait"
          subjectId={person.portraitAssetId}
          name={person.displayName}
          brief={person.portraitBrief}
          altText={person.portraitAltText}
        />
        <span className="campus-researcher-label">
          <strong>{person.displayName}</strong>
          <small>{person.assignmentLabel}</small>
        </span>
      </button>
    );
  }

  function renderFacility(building: CampusFacility, index: number): ReactElement {
    const contents = (
      <>
        <div className="campus-building-art">
          <FacilityPixelIcon
            family={building.family}
            displayName={building.displayName}
            tier={building.tier}
            variantId={building.definitionId}
          />
          <span className="campus-building-shadow" aria-hidden="true" />
        </div>
        <div className="campus-building-label">
          <strong>{building.displayName}</strong>
          <span className={building.operational ? "online" : "offline"}>
            {building.loadLabel}
          </span>
        </div>
      </>
    );
    const sharedProps = {
      className: `campus-map-building load-${building.loadState}`,
      "data-visual-kind": visualKind(building.family, building.campusModule),
      style: plotStyle(index),
      title: `${building.displayName} · ${building.loadLabel}`,
    };
    return onInspectFacility === undefined ? (
      <article {...sharedProps}>{contents}</article>
    ) : (
      <button
        {...sharedProps}
        type="button"
        aria-haspopup="dialog"
        aria-label={`Inspect ${building.displayName} · ${building.loadLabel}`}
        onClick={() => onInspectFacility(building)}
      >
        {contents}
      </button>
    );
  }

  function renderPlot(plot: CampusPlot, index: number): ReactElement {
    switch (plot.kind) {
      case "facility":
        return (
          <div className="campus-map-plot" key={plot.key}>
            {renderFacility(plot.facility, index)}
            {plot.people.map(renderResearcher)}
          </div>
        );
      case "construction":
        return (
          <div className="campus-map-plot" key={plot.key}>
            <article
              className="campus-map-construction"
              data-construction-stage={plot.project.stage}
              style={plotStyle(index)}
              title={`${plot.project.displayName} · ${plot.project.stageLabel}`}
            >
              <div aria-hidden="true">
                <span />
                <i />
                <b />
              </div>
              <strong>{plot.project.displayName}</strong>
              <small>
                {plot.project.stageLabel} ·{" "}
                {String(Math.round(plot.project.progressBasisPoints / 100))}%
              </small>
            </article>
          </div>
        );
      case "lawn":
        return (
          <div className="campus-map-plot campus-map-lawn" key={plot.key}>
            {plot.people.map(renderResearcher)}
          </div>
        );
    }
  }

  return (
    <section
      className={`campus-map ${sceneClass(campus)}`.trim()}
      aria-labelledby="campus-map-title"
      data-testid="campus-strip"
      data-paused={paused ? "true" : "false"}
      data-density={
        buildings.length < 4 ? "early" : buildings.length < 9 ? "growing" : "frontier"
      }
    >
      <header className="campus-map-header">
        <div>
          <p className="eyebrow">PHYSICAL CAMPUS // {dateLabel}</p>
          <h2 id="campus-map-title">The lab, from above</h2>
        </div>
        <div className="campus-map-statline" aria-label="Campus summary">
          <article>
            <span>Buildings</span>
            <strong>{campus.facilities.length}</strong>
          </article>
          <article>
            <span>Building now</span>
            <strong>{campus.construction.length}</strong>
          </article>
          <article>
            <span>Star researchers</span>
            <strong>{campus.namedPeople.length}</strong>
          </article>
          <article className={paused ? "paused" : "live"}>
            <span>Activity</span>
            <strong>{activityLabel}</strong>
          </article>
        </div>
      </header>

      <div className="campus-map-cues" aria-live="polite" aria-label="Campus activity">
        {cues.length === 0 ? (
          <span className="campus-map-cue ambient">Campus nominal</span>
        ) : (
          cues.map((cue) => (
            <span className={`campus-map-cue ${cue.severity}`} key={cue.id}>
              {cue.label}
            </span>
          ))
        )}
      </div>

      <div className="campus-map-scene">
        <span className="campus-map-grid" aria-hidden="true" />
        <span className="campus-map-road road-east-west" aria-hidden="true">
          <Walkers route="street" count={decorativeStaffCount} />
          {Array.from(
            { length: Math.min(5, Math.max(2, Math.ceil(buildings.length / 2))) },
            (_, index) => (
              <span
                className={`campus-map-cart cart-${String(index % 3)}`}
                key={`cart:${String(index)}`}
                style={
                  {
                    "--cart-y": index % 2 === 0 ? "3px" : "16px",
                    "--cart-delay": `${String(index * -3.8)}s`,
                  } as CSSProperties
                }
              >
                <i />
              </span>
            ),
          )}
        </span>
        <span className="campus-map-road road-north-south" aria-hidden="true">
          <Walkers route="avenue" count={decorativeStaffCount} />
        </span>
        <span className="campus-map-road road-service" aria-hidden="true" />
        <span className="campus-map-plaza" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="campus-map-pond" aria-hidden="true" />
        <span className="campus-map-helipad" aria-hidden="true">
          H
        </span>
        {Array.from({ length: 24 }, (_, index) => (
          <span
            className={`campus-map-tree tree-${String(index % 4)}`}
            key={`tree:${String(index)}`}
            style={
              {
                "--tree-x": `${String(3 + ((index * 29) % 92))}%`,
                "--tree-y": `${String(4 + ((index * 41) % 89))}%`,
              } as CSSProperties
            }
            aria-hidden="true"
          />
        ))}

        {QUADRANTS.map((quadrant) => (
          <div className={`campus-map-quarter quarter-${quadrant}`} key={quadrant}>
            {quadrants.get(quadrant)?.map(({ plot, index }) => renderPlot(plot, index))}
          </div>
        ))}

        <Walkers route="lawn" count={decorativeStaffCount} />

        {Array.from(
          { length: Math.min(4, Math.max(1, Math.ceil(buildings.length / 4))) },
          (_, index) => (
            <span
              className={`campus-map-drone drone-${String(index % 2)}`}
              key={`drone:${String(index)}`}
              style={
                {
                  "--map-drone-y": `${String(8 + index * 21)}%`,
                  "--map-drone-delay": `${String(index * -4.1)}s`,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <i />
            </span>
          ),
        )}
      </div>

      <footer className="campus-map-legend">
        {onInspectFacility === undefined ? null : (
          <span>
            <i className="legend-building">▣</i> Buildings are inspectable
          </span>
        )}
        <span>
          <i className="legend-live" /> Activity moves only while simulation time runs
        </span>
        <span>
          <i className="legend-star">★</i> Named star researchers are inspectable
        </span>
        {campus.overflowFacilityCount === 0 ? null : (
          <span>
            +{campus.overflowFacilityCount} integrated upgrade
            {campus.overflowFacilityCount === 1 ? "" : "s"} represented inside the estate
          </span>
        )}
      </footer>
    </section>
  );
}
