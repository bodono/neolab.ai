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

type BuildingStyle = CSSProperties &
  Readonly<Record<"--campus-x" | "--campus-y" | "--campus-depth", string>>;

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

const BUILDING_SLOTS = [
  { x: 6, y: 11 },
  { x: 27, y: 7 },
  { x: 51, y: 10 },
  { x: 75, y: 7 },
  { x: 12, y: 39 },
  { x: 36, y: 36 },
  { x: 62, y: 39 },
  { x: 82, y: 35 },
  { x: 4, y: 66 },
  { x: 27, y: 67 },
  { x: 53, y: 65 },
  { x: 76, y: 66 },
  { x: 17, y: 20 },
  { x: 42, y: 22 },
  { x: 67, y: 20 },
  { x: 87, y: 18 },
] as const;

const NAMED_PERSON_OFFSETS = [
  { x: -8, y: 16 },
  { x: 15, y: 13 },
  { x: -12, y: 29 },
  { x: 19, y: 27 },
  { x: -11, y: -11 },
  { x: 16, y: -13 },
  { x: -17, y: 41 },
  { x: 22, y: 40 },
] as const;

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

function buildingStyle(index: number): BuildingStyle {
  const slot = BUILDING_SLOTS[index % BUILDING_SLOTS.length]!;
  return {
    "--campus-x": `${String(slot.x)}%`,
    "--campus-y": `${String(slot.y)}%`,
    "--campus-depth": String(20 + Math.round(slot.y)),
  };
}

function personStyle(index: number, named = false): PersonStyle {
  const x = 12 + ((index * 23 + (named ? 9 : 0)) % 73);
  const y = 25 + ((index * 17 + (named ? 11 : 0)) % 61);
  return {
    "--campus-person-x": `${String(x)}%`,
    "--campus-person-y": `${String(y)}%`,
    "--campus-person-delay": `${String(-((index * 1.9) % 13))}s`,
    "--campus-person-distance": `${String(18 + ((index * 11) % 42))}px`,
    "--campus-person-drift-y": "8px",
    "--campus-person-duration": "12s",
  };
}

function namedPersonMotion(
  index: number,
  x: number,
  y: number,
): Pick<
  PersonStyle,
  | "--campus-person-delay"
  | "--campus-person-distance"
  | "--campus-person-drift-y"
  | "--campus-person-duration"
> {
  const horizontalDirection = x < 25 ? 1 : x > 75 ? -1 : index % 2 === 0 ? 1 : -1;
  const verticalDirection = y < 24 ? 1 : y > 78 ? -1 : index % 3 === 0 ? -1 : 1;
  return {
    "--campus-person-delay": `${String(-((index * 2.7) % 17))}s`,
    "--campus-person-distance": `${String(horizontalDirection * (30 + ((index * 13) % 31)))}px`,
    "--campus-person-drift-y": `${String(verticalDirection * (8 + ((index * 7) % 13)))}px`,
    "--campus-person-duration": `${String(13 + ((index * 3) % 8))}s`,
  };
}

function namedPersonStyle(
  index: number,
  moduleIndex: number,
  person: CampusView["namedPeople"][number],
  buildings: CampusView["facilities"],
): PersonStyle {
  const assignedBuildingIndex = buildings.findIndex(
    (building) => building.campusModule === person.locationModule,
  );
  if (assignedBuildingIndex < 0) return personStyle(index, true);
  const slot = BUILDING_SLOTS[assignedBuildingIndex % BUILDING_SLOTS.length]!;
  const offset = NAMED_PERSON_OFFSETS[moduleIndex % NAMED_PERSON_OFFSETS.length]!;
  const x = Math.min(91, Math.max(9, slot.x + offset.x));
  const y = Math.min(88, Math.max(10, slot.y + offset.y));
  return {
    "--campus-person-x": `${String(x)}%`,
    "--campus-person-y": `${String(y)}%`,
    ...namedPersonMotion(index, x, y),
  };
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
  const peoplePerModule = new Map<string, number>();
  const namedPeopleWithStyles = namedPeople.map((person, index) => {
    const moduleIndex = peoplePerModule.get(person.locationModule) ?? 0;
    peoplePerModule.set(person.locationModule, moduleIndex + 1);
    return {
      person,
      style: namedPersonStyle(index, moduleIndex, person, buildings),
    };
  });
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
        <span className="campus-map-road road-east-west" aria-hidden="true" />
        <span className="campus-map-road road-north-south" aria-hidden="true" />
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

        {buildings.map((building, index) => {
          const key = building.facilityId ?? `${building.definitionId}:${String(index)}`;
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
            style: buildingStyle(index),
            title: `${building.displayName} · ${building.loadLabel}`,
          };
          return onInspectFacility === undefined ? (
            <article key={key} {...sharedProps}>
              {contents}
            </article>
          ) : (
            <button
              key={key}
              {...sharedProps}
              type="button"
              aria-haspopup="dialog"
              aria-label={`Inspect ${building.displayName} · ${building.loadLabel}`}
              onClick={() => onInspectFacility(building)}
            >
              {contents}
            </button>
          );
        })}

        {projects.map((project, index) => (
          <article
            className="campus-map-construction"
            data-construction-stage={project.stage}
            key={project.projectId}
            style={buildingStyle(buildings.length + index)}
            title={`${project.displayName} · ${project.stageLabel}`}
          >
            <div aria-hidden="true">
              <span />
              <i />
              <b />
            </div>
            <strong>{project.displayName}</strong>
            <small>
              {project.stageLabel} ·{" "}
              {String(Math.round(project.progressBasisPoints / 100))}%
            </small>
          </article>
        ))}

        {namedPeopleWithStyles.map(({ person, style }, index) => (
          <button
            className={`campus-map-researcher researcher-${String(index % 5)}`}
            type="button"
            key={person.researcherId}
            style={style}
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
        ))}

        {Array.from({ length: decorativeStaffCount }, (_, index) => (
          <span
            className={`campus-map-staff staff-${String(index % 6)}`}
            key={`staff:${String(index)}`}
            style={personStyle(index)}
            aria-hidden="true"
          >
            <i />
          </span>
        ))}

        {Array.from(
          { length: Math.min(5, Math.max(2, Math.ceil(buildings.length / 2))) },
          (_, index) => (
            <span
              className={`campus-map-cart cart-${String(index % 3)}`}
              key={`cart:${String(index)}`}
              style={
                {
                  "--cart-y": `${String(37 + (index % 3) * 24)}%`,
                  "--cart-delay": `${String(index * -3.8)}s`,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <i />
            </span>
          ),
        )}

        {Array.from(
          { length: Math.min(4, Math.max(1, Math.ceil(buildings.length / 4))) },
          (_, index) => (
            <span
              className={`campus-map-drone drone-${String(index % 2)}`}
              key={`drone:${String(index)}`}
              style={
                {
                  "--map-drone-x": `${String(21 + ((index * 31) % 66))}%`,
                  "--map-drone-y": `${String(12 + (index % 3) * 21)}%`,
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
