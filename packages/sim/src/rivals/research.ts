import type {
  CompiledContent,
  ContentId,
  ResearchProgramKind,
} from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";
import { rating } from "../model/units.ts";
import type { RandomOracle } from "../random/oracle.ts";
import {
  calculateDomainOutput,
  researchPointsForNextLevel,
} from "../research/research.ts";
import { advanceRivalAutonomy, rivalAutonomyMultiplier } from "./autonomy.ts";
import { calculateRivalProgressMultiplier } from "./pacing.ts";

export interface RivalResearchStrength {
  readonly rosterStrength: number;
  readonly facilityStrength: number;
  readonly difficultyMultiplier: number;
}

export interface RivalProgramResearchOutput extends RivalResearchStrength {
  readonly labId: LabId;
  readonly programId: ContentId;
  readonly kind: ResearchProgramKind;
  readonly baseResearchPoints: number;
  readonly weeklyVariance: number;
  readonly finalResearchPoints: number;
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
  // across the campaign, or a competent player inevitably monopolises the
  // paper race once useful serving allocation is capped to demand.
  const visibleFacilityStrength =
    1 + lab.facilities.instances.length * content.research.rules.facilityContribution;
  const offscreenExpansion =
    (state.run.tick / 520) *
    Math.max(0, content.research.rules.facilityMultiplierMax - visibleFacilityStrength);
  const offscreenOrganisationMultiplier = 1 + Math.min(1, state.run.tick / 520) * 2;
  return {
    rosterStrength: Math.min(
      content.research.rules.talentMultiplier.max,
      1 +
        lab.organisation.generalResearchers *
          content.research.rules.generalResearcherContribution +
        lab.roster.researcherIds.length * 0.08,
    ),
    facilityStrength: Math.min(
      content.research.rules.facilityMultiplierMax,
      visibleFacilityStrength + offscreenExpansion,
    ),
    difficultyMultiplier:
      calculateRivalProgressMultiplier(state) *
      offscreenOrganisationMultiplier *
      // A rival running its Candidate Programme is running its models hard;
      // the same acceleration the player buys on the autonomy ladder.
      rivalAutonomyMultiplier(state, labId),
  };
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
  return {
    labId,
    programId,
    kind: base.kind,
    baseResearchPoints: base.baseResearchPoints,
    ...strength,
    weeklyVariance: base.weeklyVariance,
    finalResearchPoints:
      base.baseResearchPoints *
      strength.rosterStrength *
      strength.facilityStrength *
      strength.difficultyMultiplier *
      base.weeklyVariance,
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
      let level = Number(before.level);
      let progress = before.levelProgressRp + output.finalResearchPoints;
      while (level < 100) {
        const cost = researchPointsForNextLevel(content, output.programId, level);
        if (progress + 1e-12 < cost) break;
        progress -= cost;
        level += 1;
      }
      if (level >= 100) progress = 0;
      collection[output.programId] = {
        level: rating(level),
        levelProgressRp: progress,
        totalResearchPoints: before.totalResearchPoints + output.finalResearchPoints,
        weeklyMomentum: before.weeklyMomentum * 0.75 + output.finalResearchPoints * 0.25,
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
