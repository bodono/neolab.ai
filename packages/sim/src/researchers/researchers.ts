import type {
  CompiledContent,
  ResearcherAbilityDefinition,
  ResearcherActivationDefinition,
  ResearcherAssignmentKind,
  ResearcherModifierDefinition,
} from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import type { ModifierId, ProjectId, ResearcherId } from "../model/ids.ts";
import type {
  GameState,
  ModifierState,
  ResearcherAssignmentState,
  ResearcherState,
} from "../model/state.ts";
import { tick } from "../model/units.ts";

export interface ResearcherContributionBreakdown {
  readonly researcherId: ResearcherId;
  readonly assignmentKind: ResearcherAssignmentKind;
  readonly role: ResearcherAssignmentState["role"];
  readonly matchingSkill: string;
  readonly skillLevel: number;
  readonly genericPercentagePoints: number;
  readonly signatureEligible: boolean;
  readonly signatureRamp: number;
  readonly housingMultiplier: number;
}

const PROGRAMME_SKILLS: Readonly<Record<string, string>> = {
  "base:domain.architectures": "architectures",
  "base:domain.optimisation-scaling": "optimisationScaling",
  "base:domain.reinforcement-agency": "reinforcementAgency",
  "base:domain.multimodality": "multimodality",
  "base:domain.reasoning-tools": "reasoningTools",
  "base:domain.robotics-embodiment": "roboticsEmbodiment",
  "base:domain.scientific-ai": "scientificAi",
  "base:safety.alignment-control": "alignmentControl",
  "base:safety.interpretability-evals": "interpretabilityEvals",
  "base:safety.security-containment": "securityContainment",
};

export function researcherSkillForProgramme(programmeId: string): string | undefined {
  return PROGRAMME_SKILLS[programmeId];
}

export function researcherSkillForAssignment(
  assignment: ResearcherAssignmentState,
): string {
  const programmeSkill =
    assignment.targetId === undefined
      ? undefined
      : researcherSkillForProgramme(assignment.targetId);
  if (programmeSkill !== undefined) return programmeSkill;
  if (assignment.kind === "training-run") return "training";
  if (assignment.kind === "productisation") return "product";
  return "management";
}

function requireResearcher(
  state: Readonly<GameState>,
  researcherId: ResearcherId,
): ResearcherState {
  const researcher = state.researchers[researcherId];
  if (researcher === undefined) throw new Error(`Unknown researcher ${researcherId}`);
  return researcher;
}

/**
 * How much of an ability's authored strength is live this week.
 *
 * Two bugs lived here. It returned zero for an unassigned researcher, which
 * silently cancelled the always-on signature rule: a new hire's ability showed
 * on the dossier and then did nothing until they were given a programme. And
 * it ignored the authored `rampWeeks` in favour of a fixed four-step table, so
 * an ability advertising a five-week ramp still ramped in four.
 *
 * It now counts from the hire date, so changing which programme someone leads
 * cannot silently switch off or restart an unrelated standing ability, and it
 * honours the authored ramp length when present.
 */
function signatureRamp(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcher: ResearcherState,
  rampWeeks?: number,
): number {
  const startedAt = researcher.employedAt;
  if (startedAt === undefined) return 0;
  const elapsed = Math.max(0, state.run.tick - startedAt);
  if (rampWeeks !== undefined && rampWeeks > 0) {
    return Math.min(1, (elapsed + 1) / rampWeeks);
  }
  const sequence = content.researchers.rules.ability.reassignmentRamp;
  return sequence[Math.min(elapsed, sequence.length - 1)] ?? 1;
}

/** Generic programme skill contribution shared by every star researcher. */
export function quoteResearcherContribution(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcherId: ResearcherId,
  assignment: ResearcherAssignmentState,
): ResearcherContributionBreakdown {
  const researcher = requireResearcher(state, researcherId);
  const definition = content.researchers.definitions[researcher.definitionId];
  if (definition === undefined) {
    throw new Error(`Missing definition ${researcher.definitionId} for ${researcherId}`);
  }
  const skill = researcherSkillForAssignment(assignment);
  const skillLevel = definition.skills[skill] ?? 0;
  const housingMultiplier =
    researcher.housing === "unhoused"
      ? content.researchers.rules.ability.unhousedStrengthMultiplier
      : 1;
  const rawPercentagePoints =
    assignment.role === "lead"
      ? skillLevel * 3
      : assignment.role === "advisor"
        ? skillLevel * 1.5
        : 0;
  return {
    researcherId,
    assignmentKind: assignment.kind,
    role: assignment.role,
    matchingSkill: skill,
    skillLevel,
    genericPercentagePoints:
      researcher.status === "employed" ? rawPercentagePoints * housingMultiplier : 0,
    signatureEligible: researcher.status === "employed",
    signatureRamp: signatureRamp(state, content, researcher),
    housingMultiplier,
  };
}

/** One line of the unified benefit breakdown, current strength versus full. */
export interface ResearcherBenefitRow {
  readonly key: string;
  readonly kind: "signature" | "passive" | "compact" | "generic";
  readonly abilityLabel: string;
  /** Runtime target, already resolved through runtimeTarget. */
  readonly target: string;
  readonly operation: "add" | "multiply" | "min" | "max";
  /** What the lab is getting right now: neutral (1 or 0) when inactive. */
  readonly currentValue: number;
  /** What it is worth at full ramp, housed and eligible. */
  readonly fullValue: number;
  readonly atFullStrength: boolean;
  readonly active: boolean;
  readonly inactiveReason?: string;
  readonly stackingGroup?: string;
}

function neutralValue(operation: ResearcherModifierDefinition["operation"]): number {
  return operation === "multiply" ? 1 : 0;
}

/**
 * Why an ability is not paying out, or undefined when it is. The recruitment
 * dossier and the roster panel both render from this, so a ramping signature
 * no longer appears to change value the moment someone is hired: it is the
 * same row, with a current strength that climbs to the full one.
 */
function abilityInactiveReason(
  content: CompiledContent,
  researcher: ResearcherState,
  kind: ResearcherBenefitRow["kind"],
): string | undefined {
  if (researcher.status === "available") return "Not on your roster yet";
  if (researcher.status === "departed") return "No longer at your lab";
  if (researcher.employerLabId === undefined) return "Not on your roster yet";
  const rules = content.researchers.rules.ability;
  if (researcher.status === "sabbatical") {
    if (kind === "passive" && rules.sabbaticalDisablesPassive) return "On sabbatical";
    if (kind === "signature" && rules.sabbaticalDisablesSignature) {
      return "On sabbatical";
    }
  }
  if (kind === "compact" && !researcher.compact.includedInOffer) {
    return "Compact not in their contract";
  }
  return undefined;
}

function benefitRows(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcher: ResearcherState,
  ability: ResearcherAbilityDefinition,
  kind: ResearcherBenefitRow["kind"],
  liveStrength: number,
): readonly ResearcherBenefitRow[] {
  const inactiveReason = abilityInactiveReason(content, researcher, kind);
  const active = inactiveReason === undefined;
  const strength = active ? liveStrength : 0;
  return abilityEffects(researcher, ability).flatMap(
    (effect, index): readonly ResearcherBenefitRow[] => {
      const target = runtimeTarget(
        content,
        effect.target,
        researcher,
        authoredProgrammeId(ability, effect),
      );
      // A target that cannot resolve is not a benefit anyone can be shown.
      if (target === undefined) return [];
      const fullValue = scaledModifierValue(effect, 1);
      const currentValue = active
        ? scaledModifierValue(effect, strength)
        : neutralValue(effect.operation);
      return [
        {
          key: `${researcher.id}/${ability.id}/${String(index)}`,
          kind,
          abilityLabel: ability.label,
          target,
          operation: effect.operation,
          currentValue,
          fullValue,
          atFullStrength: active && Math.abs(currentValue - fullValue) < 1e-9,
          active,
          ...(inactiveReason === undefined ? {} : { inactiveReason }),
          ...(effect.stackingGroup === undefined
            ? {}
            : { stackingGroup: effect.stackingGroup }),
        },
      ];
    },
  );
}

/**
 * The single benefit breakdown both people surfaces render. Covers the
 * signature, the passive, the compact's attached effects, and the generic
 * per-skill-point lead bonus that neither surface used to show at all.
 */
export function quoteResearcherBenefits(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcherId: ResearcherId,
): readonly ResearcherBenefitRow[] {
  const researcher = requireResearcher(state, researcherId);
  const definition = content.researchers.definitions[researcher.definitionId];
  if (definition === undefined) {
    throw new Error(`Missing definition ${researcher.definitionId} for ${researcherId}`);
  }
  const housingStrength =
    researcher.housing === "unhoused"
      ? content.researchers.rules.ability.unhousedStrengthMultiplier
      : 1;
  const ramp = signatureRamp(state, content, researcher, definition.signature.rampWeeks);
  const rows = [
    ...benefitRows(
      state,
      content,
      researcher,
      definition.passive,
      "passive",
      housingStrength,
    ),
    ...benefitRows(
      state,
      content,
      researcher,
      definition.signature,
      "signature",
      housingStrength * ramp,
    ),
    ...benefitRows(
      state,
      content,
      researcher,
      {
        id: definition.compact.id,
        label: definition.compact.label,
        eligibleAssignments: [],
        effects: definition.compact.attachedEffects,
        modes: [],
        rampWeeks: 0,
      },
      "compact",
      housingStrength,
    ),
  ];
  // The generic lead bonus is a real, sizeable contribution -- up to 15% -- and
  // was the one thing neither the dossier nor the roster ever showed.
  const assignment = researcher.assignment;
  const skill =
    assignment === undefined ? undefined : researcherSkillForAssignment(assignment);
  const skillLevel = skill === undefined ? 0 : (definition.skills[skill] ?? 0);
  const fullGeneric = skillLevel * 3;
  if (fullGeneric > 0 || assignment === undefined) {
    const leadInactive =
      assignment === undefined
        ? "Not leading a programme"
        : abilityInactiveReason(content, researcher, "passive");
    const strongest = strongestProgrammeId(content, researcher);
    const target = assignment?.targetId ?? strongest ?? definition.id;
    const best = Math.max(
      ...Object.values(definition.skills).map((value) => value ?? 0),
      0,
    );
    rows.push({
      key: `${researcher.id}/generic`,
      kind: "generic",
      abilityLabel: "Baseline programme lead bonus",
      target: programmeModifierTarget(target),
      operation: "add",
      currentValue: leadInactive === undefined ? fullGeneric * housingStrength : 0,
      fullValue: assignment === undefined ? best * 3 : fullGeneric,
      atFullStrength: leadInactive === undefined && housingStrength === 1,
      active: leadInactive === undefined,
      ...(leadInactive === undefined ? {} : { inactiveReason: leadInactive }),
    });
  }
  return rows;
}

function currentModel(state: Readonly<GameState>, researcher: ResearcherState) {
  const lab =
    researcher.employerLabId === undefined
      ? undefined
      : state.labs[researcher.employerLabId];
  return lab?.models.currentModelId === undefined
    ? undefined
    : state.models[lab.models.currentModelId];
}

function assignmentProject(state: Readonly<GameState>, researcher: ResearcherState) {
  const targetId = researcher.assignment?.targetId;
  return targetId === undefined ? undefined : state.projects[targetId as ProjectId];
}

function labMetric(
  state: Readonly<GameState>,
  researcher: ResearcherState,
  metric: string,
): number | undefined {
  const lab =
    researcher.employerLabId === undefined
      ? undefined
      : state.labs[researcher.employerLabId];
  if (lab === undefined) return undefined;
  switch (metric) {
    case "lab.allocation.rdSafetyShare":
      return 1 - lab.compute.allocation.capabilityBasisPoints / 10_000;
    case "lab.model.maxActiveFC": {
      const values = lab.models.modelIds.map((id) => {
        const model = state.models[id];
        return model?.measuredCapability?.frontierCapability ?? 0;
      });
      return Math.max(0, ...values);
    }
    default:
      return typeof lab.flags[`metric:${metric}`] === "number"
        ? (lab.flags[`metric:${metric}`] as number)
        : undefined;
  }
}

function contentIdSuffix(value: string): string {
  const separator = value.indexOf(":");
  return separator === -1 ? value : value.slice(separator + 1);
}

function activationMatches(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcher: ResearcherState,
  activation: ResearcherActivationDefinition | undefined,
): boolean {
  if (activation === undefined) return true;
  const assignment = researcher.assignment;
  const project = assignmentProject(state, researcher);
  const lab =
    researcher.employerLabId === undefined
      ? undefined
      : state.labs[researcher.employerLabId];
  if (lab === undefined) return false;
  switch (activation.type) {
    case "assignment-domain-in":
      return (
        assignment?.targetId !== undefined &&
        activation.values.includes(assignment.targetId)
      );
    case "assignment-id-in":
      return (
        assignment?.targetId !== undefined &&
        activation.values.includes(assignment.targetId)
      );
    case "assignment-kind-in":
      return assignment !== undefined && activation.values.includes(assignment.kind);
    case "assignment-tag-in":
      return activation.values.some(
        (tag) =>
          lab.flags[`assignment-tag:${tag}`] === true ||
          assignment?.targetId?.includes(contentIdSuffix(tag)) === true,
      );
    case "assignment-domain":
    case "assignment-programme":
      return assignment?.targetId === activation.value;
    case "assigned-project-kind":
      return project?.kind === activation.value;
    case "assigned-training-scale-in":
      return (
        project?.payload.kind === "training" &&
        activation.values.includes(project.payload.scale)
      );
    case "assignment-domain-or-training":
      return (
        assignment?.targetId === activation.domain || assignment?.kind === "training-run"
      );
    case "assignment-domain-or-discovery":
      return (
        (assignment?.targetId !== undefined &&
          activation.domains.includes(assignment.targetId)) ||
        lab.research.discoveredPaperIds.some((paperId) =>
          content.papers.definitions[paperId]?.tags.includes(activation.discoveryTag),
        )
      );
    case "assignment-domain-or-project-tag":
      return (
        assignment?.targetId === activation.domain ||
        lab.flags[`project-tag:${activation.projectTag}:active`] === true
      );
    case "metric-between-for-weeks": {
      const metric = labMetric(state, researcher, activation.metric);
      return metric !== undefined && metric >= activation.min && metric <= activation.max;
    }
    case "paired-allocation-at-least": {
      const first = Object.entries(lab.compute.allocation.capabilityDomainWeights).some(
        ([domainId, weight]) =>
          activation.firstTags.some((tag) => domainId.includes(tag)) &&
          weight / 10_000 >= activation.eachShareOfRd,
      );
      const secondWeight =
        lab.compute.allocation.safetyProgramWeights[activation.secondProgramme] ??
        lab.compute.allocation.capabilityDomainWeights[activation.secondProgramme] ??
        0;
      return first && secondWeight / 10_000 >= activation.eachShareOfRd;
    }
    case "paired-safety-allocation-at-least":
      return activation.programmes.every(
        (programId) =>
          (lab.compute.allocation.safetyProgramWeights[programId] ?? 0) / 10_000 >=
          activation.eachShareOfSafety,
      );
    case "source-model-attribute-at-least": {
      const model = currentModel(state, researcher);
      if (model === undefined) return false;
      if (activation.attribute === "reliability") {
        return model.reliability >= activation.value;
      }
      const capability = model.measuredCapability?.values;
      return (
        capability !== undefined &&
        activation.attribute in capability &&
        capability[activation.attribute as keyof typeof capability] >= activation.value
      );
    }
    case "capability-program":
      return assignment?.kind === "capability-program";
    case "training-run":
      return assignment?.kind === "training-run";
    case "ui-capacity-available":
      return lab.roster.researcherIds.length < lab.roster.starSlots;
    case "review-not-already-complete":
      return lab.flags["review:complete"] !== true;
    case "rival-open-paper-and-player-prerequisites-satisfied":
      return lab.flags["rival-open-paper:eligible"] === true;
  }
}

/** How much a mode is worth, for picking an unassigned researcher's default. */
function modeMagnitude(mode: {
  readonly effects: readonly ResearcherModifierDefinition[];
}): number {
  return mode.effects.reduce(
    (sum, effect) =>
      sum + Math.abs(effect.operation === "multiply" ? effect.value - 1 : effect.value),
    0,
  );
}

function abilityEffects(
  researcher: ResearcherState,
  ability: ResearcherAbilityDefinition,
): readonly ResearcherModifierDefinition[] {
  if (ability.modes.length === 0) return ability.effects;
  const assignment = researcher.assignment;
  const selected = ability.modes.find((mode) => {
    if (mode.domain !== undefined) return assignment?.targetId === mode.domain;
    return (
      mode.assignment !== undefined &&
      assignment?.kind === mode.assignment.kind &&
      (mode.assignment.id === undefined || assignment.targetId === mode.assignment.id)
    );
  });
  if (selected !== undefined) return selected.effects;
  // Abilities are always on, so an unassigned researcher must still get
  // something rather than nothing at all -- that is what made a new hire's
  // advertised ability vanish the moment they arrived. They fall back to the
  // LEAST generous mode: undirected work should never beat directed work, or
  // assigning someone to a programme would be a downgrade.
  const weakest = [...ability.modes].sort(
    (left, right) => modeMagnitude(left) - modeMagnitude(right),
  )[0];
  return weakest?.effects ?? [];
}

export function programmeModifierTarget(programId: string): string {
  return `lab.research.program.${programId}.output`;
}

/**
 * Signature abilities are always on, so "the assigned programme" has to mean
 * something for a researcher who leads nothing. Every authored ability names
 * the programme it was written for in its activation clause; that is the
 * programme the ability describes, whatever the roster happens to look like
 * this week. Fall back to it, and only give up when nothing names a target.
 */
function authoredProgrammeId(
  ability: ResearcherAbilityDefinition,
  modifier: ResearcherModifierDefinition,
): string | undefined {
  for (const activation of [modifier.activation, ability.activation]) {
    if (activation === undefined) continue;
    if (
      (activation.type === "assignment-id-in" ||
        activation.type === "assignment-domain-in") &&
      activation.values.length > 0
    ) {
      const value = activation.values[0];
      if (value !== undefined) {
        return value.startsWith("base:") ? value : `base:${value}`;
      }
    }
  }
  return undefined;
}

/** Programme skills, in the order runtimeTarget resolves them. */
const PAIRED_PROGRAMME_CANDIDATES: readonly (readonly [string, string])[] = [
  ["base:domain.architectures", "architectures"],
  ["base:domain.optimisation-scaling", "optimisationScaling"],
  ["base:domain.reinforcement-agency", "reinforcementAgency"],
  ["base:domain.multimodality", "multimodality"],
  ["base:domain.reasoning-tools", "reasoningTools"],
  ["base:domain.robotics-embodiment", "roboticsEmbodiment"],
  ["base:domain.scientific-ai", "scientificAi"],
  ["base:safety.alignment-control", "alignmentControl"],
  ["base:safety.interpretability-evals", "interpretabilityEvals"],
  ["base:safety.security-containment", "securityContainment"],
];

/**
 * The researcher's strongest programme that is NOT the one they are already
 * boosting. Deterministic: highest skill wins, ties break on programme id.
 */
function pairedProgrammeId(
  content: CompiledContent,
  researcher: ResearcherState,
  primaryProgrammeId: string | undefined,
): string | undefined {
  const skills = content.researchers.definitions[researcher.definitionId]?.skills;
  if (skills === undefined) return undefined;
  const ranked = PAIRED_PROGRAMME_CANDIDATES.filter(
    ([programmeId]) => programmeId !== primaryProgrammeId,
  ).sort(
    ([leftId, leftSkill], [rightId, rightSkill]) =>
      (skills[rightSkill] ?? 0) - (skills[leftSkill] ?? 0) || (leftId < rightId ? -1 : 1),
  );
  return ranked[0]?.[0];
}

/**
 * The programme an ability boosts when nothing else names one. Signatures are
 * always on, so an unassigned researcher with no authored activation clause
 * would otherwise resolve to no target and silently contribute nothing --
 * exactly what made a new hire's dossier promise vanish on arrival. Their
 * strongest programme domain is the honest answer.
 */
function strongestProgrammeId(
  content: CompiledContent,
  researcher: ResearcherState,
): string | undefined {
  return pairedProgrammeId(content, researcher, undefined);
}

function runtimeTarget(
  content: CompiledContent,
  target: string,
  researcher: ResearcherState,
  authoredProgramme?: string,
): string | undefined {
  const assignment = researcher.assignment;
  if (target === "assignedProgramme.researchOutput") {
    const programmeId =
      assignment?.targetId ??
      authoredProgramme ??
      strongestProgrammeId(content, researcher);
    return programmeId === undefined ? undefined : programmeModifierTarget(programmeId);
  }
  // "Paired" means a SECOND programme, not the one already being boosted. It
  // previously shared the branch above and resolved to the same target, so an
  // ability advertising two distinct bonuses stacked both onto one programme.
  if (target === "pairedProgramme.researchOutput") {
    const primary =
      assignment?.targetId ??
      authoredProgramme ??
      strongestProgrammeId(content, researcher);
    const paired = pairedProgrammeId(content, researcher, primary);
    return paired === undefined ? undefined : programmeModifierTarget(paired);
  }
  const domain = /^domain\.([a-z0-9-]+)\.researchOutput$/.exec(target);
  if (domain?.[1] !== undefined) {
    return programmeModifierTarget(`base:domain.${domain[1]}`);
  }
  const safety = /^safety\.([a-z0-9-]+)\.researchOutput$/.exec(target);
  if (safety?.[1] !== undefined) {
    return programmeModifierTarget(`base:safety.${safety[1]}`);
  }
  const labDomain = /^lab\.research\.domain\.([a-z0-9-]+)\.output$/.exec(target);
  if (labDomain?.[1] !== undefined) {
    return programmeModifierTarget(`base:domain.${labDomain[1]}`);
  }
  if (target === "assignedProgramme.weeklyVarianceWidth") {
    const programmeId =
      assignment?.targetId ??
      authoredProgramme ??
      strongestProgrammeId(content, researcher);
    return programmeId === undefined
      ? undefined
      : `lab.research.program.${programmeId}.weeklyVarianceWidth`;
  }
  return target;
}

function scaledModifierValue(
  modifier: ResearcherModifierDefinition,
  strength: number,
): number {
  if (modifier.operation === "multiply") {
    return 1 + (modifier.value - 1) * strength;
  }
  if (modifier.operation === "add") return modifier.value * strength;
  return modifier.value;
}

function modifierFromDefinition(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcher: ResearcherState,
  ability: ResearcherAbilityDefinition,
  abilityKind: "signature" | "passive" | "compact",
  modifier: ResearcherModifierDefinition,
  index: number,
  strength: number,
): ModifierState | undefined {
  // Signatures and passives are always on, so a per-modifier activation clause
  // must not gate them either -- only the ability-level gate was relaxed
  // before, which left individual effects silently dropped for an unassigned
  // researcher. Compacts keep their gates: those are conditional promises.
  if (
    abilityKind === "compact" &&
    !activationMatches(state, content, researcher, modifier.activation)
  ) {
    return undefined;
  }
  const target = runtimeTarget(
    content,
    modifier.target,
    researcher,
    authoredProgrammeId(ability, modifier),
  );
  if (target === undefined) return undefined;
  const sourceId = `${researcher.id}/${ability.id}`;
  const id = `researcher-modifier:${sourceId}:${String(index)}` as ModifierId;
  const durationWeeks =
    modifier.durationWeeks ?? (modifier.duration === "one-cycle" ? 4 : undefined);
  return {
    id,
    source: { kind: "researcher", id: sourceId },
    ...(researcher.employerLabId === undefined
      ? {}
      : { labId: researcher.employerLabId }),
    target,
    operation: modifier.operation,
    value: scaledModifierValue(modifier, strength),
    startsAt: state.run.tick,
    ...(durationWeeks === undefined
      ? {}
      : { endsAt: tick(state.run.tick + durationWeeks) }),
    tags: [
      `researcher:${researcher.id}`,
      `ability:${ability.id}`,
      `ability-kind:${abilityKind}`,
      ...(modifier.stackingGroup === undefined
        ? []
        : [`stacking-group:${modifier.stackingGroup}`]),
    ],
  };
}

function buildAbilityModifiers(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcher: ResearcherState,
  ability: ResearcherAbilityDefinition,
  abilityKind: "signature" | "passive" | "compact",
  strength: number,
): readonly ModifierState[] {
  // Signature abilities are always on: a hired researcher changes the lab by
  // being in it, not by occupying the one slot the ability was authored for.
  // Compacts keep their activation gates -- those are promises with conditions.
  if (
    abilityKind === "compact" &&
    !activationMatches(state, content, researcher, ability.activation)
  ) {
    return [];
  }
  return abilityEffects(researcher, ability).flatMap((modifier, index) => {
    const built = modifierFromDefinition(
      state,
      content,
      researcher,
      ability,
      abilityKind,
      modifier,
      index,
      strength,
    );
    return built === undefined ? [] : [built];
  });
}

/** Rebuild all sourced records for one researcher from canonical employment state. */
export function syncResearcherAbilityModifiers(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
): void {
  const state = tx.read();
  const researcher = requireResearcher(state, researcherId);
  const sourcePrefix = `${researcher.id}/`;
  const definition = content.researchers.definitions[researcher.definitionId];
  if (definition === undefined) {
    throw new Error(`Missing definition ${researcher.definitionId} for ${researcherId}`);
  }
  const built: ModifierState[] = [];
  if (researcher.status === "employed" || researcher.status === "sabbatical") {
    const housingStrength =
      researcher.housing === "unhoused"
        ? content.researchers.rules.ability.unhousedStrengthMultiplier
        : 1;
    if (
      researcher.status !== "sabbatical" ||
      !content.researchers.rules.ability.sabbaticalDisablesPassive
    ) {
      built.push(
        ...buildAbilityModifiers(
          state,
          content,
          researcher,
          definition.passive,
          "passive",
          housingStrength,
        ),
      );
    }
    if (
      researcher.status !== "sabbatical" ||
      !content.researchers.rules.ability.sabbaticalDisablesSignature
    ) {
      built.push(
        ...buildAbilityModifiers(
          state,
          content,
          researcher,
          definition.signature,
          "signature",
          housingStrength *
            signatureRamp(state, content, researcher, definition.signature.rampWeeks),
        ),
      );
    }
    if (researcher.compact.includedInOffer) {
      const compactAbility: ResearcherAbilityDefinition = {
        id: definition.compact.id,
        label: definition.compact.label,
        eligibleAssignments: [],
        effects: definition.compact.attachedEffects,
        modes: [],
        rampWeeks: 0,
      };
      built.push(
        ...buildAbilityModifiers(
          state,
          content,
          researcher,
          compactAbility,
          "compact",
          housingStrength,
        ),
      );
    }
  }
  tx.update((draft) => {
    for (const [modifierId, modifier] of Object.entries(draft.modifiers)) {
      if (
        modifier.source.kind === "researcher" &&
        modifier.source.id?.startsWith(sourcePrefix) === true
      ) {
        delete draft.modifiers[modifierId as ModifierId];
      }
    }
    for (const modifier of built) {
      const { activation: _activation, ...plainModifier } = modifier;
      draft.modifiers[modifier.id] = {
        ...plainModifier,
        source: { ...modifier.source },
        tags: [...modifier.tags],
      };
    }
  });
}

export function syncAllResearcherAbilityModifiers(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  for (const researcherId of Object.keys(tx.read().researchers).sort()) {
    syncResearcherAbilityModifiers(tx, content, researcherId as ResearcherId);
  }
}
