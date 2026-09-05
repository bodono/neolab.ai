import type {
  CompiledContent,
  ResearcherAbilityDefinition,
  ResearcherAssignmentKind,
  ResearcherCompactCheckDefinition,
  ResearcherDefinition,
  ResearcherModifierDefinition,
} from "@neolab/content-schema";

import type { LabId, ResearcherId } from "../model/ids.ts";
import type { AuraMarketPressureQuote } from "../aura/aura.ts";
import type {
  GameState,
  ResearcherAssignmentRole,
  ResearcherState,
} from "../model/state.ts";
import {
  calculateDeparturePressure,
  quoteDismissal,
  RESEARCHER_CONTRACT_REVIEW_WEEKS,
} from "../researchers/people.ts";
import {
  quoteResearcherBenefits,
  researcherSkillForProgramme,
  type ResearcherBenefitRow,
} from "../researchers/researchers.ts";
import {
  compactWindowWeeks,
  evaluateResearcherCompactCheck,
} from "../researchers/compacts.ts";
import {
  quoteRecruitment,
  staffPayrollMarketMultiplier,
  researcherSalaryMarketMultiplier,
} from "../researchers/talent-market.ts";
import {
  quoteResearcherCommitment,
  researcherCommitmentTargets,
  type ResearcherCommitmentQuote,
} from "../researchers/commitments.ts";
import {
  buildResearcherPaperLinkIndex,
  type RealPaperCitation,
  type ResearcherPaperLinkIndex,
} from "./researcher-paper-links.ts";

export type PeopleConditionBand = "good" | "steady" | "warning" | "critical";

export type PeopleCompactDestination =
  "lab" | "research" | "models" | "people" | "world" | "finances" | "bonuses";

export interface PeopleCompactConditionView {
  readonly progress: string;
  readonly explanation: string;
  readonly satisfied: boolean;
  readonly actionLabel?: string;
  readonly destination?: PeopleCompactDestination;
}

export interface PeopleAbilityEffectView {
  readonly targetLabel: string;
  readonly operation: "add" | "multiply" | "min" | "max";
  readonly value: number;
  readonly displayLabel: string;
  readonly explanation: string;
  readonly stackingGroup?: string;
}

export interface PeopleAbilityView {
  readonly abilityId: string;
  readonly label: string;
  readonly notes?: string;
  readonly eligibleAssignmentKinds: readonly ResearcherAssignmentKind[];
  readonly effects: readonly PeopleAbilityEffectView[];
  readonly modes: readonly {
    readonly label: string;
    readonly effects: readonly PeopleAbilityEffectView[];
  }[];
  readonly rampWeeks: number;
}

/** One row of the unified benefit breakdown, shared by dossier and roster. */
export interface PeopleBenefitRowView {
  readonly key: string;
  readonly kind: "signature" | "passive" | "compact" | "generic";
  readonly abilityLabel: string;
  readonly targetLabel: string;
  /** What the lab gets right now, e.g. "x1.03" or "+9%". */
  readonly currentLabel: string;
  /** What it is worth at full ramp, housed and eligible. */
  readonly fullLabel: string;
  readonly atFullStrength: boolean;
  readonly active: boolean;
  readonly inactiveReason?: string;
  readonly explanation: string;
  readonly stackingGroup?: string;
}

export interface PeopleResearchSkillView {
  readonly programmeId: string;
  readonly skillKey: string;
  readonly label: string;
  readonly kind: "capability" | "safety";
  readonly level: number;
  readonly maximumLevel: 5;
  readonly leadOutputBonusPercent: number;
}

export interface PeopleProfileView {
  readonly researcherId: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly inspirationName: string;
  readonly inspirationSummary: string;
  readonly initials: string;
  readonly epithet: string;
  readonly role: string;
  readonly rosterSummary: string;
  readonly biography: string;
  readonly sourceUrls: readonly string[];
  /** Real-world papers credited to the researcher who inspired this character. */
  readonly realWorldPapers: readonly RealPaperCitation[];
  readonly portraitAssetId: string;
  readonly portraitBrief?: string;
  readonly portraitAltText: string;
  readonly contractBand: "focused" | "competitive" | "major" | "lab-defining";
  readonly researchSkills: readonly PeopleResearchSkillView[];
  readonly benefits: readonly PeopleBenefitRowView[];
  readonly signature: PeopleAbilityView;
  readonly passive: PeopleAbilityView;
  readonly compact: {
    readonly label: string;
    readonly requirement: string;
    readonly cadence: "rolling" | "one-time" | "event-driven";
  };
}

export interface PeopleAssignmentOptionView {
  readonly optionId: string;
  readonly kind: ResearcherAssignmentKind;
  readonly targetId?: string;
  readonly role: ResearcherAssignmentRole;
  readonly label: string;
  readonly shortLabel: string;
}

export interface RosterResearcherView extends PeopleProfileView {
  readonly status: "employed" | "sabbatical";
  readonly housing: "housed" | "unhoused";
  readonly assignment?: {
    readonly optionId: string;
    readonly kind: ResearcherAssignmentKind;
    readonly targetId?: string;
    readonly role: ResearcherAssignmentRole;
    readonly label: string;
    readonly assignedAtTick: number;
  };
  readonly morale: { readonly band: PeopleConditionBand; readonly label: string };
  readonly loyalty: { readonly band: PeopleConditionBand; readonly label: string };
  readonly burnout: { readonly band: PeopleConditionBand; readonly label: string };
  /**
   * The engine's actual departure pressure, banded like the mood trio, with
   * the concrete causes feeding it. The number existed and drove departure
   * checks; the player only ever saw its inputs, never the total.
   */
  readonly departure: {
    readonly band: PeopleConditionBand;
    readonly label: string;
    readonly topFactors: readonly string[];
  };
  /**
   * Share of this researcher's secret paper progress that leaks to a rival on
   * ANY departure -- voluntary, poached, or dismissed. Higher security posture
   * and loyalty shrink it (clamped 20-60%).
   */
  readonly knowledgeTransferPercent: number;
  readonly contract?: {
    readonly salaryMillionsPerCycle: number;
    readonly signingCashMillions: number;
    readonly auraCost: number;
    readonly agreedAtTick: number;
    readonly annualGrowthPercent: number;
    readonly nextReviewAtTick: number;
    readonly nextReviewInWeeks: number;
  };
  readonly compactStatus:
    "not-applicable" | "tracking" | "fulfilled" | "warning" | "breached";
  readonly compactReview: {
    readonly includedInOffer: boolean;
    readonly currentEvidence: string;
    readonly condition?: PeopleCompactConditionView;
    readonly promiseWork?: ResearcherCommitmentQuote;
    readonly fulfilmentReward: string;
    readonly consequence: string;
    readonly reviewInWeeks?: number;
  };
  readonly ultimatum?: {
    readonly reason: "quarterly" | "promise-breach" | "compact-breach" | "provocation";
    readonly expiresInWeeks: number;
  };
  readonly rivalApproach?: {
    readonly stage: "rumour" | "counteroffer";
    readonly rivalLabName: string;
    readonly resolvesInWeeks: number;
    readonly retentionResponseKind: "none" | "reassurance" | "serious";
    readonly retentionResponseLabel: string;
  };
  readonly warnings: readonly string[];
  /** Temporary obligations created by a later ultimatum or retention agreement. */
  readonly promises: readonly {
    readonly id: string;
    readonly label: string;
    readonly status: "pending" | "kept" | "broken" | "waived";
    readonly dueAtTick: number;
  }[];
  readonly dismissal: {
    readonly severanceCashMillions: number;
    readonly auraLoss: number;
    readonly blockers: readonly string[];
  };
}

export interface TalentCandidateView extends PeopleProfileView {
  readonly listedTerms: {
    readonly salaryMillionsPerCycle: number;
    readonly signingCashMillions: number;
    readonly auraCost: number;
    readonly auraCostBreakdown: AuraMarketPressureQuote;
    readonly foundingHireGuarantee?: {
      readonly cashReliefMillions: number;
      readonly auraRelief: number;
    };
    readonly blockers: readonly string[];
  };
}

export interface PeopleView {
  readonly organisation: {
    /**
     * The live staff-payroll market: yearly inflation times the AGI-proximity
     * boom (pay doubles every 30 points of world frontier capability), applied
     * to engineers, the general researcher pool and the executive suite every
     * cycle with no contract lag.
     */
    readonly staffPayMultiplier: number;
  };
  readonly slots: {
    readonly occupied: number;
    readonly unlocked: number;
    readonly hardMaximum: number;
    readonly vacant: number;
    readonly unhoused: number;
    /**
     * Star-slot facilities not yet built, lowest tier first: the truthful
     * unlock path for every locked slot the panel shows.
     */
    readonly nextSlotFacilities: readonly string[];
  };
  readonly roster: readonly RosterResearcherView[];
  readonly assignmentOptions: readonly PeopleAssignmentOptionView[];
  readonly market: {
    readonly refreshIndex: number;
    readonly nextRefreshAtTick: number;
    readonly refreshInWeeks: number;
    readonly candidates: readonly TalentCandidateView[];
  };
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown viewing lab ${labId}`);
  return lab;
}

function rivalLabDisplayName(
  state: Readonly<GameState>,
  content: CompiledContent,
  rivalLabId: string,
): string {
  const rival = state.labs[rivalLabId as LabId];
  return rival === undefined
    ? "a rival lab"
    : (content.labs[rival.definitionId]?.displayName ?? "a rival lab");
}

function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function title(value: string): string {
  return value
    .replace(/^.*\./, "")
    .replaceAll("-", " ")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function humanize(value: string): string {
  return value
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function compactEvidenceLabel(evidence: string): string {
  if (evidence === "condition is inactive") return "Not currently active";
  if (evidence === "assignment condition is inactive")
    return "This promise is not active under the current appointment";
  if (evidence === "no active led assignment") return "No relevant assignment is active";
  if (evidence === "qualifying assignment remains active")
    return "The agreed assignment is still active";
  const share = /^pool share=([0-9.]+)$/.exec(evidence);
  if (share !== null) {
    return `Current allocation: ${Math.round(Number(share[1]) * 100)}%`;
  }
  const gpus = /^assigned GPUs=([0-9.]+)$/.exec(evidence);
  if (gpus !== null) {
    return `Current assigned compute: ${String(Math.round(Number(gpus[1])))} GPUs/week`;
  }
  const priority = /^research priority=(primary|secondary|tertiary|none)$/.exec(evidence);
  if (priority !== null) {
    return priority[1] === "none"
      ? "Not currently selected as a research priority"
      : `Current priority: ${title(priority[1] ?? "")}`;
  }
  const metric = /^([^=]+)=([0-9.]+|unknown)$/.exec(evidence);
  if (metric !== null) {
    const labels: Readonly<Record<string, string>> = {
      "lab.allocation.rdSafetyShare": "Current safety share of R&D",
      "lab.model.maxActiveFC": "Current highest model estimate",
    };
    const metricName = metric[1] ?? evidence;
    const rawValue = metric[2] ?? "unknown";
    const value =
      rawValue === "unknown"
        ? "unknown"
        : metricName.includes("Share")
          ? `${Math.round(Number(rawValue) * 100)}%`
          : String(Math.round(Number(rawValue)));
    return `${labels[metricName] ?? humanize(metricName)}: ${value}`;
  }
  const latest = /latest (?:conditional )?(?:tagged )?action at (never|[0-9]+)/.exec(
    evidence,
  );
  if (latest !== null) {
    return latest[1] === "never"
      ? "No qualifying action has been completed"
      : `Last qualifying action: week ${latest[1]}`;
  }
  return humanize(evidence.replaceAll("base:", ""));
}

function compactFacilityName(content: CompiledContent, facilityId: string): string {
  return (
    content.facilities[facilityId]?.displayName ??
    humanize(facilityId.replace(/^base:/, "").replace(/^facility\./, ""))
  );
}

function compactMetricExplanation(metric: string): string {
  switch (metric) {
    case "lab.allocation.rdSafetyShare":
      return "This is the share of research GPUs assigned to safety rather than capabilities. Change it in Research.";
    case "lab.model.maxActiveFC":
      return "This is the highest measured frontier-capability estimate among the lab's models. Review it in Models.";
    default:
      return "This promise is checked automatically from the lab's visible state.";
  }
}

function compactDestinationForMetric(
  metric: string,
): Pick<PeopleCompactConditionView, "actionLabel" | "destination"> {
  if (metric === "lab.allocation.rdSafetyShare") {
    return { actionLabel: "Open research allocation", destination: "research" };
  }
  if (metric === "lab.model.maxActiveFC") {
    return { actionLabel: "Open models", destination: "models" };
  }
  return { actionLabel: "See active bonuses", destination: "bonuses" };
}

function compactConditionDestination(
  check: ResearcherCompactCheckDefinition,
): Pick<PeopleCompactConditionView, "actionLabel" | "destination"> {
  if ("metric" in check && "atLeast" in check) {
    return compactDestinationForMetric(check.metric);
  }
  switch (check.type) {
    case "facility-owned-within":
      return { actionLabel: "Open facilities", destination: "lab" };
    case "release-requires-project":
    case "deployment-requires-flag":
      return { actionLabel: "Open models", destination: "models" };
    case "conditional-metric-at-least":
      return compactDestinationForMetric(check.metric);
    case "tagged-action-within":
      if (check.tags.includes("training-run-underway")) {
        return { actionLabel: "Open models", destination: "models" };
      }
      return { actionLabel: "Open research", destination: "research" };
    case "conditional-tagged-action-within":
    case "assignment-requires-project-tag":
    case "minimum-assignment-duration":
    case "publication-requires-review-tag":
    case "ratio-at-least":
      return { actionLabel: "Open research", destination: "research" };
    case "conditional-pool-share-at-least":
      return { actionLabel: "Open research", destination: "research" };
  }
}

function compactConditionExplanation(check: ResearcherCompactCheckDefinition): string {
  if ("metric" in check && "atLeast" in check) {
    return compactMetricExplanation(check.metric);
  }
  switch (check.type) {
    case "conditional-metric-at-least":
      return compactMetricExplanation(check.metric);
    case "facility-owned-within":
      return "Finishing before the hiring deadline avoids a breach. Completing the facility later repairs the ongoing relationship penalty, but does not erase the original breach.";
    case "conditional-pool-share-at-least":
      return "The promise is checked from the live GPU allocation whenever its condition applies.";
    case "minimum-assignment-duration":
    case "assignment-requires-project-tag":
      return "The promise is checked from the researcher's current appointment and active projects.";
    case "release-requires-project":
    case "deployment-requires-flag":
      return "This is checked when you authorise the relevant model operation.";
    case "tagged-action-within":
      if (check.tags.includes("training-run-underway")) {
        return "A run in progress keeps this promise the whole time it trains; once it ends, the next run must start within the window. Checked automatically from the training schedule.";
      }
      return "Qualifying research, review, and publication decisions are recorded automatically.";
    case "conditional-tagged-action-within":
    case "publication-requires-review-tag":
    case "ratio-at-least":
      return "Qualifying research, review, and publication decisions are recorded automatically.";
  }
}

function compactConditionProgress(
  check: ResearcherCompactCheckDefinition,
  content: CompiledContent,
  evaluated: {
    readonly satisfied: boolean;
    readonly applicable: boolean;
    readonly evidence: string;
  },
): string {
  if ("type" in check && check.type === "facility-owned-within") {
    const name = compactFacilityName(content, check.facility);
    return evaluated.satisfied ? `${name} completed` : `${name} not completed yet`;
  }
  if (!evaluated.applicable) {
    return "Not active — no action is required right now";
  }
  return compactEvidenceLabel(evaluated.evidence);
}

function compactConditionView(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcher: ResearcherState,
  check: ResearcherCompactCheckDefinition,
  promiseWork: ResearcherCommitmentQuote,
): PeopleCompactConditionView {
  const evaluated = evaluateResearcherCompactCheck(state, content, researcher.id, check);
  const commitmentTargets = researcherCommitmentTargets(check);
  const usesPromiseWork =
    commitmentTargets.actionTags.length > 0 ||
    commitmentTargets.projectTags.length > 0 ||
    commitmentTargets.reviewTags.length > 0 ||
    commitmentTargets.requiredFlags.length > 0;
  const dormantUntilCondition =
    !evaluated.applicable &&
    "type" in check &&
    (check.type === "assignment-requires-project-tag" ||
      check.type === "conditional-tagged-action-within");
  const promiseProgress =
    promiseWork.status === "complete-for-window"
      ? "Complete for the current review window"
      : promiseWork.status === "active"
        ? "In progress"
        : promiseWork.status === "queued"
          ? "Queued until a major-project slot is free"
          : "Not yet completed";
  return {
    progress:
      usesPromiseWork && !dormantUntilCondition
        ? promiseProgress
        : compactConditionProgress(check, content, evaluated),
    explanation:
      usesPromiseWork && !dormantUntilCondition
        ? "Completion is recorded automatically when this promise project finishes."
        : compactConditionExplanation(check),
    satisfied:
      usesPromiseWork && !dormantUntilCondition
        ? promiseWork.status === "complete-for-window"
        : evaluated.satisfied,
    ...(usesPromiseWork ? {} : compactConditionDestination(check)),
  };
}

function compactFulfilmentReward(definition: ResearcherDefinition): string {
  const effects = definition.compact.fulfilmentEffects.map((effect) => {
    const target =
      effect.target === "researcher.moraleTarget"
        ? "morale"
        : effect.target === "researcher.loyalty"
          ? "loyalty"
          : effect.target === "researcher.departurePressure"
            ? "departure pressure"
            : effectTargetLabel(effect.target).toLowerCase();
    if (effect.operation === "multiply") {
      return `×${String(effect.value)} ${target}`;
    }
    return `${effect.value >= 0 ? "+" : "−"}${String(Math.abs(effect.value))} ${target}`;
  });
  const timing =
    definition.compact.cadence === "one-time"
      ? "when completed"
      : definition.compact.cadence === "event-driven"
        ? "for each compliant event"
        : "when fulfilled or renewed";
  return `${effects.join(" · ")} ${timing}`;
}

const TARGET_PREFIXES: Readonly<Record<string, string>> = {
  assignedProgramme: "Assigned programme",
  pairedProgramme: "Paired programme",
  assignedProject: "Assigned project",
  auditedModel: "Audited model",
  completedDeepAudit: "Completed deep audit",
  modelAssistedResearch: "Model-assisted research",
  nextDifferentRoboticsProject: "Next different robotics project",
  prosperityProject: "Prosperity project",
  generalResearchers: "General researchers",
  safetyEvaluation: "Safety evaluation",
  talentMarket: "Talent market",
  trainingRun: "Training run",
};

function taggedTargetLabel(target: string): string | undefined {
  const match =
    /^(action|facility|incident|paper|project|recruitment|trainingRun)\.tag\.([^.]+)\.(.+)$/.exec(
      target,
    );
  if (match === null) return undefined;
  const [, kind, tag, metric] = match;
  if (kind === undefined || tag === undefined || metric === undefined) return undefined;
  const kindLabel = kind === "trainingRun" ? "training run" : kind;
  return `${humanize(tag)} ${kindLabel} ${humanize(metric).toLowerCase()}`;
}

function effectTargetLabel(target: string): string {
  const tagged = taggedTargetLabel(target);
  if (tagged !== undefined) return tagged;
  if (target === "lab.research.capability.output")
    return "All capability research output";
  if (target === "lab.research.safety.output") return "All safety research output";
  if (target === "lab.compute.workloadThroughput") return "Effective GPU throughput";
  if (target === "lab.evidence.displayedQuality") return "Evaluation evidence quality";
  if (target === "lab.incident.hazard") return "Incident risk";
  // Every target a researcher can carry needs a name a player recognises.
  // Without a case here the label falls through to a humanised dump of the
  // target path -- "Lab · Compute · Owned Power Cost" -- which reads as a
  // debugging artefact and tells a player nothing about what they are buying.
  if (target === "lab.compute.ownedPowerCost") return "Owned-GPU power cost";
  if (target === "lab.evaluation.cashCost") return "Evaluation cash cost";
  if (target === "lab.research.all.output") return "All research output";
  if (target === "lab.research.diffusionRate")
    return "Knowledge diffusion per colleague skill point";
  if (target === "serving.computePerRequest") return "Compute per served request";
  if (target === "lab.politics.governmentTrustFloor") return "Government trust floor";
  if (target === "lab.organisation.safetyCultureFloor") return "Safety culture floor";
  if (target === "aura.firstPublicLaunchGain")
    return "Aura from each model's initial public launch";
  if (target === "aura.openPaperModelOrDatasetGain") return "Aura from open releases";
  if (target === "lab.aura.standingIncome") return "Aura per cycle (4 weeks)";
  if (target === "aura.worldFirstCapabilityPaperGain")
    return "Aura from world-first papers";
  // These are run-wide, not scoped to an individual training run.
  if (target === "lab.training.technicalFailureHazard")
    return "Training technical-failure risk";
  if (target === "lab.training.frontier.cashCost") return "Frontier training cash cost";
  if (target === "lab.product.durationWeeks")
    return "Productisation duration for every model (weeks)";
  if (target === "lab.product.firstProject.durationWeeks")
    return "First productisation duration (weeks)";
  if (target === "world.rival.progress") return "Rival research progress";
  if (target === "researcher.moraleTarget") return "Lab-wide researcher morale";
  if (target === "researcher.loyalty") return "Lab-wide researcher loyalty";
  // Runtime programme targets, e.g.
  // lab.research.program.base:safety.alignment-control.output. The authored
  // form has a friendly label already; the resolved form reaches the benefit
  // breakdown and would otherwise render as "Lab · Research · Program · ...".
  const programme =
    /^lab\.research\.program\.base:(domain|safety)\.([a-z0-9-]+)\.(output|weeklyVarianceWidth)$/.exec(
      target,
    );
  if (programme !== null) {
    const [, kind, id, metric] = programme;
    if (kind !== undefined && id !== undefined && metric !== undefined) {
      const scope = kind === "domain" ? "research output" : "safety research output";
      return metric === "output"
        ? `${humanize(id)} ${scope}`
        : `${humanize(id)} weekly variance`;
    }
  }
  const domain = /^(domain|safety)\.([^.]+)\.(.+)$/.exec(target);
  if (domain !== null) {
    const [, kind, id, metric] = domain;
    if (kind !== undefined && id !== undefined && metric !== undefined) {
      return `${humanize(id)} ${kind === "domain" ? "domain" : "safety programme"} ${humanize(metric).toLowerCase()}`;
    }
  }
  const [prefix, ...rest] = target.split(".");
  const prefixLabel = prefix === undefined ? undefined : TARGET_PREFIXES[prefix];
  if (prefixLabel !== undefined && rest.length > 0) {
    return `${prefixLabel} ${rest.map(humanize).join(" · ").toLowerCase()}`;
  }
  return target.split(".").map(humanize).join(" · ");
}

function effectView(effect: ResearcherModifierDefinition): PeopleAbilityEffectView {
  const target = effectTargetLabel(effect.target);
  const valueLabel =
    effect.operation === "multiply"
      ? `${effect.value >= 1 ? "+" : "−"}${String(Math.round(Math.abs(effect.value - 1) * 100))}%`
      : `${effect.value >= 0 ? "+" : ""}${String(effect.value)}`;
  const stackingGroup =
    effect.stackingGroup === undefined ? undefined : humanize(effect.stackingGroup);
  const targetInSentence = `${target[0]?.toLowerCase() ?? ""}${target.slice(1)}`;
  const explanation = (() => {
    if (effect.operation === "multiply") {
      return `Multiplies ${targetInSentence} by ${effect.value.toFixed(2)}. Effects on distinct scoped targets remain separate; effects on the same target combine multiplicatively in full.`;
    }
    if (effect.operation === "add") {
      return `Adds ${String(effect.value)} to ${targetInSentence}. Additive effects on the same target are totalled in full.`;
    }
    if (effect.operation === "min") {
      return `Caps ${targetInSentence} at ${String(effect.value)} when this ability applies.`;
    }
    return `Raises the floor for ${targetInSentence} to ${String(effect.value)} when this ability applies.`;
  })();
  return {
    targetLabel: target,
    operation: effect.operation,
    value: effect.value,
    displayLabel: `${target} ${valueLabel}`,
    explanation,
    ...(stackingGroup === undefined ? {} : { stackingGroup }),
  };
}

function benefitValueLabel(
  operation: ResearcherBenefitRow["operation"],
  value: number,
  kind: ResearcherBenefitRow["kind"],
): string {
  if (operation === "multiply")
    return `x${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  if (kind === "generic") return `+${value.toFixed(1).replace(/\.0$/, "")}%`;
  return `${value >= 0 ? "+" : ""}${String(Number(value.toFixed(3)))}`;
}

function benefitRowView(row: ResearcherBenefitRow): PeopleBenefitRowView {
  const targetLabel = effectTargetLabel(row.target);
  const currentLabel = benefitValueLabel(row.operation, row.currentValue, row.kind);
  const fullLabel = benefitValueLabel(row.operation, row.fullValue, row.kind);
  const explanation =
    row.kind === "generic"
      ? row.active
        ? `Standard for every programme lead: each matching skill point adds 3% research output. This appointment contributes ${currentLabel}.`
        : `Standard for every programme lead: each matching skill point adds 3% research output. ${row.inactiveReason ?? "No programme is currently led."}`
      : !row.active
        ? `Not applying: ${row.inactiveReason ?? "condition not met"}. At full strength this would be ${fullLabel} on ${targetLabel.toLowerCase()}.`
        : row.atFullStrength
          ? `Applying at full strength, ${fullLabel} on ${targetLabel.toLowerCase()}.`
          : `Applying at ${currentLabel} of an eventual ${fullLabel} on ${targetLabel.toLowerCase()}, while the ability ramps or the researcher is unhoused.`;
  return {
    key: row.key,
    kind: row.kind,
    abilityLabel: row.abilityLabel,
    targetLabel,
    currentLabel,
    fullLabel,
    atFullStrength: row.atFullStrength,
    active: row.active,
    ...(row.inactiveReason === undefined ? {} : { inactiveReason: row.inactiveReason }),
    explanation,
    ...(row.stackingGroup === undefined ? {} : { stackingGroup: row.stackingGroup }),
  };
}

export function projectPeopleAbilityView(
  ability: ResearcherAbilityDefinition,
): PeopleAbilityView {
  return {
    abilityId: ability.id,
    label: ability.label,
    ...(ability.notes === undefined ? {} : { notes: ability.notes }),
    eligibleAssignmentKinds: ability.eligibleAssignments,
    effects: ability.effects.map(effectView),
    modes: ability.modes.map((mode) => ({
      label:
        mode.domain === undefined
          ? mode.assignment === undefined
            ? "Contextual mode"
            : `${title(mode.assignment.kind)}${mode.assignment.id === undefined ? "" : ` · ${title(mode.assignment.id)}`}`
          : title(mode.domain),
      effects: mode.effects.map(effectView),
    })),
    rampWeeks: ability.rampWeeks,
  };
}

function profile(
  state: Readonly<GameState>,
  content: CompiledContent,
  definition: ResearcherDefinition,
  researcherId: ResearcherId,
  paperLinks: ResearcherPaperLinkIndex,
): PeopleProfileView {
  const researchSkills = [
    ...Object.values(content.research.capabilityDomains),
    ...Object.values(content.research.safetyPrograms),
  ].flatMap((programme): readonly PeopleResearchSkillView[] => {
    const skillKey = researcherSkillForProgramme(programme.id);
    if (skillKey === undefined) return [];
    const level = definition.skills[skillKey] ?? 0;
    return [
      {
        programmeId: programme.id,
        skillKey,
        label: programme.shortName,
        kind: programme.kind,
        level,
        maximumLevel: 5,
        leadOutputBonusPercent: level * 3,
      },
    ];
  });
  return {
    researcherId,
    definitionId: definition.id,
    displayName: definition.displayName,
    inspirationName: definition.inspirationName,
    inspirationSummary: definition.inspirationSummary,
    initials: initials(definition.displayName),
    epithet: definition.epithet,
    role: definition.role,
    rosterSummary: definition.rosterCardSummary,
    biography: definition.biography,
    sourceUrls: definition.sources,
    realWorldPapers: paperLinks.papersByResearcherDefinitionId[definition.id] ?? [],
    portraitAssetId: definition.portrait.assetId,
    portraitBrief: definition.portrait.brief,
    portraitAltText: definition.portrait.altText,
    contractBand: definition.contract.band,
    researchSkills,
    benefits: quoteResearcherBenefits(state, content, researcherId).map(benefitRowView),
    signature: projectPeopleAbilityView(definition.signature),
    passive: projectPeopleAbilityView(definition.passive),
    compact: {
      label: definition.compact.label,
      requirement: definition.compact.requirement,
      cadence: definition.compact.cadence,
    },
  };
}

function optionId(
  kind: ResearcherAssignmentKind,
  targetId: string | undefined,
  role: ResearcherAssignmentRole,
): string {
  return `${kind}|${targetId ?? "institution"}|${role}`;
}

function assignmentOptions(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): readonly PeopleAssignmentOptionView[] {
  const lab = requireLab(state, labId);
  const options: PeopleAssignmentOptionView[] = [];
  const add = (
    kind: ResearcherAssignmentKind,
    label: string,
    targetId: string | undefined,
    role: ResearcherAssignmentRole,
  ): void => {
    options.push({
      optionId: optionId(kind, targetId, role),
      kind,
      ...(targetId === undefined ? {} : { targetId }),
      role,
      label: `Lead · ${label}`,
      shortLabel: `${label} · lead`,
    });
  };
  for (const programId of Object.keys(lab.research.domains).sort()) {
    const label =
      content.research.capabilityDomains[programId]?.shortName ??
      humanize(programId.split(":").at(-1) ?? "Capability programme");
    add("capability-program", label, programId, "lead");
  }
  for (const programId of Object.keys(lab.research.safetyPrograms).sort()) {
    const label =
      content.research.safetyPrograms[programId]?.shortName ??
      humanize(programId.split(":").at(-1) ?? "Safety programme");
    add("safety-program", label, programId, "lead");
  }
  // Leading a research area is the only assignment. Project postings and the
  // three institutional councils were removed: signature abilities are always
  // on now, so those slots existed only to gate bonuses the researcher already
  // provides, and they made the governing skill invisible at the point of
  // choice. The unused skills (management, politics, training, product) stay
  // in the data, connected to nothing, until they earn a real mechanic.
  return options;
}

function condition(
  value: number,
  thresholds: readonly [number, number, number],
  labels: readonly [string, string, string, string],
  reverse = false,
): { readonly band: PeopleConditionBand; readonly label: string } {
  const score = reverse ? 100 - value : value;
  if (score >= thresholds[2]) return { band: "good", label: labels[3] };
  if (score >= thresholds[1]) return { band: "steady", label: labels[2] };
  if (score >= thresholds[0]) return { band: "warning", label: labels[1] };
  return { band: "critical", label: labels[0] };
}

function currentAssignmentLabel(
  researcher: Readonly<ResearcherState>,
  options: readonly PeopleAssignmentOptionView[],
): string | undefined {
  const assignment = researcher.assignment;
  if (assignment === undefined) return undefined;
  return options.find(
    (option) =>
      option.kind === assignment.kind &&
      option.targetId === assignment.targetId &&
      option.role === assignment.role,
  )?.label;
}

function researcherWarnings(
  researcher: Readonly<ResearcherState>,
  morale: PeopleConditionBand,
  burnout: PeopleConditionBand,
): readonly string[] {
  const warnings: string[] = [];
  if (researcher.housing === "unhoused")
    warnings.push("Unhoused · reduced effectiveness");
  if (morale === "warning" || morale === "critical") warnings.push("Morale is fragile");
  if (burnout === "warning" || burnout === "critical") warnings.push("Burnout risk");
  if (researcher.compact.status === "warning") warnings.push("Promise due soon");
  if (researcher.compact.status === "breached") warnings.push("Promise broken");
  if (researcher.ultimatum?.status === "pending") warnings.push("Ultimatum pending");
  if (researcher.poaching !== undefined && researcher.poaching.stage !== "resolved") {
    warnings.push("Rival contact reported");
  }
  return warnings;
}

function candidateView(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
  paperLinks: ResearcherPaperLinkIndex,
): TalentCandidateView {
  const researcher = state.researchers[researcherId];
  const definition =
    researcher === undefined
      ? undefined
      : content.researchers.definitions[researcher.definitionId];
  if (researcher === undefined || definition === undefined) {
    throw new Error(`Missing talent candidate ${researcherId}`);
  }
  const quote = quoteRecruitment(state, content, labId, researcherId);
  return {
    ...profile(state, content, definition, researcherId, paperLinks),
    listedTerms: {
      salaryMillionsPerCycle: quote.salaryPerCycle,
      signingCashMillions: quote.signingCash,
      auraCost: quote.auraCost,
      auraCostBreakdown: quote.auraCostBreakdown,
      ...(quote.foundingHireGuarantee === undefined
        ? {}
        : { foundingHireGuarantee: quote.foundingHireGuarantee }),
      blockers: quote.blockers,
    },
  };
}

export function projectPeopleView(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): PeopleView {
  const lab = requireLab(state, labId);
  const options = assignmentOptions(state, content, labId);
  const paperLinks = buildResearcherPaperLinkIndex(content);
  const roster = lab.roster.researcherIds.flatMap((researcherId) => {
    const researcher = state.researchers[researcherId];
    const definition =
      researcher === undefined
        ? undefined
        : content.researchers.definitions[researcher.definitionId];
    if (
      researcher === undefined ||
      definition === undefined ||
      researcher.employerLabId !== labId ||
      (researcher.status !== "employed" && researcher.status !== "sabbatical")
    ) {
      return [];
    }
    const morale = condition(
      researcher.morale,
      [30, 50, 75],
      ["Disaffected", "Fragile", "Steady", "Inspired"],
    );
    const loyalty = condition(
      researcher.loyalty,
      [25, 50, 75],
      ["Flight risk", "Listening", "Settled", "Committed"],
    );
    const burnout = condition(
      researcher.burnout,
      [25, 50, 75],
      ["Exhausted", "Strained", "Sustainable", "Rested"],
      true,
    );
    const dismissal = quoteDismissal(state, content, labId, researcherId);
    const assignmentLabel = currentAssignmentLabel(researcher, options);
    const compactCheck = evaluateResearcherCompactCheck(
      state,
      content,
      researcher.id,
      definition.compact.check,
    );
    const promiseWork = quoteResearcherCommitment(state, content, labId, researcher.id);
    const compactCondition = compactConditionView(
      state,
      content,
      researcher,
      definition.compact.check,
      promiseWork,
    );
    const compactWindow = compactWindowWeeks(content, definition.compact.check);
    const compactAnchor = Math.max(
      compactCheck.satisfiedAt ?? 0,
      researcher.compact.lastSatisfiedAt ?? 0,
      researcher.compact.windowStartedAt ?? researcher.employedAt ?? state.run.tick,
    );
    const compactStatus: RosterResearcherView["compactStatus"] =
      researcher.compact.status === "warning" || researcher.compact.status === "breached"
        ? researcher.compact.status
        : researcher.compact.includedInOffer && compactCondition.satisfied
          ? "fulfilled"
          : "tracking";
    return [
      {
        ...profile(state, content, definition, researcherId, paperLinks),
        status: researcher.status,
        housing: researcher.housing,
        ...(researcher.assignment === undefined
          ? {}
          : {
              assignment: {
                optionId: optionId(
                  researcher.assignment.kind,
                  researcher.assignment.targetId,
                  researcher.assignment.role,
                ),
                kind: researcher.assignment.kind,
                ...(researcher.assignment.targetId === undefined
                  ? {}
                  : { targetId: researcher.assignment.targetId }),
                role: researcher.assignment.role,
                label:
                  assignmentLabel ??
                  `${title(researcher.assignment.role)} · ${title(researcher.assignment.kind)}`,
                assignedAtTick: researcher.assignment.assignedAt,
              },
            }),
        morale,
        loyalty,
        burnout,
        departure: (() => {
          const pressure = calculateDeparturePressure(state, researcherId);
          const factors: readonly [string, number][] = [
            ["low morale", pressure.lowMorale],
            ["low loyalty", pressure.lowLoyalty],
            ["burnout", pressure.burnout],
            ["unhoused", pressure.unhoused],
            ["broken compact", pressure.compact],
            ["broken promises", pressure.brokenPromises],
            ["rival contact", pressure.rivalContact],
            ["frontier headhunting", pressure.frontierPull],
          ];
          return {
            ...condition(
              pressure.target,
              [20, 45, 70],
              ["Departure likely", "Strained", "Restless", "Settled"],
              true,
            ),
            topFactors: factors
              .filter(([, amount]) => amount > 0)
              .sort((left, right) => right[1] - left[1])
              .slice(0, 3)
              .map(([label]) => label),
          };
        })(),
        // Mirrors people.ts transferFraction; recomputed here from the same
        // visible inputs so the risk is priced before the resignation letter.
        knowledgeTransferPercent: Math.round(
          Math.min(
            0.6,
            Math.max(
              0.2,
              0.6 - lab.safety.securityPosture / 250 - researcher.loyalty / 500,
            ),
          ) * 100,
        ),
        ...(researcher.contract === undefined
          ? {}
          : {
              contract: {
                salaryMillionsPerCycle: researcher.contract.salaryPerCycle,
                signingCashMillions: researcher.contract.signingCash,
                auraCost: researcher.contract.auraCost,
                agreedAtTick: researcher.contract.agreedAt,
                // The projected raise if the review happened now: the gap
                // between the contract and the live market (inflation times
                // the AGI-proximity boom). Grows as the world frontier climbs.
                annualGrowthPercent: Math.max(
                  0,
                  ((definition.contract.baseSalaryPerCycle *
                    researcherSalaryMarketMultiplier(state, state.run.tick)) /
                    Math.max(0.01, researcher.contract.salaryPerCycle) -
                    1) *
                    100,
                ),
                nextReviewAtTick:
                  researcher.contract.agreedAt +
                  (Math.floor(
                    Math.max(0, state.run.tick - researcher.contract.agreedAt) /
                      RESEARCHER_CONTRACT_REVIEW_WEEKS,
                  ) +
                    1) *
                    RESEARCHER_CONTRACT_REVIEW_WEEKS,
                nextReviewInWeeks:
                  researcher.contract.agreedAt +
                  (Math.floor(
                    Math.max(0, state.run.tick - researcher.contract.agreedAt) /
                      RESEARCHER_CONTRACT_REVIEW_WEEKS,
                  ) +
                    1) *
                    RESEARCHER_CONTRACT_REVIEW_WEEKS -
                  state.run.tick,
              },
            }),
        compactStatus,
        compactReview: {
          includedInOffer: researcher.compact.includedInOffer,
          currentEvidence: researcher.compact.includedInOffer
            ? compactEvidenceLabel(compactCheck.evidence)
            : "This promise was not included in the accepted hiring terms",
          ...(researcher.compact.includedInOffer
            ? {
                condition: compactCondition,
              }
            : {}),
          fulfilmentReward: compactFulfilmentReward(definition),
          ...(researcher.compact.includedInOffer
            ? {
                promiseWork,
              }
            : {}),
          consequence:
            "If this promise is breached, morale and loyalty fall, departure pressure rises, and the researcher may issue an ultimatum.",
          ...(researcher.compact.includedInOffer &&
          compactCheck.applicable &&
          definition.compact.cadence !== "event-driven" &&
          !(definition.compact.cadence === "one-time" && compactCheck.satisfied) &&
          researcher.compact.status !== "breached"
            ? {
                reviewInWeeks: Math.max(
                  0,
                  compactWindow - (state.run.tick - compactAnchor),
                ),
              }
            : {}),
        },
        ...(researcher.ultimatum?.status === "pending"
          ? {
              ultimatum: {
                reason: researcher.ultimatum.reason,
                expiresInWeeks: Math.max(
                  0,
                  researcher.ultimatum.expiresAt - state.run.tick,
                ),
              },
            }
          : {}),
        ...(researcher.poaching === undefined || researcher.poaching.stage === "resolved"
          ? {}
          : {
              rivalApproach: {
                stage: researcher.poaching.stage,
                rivalLabName: rivalLabDisplayName(
                  state,
                  content,
                  researcher.poaching.rivalLabId,
                ),
                resolvesInWeeks: Math.max(
                  0,
                  researcher.poaching.resolvesAt - state.run.tick,
                ),
                retentionResponseKind:
                  researcher.poaching.playerRetentionStrength <= 0
                    ? ("none" as const)
                    : researcher.poaching.playerRetentionStrength >= 10
                      ? ("serious" as const)
                      : ("reassurance" as const),
                retentionResponseLabel:
                  researcher.poaching.playerRetentionStrength <= 0
                    ? "No retention offer submitted"
                    : researcher.poaching.playerRetentionStrength >= 9
                      ? "Serious retention package recorded"
                      : "Immediate reassurance recorded",
              },
            }),
        warnings: researcherWarnings(researcher, morale.band, burnout.band),
        promises: researcher.promises.map((promise) => ({
          id: promise.id,
          label: promise.label,
          status: promise.status,
          dueAtTick: promise.dueAt,
        })),
        dismissal: {
          severanceCashMillions: dismissal.severanceCash,
          auraLoss: dismissal.auraLoss,
          blockers: dismissal.blockers,
        },
      },
    ];
  });
  const builtFacilityIds = new Set(
    lab.facilities.instances.map((instance) => instance.definitionId),
  );
  const nextSlotFacilities = Object.values(content.facilities)
    .filter(
      (definition) =>
        definition.tags.includes("star-slot") && !builtFacilityIds.has(definition.id),
    )
    .sort((a, b) => a.tier - b.tier || a.cashCostMillions - b.cashCostMillions)
    .map((definition) => definition.displayName);
  return {
    organisation: {
      staffPayMultiplier:
        Math.round(staffPayrollMarketMultiplier(state, state.run.tick) * 100) / 100,
    },
    slots: {
      occupied: roster.length,
      unlocked: lab.roster.starSlots,
      hardMaximum: content.researchers.rules.ability.hardMaximumSlots,
      vacant: Math.max(0, lab.roster.starSlots - roster.length),
      unhoused: roster.filter((researcher) => researcher.housing === "unhoused").length,
      nextSlotFacilities,
    },
    roster,
    assignmentOptions: options,
    market: {
      refreshIndex: state.talentMarket.refreshIndex,
      nextRefreshAtTick: state.talentMarket.nextRefreshAt,
      refreshInWeeks: Math.max(0, state.talentMarket.nextRefreshAt - state.run.tick),
      candidates: state.talentMarket.visibleResearcherIds.map((researcherId) =>
        candidateView(state, content, labId, researcherId, paperLinks),
      ),
    },
  };
}
