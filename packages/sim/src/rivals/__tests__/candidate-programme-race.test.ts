import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import {
  AGI_COMPONENT_RULES,
  AGI_COMPONENT_TYPES,
  FINAL_ERA_FIRST_GENERATION_ID,
  agiComponentFlag,
} from "../../endgame/candidate-programme.ts";
import { registerCompletedTrainingArtifact } from "../../endgame/candidate-lifecycle.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { rivalFacilityCompleteFlag } from "../../facilities/facilities.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { LabId } from "../../model/ids.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { gpuCount, rating, tick } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  agiComponentBuildingFlag,
  agiComponentProgress,
  rivalAgiComponentPrerequisitesMet,
  rivalAgiComponentStartChance,
  rivalAgiComponentDurationWeeks,
} from "../candidate-programme-race.ts";
import {
  advanceRivalInfrastructure,
  rivalFacilityBuildingFlag,
  rivalFacilityDurationWeeks,
} from "../infrastructure.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function finalEraState(): DeepMutable<GameState> {
  const state = structuredClone(
    addBaselineModelsForTest(
      createNewGame(
        {
          seed: seed128("fedcba9876543210fedcba9876543210"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  state.world.currentGpuGenerationId = contentId(FINAL_ERA_FIRST_GENERATION_ID);
  for (const labId of Object.keys(state.world.rivals) as LabId[]) {
    const lab = state.labs[labId];
    if (lab === undefined) continue;
    for (const componentType of AGI_COMPONENT_TYPES) {
      const programId = AGI_COMPONENT_RULES[componentType].requirement.researchProgramId;
      const domain =
        programId === undefined ? undefined : lab.research.domains[programId];
      if (domain !== undefined) domain.level = rating(75);
    }
    const lot = lab.compute.lots[0];
    if (lot !== undefined) {
      // A late Rubin fleet can support either pair of concurrent works.
      lot.generationId = contentId("base:gpu.rubin");
      lot.physicalCount = gpuCount(20_000);
    }
    lab.flags[rivalFacilityCompleteFlag(contentId("base:facility.data-centre-5"))] = true;
    for (const componentType of AGI_COMPONENT_TYPES) {
      const facilityId = AGI_COMPONENT_RULES[componentType].requirement.facilityId;
      if (facilityId !== undefined) {
        lab.flags[rivalFacilityCompleteFlag(contentId(facilityId))] = true;
      }
    }
  }
  // Keep the player solvent and quiet so long advances stay about the rivals.
  const player = state.labs[state.run.playerLabId];
  if (player !== undefined) player.finance.cash = 100_000 as typeof player.finance.cash;
  return state;
}

function advance(state: GameState, ticks: number): GameState {
  let current = state;
  for (let index = 0; index < ticks; index += 1) {
    if (current.run.status !== "active") break;
    current = advanceOneTick(current, content).state;
  }
  return current;
}

function rivalIds(state: GameState): readonly LabId[] {
  return Object.keys(state.world.rivals).sort() as LabId[];
}

/**
 * Advancing 60-80 ticks of a fully populated final-era world is real work, not
 * a hang: these run in about five seconds alone and tip over the default
 * timeout once the rest of the suite is competing for cores. The assertions
 * below are unchanged -- only the clock they race is.
 */
const SLOW_WORLD_ADVANCE_MS = 30_000;

describe("the rival Candidate Programme race", () => {
  it("constructs the authored datacentre chain in stages", () => {
    const state = finalEraState();
    const labId = rivalIds(state)[0];
    if (labId === undefined) throw new Error("no rivals in fixture");
    const lab = state.labs[labId];
    if (lab === undefined) throw new Error("rival lab missing");
    for (const key of Object.keys(lab.flags)) {
      if (key.startsWith("rival:facility:")) delete lab.flags[key];
    }

    const start = createTransaction(state);
    advanceRivalInfrastructure(start, content);
    const started = start.commit({ description: "start rival infrastructure" }).state;
    const powerId = contentId("base:facility.power-and-cooling-1");
    const hallId = contentId("base:facility.server-hall");
    const dataCentreId = contentId("base:facility.data-centre-1");
    expect(started.labs[labId]?.flags[rivalFacilityBuildingFlag(powerId)]).toBe(0);
    expect(started.labs[labId]?.flags[rivalFacilityBuildingFlag(hallId)]).toBe(0);
    expect(started.labs[labId]?.flags[rivalFacilityBuildingFlag(dataCentreId)]).toBe(
      undefined,
    );

    const due = structuredClone(started) as DeepMutable<GameState>;
    due.run.tick = tick(
      Math.max(
        rivalFacilityDurationWeeks(due, content, powerId),
        rivalFacilityDurationWeeks(due, content, hallId),
      ),
    );
    due.run.calendar = calendarFromTick(due.run.tick);
    const completion = createTransaction(due);
    advanceRivalInfrastructure(completion, content);
    const completed = completion.commit({ description: "complete first stage" }).state;
    expect(completed.labs[labId]?.flags[rivalFacilityCompleteFlag(powerId)]).toBe(true);
    expect(completed.labs[labId]?.flags[rivalFacilityCompleteFlag(hallId)]).toBe(true);
    expect(completed.labs[labId]?.flags[rivalFacilityBuildingFlag(dataCentreId)]).toBe(
      due.run.tick,
    );
  });

  it("applies the difficulty pace to rival Candidate Programme works", () => {
    const state = finalEraState();
    expect(rivalAgiComponentDurationWeeks(state, "project-panopticon")).toBe(19);
    expect(rivalAgiComponentDurationWeeks(state, "world-engine")).toBe(24);
    expect(rivalAgiComponentDurationWeeks(state, "oracle-grid")).toBe(15);
    expect(rivalAgiComponentDurationWeeks(state, "mirror-test")).toBe(19);
  });

  it("commissions the final World Engine chain in about one year", () => {
    const state = finalEraState();
    const colliderWeeks = rivalFacilityDurationWeeks(
      state,
      content,
      contentId("base:facility.hadron-collider-1"),
    );
    const timeSphereWeeks = rivalFacilityDurationWeeks(
      state,
      content,
      contentId("base:facility.time-sphere-1"),
    );
    const worldEngineWeeks = rivalAgiComponentDurationWeeks(state, "world-engine");

    expect(colliderWeeks + timeSphereWeeks + worldEngineWeeks).toBeLessThanOrEqual(60);
    expect(colliderWeeks).toBeGreaterThan(0);
    expect(timeSphereWeeks).toBeGreaterThan(0);
  });

  it("requires each rival's own level-70 research and real fleet capacity", () => {
    const state = finalEraState();
    const labId = rivalIds(state)[0];
    if (labId === undefined) throw new Error("no rivals in fixture");
    expect(
      rivalAgiComponentPrerequisitesMet(state, content, labId, "project-panopticon"),
    ).toBe(true);

    const lowResearch = structuredClone(state);
    const programId =
      AGI_COMPONENT_RULES["project-panopticon"].requirement.researchProgramId;
    const domain =
      programId === undefined
        ? undefined
        : lowResearch.labs[labId]?.research.domains[programId];
    if (domain === undefined) throw new Error("research fixture missing");
    domain.level = rating(69);
    expect(
      rivalAgiComponentPrerequisitesMet(
        lowResearch,
        content,
        labId,
        "project-panopticon",
      ),
    ).toBe(false);

    const smallFleet = structuredClone(state);
    const lot = smallFleet.labs[labId]?.compute.lots[0];
    if (lot === undefined) throw new Error("fleet fixture missing");
    lot.physicalCount = gpuCount(1);
    expect(
      rivalAgiComponentPrerequisitesMet(smallFleet, content, labId, "project-panopticon"),
    ).toBe(false);
  });

  it("uses authored facility readiness and a 20–30% weekly start roll", () => {
    const state = finalEraState();
    const labId = rivalIds(state)[0];
    if (labId === undefined) throw new Error("no rivals in fixture");
    const facilityId = contentId("base:facility.argus-array-1");
    delete state.labs[labId]?.flags[rivalFacilityCompleteFlag(facilityId)];
    expect(
      rivalAgiComponentPrerequisitesMet(state, content, labId, "project-panopticon"),
    ).toBe(false);
    expect(rivalAgiComponentStartChance(0)).toBeCloseTo(0.2);
    expect(rivalAgiComponentStartChance(50)).toBeCloseTo(0.25);
    expect(rivalAgiComponentStartChance(100)).toBeCloseTo(0.3);
  });

  it(
    "rivals build works in the Markov hardware era",
    () => {
      const advanced = advance(finalEraState(), 60);
      const totals = rivalIds(advanced).map((labId) =>
        agiComponentProgress(advanced, labId),
      );
      expect(totals.some((progress) => progress.completed > 0)).toBe(true);
      // Nobody builds more than two works at once.
      expect(totals.every((progress) => progress.building <= 2)).toBe(true);
    },
    SLOW_WORLD_ADVANCE_MS,
  );

  it("does nothing before the final era", () => {
    const state = finalEraState();
    state.world.currentGpuGenerationId = contentId("base:gpu.kepler");
    const advanced = advance(state, 12);
    for (const labId of rivalIds(advanced)) {
      expect(agiComponentProgress(advanced, labId)).toEqual({
        building: 0,
        completed: 0,
      });
    }
    expect(advanced.world.rivalComponentAnnouncements).toHaveLength(0);
  });

  it(
    "rivals break ground on only the Rubin-era works before Markov",
    () => {
      const state = finalEraState();
      state.world.currentGpuGenerationId = contentId("base:gpu.rubin");
      const advanced = advance(state, 60);
      let anyRubinWorkStarted = false;
      for (const labId of rivalIds(advanced)) {
        const lab = advanced.labs[labId];
        if (lab === undefined) continue;
        for (const componentType of AGI_COMPONENT_TYPES) {
          const started =
            lab.flags[agiComponentFlag(componentType)] === true ||
            typeof lab.flags[agiComponentBuildingFlag(componentType)] === "number";
          if (AGI_COMPONENT_RULES[componentType].eraGenerationId === "base:gpu.rubin") {
            anyRubinWorkStarted = anyRubinWorkStarted || started;
          } else {
            expect(started).toBe(false);
          }
        }
      }
      expect(anyRubinWorkStarted).toBe(true);
    },
    SLOW_WORLD_ADVANCE_MS,
  );

  it(
    "announces every rival start and completion once",
    () => {
      const advanced = advance(finalEraState(), 80);
      const announcements = advanced.world.rivalComponentAnnouncements;
      const seen = new Set<string>();
      for (const announcement of announcements) {
        const key = `${announcement.labId}:${announcement.componentType}:${announcement.kind}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      for (const labId of rivalIds(advanced)) {
        const lab = advanced.labs[labId];
        if (lab === undefined) continue;
        for (const componentType of AGI_COMPONENT_TYPES) {
          if (
            lab.flags[agiComponentFlag(componentType)] === true ||
            typeof lab.flags[agiComponentBuildingFlag(componentType)] === "number"
          ) {
            expect(seen.has(`${labId}:${componentType}:started`)).toBe(true);
          }
          if (lab.flags[agiComponentFlag(componentType)] === true) {
            expect(seen.has(`${labId}:${componentType}:completed`)).toBe(true);
          }
        }
      }
      expect(new Set(announcements.map((item) => item.labId)).size).toBeGreaterThan(1);
      expect(advanced.run.autoPauseReasons).not.toContain("rival-agi-component");
    },
    SLOW_WORLD_ADVANCE_MS,
  );

  it("starts an eligible rival countdown independently once its programme is complete", () => {
    const state = finalEraState();
    const labId = rivalIds(state)[0];
    if (labId === undefined) throw new Error("no rivals in fixture");
    const rivalLab = state.labs[labId];
    const modelId = rivalLab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (rivalLab === undefined || model === undefined) {
      throw new Error("rival model missing");
    }
    model.trueCapability = {
      language: rating(93),
      reasoning: rating(92),
      agency: rating(88),
      toolUse: rating(90),
      multimodality: rating(85),
      scientificAbility: rating(89),
      embodiment: rating(80),
    };

    const registration = createTransaction(state);
    expect(
      registerCompletedTrainingArtifact(
        registration,
        model.id,
        new RandomOracleV1(state.run.seed),
      ),
    ).toBe(true);
    const registered = registration.commit({
      description: "register rival qualifying artifact",
    }).state;

    const oneWeek = advance(structuredClone(registered), 1);
    expect(oneWeek.world.rivals[labId]?.candidateCountdown).toBeUndefined();

    const armedState = structuredClone(registered) as DeepMutable<GameState>;
    const armedLab = armedState.labs[labId];
    if (armedLab === undefined) throw new Error("registered rival lab missing");
    for (const componentType of AGI_COMPONENT_TYPES) {
      armedLab.flags[agiComponentFlag(componentType)] = true;
    }
    const armed = advance(armedState, 1);
    expect(armed.world.rivals[labId]?.candidateCountdown).toBeDefined();
    expect(armed.endgame.stage).toBe("inactive");
  });

  it("keeps building flags as numbers so progress derives from state alone", () => {
    const advanced = advance(finalEraState(), 25);
    for (const labId of rivalIds(advanced)) {
      const lab = advanced.labs[labId];
      if (lab === undefined) continue;
      for (const componentType of AGI_COMPONENT_TYPES) {
        const flag = lab.flags[agiComponentBuildingFlag(componentType)];
        expect(flag === undefined || typeof flag === "number").toBe(true);
      }
    }
  });
});
