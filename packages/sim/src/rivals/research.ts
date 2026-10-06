import type {
  CompiledContent,
  ContentId,
  ResearchProgramKind,
} from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type { GameState, LabState, RivalPaperLevelState } from "../model/state.ts";
import { rating } from "../model/units.ts";
import type { RandomOracle } from "../random/oracle.ts";
import { calculateDomainOutput, climbResearchLadder } from "../research/research.ts";
import { advanceRivalAutonomy, rivalAutonomyMultiplier } from "./autonomy.ts";
import { calculateRivalProgressMultiplier } from "./pacing.ts";

export interface RivalResearchStrength {
  readonly rosterStrength: number;
  readonly facilityStrength: number;
  readonly difficultyMultiplier: number;
  /**
   * The three terms with no player counterpart. `offscreenOrganisationMultiplier`
   * and `autonomyMultiplier` are factors of `difficultyMultiplier`;
   * `offscreenFacilityMultiplier` is the part of `facilityStrength` above the
   * rival's visible campus.
   */
  readonly offscreenOrganisationMultiplier: number;
  readonly offscreenFacilityMultiplier: number;
  readonly autonomyMultiplier: number;
}

export interface RivalProgramResearchOutput extends RivalResearchStrength {
  readonly labId: LabId;
  readonly programId: ContentId;
  readonly kind: ResearchProgramKind;
  readonly baseResearchPoints: number;
  readonly weeklyVariance: number;
  readonly finalResearchPoints: number;
  /** What the week adds to the hidden paper level (see `rivalPaperResearchPoints`). */
  readonly paperResearchPoints: number;
}

export function calculateRivalResearchStrength(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): RivalResearchStrength {
  const lab = state.labs[labId];
  if (lab === undefined || lab.control !== "rival") {
    throw new Error(`Unknown rival lab ${labId}`);
  }
  // Rival campuses are intentionally abstracted rather than rendered as full
  // player-style build queues. Their off-screen organisations still expand
  // across the campaign so the rival AGI race keeps its pace. These boosts are
  // partly removed again for the paper race (see `rivalOffscreenBoost`).
  const visibleFacilityStrength =
    1 + lab.facilities.instances.length * content.research.rules.facilityContribution;
  const offscreenExpansion =
    (state.run.tick / 520) *
    Math.max(0, content.research.rules.facilityMultiplierMax - visibleFacilityStrength);
  const facilityStrength = Math.min(
    content.research.rules.facilityMultiplierMax,
    visibleFacilityStrength + offscreenExpansion,
  );
  const offscreenOrganisationMultiplier = 1 + Math.min(1, state.run.tick / 520) * 2;
  // A rival running its Candidate Programme is running its models hard; the
  // same acceleration the player buys on the autonomy ladder.
  const autonomyMultiplier = rivalAutonomyMultiplier(state, labId);
  return {
    rosterStrength: Math.min(
      content.research.rules.talentMultiplier.max,
      1 +
        lab.organisation.generalResearchers *
          content.research.rules.generalResearcherContribution +
        lab.roster.researcherIds.length * 0.08,
    ),
    facilityStrength,
    difficultyMultiplier:
      calculateRivalProgressMultiplier(state) *
      offscreenOrganisationMultiplier *
      autonomyMultiplier,
    offscreenOrganisationMultiplier,
    offscreenFacilityMultiplier:
      facilityStrength /
      Math.min(content.research.rules.facilityMultiplierMax, visibleFacilityStrength),
    autonomyMultiplier,
  };
}

/** Combined off-screen boost: organisation x facility expansion x autonomy (>= 1). */
export function rivalOffscreenBoost(strength: RivalResearchStrength): number {
  return (
    strength.offscreenOrganisationMultiplier *
    strength.offscreenFacilityMultiplier *
    strength.autonomyMultiplier
  );
}

/**
 * The share of a rival's weekly research that counts toward its hidden paper
 * level: the off-screen boost is divided back out, raised to the authored
 * `rivalOffscreenBoostExponent`. Deterministic; no draw of its own.
 */
export function rivalPaperResearchPoints(
  content: CompiledContent,
  strength: RivalResearchStrength,
  researchPoints: number,
): number {
  const exponent = content.papers.rules.rivalOffscreenBoostExponent;
  if (exponent === 0) return researchPoints;
  return researchPoints / rivalOffscreenBoost(strength) ** exponent;
}

/** A new rival's paper levels equal its starting programme levels. */
export function initialRivalPaperLevels(
  research: Pick<LabState["research"], "domains" | "safetyPrograms">,
): Record<string, RivalPaperLevelState> {
  return Object.fromEntries(
    [...Object.entries(research.domains), ...Object.entries(research.safetyPrograms)]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([programmeId, programme]) => [
        programmeId,
        { level: programme.level, levelProgressRp: 0 },
      ]),
  );
}

/**
 * The level a rival programme counts as in the paper race. Never above the
 * real level: an incident can cut real progress without touching the ledger.
 */
export function rivalPaperLevel(
  state: Readonly<GameState>,
  labId: LabId,
  programmeId: string,
): number {
  const lab = state.labs[labId];
  const real =
    lab?.research.domains[programmeId]?.level ??
    lab?.research.safetyPrograms[programmeId]?.level ??
    0;
  const paper = state.world.rivals[labId]?.paperLevels[programmeId]?.level;
  return paper === undefined ? real : Math.min(real, paper);
}

export function calculateRivalProgramResearch(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  programId: ContentId,
  random: RandomOracle,
): RivalProgramResearchOutput {
  const base = calculateDomainOutput(
    state,
    content,
    labId,
    programId,
    state.run.tick,
    random,
  );
  const strength = calculateRivalResearchStrength(state, content, labId);
  const finalResearchPoints =
    base.baseResearchPoints *
    strength.rosterStrength *
    strength.facilityStrength *
    strength.difficultyMultiplier *
    base.weeklyVariance;
  return {
    labId,
    programId,
    kind: base.kind,
    baseResearchPoints: base.baseResearchPoints,
    ...strength,
    weeklyVariance: base.weeklyVariance,
    finalResearchPoints,
    paperResearchPoints: rivalPaperResearchPoints(content, strength, finalResearchPoints),
  };
}

export function advanceRivalResearch(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
): readonly RivalProgramResearchOutput[] {
  advanceRivalAutonomy(tx);
  const state = tx.read();
  const programIds = [
    ...Object.keys(content.research.capabilityDomains),
    ...Object.keys(content.research.safetyPrograms),
  ].sort() as ContentId[];
  const outputs = (Object.keys(state.world.rivals).sort() as LabId[]).flatMap((labId) =>
    programIds.map((programId) =>
      calculateRivalProgramResearch(state, content, labId, programId, random),
    ),
  );
  tx.update((draft) => {
    for (const output of outputs) {
      const lab = draft.labs[output.labId];
      if (lab === undefined) throw new Error(`Missing rival lab ${output.labId}`);
      const collection =
        output.kind === "capability" ? lab.research.domains : lab.research.safetyPrograms;
      const before = collection[output.programId];
      if (before === undefined) {
        throw new Error(`Missing rival research programme ${output.programId}`);
      }
      const climbed = climbResearchLadder(
        content,
        output.programId,
        Number(before.level),
        before.levelProgressRp,
        output.finalResearchPoints,
      );
      collection[output.programId] = {
        level: rating(climbed.level),
        levelProgressRp: climbed.levelProgressRp,
        totalResearchPoints: before.totalResearchPoints + output.finalResearchPoints,
        weeklyMomentum: before.weeklyMomentum * 0.75 + output.finalResearchPoints * 0.25,
      };
      const strategy = draft.world.rivals[output.labId];
      if (strategy === undefined) {
        throw new Error(`Missing rival strategy ${output.labId}`);
      }
      const paperBefore = strategy.paperLevels[output.programId] ?? {
        level: before.level,
        levelProgressRp: 0,
      };
      const paperClimbed = climbResearchLadder(
        content,
        output.programId,
        Number(paperBefore.level),
        paperBefore.levelProgressRp,
        output.paperResearchPoints,
      );
      strategy.paperLevels[output.programId] = {
        level: rating(paperClimbed.level),
        levelProgressRp: paperClimbed.levelProgressRp,
      };
    }
  });
  for (const output of outputs) {
    tx.emit({
      kind: "research-produced",
      labId: output.labId,
      programId: output.programId,
      researchPoints: output.finalResearchPoints,
    });
  }
  return outputs;
}
