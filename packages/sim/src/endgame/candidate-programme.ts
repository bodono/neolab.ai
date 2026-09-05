import type { CompiledContent } from "@neolab/content-schema";

import { formatTeraflops, planFlopsReservation } from "../compute/flops.ts";
import { resolveGpuReservations } from "../compute/gpu-portfolio.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId, ModelId, ModifierId, ProjectId } from "../model/ids.ts";
import type {
  AgiComponentType,
  CapabilityVector,
  GameState,
  ModelState,
  ProjectState,
} from "../model/state.ts";
import { cashMillions, gpuCount, tick, type Tick } from "../model/units.ts";
import { satisfiesAgiCandidateCapabilityGate } from "../models/capability.ts";
import {
  isCandidateArtifactEligible,
  isCandidateArtifactFormal,
} from "./candidate-lifecycle.ts";
import type { ProjectHandler } from "../projects/project-framework.ts";

/** Public-claim review imposed after deploying a model that proves not to be SI. */
export const FALSE_DAWN_CANDIDATE_COOLDOWN_WEEKS = 52;

export function candidateDeclarationCooldownUntil(
  state: Readonly<GameState>,
  labId: LabId,
): Tick | undefined {
  if (labId !== state.run.playerLabId) return undefined;
  return state.endgameHistory.candidateDeclarationCooldownUntil;
}

export function candidateDeclarationCooldownRemaining(
  state: Readonly<GameState>,
  labId: LabId,
  atTick: number = state.run.tick,
): number {
  const until = candidateDeclarationCooldownUntil(state, labId);
  return until === undefined ? 0 : Math.max(0, until - atTick);
}

export function candidateDeclarationsPaused(
  state: Readonly<GameState>,
  labId: LabId,
  atTick: number = state.run.tick,
): boolean {
  return candidateDeclarationCooldownRemaining(state, labId, atTick) > 0;
}

/**
 * The Candidate Programme: four major works that must stand before any run
 * can produce an apparent AGI candidate — the game's Civ-style science
 * victory chassis. Each is an opt-in, funded, slot-occupying project that
 * grants one real standing benefit on completion.
 */
export interface AgiComponentRule {
  readonly componentType: AgiComponentType;
  readonly displayName: string;
  readonly description: string;
  readonly requirement: {
    readonly researchProgramId?: string;
    readonly researchLevelAtLeast?: number;
    readonly researchLabel?: string;
    readonly facilityId?: string;
    readonly facilityLabel?: string;
  };
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  /**
   * Reserved training compute in TFLOP/s while building. Fixed absolute
   * rates, not era-relative: the works are physics, not fashion. Sized for
   * a Markov-era fleet — the Rubin-era works demand most of a Rubin fleet,
   * which is exactly what starting one era early should cost.
   */
  readonly reservedTeraflops: number;
  /** The world hardware era (GPU generation) that opens this work. */
  readonly eraGenerationId: string;
  readonly completionModifier: {
    readonly target: string;
    readonly operation: "multiply" | "add";
    readonly value: number;
  };
  readonly benefitLabel: string;
}

/**
 * Candidacy demands breadth across the CAPABILITY tree -- one work in each of
 * the four major domains at level 70 -- plus an exotic late-game building to
 * house each, chosen so no required building is a prerequisite of another:
 * the four works rise on four separate branches of the campus. Never safety: two of these works used to gate on safety
 * research, which meant caution blocked the race, the one thing this game
 * refuses to do. A greedy racer reaches the very end of the game with zero
 * safety investment, and then the Deployment Crisis asks what they actually
 * know about the thing they built.
 */
export const AGI_COMPONENT_RULES: Readonly<Record<AgiComponentType, AgiComponentRule>> = {
  "project-panopticon": {
    componentType: "project-panopticon",
    displayName: "Project Panopticon",
    description:
      "A scalable-oversight lattice: models watching models watching models, with one nervous human at the end of the chain.",
    requirement: {
      researchProgramId: "base:domain.reinforcement-agency",
      researchLevelAtLeast: 70,
      researchLabel: "Reinforcement Learning & Agency level 70+",
      facilityId: "base:facility.argus-array-1",
      facilityLabel: "The Argus Array built",
    },
    durationWeeks: 20,
    cashCostMillions: 25_000,
    reservedTeraflops: 3_000_000,
    eraGenerationId: "base:gpu.markov",
    completionModifier: {
      target: "lab.evaluation.cashCost",
      operation: "multiply",
      value: 0.95,
    },
    benefitLabel: "Evaluations cost ×0.95",
  },
  "world-engine": {
    componentType: "world-engine",
    displayName: "The World Engine",
    description:
      "A continually-learning model of everything: physics, markets, weather, and why the third data centre hums in B-flat.",
    requirement: {
      researchProgramId: "base:domain.architectures",
      researchLevelAtLeast: 70,
      researchLabel: "Architectures level 70+",
      facilityId: "base:facility.time-sphere-1",
      facilityLabel: "Time Sphere built",
    },
    durationWeeks: 26,
    cashCostMillions: 40_000,
    reservedTeraflops: 8_000_000,
    eraGenerationId: "base:gpu.markov",
    completionModifier: {
      target: "lab.compute.workloadThroughput",
      operation: "multiply",
      value: 1.05,
    },
    benefitLabel: "Training throughput ×1.05",
  },
  "oracle-grid": {
    componentType: "oracle-grid",
    displayName: "The Oracle Grid",
    description:
      "Planet-scale inference infrastructure, built so that when the candidate finally speaks, everyone can hear it at once.",
    requirement: {
      researchProgramId: "base:domain.optimisation-scaling",
      researchLevelAtLeast: 70,
      researchLabel: "Optimisation & Scaling level 70+",
      facilityId: "base:facility.data-centre-4",
      facilityLabel: "Data Centre IV built",
    },
    durationWeeks: 16,
    cashCostMillions: 30_000,
    reservedTeraflops: 5_000_000,
    eraGenerationId: "base:gpu.rubin",
    completionModifier: {
      target: "serving.computePerRequest",
      operation: "multiply",
      value: 0.95,
    },
    benefitLabel: "Serving compute per request ×0.95",
  },
  "mirror-test": {
    componentType: "mirror-test",
    displayName: "The Mirror Test",
    description:
      "A self-knowledge gauntlet: can the system predict its own failures, explain its own reasoning, and recognise its own reflection in the logs?",
    requirement: {
      researchProgramId: "base:domain.reasoning-tools",
      researchLevelAtLeast: 70,
      researchLabel: "Reasoning & Tool Use level 70+",
      facilityId: "base:facility.shared-kv-cache",
      facilityLabel: "Shared KV Cache built",
    },
    durationWeeks: 20,
    cashCostMillions: 20_000,
    reservedTeraflops: 3_000_000,
    eraGenerationId: "base:gpu.rubin",
    completionModifier: {
      target: "lab.evidence.displayedQuality",
      operation: "add",
      value: 2,
    },
    benefitLabel: "Displayed evaluation quality +2",
  },
};

export const AGI_COMPONENT_TYPES = Object.keys(
  AGI_COMPONENT_RULES,
) as readonly AgiComponentType[];

export function agiComponentFlag(componentType: AgiComponentType): string {
  return `agi-component:${componentType}:complete`;
}

export function agiComponentsComplete(state: Readonly<GameState>, labId: LabId): boolean {
  const lab = state.labs[labId];
  if (lab === undefined) return false;
  return AGI_COMPONENT_TYPES.every(
    (componentType) => lab.flags[agiComponentFlag(componentType)] === true,
  );
}

/**
 * Canonical candidacy contract shared by player and rival models. Training
 * compute influences the capability vector, but is not a separate endgame
 * requirement.
 */
export function satisfiesAgiCandidateRequirements(
  state: Readonly<GameState>,
  labId: LabId,
  capability: Readonly<CapabilityVector>,
  frontierCapability?: number,
): boolean {
  return (
    agiComponentsComplete(state, labId) &&
    satisfiesAgiCandidateCapabilityGate(capability, frontierCapability)
  );
}

/** Shared deterministic nomination predicate for both player and rivals. */
export function isEligibleProgrammeCandidate(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
  atTick: number = state.run.tick,
): boolean {
  return (
    agiComponentsComplete(state, model.ownerLabId) &&
    !candidateDeclarationsPaused(state, model.ownerLabId, atTick) &&
    satisfiesAgiCandidateCapabilityGate(model.trueCapability) &&
    isCandidateArtifactEligible(model)
  );
}

/** Shared validity predicate after nomination/countdown has atomically begun. */
export function isValidFormalProgrammeCandidate(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): boolean {
  return (
    agiComponentsComplete(state, model.ownerLabId) &&
    satisfiesAgiCandidateCapabilityGate(model.trueCapability) &&
    isCandidateArtifactFormal(model)
  );
}

export function eligibleProgrammeCandidateModelIds(
  state: Readonly<GameState>,
  labId: LabId,
  atTick: number = state.run.tick,
): readonly ModelId[] {
  const lab = state.labs[labId];
  if (
    lab === undefined ||
    !agiComponentsComplete(state, labId) ||
    candidateDeclarationsPaused(state, labId, atTick)
  ) {
    return [];
  }
  return lab.models.modelIds
    .filter((modelId) => {
      const model = state.models[modelId];
      return model !== undefined && isEligibleProgrammeCandidate(state, model, atTick);
    })
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * The Candidate Programme paces the endgame on the world's hardware clock,
 * one era gate per work. The two infrastructure bets — the Oracle Grid and
 * the Mirror Test — open with Rubin-class hardware, one era early: their
 * bills demand most of a Rubin fleet, so breaking ground then is a
 * deliberate, expensive gamble on the race. The two frontier works wait for
 * the Markov era. Nothing gates on the final Kolmogorov generation, which
 * keeps the science victory reachable — rival ascendance usually resolves
 * the race before the world frontier climbs high enough to unlock it.
 */
export const FINAL_ERA_FIRST_GENERATION_ID = "base:gpu.markov";

export function isEraReached(
  state: Readonly<GameState>,
  content: CompiledContent,
  generationId: string,
): boolean {
  const current = content.gpuGenerations[state.world.currentGpuGenerationId];
  const threshold = content.gpuGenerations[generationId];
  if (current === undefined || threshold === undefined) return false;
  return (
    current.unlockAtWorldFrontierCapability >= threshold.unlockAtWorldFrontierCapability
  );
}

export function eraBlockerLabel(content: CompiledContent, generationId: string): string {
  const name = content.gpuGenerations[generationId]?.displayName ?? generationId;
  return `Requires the ${name} hardware era (${name}-class GPUs or later)`;
}

function componentSourceId(labId: LabId, componentType: AgiComponentType): string {
  return `agi-component:${labId}:${componentType}`;
}

export interface AgiComponentQuote {
  readonly rule: AgiComponentRule;
  readonly status: "complete" | "in-progress" | "available" | "locked";
  readonly cashCostMillions: number;
  readonly reservedPhysicalGpus: number;
  readonly reservationGenerationCounts: Readonly<Record<string, number>>;
  readonly reservedTeraflops: number;
  readonly blockers: readonly string[];
  readonly canStart: boolean;
}

export function quoteAgiComponent(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  componentType: AgiComponentType,
): AgiComponentQuote {
  const rule = AGI_COMPONENT_RULES[componentType];
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const blockers: string[] = [];
  const complete = lab.flags[agiComponentFlag(componentType)] === true;
  const inProgress = lab.projects.projectIds.some((projectId) => {
    const project = state.projects[projectId];
    return (
      project?.payload.kind === "agi-component" &&
      project.payload.componentType === componentType &&
      project.status !== "completed" &&
      project.status !== "cancelled" &&
      project.status !== "failed"
    );
  });
  if (complete) blockers.push("Already complete");
  if (inProgress) blockers.push("Already under construction");
  if (!isEraReached(state, content, rule.eraGenerationId)) {
    blockers.push(eraBlockerLabel(content, rule.eraGenerationId));
  }
  if (rule.requirement.researchProgramId !== undefined) {
    const level =
      lab.research.domains[rule.requirement.researchProgramId]?.level ??
      lab.research.safetyPrograms[rule.requirement.researchProgramId]?.level ??
      0;
    if (level < (rule.requirement.researchLevelAtLeast ?? 0)) {
      blockers.push(`Requires ${rule.requirement.researchLabel ?? "further research"}`);
    }
  }
  if (
    rule.requirement.facilityId !== undefined &&
    !lab.facilities.instances.some(
      (facility) => facility.definitionId === rule.requirement.facilityId,
    )
  ) {
    blockers.push(`Requires ${rule.requirement.facilityLabel ?? "a larger facility"}`);
  }
  if (lab.finance.cash < rule.cashCostMillions) blockers.push("Insufficient cash");

  const reservations = resolveGpuReservations(state, content, labId, "committed");
  const teraflops = rule.reservedTeraflops;
  const plan = planFlopsReservation(
    state,
    content,
    labId,
    reservations.remainingByLot,
    teraflops,
  );
  if (plan.availableTeraflops < teraflops) {
    blockers.push(
      `Requires ${formatTeraflops(teraflops)} of unreserved fleet compute; ${formatTeraflops(plan.availableTeraflops)} available`,
    );
  }
  return {
    rule,
    status: complete
      ? "complete"
      : inProgress
        ? "in-progress"
        : blockers.length === 0
          ? "available"
          : "locked",
    cashCostMillions: rule.cashCostMillions,
    reservedPhysicalGpus: plan.reservedPhysicalGpus,
    reservationGenerationCounts: plan.generationCounts,
    reservedTeraflops: teraflops,
    blockers,
    canStart: blockers.length === 0,
  };
}

export function startAgiComponent(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  componentType: AgiComponentType,
): ProjectId {
  const quote = quoteAgiComponent(tx.read(), content, labId, componentType);
  if (!quote.canStart) {
    throw new Error(`Component blocked: ${quote.blockers.join("; ")}`);
  }
  const rule = quote.rule;
  const projectId = tx.allocateId("project", labId) as ProjectId;
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId },
      resource: "cash",
      amount: -rule.cashCostMillions,
      financeCategory: "project-cost",
    },
    { kind: "system", id: projectId },
  );
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    draft.projects[projectId] = {
      id: projectId,
      ownerLabId: labId,
      definitionId: "base:project.agi-component" as ProjectState["definitionId"],
      kind: "agi-component",
      status: "queued",
      createdAt: draft.run.tick,
      expectedDurationWeeks: rule.durationWeeks,
      progress: 0,
      reservations: { majorProjectSlots: 1 },
      assignedResearcherIds: [],
      completionOrder: draft.run.idCounters.project - 1,
      payload: {
        kind: "agi-component",
        componentType,
        quotedAt: tick(draft.run.tick),
        cashCostMillions: cashMillions(rule.cashCostMillions),
        reservedPhysicalGpus: gpuCount(quote.reservedPhysicalGpus),
        reservationGenerationCounts: { ...quote.reservationGenerationCounts },
      },
    };
    lab.projects.projectIds.push(projectId);
    lab.compute.reservations.push({
      projectId,
      gpus: gpuCount(quote.reservedPhysicalGpus),
      generationCounts: { ...quote.reservationGenerationCounts },
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${rule.displayName} authorised — the Candidate Programme advances.`,
      category: "narrative",
      source: { kind: "system", id: componentSourceId(labId, componentType) },
      relatedIds: [],
    });
  });
  tx.emit({
    kind: "project-queued",
    labId,
    projectId,
    projectKind: "agi-component",
  });
  return projectId;
}

function releaseReservation(
  tx: SimulationTransaction,
  labId: LabId,
  projectId: ProjectId,
): void {
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    lab.compute.reservations = lab.compute.reservations.filter(
      (reservation) => reservation.projectId !== projectId,
    );
  });
}

export const AGI_COMPONENT_PROJECT_HANDLER: ProjectHandler<"agi-component"> = {
  kind: "agi-component",
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
  complete(tx, _content, project): void {
    if (project.payload.kind !== "agi-component") {
      throw new Error(`Project ${project.id} is not an AGI component`);
    }
    const componentType = project.payload.componentType;
    const rule = AGI_COMPONENT_RULES[componentType];
    releaseReservation(tx, project.ownerLabId, project.id);
    const modifierId = tx.allocateId("modifier", "world") as ModifierId;
    tx.update((draft) => {
      const lab = draft.labs[project.ownerLabId];
      if (lab === undefined) throw new Error(`Unknown lab ${project.ownerLabId}`);
      lab.flags[agiComponentFlag(componentType)] = true;
      draft.modifiers[modifierId] = {
        id: modifierId,
        source: {
          kind: "system",
          id: componentSourceId(project.ownerLabId, componentType),
        },
        labId: project.ownerLabId,
        target: rule.completionModifier.target,
        operation: rule.completionModifier.operation,
        value: rule.completionModifier.value,
        startsAt: draft.run.tick,
        tags: ["agi-component", componentType],
      };
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `${rule.displayName} is complete. ${rule.benefitLabel}.`,
        category: "narrative",
        source: {
          kind: "system",
          id: componentSourceId(project.ownerLabId, componentType),
        },
        relatedIds: [],
      });
    });
    tx.emit({
      kind: "agi-component-completed",
      labId: project.ownerLabId,
      componentType,
    });
  },
  cancel(tx, project): void {
    releaseReservation(tx, project.ownerLabId, project.id);
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.status = "cancelled";
    });
  },
};
