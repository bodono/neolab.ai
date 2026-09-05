import type { CompiledContent, ContentId } from "@neolab/content-schema";

import {
  completeFacilityConstruction,
  facilityConstructionMajorProjectSlots,
} from "../facilities/facilities.ts";
import type { LabId, ProjectId } from "../model/ids.ts";
import type { GameState, ProjectKind, ProjectState } from "../model/state.ts";
import { cashMillions, type CashMillions, type Tick } from "../model/units.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { DeepMutable } from "../engine/draft.ts";
import { TRAINING_PROJECT_HANDLER } from "../training/training.ts";
import {
  ANOMALY_INVESTIGATION_PROJECT_HANDLER,
  EVALUATION_PROJECT_HANDLER,
} from "../evaluations/evaluations.ts";
import { PRODUCTISATION_PROJECT_HANDLER } from "../productisation/productisation.ts";
import { FUNDRAISING_PROJECT_HANDLER } from "../fundraising/fundraising.ts";
import { RESEARCHER_COMMITMENT_PROJECT_HANDLER } from "../researchers/commitments.ts";
import { LOBBYING_PROJECT_HANDLER } from "../politics/politics.ts";
import { COALITION_PROJECT_HANDLER } from "../coalition/coalition.ts";
import { CRISIS_PROJECT_HANDLER } from "../endgame/crisis-stages.ts";
import { AGI_COMPONENT_PROJECT_HANDLER } from "../endgame/candidate-programme.ts";
import { calculateProjectCapacity } from "./capacity.ts";
import { CRISIS_SLOT_FLOOR } from "./slot-policy.ts";
import type { ProjectHandler } from "./project-handler.ts";

export { calculateProjectCapacity, type ProjectCapacityView } from "./capacity.ts";
export type { ProjectHandler } from "./project-handler.ts";

export function createProjectHandlerRegistry(
  handlers: readonly ProjectHandler[],
): ReadonlyMap<ProjectKind, ProjectHandler> {
  const registry = new Map<ProjectKind, ProjectHandler>();
  for (const handler of handlers) {
    if (registry.has(handler.kind)) {
      throw new Error(`Duplicate project handler for ${handler.kind}`);
    }
    registry.set(handler.kind, handler);
  }
  return registry;
}

const constructionHandler: ProjectHandler<"construction"> = {
  kind: "construction",
  advance(tx, _content, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.progress = Math.min(
        1,
        mutable.progress + 1 / mutable.expectedDurationWeeks,
      );
    });
  },
  complete(tx, content, project): void {
    completeFacilityConstruction(tx, content, project.ownerLabId, project.id);
  },
  cancel(tx, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.status = "cancelled";
      if (project.payload.kind === "construction") {
        const facilityDefinitionId = project.payload.facilityDefinitionId;
        const lab = draft.labs[project.ownerLabId];
        const stillPromised = Object.values(draft.projects).some(
          (candidate) =>
            candidate.id !== project.id &&
            candidate.ownerLabId === project.ownerLabId &&
            candidate.payload.kind === "construction" &&
            candidate.payload.facilityDefinitionId === facilityDefinitionId &&
            (candidate.status === "queued" ||
              candidate.status === "active" ||
              candidate.status === "paused"),
        );
        if (lab !== undefined && !stillPromised) {
          delete lab.flags[`facility-promised:${facilityDefinitionId}:at`];
        }
      }
    });
  },
};

export const DEFAULT_PROJECT_HANDLERS = createProjectHandlerRegistry([
  constructionHandler,
  TRAINING_PROJECT_HANDLER,
  EVALUATION_PROJECT_HANDLER,
  ANOMALY_INVESTIGATION_PROJECT_HANDLER,
  PRODUCTISATION_PROJECT_HANDLER,
  FUNDRAISING_PROJECT_HANDLER,
  RESEARCHER_COMMITMENT_PROJECT_HANDLER,
  LOBBYING_PROJECT_HANDLER,
  COALITION_PROJECT_HANDLER,
  CRISIS_PROJECT_HANDLER,
  AGI_COMPONENT_PROJECT_HANDLER,
]);

function requireHandler(
  registry: ReadonlyMap<ProjectKind, ProjectHandler>,
  kind: ProjectKind,
): ProjectHandler {
  const handler = registry.get(kind);
  if (handler === undefined) throw new Error(`No project handler registered for ${kind}`);
  return handler;
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

export function startConstructionProject(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  facilityDefinitionId: ContentId,
  upfrontCostMillions?: CashMillions,
): ProjectId {
  const definition = content.facilities[facilityDefinitionId];
  if (definition === undefined)
    throw new Error(`Unknown facility ${facilityDefinitionId}`);
  const completionOrder = tx.read().run.idCounters.project;
  const projectId = tx.allocateId("project", labId) as ProjectId;
  const createdAt = tx.read().run.tick;
  const project: ProjectState = {
    id: projectId,
    ownerLabId: labId,
    definitionId: facilityDefinitionId,
    kind: "construction",
    status: "queued",
    createdAt,
    expectedDurationWeeks: definition.durationWeeks,
    progress: 0,
    reservations: {
      majorProjectSlots: facilityConstructionMajorProjectSlots(definition),
    },
    assignedResearcherIds: [],
    completionOrder,
    payload: {
      kind: "construction",
      facilityDefinitionId,
      upfrontCostMillions:
        upfrontCostMillions ?? cashMillions(definition.cashCostMillions),
    },
  };
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    lab.projects.projectIds.push(projectId);
    // A queued construction project is a concrete facility promise. Ownership
    // is still checked separately by compacts that require a completed build.
    lab.flags[`facility-promised:${facilityDefinitionId}:at`] = createdAt;
  });
  tx.emit({ kind: "project-queued", labId, projectId, projectKind: "construction" });
  return projectId;
}

function compareProjects(left: ProjectState, right: ProjectState): number {
  return left.createdAt !== right.createdAt
    ? left.createdAt - right.createdAt
    : left.completionOrder !== right.completionOrder
      ? left.completionOrder - right.completionOrder
      : left.id < right.id
        ? -1
        : 1;
}

export function activateEligibleQueuedProjects(
  tx: SimulationTransaction,
  content: CompiledContent,
  labIds: readonly LabId[] = Object.keys(tx.read().labs).sort() as LabId[],
  startedAt: Tick = tx.read().run.tick,
): readonly ProjectId[] {
  const started: ProjectState[] = [];
  for (const labId of labIds) {
    const capacity = calculateProjectCapacity(tx.read(), content, labId);
    let majorAvailable = capacity.availableMajorProjectSlots;
    let crisisFloorRemaining = Math.max(
      0,
      CRISIS_SLOT_FLOOR - capacity.occupiedCrisisSlots,
    );
    const lab = requireLab(tx.read(), labId);
    // Crisis projects start first: freed slots always go to the crisis
    // before construction, and the floor guarantees the crisis is never
    // starved by a fully committed campus.
    const queued = lab.projects.projectIds
      .map((projectId) => tx.read().projects[projectId])
      .filter(
        (project): project is ProjectState =>
          project !== undefined && project.status === "queued",
      )
      .sort(
        (left, right) =>
          Number(right.kind === "crisis") - Number(left.kind === "crisis") ||
          compareProjects(left, right),
      );
    for (const project of queued) {
      const handler = requireHandler(DEFAULT_PROJECT_HANDLERS, project.kind);
      if (handler.canActivate?.(tx.read(), content, project) === false) continue;
      const slots = project.reservations.majorProjectSlots;
      const canStart =
        project.kind === "crisis"
          ? slots <= Math.max(majorAvailable, crisisFloorRemaining)
          : slots <= majorAvailable;
      if (!canStart) continue;
      if (project.kind === "crisis") {
        crisisFloorRemaining = Math.max(0, crisisFloorRemaining - slots);
        majorAvailable = Math.max(0, majorAvailable - slots);
      } else {
        majorAvailable -= slots;
      }
      tx.update((draft) => {
        const mutable = draft.projects[project.id];
        if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
        mutable.status = "active";
        mutable.startedAt = startedAt;
      });
      started.push(project);
    }
  }
  for (const project of started) {
    tx.emit({
      kind: "project-started",
      labId: project.ownerLabId,
      projectId: project.id,
      projectKind: project.kind,
    });
  }
  return started.map((project) => project.id);
}

export function advanceProjects(
  tx: SimulationTransaction,
  content: CompiledContent,
  registry: ReadonlyMap<ProjectKind, ProjectHandler> = DEFAULT_PROJECT_HANDLERS,
): void {
  activateEligibleQueuedProjects(tx, content);
  const active = Object.values(tx.read().projects)
    .filter((project) => project.status === "active")
    .sort(compareProjects);
  for (const project of active) {
    requireHandler(registry, project.kind).advance(tx, content, project);
  }
}

export function completeReadyProjects(
  tx: SimulationTransaction,
  content: CompiledContent,
  registry: ReadonlyMap<ProjectKind, ProjectHandler> = DEFAULT_PROJECT_HANDLERS,
): void {
  const ready = Object.values(tx.read().projects)
    .filter((project) => project.status === "active" && project.progress >= 1)
    .sort(compareProjects);
  for (const project of ready) {
    requireHandler(registry, project.kind).complete(tx, content, project);
    const completed = tx.read().projects[project.id];
    // A completion handler may discover a newly-invalid authorisation and
    // cancel atomically (for example, a model sealed into Long Pause custody).
    // Do not overwrite that defensive cancellation with a completed status.
    if (completed?.status === "cancelled") continue;
    if (completed?.status !== "active") {
      throw new Error(
        `Project ${project.id} completion left unexpected status ${completed?.status ?? "missing"}`,
      );
    }
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.status = "completed";
      mutable.progress = 1;
    });
    tx.emit({
      kind: "project-completed",
      labId: project.ownerLabId,
      projectId: project.id,
      projectKind: project.kind,
    });
    if (project.payload.kind === "construction") {
      tx.emit({
        kind: "facility-completed",
        labId: project.ownerLabId,
        projectId: project.id,
        definitionId: project.payload.facilityDefinitionId,
      });
    }
  }
}

export function cancelProject(
  tx: SimulationTransaction,
  projectId: ProjectId,
  registry: ReadonlyMap<ProjectKind, ProjectHandler> = DEFAULT_PROJECT_HANDLERS,
): void {
  const project = tx.read().projects[projectId];
  if (project === undefined) throw new Error(`Unknown project ${projectId}`);
  if (project.status === "completed" || project.status === "cancelled") {
    throw new Error(`Project ${projectId} cannot be cancelled from ${project.status}`);
  }
  requireHandler(registry, project.kind).cancel(tx, project);
}
