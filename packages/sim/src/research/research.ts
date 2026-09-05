import { effectiveTeraflopsPerGpu } from "../compute/flops.ts";
import type {
  AuthoredActivation,
  AuthoredEffect,
  CompiledContent,
  ContentId,
  ResearchProgramDefinition,
  ResearchProgramKind,
} from "@neolab/content-schema";

import {
  calculateAllocationTeraflops,
  CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG,
  MINIMUM_FUNDED_PROGRAM_TERAFLOPS,
  planGpuPortfolio,
} from "../compute/gpu-portfolio.ts";
import { awardScore } from "../engine/score.ts";
import {
  resolveModifierValue,
  resolveResearcherStack,
  type ModifierContribution,
} from "../engine/modifier-resolver.ts";
import { isModifierTarget } from "../engine/modifier-targets.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId, ModifierId } from "../model/ids.ts";
import type { DomainState, GameState } from "../model/state.ts";
import { rating, tick, type Tick } from "../model/units.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import {
  programmeModifierTarget,
  quoteResearcherContribution,
  type ResearcherContributionBreakdown,
  researcherSkillForProgramme,
} from "../researchers/researchers.ts";
import { candidateAccessAcceleration } from "../endgame/access.ts";

export interface ResearchGenerationLine {
  readonly generationId: ContentId;
  readonly physicalGpus: number;
  readonly effectiveTeraflops: number;
}

export interface ResearchOutputBreakdown {
  readonly programId: ContentId;
  readonly kind: ResearchProgramKind;
  readonly physicalGpus: number;
  readonly generations: readonly ResearchGenerationLine[];
  readonly effectiveTeraflops: number;
  readonly isFunded: boolean;
  readonly baseResearchPoints: number;
  readonly generalTeamContribution: number;
  readonly starResearcherContributions: readonly ResearcherContributionBreakdown[];
  readonly starResearcherMultiplier: number;
  readonly talentMultiplier: number;
  readonly facilityMultiplier: number;
  readonly freedomMultiplier: number;
  readonly modelAssistMultiplier: number;
  readonly contextSwitchMultiplier: number;
  readonly outputModifier: number;
  readonly modifierContributions: readonly ModifierContribution[];
  readonly weeklyVariance: number;
  readonly finalResearchPoints: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function requireProgram(
  content: CompiledContent,
  programId: ContentId,
): ResearchProgramDefinition {
  const program =
    content.research.capabilityDomains[programId] ??
    content.research.safetyPrograms[programId];
  if (program === undefined) {
    throw new Error(`Unknown research programme ${programId}`);
  }
  return program;
}

function researchVariance(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  programId: ContentId,
  atTick: Tick,
  oracle: RandomOracle,
): number {
  // Research freedom used to widen this draw above a threshold of 80. The stat
  // is gone: it was three separate hidden effects behind one opaque number, and
  // an event granting "+4 research freedom" was really granting +1% research
  // output, which no player could have known. Effects are now authored in the
  // terms they actually take -- research output and researcher morale.
  const range = content.research.rules.weeklyVariance;
  // Steady-hands effects narrow the draw around its mode. Researcher
  // abilities arrive programme-scoped through runtimeTarget; domain-wide
  // advances use the lab.research.domain.<x>.weeklyVarianceWidth form.
  const researcherWidth = resolveResearcherStack(
    state,
    `lab.research.program.${programId}.weeklyVarianceWidth`,
    1,
  ).final;
  const domainShort = /^base:domain\.([a-z0-9-]+)$/.exec(programId)?.[1];
  const domainTarget =
    domainShort === undefined
      ? undefined
      : `lab.research.domain.${domainShort}.weeklyVarianceWidth`;
  const advanceWidth =
    domainTarget === undefined || !isModifierTarget(domainTarget)
      ? 1
      : resolveModifierValue(state, domainTarget, 1, {
          labId,
          includeUnscoped: labId === state.run.playerLabId,
          clampMin: 0,
          excludeSourceKinds: ["researcher"],
        }).final;
  const width = researcherWidth * advanceWidth;
  const draw = oracle.triangular(
    randomKey("research", "weekly-variance", labId, programId, String(atTick)),
    range.min,
    range.mode,
    range.max,
  );
  return range.mode + (draw - range.mode) * width;
}

/**
 * Pure, tooltip-ready weekly research calculation (GDD 34.2). The temporary
 * `effectiveTeraflops / teraflopScaleDivisor` input is deliberately not
 * returned or stored as a resource.
 */
export interface KnowledgeDiffusionBreakdown {
  /** Percentage points added to this programme's output by non-leads. */
  readonly percentagePoints: number;
  /** Rate per ability point, 0 until the campus unlocks it. */
  readonly ratePerSkillPoint: number;
  readonly contributors: readonly {
    readonly researcherId: string;
    readonly skill: number;
    readonly percentagePoints: number;
  }[];
}

/**
 * The canonical stack of programme-scoped research-output bonuses. This is
 * intentionally separate from compute, team size, freedom, focus, model
 * assistance, context switching, and weekly variance: those multiply weekly
 * throughput elsewhere in `calculateDomainOutput`.
 */
export interface ResearchOutputModifierBreakdown {
  readonly starResearcherContributions: readonly ResearcherContributionBreakdown[];
  /** Applied generic percentage points from the programme's lead and advisors. */
  readonly assignedResearcherPercentagePoints: number;
  readonly diffusion: KnowledgeDiffusionBreakdown;
  readonly starResearcherMultiplier: number;
  readonly outputModifier: number;
  readonly modifierContributions: readonly ModifierContribution[];
}

/**
 * Knowledge diffusion: hallway conversations, shared notebooks, and the fact
 * that a lab is one building rather than ten silos. Every employed star
 * researcher lifts every programme by their skill in that programme's domain,
 * scaled by a rate the campus unlocks — zero until the first collaboration
 * building goes up.
 *
 * The researcher leading a programme is deliberately excluded from it: their
 * contribution there is already the lead skill bonus, and counting both would
 * pay twice for one person's expertise.
 */
export function calculateKnowledgeDiffusion(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  programId: string,
): KnowledgeDiffusionBreakdown {
  const ratePerSkillPoint = resolveModifierValue(state, "lab.research.diffusionRate", 0, {
    labId,
    includeUnscoped: labId === state.run.playerLabId,
  }).final;
  const lab = state.labs[labId];
  if (lab === undefined || ratePerSkillPoint <= 0) {
    return { percentagePoints: 0, ratePerSkillPoint: 0, contributors: [] };
  }
  const skillKey = researcherSkillForProgramme(programId);
  if (skillKey === undefined) {
    return { percentagePoints: 0, ratePerSkillPoint, contributors: [] };
  }
  const contributors = lab.roster.researcherIds.flatMap((researcherId) => {
    const researcher = state.researchers[researcherId];
    if (researcher === undefined) return [];
    // The lead of this programme is paid through the lead bonus instead.
    if (researcher.assignment?.targetId === programId) return [];
    const definition = content.researchers.definitions[researcher.definitionId];
    const skill = definition?.skills[skillKey] ?? 0;
    if (skill <= 0) return [];
    return [
      {
        researcherId,
        skill,
        percentagePoints: skill * ratePerSkillPoint,
      },
    ];
  });
  return {
    percentagePoints: contributors.reduce((sum, c) => sum + c.percentagePoints, 0),
    ratePerSkillPoint,
    contributors,
  };
}

/**
 * Resolve the complete programme research-output stack without planning or
 * pricing its GPU portfolio. Both the weekly engine calculation and
 * player-facing projections use this helper so the displayed multiplier
 * cannot drift from the applied one.
 */
export function calculateResearchOutputModifier(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  programId: ContentId,
): ResearchOutputModifierBreakdown {
  const lab = state.labs[labId];
  if (lab === undefined) {
    throw new Error(`calculateResearchOutputModifier: unknown lab ${labId}`);
  }
  const includeUnscoped = labId === state.run.playerLabId;
  const program = requireProgram(content, programId);
  const starResearcherContributions = lab.roster.researcherIds.flatMap((researcherId) => {
    const researcher = state.researchers[researcherId];
    if (
      researcher?.assignment?.targetId !== programId ||
      (researcher.assignment.role !== "lead" && researcher.assignment.role !== "advisor")
    ) {
      return [];
    }
    return [
      quoteResearcherContribution(state, content, researcherId, researcher.assignment),
    ];
  });
  const assignedResearcherPercentagePoints = starResearcherContributions.reduce(
    (sum, contribution) => sum + contribution.genericPercentagePoints,
    0,
  );
  const diffusion = calculateKnowledgeDiffusion(state, content, labId, programId);
  const programmeResearchers = resolveResearcherStack(
    state,
    programmeModifierTarget(programId),
    1 + (assignedResearcherPercentagePoints + diffusion.percentagePoints) / 100,
    {
      labId,
      includeUnscoped,
    },
  );
  const globalResearchers = resolveResearcherStack(
    state,
    program.kind === "capability"
      ? "lab.research.capability.output"
      : "lab.research.safety.output",
    1,
    {
      labId,
      includeUnscoped,
    },
  );
  const starResearcherMultiplier = programmeResearchers.final * globalResearchers.final;
  // Researcher-sourced all-output effects belong in this stack. Programme,
  // kind, and specific-target researcher effects are resolved separately above
  // so those targets exclude researcher sources here.
  const allOutput = resolveModifierValue(state, "lab.research.all.output", 1, {
    labId,
    includeUnscoped,
  });
  const programmeOutput = resolveModifierValue(
    state,
    programmeModifierTarget(programId),
    1,
    { labId, includeUnscoped, excludeSourceKinds: ["researcher"] },
  );
  const kindOutput = resolveModifierValue(
    state,
    program.kind === "capability"
      ? "lab.research.capability.output"
      : "lab.research.safety.output",
    1,
    { labId, includeUnscoped, excludeSourceKinds: ["researcher"] },
  );
  const specificTarget = program.outputModifierTarget;
  const specificOutput =
    specificTarget === undefined
      ? undefined
      : resolveModifierValue(state, specificTarget, 1, {
          labId,
          includeUnscoped,
          excludeSourceKinds: ["researcher"],
        });
  // Capability-domain facility effects predate the runtime programme target
  // used by researchers and generic advances. Keep resolving their authored
  // domain target so existing saves and newly completed facilities both pay
  // the bonus shown on their cards.
  const capabilityDomain = /^base:domain\.([a-z0-9-]+)$/.exec(programId)?.[1];
  const facilityDomainTarget =
    capabilityDomain === undefined
      ? undefined
      : `lab.research.domain.${capabilityDomain}.output`;
  const facilityDomainOutput =
    facilityDomainTarget === undefined || !isModifierTarget(facilityDomainTarget)
      ? undefined
      : resolveModifierValue(state, facilityDomainTarget, 1, {
          labId,
          includeUnscoped,
          excludeSourceKinds: ["researcher"],
        });
  const outputModifier =
    allOutput.final *
    programmeOutput.final *
    kindOutput.final *
    (specificOutput?.final ?? 1) *
    (facilityDomainOutput?.final ?? 1) *
    starResearcherMultiplier;

  return {
    starResearcherContributions,
    assignedResearcherPercentagePoints,
    diffusion,
    starResearcherMultiplier,
    outputModifier,
    modifierContributions: [
      ...allOutput.contributions,
      ...programmeOutput.contributions,
      ...kindOutput.contributions,
      ...(specificOutput?.contributions ?? []),
      ...(facilityDomainOutput?.contributions ?? []),
      ...programmeResearchers.contributions,
      ...globalResearchers.contributions,
    ],
  };
}

export function calculateDomainOutput(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  programId: ContentId,
  atTick: Tick = state.run.tick,
  oracle: RandomOracle = new RandomOracleV1(state.run.seed),
): ResearchOutputBreakdown {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`calculateDomainOutput: unknown lab ${labId}`);
  const program = requireProgram(content, programId);
  const portfolio = planGpuPortfolio(state, content, labId);
  const delivered = calculateAllocationTeraflops(
    state,
    content,
    labId,
    portfolio.allocation,
  );
  const programAllocation = (
    program.kind === "capability"
      ? portfolio.allocation.capabilityPrograms
      : portfolio.allocation.safetyPrograms
  ).find((candidate) => candidate.programId === programId);
  const physicalGpus = programAllocation?.physicalGpus ?? 0;
  const effectiveTeraflops =
    (program.kind === "capability"
      ? delivered.capabilityPrograms[programId]
      : delivered.safetyPrograms[programId]) ?? 0;
  const isFunded =
    effectiveTeraflops >= MINIMUM_FUNDED_PROGRAM_TERAFLOPS ||
    (effectiveTeraflops > 0 && content.research.rules.unfundedDomainsProduceProgress);

  const generationTotals = new Map<
    ContentId,
    { physicalGpus: number; effectiveTeraflops: number }
  >();
  for (const line of portfolio.allocation.lots) {
    const allocated =
      program.kind === "capability"
        ? (line.capabilityPrograms[programId] ?? 0)
        : (line.safetyPrograms[programId] ?? 0);
    if (allocated <= 0) continue;
    const lot = lab.compute.lots.find((candidate) => candidate.id === line.lotId);
    if (lot === undefined)
      throw new Error(`Allocation references missing lot ${line.lotId}`);
    const generation = content.gpuGenerations[lot.generationId];
    if (generation === undefined)
      throw new Error(`Unknown GPU generation ${lot.generationId}`);
    const existing = generationTotals.get(lot.generationId) ?? {
      physicalGpus: 0,
      effectiveTeraflops: 0,
    };
    generationTotals.set(lot.generationId, {
      physicalGpus: existing.physicalGpus + allocated,
      effectiveTeraflops:
        existing.effectiveTeraflops +
        allocated *
          effectiveTeraflopsPerGpu(state, labId, generation) *
          lot.availableFraction,
    });
  }
  const generations = [...generationTotals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([generationId, totals]) => ({ generationId, ...totals }));
  const rules = content.research.rules;
  const researchScale = effectiveTeraflops / rules.teraflopScaleDivisor;
  const baseResearchPoints =
    isFunded && researchScale > 0
      ? rules.baseCoefficient * researchScale ** rules.gpuExponent
      : 0;
  const generalTeamContribution =
    lab.organisation.generalResearchers * rules.generalResearcherContribution;
  const talentMultiplier = clamp(
    1 + generalTeamContribution,
    rules.talentMultiplier.min,
    rules.talentMultiplier.max,
  );
  // Facilities used to add a flat 3% research each, capped at 1.6x, purely by
  // being counted. It was undocumented, invisible to the player, and made the
  // cheapest available building the mathematically optimal purchase -- a $2m
  // server rack paid exactly what a $5bn datacentre did. Research now comes
  // only from what a building actually does, which is what the modifier lists
  // and the diffusion ladder are for. Kept in the breakdown as a constant so
  // the shape of the report is unchanged.
  const facilityMultiplier = 1;
  // Was derived from the research-freedom rating, which has been removed. That
  // rating ran 0.85 to 1.10 and sat at exactly 1.00 at its starting value of
  // 60, so deleting it is neutral on day one but costs a lab the upside it
  // could once buy. Set slightly above 1 to return that upside as a flat,
  // legible baseline rather than a hidden stat nobody could read. Content that
  // wants to move research output now targets lab.research.all.output.
  const freedomMultiplier = 1.03;
  const outputBonus = calculateResearchOutputModifier(state, content, labId, programId);
  const weeklyVariance = researchVariance(
    state,
    content,
    labId,
    programId,
    atTick,
    oracle,
  );
  const contextSwitchMultiplier =
    program.kind === "capability" &&
    lab.flags[CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG] === atTick
      ? rules.contextSwitchMultiplier
      : 1;
  const modelAssistMultiplier =
    rules.modelAssistBase * candidateAccessAcceleration(state, labId);
  const finalResearchPoints =
    baseResearchPoints *
    talentMultiplier *
    facilityMultiplier *
    freedomMultiplier *
    modelAssistMultiplier *
    contextSwitchMultiplier *
    outputBonus.outputModifier *
    weeklyVariance;

  return {
    programId,
    kind: program.kind,
    physicalGpus,
    generations,
    effectiveTeraflops,
    isFunded,
    baseResearchPoints,
    generalTeamContribution,
    starResearcherContributions: outputBonus.starResearcherContributions,
    starResearcherMultiplier: outputBonus.starResearcherMultiplier,
    talentMultiplier,
    facilityMultiplier,
    freedomMultiplier,
    modelAssistMultiplier,
    contextSwitchMultiplier,
    outputModifier: outputBonus.outputModifier,
    modifierContributions: outputBonus.modifierContributions,
    weeklyVariance,
    finalResearchPoints,
  };
}

export function researchPointsForNextLevel(
  content: CompiledContent,
  programId: ContentId,
  currentLevel: number,
): number {
  const rules = content.research.rules;
  const program = requireProgram(content, programId);
  let multiplier = 1;
  for (const band of rules.levelCostBands) {
    if (currentLevel >= band.afterLevel) multiplier = band.multiplier;
  }
  // Compounding above the free band: output grows multiplicatively with fleet
  // and generation, so a flat ladder is bought out the moment modern silicon
  // lands. `currentLevel` is the level being left, so level 1 costs the flat
  // rate and growth starts once the free band is behind you.
  const compounding = Math.max(0, currentLevel - rules.levelCostGrowthFromLevel);
  const levelCostGrowth =
    program.kind === "safety" ? rules.safetyLevelCostGrowth : rules.levelCostGrowth;
  return (
    rules.lowLevelRpPerPoint *
    multiplier *
    program.levelCostMultiplier *
    levelCostGrowth ** compounding
  );
}

function applyResearchPoints(
  before: DomainState,
  researchPoints: number,
  content: CompiledContent,
  programId: ContentId,
): DomainState {
  let level: number = before.level;
  let progress = before.levelProgressRp + researchPoints;
  while (level < 100) {
    const cost = researchPointsForNextLevel(content, programId, level);
    if (progress + 1e-12 < cost) break;
    progress -= cost;
    level += 1;
  }
  if (level >= 100) progress = 0;
  return {
    level: rating(level),
    levelProgressRp: progress,
    totalResearchPoints: before.totalResearchPoints + researchPoints,
    weeklyMomentum: before.weeklyMomentum * 0.75 + researchPoints * 0.25,
  };
}

function scoreRule(
  content: CompiledContent,
  name: string,
): { readonly category: "score.scientific-legacy"; readonly points: number } {
  const raw = content.scoreRules.awardTables.researchAwards[name];
  if (
    raw === null ||
    typeof raw !== "object" ||
    (raw as { category?: unknown }).category !== "score.scientific-legacy" ||
    typeof (raw as { points?: unknown }).points !== "number"
  ) {
    throw new Error(`Invalid research score rule ${name}`);
  }
  return raw as { readonly category: "score.scientific-legacy"; readonly points: number };
}

function pendingAdvance(
  program: ResearchProgramDefinition,
  threshold: number,
): { programId: ContentId; threshold: number; optionIds: ContentId[] } {
  const optionIds = program.genericAdvanceOptionIds[String(threshold)];
  if (optionIds === undefined || optionIds.length !== 2) {
    throw new Error(
      `${program.id} has no two-option generic advance at ${String(threshold)}`,
    );
  }
  return { programId: program.id, threshold, optionIds: [...optionIds] };
}

type MutableActivation =
  | { type: "metric-below"; metric: string; value: number }
  | { type: "flag-absent"; flag: string }
  | { type: "all"; items: MutableActivation[] };

function copyActivation(activation: AuthoredActivation): MutableActivation {
  switch (activation.type) {
    case "metric-below":
      return {
        type: activation.type,
        metric: activation.metric,
        value: activation.value,
      };
    case "flag-absent":
      return { type: activation.type, flag: activation.flag };
    case "all":
      return { type: activation.type, items: activation.items.map(copyActivation) };
  }
}

/** Advance all eleven funded programmes exactly once for the current week. */
export function advanceResearch(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): readonly ResearchOutputBreakdown[] {
  reconcileGenericAdvanceModifiers(tx, content, labId);
  const before = tx.read();
  const lab = before.labs[labId];
  if (lab === undefined) throw new Error(`advanceResearch: unknown lab ${labId}`);
  const programs = [
    ...Object.values(content.research.capabilityDomains),
    ...Object.values(content.research.safetyPrograms),
  ];
  const outputs = programs.map((program) =>
    calculateDomainOutput(before, content, labId, program.id, before.run.tick, oracle),
  );
  const pendingBefore = new Set(
    lab.research.pendingGenericAdvances.map(
      (pending) => `${pending.programId}/${String(pending.threshold)}`,
    ),
  );
  const levelMilestones: { programId: ContentId; level: 50 | 80 }[] = [];

  tx.update((draft) => {
    const mutableLab = draft.labs[labId];
    if (mutableLab === undefined)
      throw new Error(`advanceResearch: unknown lab ${labId}`);
    for (const output of outputs) {
      const collection =
        output.kind === "capability"
          ? mutableLab.research.domains
          : mutableLab.research.safetyPrograms;
      const oldProgram = collection[output.programId];
      if (oldProgram === undefined) {
        throw new Error(`Research state missing ${output.programId}`);
      }
      const updated = applyResearchPoints(
        oldProgram,
        output.finalResearchPoints,
        content,
        output.programId,
      );
      collection[output.programId] = updated;
      for (const milestone of [50, 80] as const) {
        if (oldProgram.level < milestone && updated.level >= milestone) {
          levelMilestones.push({ programId: output.programId, level: milestone });
        }
      }
      const definition = requireProgram(content, output.programId);
      for (const threshold of content.research.rules.genericAdvanceThresholds) {
        if (oldProgram.level < threshold && updated.level >= threshold) {
          // Direct-to-endgame fixtures start with a mature research estate and
          // exist to exercise the crisis. Do not interrupt those test runs with
          // a backlog of research-direction choices that an ordinary campaign
          // would have resolved over many years.
          if (mutableLab.flags["developer:suppress-research-directions"] === true) {
            continue;
          }
          const alreadyPending = mutableLab.research.pendingGenericAdvances.some(
            (pending) =>
              pending.programId === output.programId && pending.threshold === threshold,
          );
          const alreadyChosen = (
            mutableLab.research.genericAdvances[output.programId] ?? []
          ).some(
            (advanceId) =>
              content.research.genericAdvances[advanceId]?.threshold === threshold,
          );
          if (!alreadyPending && !alreadyChosen) {
            mutableLab.research.pendingGenericAdvances.push(
              pendingAdvance(definition, threshold),
            );
          }
        }
      }
    }
  });

  for (const milestone of levelMilestones) {
    const rule = scoreRule(
      content,
      milestone.level === 50 ? "domainLevel50FirstTime" : "domainLevel80FirstTime",
    );
    awardScore(tx, {
      key: `research/domain-level/${milestone.programId}/${String(milestone.level)}`,
      categoryId: rule.category,
      amount: rule.points,
      source: { kind: "system", id: milestone.programId },
      explanationKey: `score.research.domain-level-${String(milestone.level)}`,
    });
  }

  for (const output of outputs) {
    tx.emit({
      kind: "research-produced",
      labId,
      programId: output.programId,
      researchPoints: output.finalResearchPoints,
    });
  }
  const afterLab = tx.read().labs[labId];
  if (afterLab !== undefined) {
    for (const pending of afterLab.research.pendingGenericAdvances) {
      if (!pendingBefore.has(`${pending.programId}/${String(pending.threshold)}`)) {
        tx.emit({
          kind: "generic-advance-offered",
          labId,
          programId: pending.programId,
          threshold: pending.threshold,
        });
        if (labId === tx.read().run.playerLabId) {
          tx.requestAutoPause("research-direction");
        }
      }
    }
  }
  return outputs;
}

export function chooseGenericAdvance(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  programId: ContentId,
  threshold: number,
  optionId: ContentId,
): void {
  const advance = content.research.genericAdvances[optionId];
  if (
    advance === undefined ||
    advance.programId !== programId ||
    advance.threshold !== threshold
  ) {
    throw new Error(`Invalid generic advance ${optionId}`);
  }
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    lab.research.pendingGenericAdvances = lab.research.pendingGenericAdvances.filter(
      (pending) => !(pending.programId === programId && pending.threshold === threshold),
    );
    const selected = lab.research.genericAdvances[programId] ?? [];
    lab.research.genericAdvances[programId] = [...selected, optionId];
  });
  reconcileGenericAdvanceModifiers(tx, content, labId);
  applyAdvanceEffects(tx, advance.effects, optionId, labId, advance.pathId);
  const rule = scoreRule(content, "genericAdvanceFirstPerThreshold");
  awardScore(tx, {
    key: `research/generic/${programId}/${String(threshold)}`,
    categoryId: rule.category,
    amount: rule.points,
    source: { kind: "system", id: optionId },
    explanationKey: "score.research.generic-advance",
  });
  tx.emit({
    kind: "generic-advance-chosen",
    labId,
    programId,
    threshold,
    optionId,
  });
}

/** Advances reward the domain their copy names, mirroring the papers router. */
function routeAdvanceTarget(target: string): string {
  const domain = /^lab\.research\.domain\.([a-z0-9-]+)\.output$/.exec(target);
  if (domain?.[1] !== undefined) {
    return `lab.research.program.base:domain.${domain[1]}.output`;
  }
  return target;
}

function applyAdvanceEffects(
  tx: SimulationTransaction,
  effects: readonly AuthoredEffect[],
  optionId: ContentId,
  labId: LabId,
  pathId: string,
): void {
  for (const effect of effects) {
    const target = routeAdvanceTarget(effect.target);
    if (!isModifierTarget(target)) {
      throw new Error(
        `Generic advance ${optionId} targets unknown "${effect.target}" - ` +
          "placebo effects are rejected; register, route, or delete the line",
      );
    }
    const modifierId = tx.allocateId("modifier", "research") as ModifierId;
    tx.update((draft) => {
      draft.modifiers[modifierId] = {
        id: modifierId,
        source: { kind: "system", id: optionId },
        labId,
        target,
        operation: effect.operation,
        value: effect.value,
        startsAt: tick(draft.run.tick),
        ...(effect.activation === undefined
          ? {}
          : { activation: copyActivation(effect.activation) }),
        tags: ["generic-advance", optionId, `generic-advance-path:${pathId}`],
      };
    });
  }
}

/**
 * Every selected research specialisation is a permanent, cumulative upgrade.
 * Preserve every historical choice in the research ledger and keep all of its
 * modifiers mechanically active.
 *
 * This reconciles two development-save formats: modifiers from the original
 * implementation were unscoped, while the short-lived replacement-tier rule
 * retired earlier choices with an `endsAt` tick. Scope the former to the player
 * lab and reactivate the latter without granting either effect a second time.
 */
export function reconcileGenericAdvanceModifiers(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
): void {
  const state = tx.read();
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown research lab ${labId}`);

  const selectedIds = new Set(Object.values(lab.research.genericAdvances).flat());
  const playerLabId = state.run.playerLabId;
  tx.update((draft) => {
    for (const modifier of Object.values(draft.modifiers)) {
      const sourceId = modifier.source.id;
      const advance =
        sourceId === undefined ? undefined : content.research.genericAdvances[sourceId];
      if (advance === undefined || !modifier.tags.includes("generic-advance")) {
        continue;
      }

      if (
        modifier.labId === undefined &&
        labId === playerLabId &&
        selectedIds.has(advance.id)
      ) {
        modifier.labId = labId;
      }
      if (modifier.labId !== labId || !selectedIds.has(advance.id)) continue;
      delete modifier.endsAt;
    }
  });
}
