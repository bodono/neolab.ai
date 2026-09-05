import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { CommandId, FacilityId, ResearcherId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState } from "../../model/state.ts";
import { tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectCampusView } from "../campus-view.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return addBaselineModelsForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
    content,
  );
}

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function advance(state: GameState, weeks: number): GameState {
  let current = state;
  for (let week = 0; week < weeks; week += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

function startPowerConstruction(state: GameState): GameState {
  return applyCommand(state, content, {
    kind: "start-facility-construction",
    meta: {
      commandId: "command:campus-power" as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    definitionId: contentId("base:facility.power-and-cooling-1"),
  }).state;
}

describe("CampusView", () => {
  it("labels star researchers by their programme lead or as unassigned", () => {
    const draft = mutable(newState());
    const lab = draft.labs[draft.run.playerLabId];
    const leadId = content.researchers.orderedIds[0] as ResearcherId | undefined;
    const safetyLeadId = content.researchers.orderedIds[1] as ResearcherId | undefined;
    const unassignedId = content.researchers.orderedIds[2] as ResearcherId | undefined;
    if (
      lab === undefined ||
      leadId === undefined ||
      safetyLeadId === undefined ||
      unassignedId === undefined
    ) {
      throw new Error("campus researcher fixture missing");
    }
    const lead = draft.researchers[leadId];
    const safetyLead = draft.researchers[safetyLeadId];
    const unassigned = draft.researchers[unassignedId];
    if (lead === undefined || safetyLead === undefined || unassigned === undefined) {
      throw new Error("campus researcher state missing");
    }
    for (const researcher of [lead, safetyLead, unassigned]) {
      researcher.employerLabId = lab.id;
      researcher.employedAt = tick(0);
      researcher.status = "employed";
      researcher.housing = "housed";
      lab.roster.researcherIds.push(researcher.id);
    }
    lead.assignment = {
      kind: "capability-program",
      targetId: contentId("base:domain.architectures"),
      role: "lead",
      assignedAt: tick(0),
    };
    safetyLead.assignment = {
      kind: "safety-program",
      targetId: contentId("base:safety.alignment-control"),
      role: "lead",
      assignedAt: tick(0),
    };

    const people = Object.fromEntries(
      projectCampusView(draft, content, lab.id).namedPeople.map((person) => [
        person.researcherId,
        person.assignmentLabel,
      ]),
    );
    expect(people[leadId]).toBe("Lead · Architectures");
    expect(people[safetyLeadId]).toBe("Lead · Alignment and Control");
    expect(people[unassignedId]).toBe("Unassigned");
  });

  it("maps construction progress into the three visible build phases", () => {
    const queued = startPowerConstruction(newState());
    const weekOne = advance(queued, 1);
    const weekThree = advance(weekOne, 2);
    const weekSix = advance(weekThree, 3);
    expect(
      projectCampusView(weekOne, content, weekOne.run.playerLabId).construction[0],
    ).toMatchObject({ stage: "foundations", progressBasisPoints: 1111 });
    expect(
      projectCampusView(weekThree, content, weekThree.run.playerLabId).construction[0],
    ).toMatchObject({ stage: "structure", progressBasisPoints: 3333 });
    expect(
      projectCampusView(weekSix, content, weekSix.run.playerLabId).construction[0],
    ).toMatchObject({ stage: "commissioning", progressBasisPoints: 6667 });
  });

  it("coalesces completed upgrades into one campus module", () => {
    const draft = mutable(newState());
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("lab fixture missing");
    const lowerId = contentId("base:facility.campus-test-1");
    const upperId = contentId("base:facility.campus-test-2");
    const baseDefinition = content.facilities["base:facility.power-and-cooling-1"];
    if (baseDefinition === undefined) throw new Error("definition fixture missing");
    const lowerDefinition = {
      ...structuredClone(baseDefinition),
      id: lowerId,
      displayName: "Campus Test I",
      family: "campus-test",
      tier: 1,
      campusModule: "campus-test-low",
    };
    const upperDefinition = {
      ...structuredClone(baseDefinition),
      id: upperId,
      displayName: "Campus Test II",
      family: "campus-test",
      tier: 2,
      campusModule: "campus-test-high",
    };
    const contentWithUpgrade: CompiledContent = {
      ...content,
      facilities: {
        ...content.facilities,
        [lowerId]: lowerDefinition,
        [upperId]: upperDefinition,
      },
    };
    lab.facilities.instances.push(
      {
        id: "run:facility:campus-test:0001" as FacilityId,
        definitionId: lowerId,
        completedAt: tick(1),
        modifierIds: [],
      },
      {
        id: "run:facility:campus-test:0002" as FacilityId,
        definitionId: upperId,
        completedAt: tick(2),
        modifierIds: [],
      },
    );

    const view = projectCampusView(draft, contentWithUpgrade, lab.id);
    expect(
      view.facilities.filter((facility) => facility.family === "campus-test"),
    ).toEqual([
      expect.objectContaining({
        definitionId: upperId,
        campusModule: "campus-test-high",
      }),
    ]);
    expect(view.overflowFacilityCount).toBe(1);
  });
});
