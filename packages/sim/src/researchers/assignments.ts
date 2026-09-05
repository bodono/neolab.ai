import type {
  CompiledContent,
  ResearcherAssignmentKind,
  ResearcherCompactCheckDefinition,
} from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId, ProjectId, ResearcherId } from "../model/ids.ts";
import type {
  GameState,
  ResearcherAssignmentRole,
  ResearcherAssignmentState,
} from "../model/state.ts";
import {
  researcherSkillForAssignment,
  syncResearcherAbilityModifiers,
} from "./researchers.ts";
import { evaluateResearcherCompacts } from "./compacts.ts";

export interface ResearcherAssignmentInput {
  readonly kind: ResearcherAssignmentKind;
  readonly targetId?: string;
  readonly role: ResearcherAssignmentRole;
}

export interface ResearcherAssignmentQuote {
  readonly researcherId: ResearcherId;
  readonly assignment: ResearcherAssignmentInput;
  readonly skillKey: string;
  readonly skillLevel: number;
  readonly blockers: readonly string[];
}

const INSTITUTIONAL_ASSIGNMENTS: readonly ResearcherAssignmentKind[] = [
  "research-council",
  "safety-director",
  "external-council",
];

function assignmentMatches(
  current: Readonly<ResearcherAssignmentState> | undefined,
  proposed: ResearcherAssignmentInput,
): boolean {
  return (
    current?.kind === proposed.kind &&
    current.targetId === proposed.targetId &&
    current.role === proposed.role
  );
}

function minimumAssignmentChecks(
  check: ResearcherCompactCheckDefinition,
): readonly Extract<
  ResearcherCompactCheckDefinition,
  { readonly type: "minimum-assignment-duration" }
>[] {
  return "type" in check && check.type === "minimum-assignment-duration" ? [check] : [];
}

function targetBlocker(
  state: Readonly<GameState>,
  labId: LabId,
  assignment: ResearcherAssignmentInput,
): string | undefined {
  const lab = state.labs[labId];
  if (lab === undefined) return `Unknown lab ${labId}`;
  const institutional = INSTITUTIONAL_ASSIGNMENTS.includes(assignment.kind);
  if (institutional) {
    return assignment.targetId === undefined
      ? undefined
      : "Institutional assignments do not use a target";
  }
  if (assignment.targetId === undefined) return "This assignment requires a target";
  if (assignment.kind === "capability-program") {
    return lab.research.domains[assignment.targetId] === undefined
      ? "Unknown capability programme"
      : undefined;
  }
  if (assignment.kind === "safety-program") {
    return lab.research.safetyPrograms[assignment.targetId] === undefined
      ? "Unknown safety programme"
      : undefined;
  }
  const project = state.projects[assignment.targetId as ProjectId];
  if (
    project === undefined ||
    project.ownerLabId !== labId ||
    project.status === "completed" ||
    project.status === "cancelled" ||
    project.status === "failed"
  ) {
    return "Assignment target is not an active lab project";
  }
  const expectedKind =
    assignment.kind === "training-run"
      ? "training"
      : assignment.kind === "productisation"
        ? "productisation"
        : assignment.kind === "facility-project"
          ? "construction"
          : assignment.kind === "evaluation-project"
            ? "evaluation"
            : undefined;
  return expectedKind !== undefined && project.kind !== expectedKind
    ? `Assignment requires a ${expectedKind} project`
    : undefined;
}

export function quoteResearcherAssignment(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
  assignment: ResearcherAssignmentInput,
): ResearcherAssignmentQuote {
  const researcher = state.researchers[researcherId];
  const definition =
    researcher === undefined
      ? undefined
      : content.researchers.definitions[researcher.definitionId];
  if (researcher === undefined || definition === undefined) {
    throw new Error(`Unknown researcher ${researcherId}`);
  }
  const blockers: string[] = [];
  if (researcher.employerLabId !== labId || researcher.status !== "employed") {
    blockers.push("Researcher is not actively employed by this lab");
  }
  if (assignmentMatches(researcher.assignment, assignment)) {
    blockers.push("Researcher already has this assignment");
  }
  const institutional = INSTITUTIONAL_ASSIGNMENTS.includes(assignment.kind);
  if (
    (institutional && assignment.role !== "institutional") ||
    (!institutional && assignment.role === "institutional")
  ) {
    blockers.push(
      institutional
        ? "Institutional assignments require the institutional role"
        : "Programme and project assignments require a lead or advisor role",
    );
  }
  const invalidTarget = targetBlocker(state, labId, assignment);
  if (invalidTarget !== undefined) blockers.push(invalidTarget);
  if (researcher.compact.includedInOffer) {
    for (const check of minimumAssignmentChecks(definition.compact.check)) {
      if (
        researcher.assignment?.targetId === check.domain &&
        assignment.targetId !== check.domain
      ) {
        const elapsed = state.run.tick - researcher.assignment.assignedAt;
        if (elapsed < check.weeks) {
          const remaining = check.weeks - elapsed;
          blockers.push(
            `Protected appointment: ${String(remaining)} ${remaining === 1 ? "week" : "weeks"} remain before a voluntary transfer`,
          );
        }
      }
    }
  }
  const peers = Object.values(state.researchers).filter(
    (candidate) =>
      candidate.id !== researcherId &&
      candidate.employerLabId === labId &&
      candidate.status === "employed" &&
      candidate.assignment?.kind === assignment.kind &&
      candidate.assignment.targetId === assignment.targetId,
  );
  if (
    (assignment.role === "lead" || assignment.role === "institutional") &&
    peers.some((candidate) => candidate.assignment?.role === assignment.role)
  ) {
    blockers.push("That assignment already has a lead");
  }
  if (
    assignment.role === "advisor" &&
    peers.filter((candidate) => candidate.assignment?.role === "advisor").length >= 2
  ) {
    blockers.push("That assignment already has two advisors");
  }
  const projected = { ...assignment, assignedAt: state.run.tick };
  const skillKey = researcherSkillForAssignment(projected);
  return {
    researcherId,
    assignment,
    skillKey,
    skillLevel: definition.skills[skillKey] ?? 0,
    blockers,
  };
}

export function assignResearcher(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
  assignment: ResearcherAssignmentInput,
): ResearcherAssignmentQuote {
  const quote = quoteResearcherAssignment(
    tx.read(),
    content,
    labId,
    researcherId,
    assignment,
  );
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const previous = tx.read().researchers[researcherId]?.assignment;
  const definitionId = tx.read().researchers[researcherId]?.definitionId;
  const definition =
    definitionId === undefined
      ? undefined
      : content.researchers.definitions[definitionId];
  tx.update((draft) => {
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error(`Unknown researcher ${researcherId}`);
    const keepsAppointment =
      previous?.kind === assignment.kind && previous.targetId === assignment.targetId;
    researcher.assignment = {
      ...structuredClone(assignment),
      assignedAt: keepsAppointment ? previous.assignedAt : draft.run.tick,
    };
    if (definition !== undefined && previous !== undefined) {
      const lab = draft.labs[labId];
      for (const check of minimumAssignmentChecks(definition.compact.check)) {
        if (
          previous.targetId === check.domain &&
          assignment.targetId !== check.domain &&
          draft.run.tick - previous.assignedAt >= check.weeks &&
          lab !== undefined
        ) {
          lab.flags[`assignment-duration:${check.domain}:at`] = draft.run.tick;
        }
      }
    }
  });
  syncResearcherAbilityModifiers(tx, content, researcherId);
  evaluateResearcherCompacts(tx, content);
  tx.emit({
    kind: "researcher-assigned",
    researcherId,
    assignmentKind: assignment.kind,
    ...(assignment.targetId === undefined ? {} : { targetId: assignment.targetId }),
    role: assignment.role,
  });
  return quote;
}
