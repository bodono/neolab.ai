import type { CompiledContent, ContentId } from "@neolab/content-schema";

import { calculateFacilityCapacity } from "../facilities/facilities.ts";
import type { LabId } from "../model/ids.ts";
import type {
  FacilityInstanceState,
  GameState,
  ProjectState,
  ResearcherState,
} from "../model/state.ts";

export type CampusLoadState = "idle" | "light" | "active" | "heavy" | "offline";
export type CampusConstructionStage =
  "queued" | "foundations" | "structure" | "commissioning" | "paused";

export interface CampusPersonView {
  readonly researcherId: string;
  readonly displayName: string;
  readonly portraitAssetId: string;
  readonly portraitAltText: string;
  readonly portraitBrief?: string;
  readonly assignmentLabel: string;
  readonly locationModule: string;
}

export interface CampusFacilityView {
  readonly facilityId?: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly family: string;
  readonly tier: number;
  readonly campusModule: string;
  readonly operational: boolean;
  readonly loadState: CampusLoadState;
  readonly loadBasisPoints: number;
  readonly loadLabel: string;
  readonly namedResearcherIds: readonly string[];
}

export interface CampusConstructionView {
  readonly projectId: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly campusModule: string;
  readonly stage: CampusConstructionStage;
  readonly stageLabel: string;
  readonly progressBasisPoints: number;
}

export interface CampusSceneCueView {
  readonly id: string;
  readonly kind:
    "incident-alarm" | "training-heavy" | "red-team-active" | "investor-visit";
  readonly severity: "ambient" | "attention" | "urgent" | "critical";
  readonly label: string;
  readonly expiresAtTick?: number;
}

export interface CampusView {
  readonly facilities: readonly CampusFacilityView[];
  readonly construction: readonly CampusConstructionView[];
  readonly namedPeople: readonly CampusPersonView[];
  readonly sceneCues: readonly CampusSceneCueView[];
  readonly decorativeStaffCount: number;
  readonly overflowFacilityCount: number;
}

interface FacilityPresentation {
  readonly definitionId: string;
  readonly displayName: string;
  readonly family: string;
  readonly tier: number;
  readonly campusModule: string;
  readonly tags: readonly string[];
  readonly supportedOwnedGpuCount: number;
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function titleFromId(value: string): string {
  return value
    .replace(/^base:facility\./, "")
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function fallbackPresentation(definitionId: string): FacilityPresentation {
  const slug = definitionId.replace(/^base:facility\./, "");
  const family = slug.replace(/-\d+$/, "");
  return {
    definitionId,
    displayName: titleFromId(definitionId),
    family,
    tier: 1,
    campusModule: family,
    tags: [family],
    supportedOwnedGpuCount: 0,
  };
}

function presentationFor(
  content: CompiledContent,
  definitionId: ContentId,
): FacilityPresentation {
  const definition = content.facilities[definitionId];
  return definition === undefined
    ? fallbackPresentation(definitionId)
    : {
        definitionId: definition.id,
        displayName: definition.displayName,
        family: definition.family,
        tier: definition.tier,
        campusModule: definition.campusModule,
        tags: definition.tags,
        supportedOwnedGpuCount: definition.supportedOwnedGpuCount,
      };
}

function loadState(loadBasisPoints: number): CampusLoadState {
  if (loadBasisPoints < 1_000) return "idle";
  if (loadBasisPoints < 3_500) return "light";
  if (loadBasisPoints < 7_500) return "active";
  return "heavy";
}

function loadLabel(state: CampusLoadState): string {
  switch (state) {
    case "idle":
      return "Standby";
    case "light":
      return "Light activity";
    case "active":
      return "Operational";
    case "heavy":
      return "High load";
    case "offline":
      return "Offline";
  }
}

function assignmentLabel(
  researcher: Readonly<ResearcherState>,
  content: CompiledContent,
): string {
  const assignment = researcher.assignment;
  if (assignment === undefined || assignment.role !== "lead") return "Unassigned";
  const programme =
    assignment.kind === "capability-program"
      ? content.research.capabilityDomains[assignment.targetId ?? ""]
      : assignment.kind === "safety-program"
        ? content.research.safetyPrograms[assignment.targetId ?? ""]
        : undefined;
  if (programme !== undefined) return `Lead · ${programme.shortName}`;
  return "Unassigned";
}

function pickLocationModule(
  researcher: Readonly<ResearcherState>,
  facilities: readonly FacilityPresentation[],
): string {
  const pick = (needles: readonly string[]): string | undefined =>
    facilities.find((facility) =>
      needles.some(
        (needle) =>
          facility.family.includes(needle) ||
          facility.tags.some((tag) => tag.includes(needle)),
      ),
    )?.campusModule;
  const fallback = pick(["headquarters", "rented-office"]) ?? "central-campus";
  switch (researcher.assignment?.kind) {
    case "training-run":
      return pick(["data-centre"]) ?? fallback;
    case "productisation":
      return pick(["inference-centre", "data-centre"]) ?? fallback;
    case "safety-program":
    case "safety-director":
    case "evaluation-project":
      return pick(["alignment", "eval", "security"]) ?? fallback;
    case "robotics-project":
      return pick(["robotics"]) ?? fallback;
    case "capability-program":
    case "research-council":
    case "science-project":
      return pick(["research-campus", "scientific", "research"]) ?? fallback;
    case "facility-project": {
      const project = researcher.assignment.targetId;
      return (
        facilities.find((facility) => facility.definitionId === project)?.campusModule ??
        fallback
      );
    }
    case "external-council":
    case undefined:
      return fallback;
  }
}

function constructionStage(project: Readonly<ProjectState>): CampusConstructionStage {
  if (project.status === "queued") return "queued";
  if (project.status === "paused") return "paused";
  if (project.progress < 1 / 3) return "foundations";
  if (project.progress < 2 / 3) return "structure";
  return "commissioning";
}

function constructionStageLabel(stage: CampusConstructionStage): string {
  switch (stage) {
    case "queued":
      return "Surveying";
    case "foundations":
      return "Foundations";
    case "structure":
      return "Structure";
    case "commissioning":
      return "Commissioning";
    case "paused":
      return "Work paused";
  }
}

function facilityLoadBasisPoints(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  facility: FacilityPresentation,
  namedPeopleAtModule: number,
): number {
  const lab = requireLab(state, labId);
  const activeProjects = Object.values(state.projects).filter(
    (project) => project.ownerLabId === labId && project.status === "active",
  );
  const hasTraining = activeProjects.some((project) => project.kind === "training");
  const hasEvaluation = activeProjects.some((project) => project.kind === "evaluation");
  const ownedGpus = lab.compute.lots
    .filter((lot) => lot.ownership === "owned")
    .reduce((sum, lot) => sum + lot.physicalCount * lot.availableFraction, 0);
  const capacity = calculateFacilityCapacity(state, content, labId);
  const ownedLoad =
    capacity.supportedOwnedGpuCount === 0
      ? 0
      : Math.round((ownedGpus / capacity.supportedOwnedGpuCount) * 10_000);
  const researchBasisPoints =
    10_000 - lab.compute.allocation.servingFleetShareBasisPoints;
  const capabilityBasisPoints = Math.round(
    (researchBasisPoints * lab.compute.allocation.capabilityBasisPoints) / 10_000,
  );
  const safetyBasisPoints = researchBasisPoints - capabilityBasisPoints;
  const familyAndTags = [facility.family, ...facility.tags].join(" ");

  if (familyAndTags.includes("data-centre")) {
    return hasTraining ? 10_000 : ownedLoad;
  }
  if (familyAndTags.includes("inference")) {
    return lab.compute.allocation.servingFleetShareBasisPoints;
  }
  if (familyAndTags.includes("power")) {
    return Math.max(ownedLoad, ownedGpus > 0 ? 2_500 : 750);
  }
  if (
    familyAndTags.includes("alignment") ||
    familyAndTags.includes("eval") ||
    familyAndTags.includes("security") ||
    familyAndTags.includes("bunker")
  ) {
    return hasEvaluation ? 9_000 : safetyBasisPoints;
  }
  if (
    familyAndTags.includes("research") ||
    familyAndTags.includes("scientific") ||
    familyAndTags.includes("robotics")
  ) {
    return capabilityBasisPoints;
  }
  if (
    familyAndTags.includes("headquarters") ||
    familyAndTags.includes("office") ||
    familyAndTags.includes("commons")
  ) {
    return Math.min(
      10_000,
      Math.round(
        (lab.roster.researcherIds.length / Math.max(1, lab.roster.starSlots)) * 8_000,
      ) +
        namedPeopleAtModule * 500,
    );
  }
  return namedPeopleAtModule > 0 ? 4_000 : 1_000;
}

function latestFacilityPerFamily(
  facilities: readonly {
    readonly instance: FacilityInstanceState;
    readonly presentation: FacilityPresentation;
  }[],
): readonly {
  readonly instance: FacilityInstanceState;
  readonly presentation: FacilityPresentation;
}[] {
  const byFamily = new Map<
    string,
    {
      readonly instance: FacilityInstanceState;
      readonly presentation: FacilityPresentation;
    }
  >();
  for (const facility of facilities) {
    const current = byFamily.get(facility.presentation.family);
    if (
      current === undefined ||
      facility.presentation.tier > current.presentation.tier ||
      (facility.presentation.tier === current.presentation.tier &&
        facility.instance.completedAt > current.instance.completedAt)
    ) {
      byFamily.set(facility.presentation.family, facility);
    }
  }
  return [...byFamily.values()].sort(
    (left, right) =>
      left.instance.completedAt - right.instance.completedAt ||
      (left.presentation.definitionId < right.presentation.definitionId
        ? -1
        : left.presentation.definitionId > right.presentation.definitionId
          ? 1
          : 0),
  );
}

/** Player-safe, coordinate-free campus projection (TDD 22.1). */
export function projectCampusView(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): CampusView {
  const lab = requireLab(state, labId);
  const completedWithPresentation = lab.facilities.instances.map((instance) => ({
    instance,
    presentation: presentationFor(content, instance.definitionId),
  }));
  const campusFacilities = latestFacilityPerFamily(completedWithPresentation);
  const operationalPresentations = campusFacilities.map(
    ({ presentation }) => presentation,
  );
  const namedPeople: CampusPersonView[] = lab.roster.researcherIds.flatMap(
    (researcherId) => {
      const researcher = state.researchers[researcherId];
      if (
        researcher === undefined ||
        researcher.employerLabId !== labId ||
        researcher.status !== "employed" ||
        researcher.housing !== "housed"
      ) {
        return [];
      }
      const definition = content.researchers.definitions[researcher.definitionId];
      if (definition === undefined) return [];
      return [
        {
          researcherId,
          displayName: definition.displayName,
          portraitAssetId: definition.portrait.assetId,
          portraitAltText: definition.portrait.altText,
          portraitBrief: definition.portrait.brief,
          assignmentLabel: assignmentLabel(researcher, content),
          locationModule: pickLocationModule(researcher, operationalPresentations),
        },
      ];
    },
  );
  const peopleByModule = new Map<string, string[]>();
  for (const person of namedPeople) {
    const ids = peopleByModule.get(person.locationModule) ?? [];
    ids.push(person.researcherId);
    peopleByModule.set(person.locationModule, ids);
  }

  const facilities = campusFacilities.map(({ instance, presentation }) => {
    const namedResearcherIds = peopleByModule.get(presentation.campusModule) ?? [];
    const loadBasisPoints = Math.min(
      10_000,
      Math.max(
        0,
        facilityLoadBasisPoints(
          state,
          content,
          labId,
          presentation,
          namedResearcherIds.length,
        ),
      ),
    );
    const stateLabel = loadState(loadBasisPoints);
    return {
      ...(instance.id === undefined ? {} : { facilityId: instance.id }),
      definitionId: instance.definitionId,
      displayName: presentation.displayName,
      family: presentation.family,
      tier: presentation.tier,
      campusModule: presentation.campusModule,
      operational: true,
      loadState: stateLabel,
      loadBasisPoints,
      loadLabel: loadLabel(stateLabel),
      namedResearcherIds,
    };
  });

  const construction = lab.projects.projectIds.flatMap((projectId) => {
    const project = state.projects[projectId];
    if (
      project === undefined ||
      project.payload.kind !== "construction" ||
      (project.status !== "queued" &&
        project.status !== "active" &&
        project.status !== "paused")
    ) {
      return [];
    }
    const definition = presentationFor(content, project.payload.facilityDefinitionId);
    const stage = constructionStage(project);
    return [
      {
        projectId,
        definitionId: definition.definitionId,
        displayName: definition.displayName,
        campusModule: definition.campusModule,
        stage,
        stageLabel: constructionStageLabel(stage),
        progressBasisPoints: Math.round(project.progress * 10_000),
      },
    ];
  });

  const sceneCues: CampusSceneCueView[] = [];
  for (const incident of state.incidents.filter(
    (candidate) => candidate.occurredAt >= state.run.tick - 2,
  )) {
    sceneCues.push({
      id: `incident:${incident.key}`,
      kind: "incident-alarm",
      severity:
        incident.category === "catastrophe" || incident.category === "critical"
          ? "critical"
          : incident.category === "major"
            ? "urgent"
            : "attention",
      label: `${incident.category} incident response`,
      expiresAtTick: incident.occurredAt + 3,
    });
  }
  if (
    Object.values(state.projects).some(
      (project) =>
        project.ownerLabId === labId &&
        project.kind === "training" &&
        project.status === "active",
    )
  ) {
    sceneCues.push({
      id: "project:training-heavy",
      kind: "training-heavy",
      severity: "ambient",
      label: "Training run at high load",
    });
  }
  if (
    Object.values(state.projects).some(
      (project) =>
        project.ownerLabId === labId &&
        project.kind === "evaluation" &&
        project.status === "active",
    )
  ) {
    sceneCues.push({
      id: "project:red-team-active",
      kind: "red-team-active",
      severity: "ambient",
      label: "Red-team exercise in progress",
    });
  }
  const liveFundingExpiries = state.fundraising.offerOrder.flatMap((offerId) => {
    const offer = state.fundraising.offers[offerId];
    return offer?.labId === labId && offer.status === "available"
      ? [offer.expiresAt]
      : [];
  });
  if (liveFundingExpiries.length > 0) {
    sceneCues.push({
      id: "fundraising:investor-visit",
      kind: "investor-visit",
      severity: "ambient",
      label: "Investor delegation on campus",
      expiresAtTick: Math.min(...liveFundingExpiries),
    });
  }

  return {
    facilities,
    construction,
    namedPeople,
    sceneCues,
    decorativeStaffCount: Math.min(
      18,
      Math.max(
        2,
        Math.ceil(
          (lab.organisation.generalResearchers + lab.organisation.engineersAndOps) / 20,
        ),
      ),
    ),
    overflowFacilityCount: Math.max(
      0,
      completedWithPresentation.length - facilities.length,
    ),
  };
}
