import {
  contentId,
  type CompiledContent,
  type ResearcherCompactCheckDefinition,
} from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { formatValuation } from "../finance/valuation.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { LabId, ProjectId, ResearcherId } from "../model/ids.ts";
import type { GameState, ProjectState } from "../model/state.ts";
import { cashMillions } from "../model/units.ts";
import type { ProjectHandler } from "../projects/project-handler.ts";
import {
  compactWarningLeadWeeks,
  compactWindowWeeks,
  evaluateResearcherCompactCheck,
  evaluateResearcherCompacts,
  recordResearcherCompactActions,
} from "./compacts.ts";

const NATIVE_ACTION_TAGS = new Set(["open-paper", "open-model", "training-run-underway"]);
const STANDARD_COMMITMENT_TERMS = {
  durationWeeks: 2,
  salaryCycles: 0.25,
} as const;
const PERIODIC_COMMITMENT_TERMS = {
  durationWeeks: 4,
  salaryCycles: 1,
} as const;

export interface ResearcherCommitmentTargets {
  readonly actionTags: readonly string[];
  readonly projectTags: readonly string[];
  readonly reviewTags: readonly string[];
  readonly requiredFlags: readonly string[];
}

export type ResearcherCommitmentStatus =
  "available" | "queued" | "active" | "complete-for-window" | "not-applicable";

export interface ResearcherCommitmentQuote extends ResearcherCommitmentTargets {
  readonly researcherId: ResearcherId;
  readonly compactId: string;
  readonly title: string;
  readonly summary: string;
  readonly expectedDurationWeeks: number;
  readonly cashCostMillions: number;
  readonly status: ResearcherCommitmentStatus;
  readonly projectId?: ProjectId;
  readonly blockers: readonly string[];
}

function humanize(value: string): string {
  return value
    .split(/[.:_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function commitmentTitle(
  requirement: string,
  targets: ResearcherCommitmentTargets,
): string {
  if (targets.requiredFlags.includes("base:lab.governance.independentSafetyCommittee")) {
    return "Charter the independent safety committee";
  }
  if (targets.requiredFlags.includes("lab.governance.independentSafetyCommittee")) {
    return "Charter the independent safety committee";
  }
  if (targets.projectTags.includes("external-audit")) {
    return "Complete an external audit";
  }
  if (targets.reviewTags.includes("expanded-historical-note")) {
    return "Review the next architecture paper's historical note";
  }
  const namedWork = [
    ...targets.actionTags,
    ...targets.projectTags,
    ...targets.reviewTags,
  ];
  const soleNamedWork = namedWork[0];
  if (soleNamedWork !== undefined) {
    return `Complete ${humanize(soleNamedWork)}`;
  }
  return requirement.replace(/[.!?]$/, "");
}

const EMPTY_TARGETS: ResearcherCommitmentTargets = {
  actionTags: [],
  projectTags: [],
  reviewTags: [],
  requiredFlags: [],
};

/**
 * Find promises that name work which otherwise has no player action.
 * Concrete promises (GPU shares, facilities, assignments, releases, and visible
 * lab metrics) continue to use their native controls.
 */
export function researcherCommitmentTargets(
  check: ResearcherCompactCheckDefinition,
): ResearcherCommitmentTargets {
  if (!("type" in check)) return EMPTY_TARGETS;
  switch (check.type) {
    case "tagged-action-within":
    case "conditional-tagged-action-within":
      return {
        ...EMPTY_TARGETS,
        actionTags: check.tags.filter((tag) => !NATIVE_ACTION_TAGS.has(tag)),
      };
    case "assignment-requires-project-tag":
      return { ...EMPTY_TARGETS, projectTags: [check.projectTag] };
    case "publication-requires-review-tag":
      return { ...EMPTY_TARGETS, reviewTags: [check.reviewTag] };
    case "release-requires-project":
      return { ...EMPTY_TARGETS, projectTags: [check.projectTag] };
    case "deployment-requires-flag":
      return { ...EMPTY_TARGETS, requiredFlags: [check.flag] };
    case "conditional-metric-at-least":
    case "conditional-pool-share-at-least":
    case "facility-owned-within":
    case "minimum-assignment-duration":
    case "ratio-at-least":
      return EMPTY_TARGETS;
  }
}

function hasTargets(targets: ResearcherCommitmentTargets): boolean {
  return (
    targets.actionTags.length > 0 ||
    targets.projectTags.length > 0 ||
    targets.reviewTags.length > 0 ||
    targets.requiredFlags.length > 0
  );
}

function commitmentTerms(
  cadence: "rolling" | "event-driven" | "one-time",
  targets: ResearcherCommitmentTargets,
  salaryPerCycle: number,
) {
  const terms =
    cadence === "rolling" && hasTargets(targets)
      ? PERIODIC_COMMITMENT_TERMS
      : STANDARD_COMMITMENT_TERMS;
  return {
    durationWeeks: terms.durationWeeks,
    cashCostMillions:
      Math.round(Math.max(0, salaryPerCycle) * terms.salaryCycles * 100) / 100,
  };
}

function targetsEstablished(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
  targets: ResearcherCommitmentTargets,
): boolean {
  const lab = state.labs[labId];
  const researcher = state.researchers[researcherId];
  const definition =
    researcher === undefined
      ? undefined
      : content.researchers.definitions[researcher.definitionId];
  if (lab === undefined || definition === undefined) return false;
  const windowWeeks = compactWindowWeeks(content, definition.compact.check);
  const renewalWeeks = Math.max(1, windowWeeks - compactWarningLeadWeeks(windowWeeks));
  const isCurrent = (kind: "action" | "project-tag" | "review-tag", tag: string) => {
    const completed = lab.flags[`${kind}:${tag}:lastAt`];
    if (typeof completed !== "number" || state.run.tick - completed >= renewalWeeks) {
      return false;
    }
    if (kind === "action") return true;
    const used = lab.flags[`${kind}:${tag}:usedAt`];
    return typeof used !== "number" || completed > used;
  };
  return (
    targets.actionTags.every((tag) => isCurrent("action", tag)) &&
    targets.projectTags.every((tag) => isCurrent("project-tag", tag)) &&
    targets.reviewTags.every((tag) => isCurrent("review-tag", tag)) &&
    targets.requiredFlags.every((flag) => lab.flags[flag] === true)
  );
}

function activeCommitmentProject(
  state: Readonly<GameState>,
  labId: LabId,
  researcherId: ResearcherId,
  compactIdValue: string,
): Readonly<ProjectState> | undefined {
  return Object.values(state.projects).find(
    (project) =>
      project.ownerLabId === labId &&
      project.payload.kind === "researcher-commitment" &&
      project.payload.researcherId === researcherId &&
      project.payload.compactId === compactIdValue &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
}

export function quoteResearcherCommitment(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
): ResearcherCommitmentQuote {
  const researcher = state.researchers[researcherId];
  if (researcher === undefined) throw new Error(`Unknown researcher ${researcherId}`);
  const definition = content.researchers.definitions[researcher.definitionId];
  if (definition === undefined) {
    throw new Error(`Missing researcher definition ${researcher.definitionId}`);
  }
  const targets = researcherCommitmentTargets(definition.compact.check);
  const project = activeCommitmentProject(
    state,
    labId,
    researcherId,
    definition.compact.id,
  );
  const lab = state.labs[labId];
  const completedForWindow = targetsEstablished(
    state,
    content,
    labId,
    researcherId,
    targets,
  );
  const newProjectTerms = commitmentTerms(
    definition.compact.cadence,
    targets,
    Number(researcher.contract?.salaryPerCycle ?? definition.contract.baseSalaryPerCycle),
  );
  const displayedTerms =
    project?.payload.kind === "researcher-commitment"
      ? {
          durationWeeks: project.expectedDurationWeeks,
          cashCostMillions: Number(project.payload.cashCostMillions),
        }
      : newProjectTerms;
  const blockers: string[] = [];
  if (researcher.employerLabId !== labId) blockers.push("Researcher is not in this lab");
  if (!researcher.compact.includedInOffer) {
    blockers.push("This promise was not included in the hiring terms");
  }
  if (!hasTargets(targets)) {
    blockers.push("This promise is fulfilled through its linked live control");
  }
  const checked = evaluateResearcherCompactCheck(
    state,
    content,
    researcherId,
    definition.compact.check,
  );
  if (
    !checked.applicable &&
    "type" in definition.compact.check &&
    definition.compact.check.type === "assignment-requires-project-tag"
  ) {
    blockers.push("Assign this researcher to the relevant programme first");
  }
  if (
    !checked.applicable &&
    "type" in definition.compact.check &&
    definition.compact.check.type === "conditional-tagged-action-within"
  ) {
    blockers.push("This promise activates when its stated model threshold is reached");
  }
  if (completedForWindow) {
    blockers.push("Promise work is already complete for this review window");
  }
  if (project !== undefined) blockers.push("Promise work is already queued or active");
  if (
    project === undefined &&
    (lab === undefined || lab.finance.cash < newProjectTerms.cashCostMillions)
  ) {
    blockers.push(`Requires ${formatValuation(newProjectTerms.cashCostMillions)} cash`);
  }
  const status: ResearcherCommitmentStatus = !hasTargets(targets)
    ? "not-applicable"
    : completedForWindow
      ? "complete-for-window"
      : project?.status === "queued"
        ? "queued"
        : project === undefined
          ? "available"
          : "active";
  const windowWeeks = compactWindowWeeks(content, definition.compact.check);
  const warningLeadWeeks = compactWarningLeadWeeks(windowWeeks);
  const cadenceSummary =
    definition.compact.cadence === "one-time"
      ? "This is a one-time promise; completion does not expire."
      : definition.compact.cadence === "event-driven"
        ? "Completion prepares the next relevant event and is consumed when that event occurs."
        : `Completion is valid for ${String(windowWeeks)} weeks and can be renewed during the final ${String(warningLeadWeeks)} weeks before its deadline.`;
  return {
    researcherId,
    compactId: definition.compact.id,
    title: commitmentTitle(definition.compact.requirement, targets),
    summary: `${definition.compact.requirement} ${cadenceSummary}`,
    expectedDurationWeeks: displayedTerms.durationWeeks,
    cashCostMillions: displayedTerms.cashCostMillions,
    status,
    ...(project === undefined ? {} : { projectId: project.id }),
    blockers,
    ...targets,
  };
}

export function startResearcherCommitment(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
): ProjectId {
  const quote = quoteResearcherCommitment(tx.read(), content, labId, researcherId);
  if (quote.blockers.length > 0) {
    throw new Error(`Researcher promise work blocked: ${quote.blockers.join("; ")}`);
  }
  const projectId = tx.allocateId("project", labId) as ProjectId;
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId },
      resource: "cash",
      amount: -quote.cashCostMillions,
      financeCategory: "project-cost",
    },
    { kind: "system", id: projectId },
  );
  const project: ProjectState = {
    id: projectId,
    ownerLabId: labId,
    definitionId: contentId("base:project.researcher-commitment"),
    kind: "researcher-commitment",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: quote.expectedDurationWeeks,
    progress: 0,
    reservations: { majorProjectSlots: 1 },
    assignedResearcherIds: [researcherId],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "researcher-commitment",
      researcherId,
      compactId: quote.compactId,
      quotedAt: tx.read().run.tick,
      cashCostMillions: cashMillions(quote.cashCostMillions),
      actionTags: quote.actionTags,
      projectTags: quote.projectTags,
      reviewTags: quote.reviewTags,
      requiredFlags: quote.requiredFlags,
    },
  };
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    lab.projects.projectIds.push(projectId);
  });
  tx.emit({
    kind: "project-queued",
    labId,
    projectId,
    projectKind: "researcher-commitment",
  });
  return projectId;
}

export const RESEARCHER_COMMITMENT_PROJECT_HANDLER: ProjectHandler<"researcher-commitment"> =
  {
    kind: "researcher-commitment",
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
      if (project.payload.kind !== "researcher-commitment") {
        throw new Error(`Project ${project.id} has the wrong promise-work payload`);
      }
      const payload = project.payload;
      tx.update((draft) => {
        const lab = draft.labs[project.ownerLabId];
        if (lab === undefined) throw new Error(`Unknown lab ${project.ownerLabId}`);
        const now = draft.run.tick;
        for (const tag of payload.projectTags) {
          lab.flags[`project-tag:${tag}:active`] = true;
          lab.flags[`project-tag:${tag}:lastAt`] = now;
        }
        for (const tag of payload.reviewTags) {
          lab.flags[`review-tag:${tag}:complete`] = true;
          lab.flags[`review-tag:${tag}:lastAt`] = now;
        }
        for (const flag of payload.requiredFlags) {
          lab.flags[flag] = true;
          lab.flags[`${flag}:at`] = now;
        }
      });
      recordResearcherCompactActions(tx, content, project.ownerLabId, payload.actionTags);
      evaluateResearcherCompacts(tx, content);
    },
    cancel(tx, project): void {
      tx.update((draft) => {
        const mutable = draft.projects[project.id];
        if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
        mutable.status = "cancelled";
      });
    },
  };
