import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { quoteGpuPurchase } from "../../compute/gpu-market.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import {
  calculateFacilityCapacity,
  quoteFacilityConstruction,
} from "../../facilities/facilities.ts";
import type { CommandId, FacilityId, ModifierId, ProjectId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { cashMillions } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { calculateResearchOutputModifier } from "../../research/research.ts";
import {
  advanceProjects,
  calculateProjectCapacity,
  createProjectHandlerRegistry,
  startConstructionProject,
} from "../project-framework.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(cash = 100): GameState {
  const state = createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.thomas-hassabi"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  lab.finance.cash = cashMillions(cash);
  return draft;
}

function constructionCommand(
  state: GameState,
  definitionId:
    | "base:facility.power-and-cooling-1"
    | "base:facility.server-hall"
    | "base:facility.data-centre-1",
) {
  return {
    kind: "start-facility-construction" as const,
    meta: {
      commandId: `command:${definitionId}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    definitionId: contentId(definitionId),
  };
}

function advance(state: GameState, ticks: number): GameState {
  let current = state;
  for (let index = 0; index < ticks; index += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

function buildCorePrerequisites(state = newState()): GameState {
  const powerQueued = applyCommand(
    state,
    content,
    constructionCommand(state, "base:facility.power-and-cooling-1"),
  ).state;
  const coreQueued = applyCommand(
    powerQueued,
    content,
    constructionCommand(powerQueued, "base:facility.server-hall"),
  ).state;
  return advance(coreQueued, 9);
}

function withFacilityEffects(state: GameState, definitionId: string): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  const definition = content.facilities[definitionId];
  if (lab === undefined || definition === undefined) {
    throw new Error(`facility effect fixture missing ${definitionId}`);
  }
  const facilityId = `run:facility:test:${definitionId}` as FacilityId;
  const modifierIds = definition.modifiers.map((effect, index) => {
    const modifierId = `run:modifier:test:${definitionId}:${String(index)}` as ModifierId;
    draft.modifiers[modifierId] = {
      id: modifierId,
      source: { kind: "facility", id: facilityId },
      labId: draft.run.playerLabId,
      target: effect.target,
      operation: effect.operation,
      value: effect.value,
      startsAt: draft.run.tick,
      tags: ["facility", ...definition.tags],
    };
    return modifierId;
  });
  lab.facilities.instances.push({
    id: facilityId,
    definitionId: definition.id,
    completedAt: draft.run.tick,
    majorProjectSlotBonus: definition.bonusMajorProjectSlots,
    modifierIds,
  });
  return draft;
}

describe("facility content and quotes", () => {
  it("compiles the opening infrastructure with the rebalanced costs and prerequisites", () => {
    expect(content.facilities["base:facility.power-and-cooling-1"]).toMatchObject({
      cashCostMillions: 10.5,
      durationWeeks: 9,
      prerequisiteFacilityIds: [],
      scoreTag: "core-tier-1",
    });
    expect(content.facilities["base:facility.server-hall"]).toMatchObject({
      cashCostMillions: 12,
      durationWeeks: 9,
      prerequisiteFacilityIds: ["base:facility.server-rack"],
    });
    expect(content.facilities["base:facility.data-centre-1"]).toMatchObject({
      cashCostMillions: 30,
      durationWeeks: 18,
      prerequisiteFacilityIds: [
        "base:facility.server-hall",
        "base:facility.power-and-cooling-1",
      ],
      supportedOwnedGpuCount: 30000,
    });
  });

  it("quotes costs and blocks Data Centre I until its hall and power are operational", () => {
    const state = newState();
    expect(
      quoteFacilityConstruction(
        state,
        content,
        state.run.playerLabId,
        contentId("base:facility.power-and-cooling-1"),
      ),
    ).toMatchObject({
      upfrontCostMillions: 10.5,
      durationWeeks: 9,
      majorProjectSlotsRequired: 1,
      blockers: [],
    });
    const dataCentreQuote = quoteFacilityConstruction(
      state,
      content,
      state.run.playerLabId,
      contentId("base:facility.data-centre-1"),
    );
    expect(dataCentreQuote).toMatchObject({
      upfrontCostMillions: 30,
      durationWeeks: 18,
      majorProjectSlotsRequired: 1,
    });
    expect(dataCentreQuote.blockers).toEqual(
      expect.arrayContaining(["Requires Server Hall", "Requires Power and Cooling I"]),
    );
  });

  it("gates facility tiers by phase and the late hardware eras", () => {
    const state = structuredClone(newState(1_000_000)) as DeepMutable<GameState>;
    const blockers = (definitionId: string): readonly string[] =>
      quoteFacilityConstruction(
        state,
        content,
        state.run.playerLabId,
        contentId(definitionId),
      ).blockers;

    expect(blockers("base:facility.power-and-cooling-2")).toContain(
      "Requires the scaling phase",
    );

    state.run.phase = "scaling";
    expect(blockers("base:facility.power-and-cooling-2")).not.toContain(
      "Requires the scaling phase",
    );
    expect(blockers("base:facility.power-and-cooling-3")).toContain(
      "Requires the frontier phase",
    );

    state.run.phase = "frontier";
    expect(blockers("base:facility.power-and-cooling-3")).not.toContain(
      "Requires the frontier phase",
    );
    expect(blockers("base:facility.power-and-cooling-4")).toContain(
      "Requires Rubin-era hardware",
    );

    state.world.currentGpuGenerationId = contentId("base:gpu.rubin");
    expect(blockers("base:facility.power-and-cooling-4")).not.toContain(
      "Requires Rubin-era hardware",
    );
    expect(blockers("base:facility.power-and-cooling-5")).toContain(
      "Requires Markov-era hardware",
    );

    state.world.currentGpuGenerationId = contentId("base:gpu.markov");
    expect(blockers("base:facility.power-and-cooling-5")).not.toContain(
      "Requires Markov-era hardware",
    );
  });

  it("unlocks Markov hardware and Tier 5 facilities at world FC 86", () => {
    expect(
      content.gpuGenerations["base:gpu.markov"]?.unlockAtWorldFrontierCapability,
    ).toBe(86);
  });

  it("reserves two major-project slots for Tier 4 and Tier 5 construction", () => {
    const state = structuredClone(newState(1_000_000)) as DeepMutable<GameState>;
    state.run.phase = "frontier";

    for (const [definitionId, generationId] of [
      ["base:facility.power-and-cooling-4", "base:gpu.rubin"],
      ["base:facility.power-and-cooling-5", "base:gpu.markov"],
    ] as const) {
      const fixture = structuredClone(state);
      fixture.world.currentGpuGenerationId = contentId(generationId);
      expect(
        quoteFacilityConstruction(
          fixture,
          content,
          fixture.run.playerLabId,
          contentId(definitionId),
        ).majorProjectSlotsRequired,
      ).toBe(2);

      const tx = createTransaction(fixture);
      const projectId = startConstructionProject(
        tx,
        content,
        fixture.run.playerLabId,
        contentId(definitionId),
      );
      expect(tx.read().projects[projectId]?.reservations.majorProjectSlots).toBe(2);
    }
  });

  it("alternates every datacentre tier with its matching power build", () => {
    for (let tier = 2; tier <= 5; tier += 1) {
      const previousTier = tier - 1;
      const power = content.facilities[`base:facility.power-and-cooling-${String(tier)}`];
      const dataCentre = content.facilities[`base:facility.data-centre-${String(tier)}`];
      expect(power?.prerequisiteFacilityIds).toEqual([
        `base:facility.power-and-cooling-${String(previousTier)}`,
        `base:facility.data-centre-${String(previousTier)}`,
      ]);
      expect(dataCentre?.prerequisiteFacilityIds).toEqual([
        `base:facility.data-centre-${String(previousTier)}`,
        `base:facility.power-and-cooling-${String(tier)}`,
      ]);
    }
  });

  it("unlocks progressively stronger inference centres in sequence", () => {
    expect(content.facilities["base:facility.inference-centre-1"]).toMatchObject({
      tier: 1,
      prerequisiteFacilityIds: ["base:facility.data-centre-1"],
      modifiers: [
        {
          target: "serving.computePerRequest",
          operation: "multiply",
          value: 0.9,
        },
      ],
    });
    expect(content.facilities["base:facility.inference-centre-2"]).toMatchObject({
      tier: 2,
      prerequisiteFacilityIds: [
        "base:facility.inference-centre-1",
        "base:facility.data-centre-2",
      ],
      modifiers: [
        {
          target: "serving.computePerRequest",
          operation: "multiply",
          value: 0.85,
        },
      ],
    });
    expect(content.facilities["base:facility.inference-centre-3"]).toMatchObject({
      tier: 3,
      prerequisiteFacilityIds: [
        "base:facility.inference-centre-2",
        "base:facility.data-centre-3",
      ],
      modifiers: [
        {
          target: "serving.computePerRequest",
          operation: "multiply",
          value: 0.75,
        },
      ],
    });
  });

  it("makes all five previously inert facility effects change their advertised outcomes", () => {
    const baseline = newState(1_000_000);
    const generationId = baseline.world.currentGpuGenerationId;
    const baselineDelivery = quoteGpuPurchase(
      baseline,
      content,
      baseline.run.playerLabId,
      generationId,
      1,
    ).deliveryWeeks;
    for (const [definitionId, multiplier] of [
      ["base:facility.data-centre-3", 0.85],
      ["base:facility.nanofoundry-1", 0.7],
    ] as const) {
      const withFacility = withFacilityEffects(baseline, definitionId);
      expect(
        quoteGpuPurchase(
          withFacility,
          content,
          withFacility.run.playerLabId,
          generationId,
          1,
        ).deliveryWeeks,
      ).toBe(Math.max(1, Math.round(baselineDelivery * multiplier)));
    }

    for (const [definitionId, programmeId, multiplier] of [
      ["base:facility.robotics-lab-1", "base:domain.robotics-embodiment", 1.2],
      ["base:facility.scientific-laboratory-1", "base:domain.scientific-ai", 1.2],
      ["base:facility.biofoundry-1", "base:domain.scientific-ai", 1.35],
    ] as const) {
      const before = calculateResearchOutputModifier(
        baseline,
        content,
        baseline.run.playerLabId,
        contentId(programmeId),
      ).outputModifier;
      const withFacility = withFacilityEffects(baseline, definitionId);
      const after = calculateResearchOutputModifier(
        withFacility,
        content,
        withFacility.run.playerLabId,
        contentId(programmeId),
      ).outputModifier;
      expect(after).toBeCloseTo(before * multiplier);
    }
  });

  it("names the missing matching power station in higher-datacentre quotes", () => {
    for (let tier = 3; tier <= 5; tier += 1) {
      const state = structuredClone(newState(10_000)) as DeepMutable<GameState>;
      const lab = state.labs[state.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      for (let completedTier = 1; completedTier < tier; completedTier += 1) {
        for (const family of ["power-and-cooling", "data-centre"]) {
          lab.facilities.instances.push({
            definitionId: contentId(`base:facility.${family}-${String(completedTier)}`),
            completedAt: state.run.tick,
            modifierIds: [],
          });
        }
      }

      const quote = quoteFacilityConstruction(
        state,
        content,
        state.run.playerLabId,
        contentId(`base:facility.data-centre-${String(tier)}`),
      );
      const matchingPower =
        content.facilities[`base:facility.power-and-cooling-${String(tier)}`];
      if (matchingPower === undefined) throw new Error("matching power stage missing");
      expect(quote.blockers).toContain(`Requires ${matchingPower.displayName}`);
    }
  });
});

describe("project scheduling and construction", () => {
  it("starts every lab at two major-project slots", () => {
    const state = newState();
    expect(calculateProjectCapacity(state, content, state.run.playerLabId)).toMatchObject(
      {
        baseMajorProjectSlots: 2,
        majorProjectSlots: 2,
        availableMajorProjectSlots: 2,
        availableCrisisSlots: 2,
      },
    );
  });

  it("adds facility slots along the campus ladder up to the five-slot lab maximum", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const headquarters = content.facilities["base:facility.headquarters-1"];
    if (lab === undefined || headquarters === undefined) {
      throw new Error("headquarters capacity fixture missing");
    }
    expect(headquarters.bonusMajorProjectSlots).toBe(1);
    lab.facilities.instances.push({
      definitionId: headquarters.id,
      completedAt: state.run.tick,
      majorProjectSlotBonus: headquarters.bonusMajorProjectSlots,
      modifierIds: [],
    });
    expect(calculateProjectCapacity(state, content, state.run.playerLabId)).toMatchObject(
      {
        baseMajorProjectSlots: 2,
        facilityBonusMajorProjectSlots: 1,
        majorProjectSlots: 3,
        maximumMajorProjectSlots: 5,
      },
    );
    for (const definitionId of [
      "base:facility.headquarters-2",
      "base:facility.cross-attention-atrium",
    ]) {
      const definition = content.facilities[definitionId];
      if (definition === undefined) throw new Error(`${definitionId} missing`);
      expect(definition.bonusMajorProjectSlots).toBe(1);
      lab.facilities.instances.push({
        definitionId: contentId(definitionId),
        completedAt: state.run.tick,
        majorProjectSlotBonus: definition.bonusMajorProjectSlots,
        modifierIds: [],
      });
    }
    expect(
      calculateProjectCapacity(state, content, state.run.playerLabId).majorProjectSlots,
    ).toBe(5);
  });

  it("rejects duplicate handler registration", () => {
    const handler = {
      kind: "construction" as const,
      advance: () => undefined,
      complete: () => undefined,
      cancel: () => undefined,
    };
    expect(() => createProjectHandlerRegistry([handler, handler])).toThrow(
      /Duplicate project handler/,
    );
  });

  it("does not count queued major projects as occupied capacity", () => {
    const state = newState();
    const firstQueued = applyCommand(state, content, {
      kind: "start-fundraising-campaign",
      meta: {
        commandId: "command:first-fundraise" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      campaign: "quiet-bridge",
    }).state;
    const fixture = structuredClone(firstQueued) as DeepMutable<GameState>;
    const firstProject = Object.values(fixture.projects).find(
      (project) => project.kind === "fundraising",
    );
    const lab = fixture.labs[fixture.run.playerLabId];
    if (firstProject === undefined || lab === undefined) {
      throw new Error("fundraising project fixture missing");
    }
    firstProject.status = "queued";
    delete firstProject.startedAt;
    const secondProjectId = "run:project:scheduler-test:0002" as ProjectId;
    fixture.projects[secondProjectId] = {
      ...structuredClone(firstProject),
      id: secondProjectId,
      completionOrder: firstProject.completionOrder + 1,
    };
    lab.projects.projectIds.push(secondProjectId);

    expect(
      calculateProjectCapacity(fixture, content, fixture.run.playerLabId),
    ).toMatchObject({
      majorProjectSlots: 2,
      occupiedMajorProjectSlots: 0,
      availableMajorProjectSlots: 2,
    });
    const tx = createTransaction(fixture);
    advanceProjects(tx, content);
    expect(
      Object.values(tx.read().projects)
        .filter((project) => project.kind === "fundraising")
        .map((project) => project.status),
    ).toEqual(["active", "active"]);
  });

  it("charges upfront, shares capacity, and immediately hands freed slots to queued work", () => {
    const state = newState();
    const first = applyCommand(
      state,
      content,
      constructionCommand(state, "base:facility.power-and-cooling-1"),
    ).state;
    expect(first.labs[state.run.playerLabId]?.finance.cash).toBe(89.5);
    expect(first.labs[state.run.playerLabId]?.finance.ledger.at(-1)).toMatchObject({
      category: "project-cost",
      amountMillions: -10.5,
    });
    expect(
      Object.values(first.projects).find((project) => project.kind === "construction"),
    ).toMatchObject({
      status: "active",
      progress: 0,
      startedAt: first.run.tick,
      reservations: {
        majorProjectSlots: 1,
      },
    });
    expect(calculateProjectCapacity(first, content, state.run.playerLabId)).toMatchObject(
      {
        occupiedMajorProjectSlots: 1,
        availableMajorProjectSlots: 1,
      },
    );

    // Bypass prerequisite validation to show that construction fills the same
    // two slots and a third build waits in the ordinary project queue.
    const tx = createTransaction(first);
    startConstructionProject(
      tx,
      content,
      state.run.playerLabId,
      contentId("base:facility.data-centre-1"),
    );
    startConstructionProject(
      tx,
      content,
      state.run.playerLabId,
      contentId("base:facility.power-and-cooling-2"),
    );
    const twoQueued = tx.commit({ description: "scheduler fixture" }).state;
    expect(
      twoQueued.labs[state.run.playerLabId]?.flags[
        "facility-promised:base:facility.data-centre-1:at"
      ],
    ).toBe(twoQueued.run.tick);
    const afterWeek = advance(twoQueued, 1);
    const projects = Object.values(afterWeek.projects)
      .filter(
        (project) =>
          project.ownerLabId === state.run.playerLabId &&
          project.payload.kind === "construction",
      )
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    expect(projects.map((project) => project.status)).toEqual([
      "active",
      "active",
      "queued",
    ]);
    expect(projects[0]?.progress).toBeCloseTo(1 / 9);
    expect(projects[1]?.progress).toBeCloseTo(1 / 18);
    expect(projects[2]?.progress).toBe(0);
    expect(
      calculateProjectCapacity(afterWeek, content, state.run.playerLabId),
    ).toMatchObject({
      occupiedMajorProjectSlots: 2,
      availableMajorProjectSlots: 0,
    });

    const afterFirstCompletion = advance(afterWeek, 8);
    const handedOffProjects = Object.values(afterFirstCompletion.projects)
      .filter(
        (project) =>
          project.ownerLabId === state.run.playerLabId &&
          project.payload.kind === "construction",
      )
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    expect(handedOffProjects.map((project) => project.status)).toEqual([
      "completed",
      "active",
      "active",
    ]);
    expect(handedOffProjects[0]?.progress).toBe(1);
    expect(handedOffProjects[1]?.progress).toBeCloseTo(0.5);
    expect(handedOffProjects[2]?.progress).toBe(0);
    expect(handedOffProjects[2]?.startedAt).toBe(afterFirstCompletion.run.tick);
    expect(
      calculateProjectCapacity(afterFirstCompletion, content, state.run.playerLabId),
    ).toMatchObject({
      occupiedMajorProjectSlots: 2,
      availableMajorProjectSlots: 0,
    });
  });

  it("completes Power and Cooling I in nine weeks and scores its milestone once", () => {
    const state = newState();
    const queued = applyCommand(
      state,
      content,
      constructionCommand(state, "base:facility.power-and-cooling-1"),
    ).state;
    const weekEight = advance(queued, 8);
    expect(
      weekEight.labs[state.run.playerLabId]?.facilities.instances.some(
        (facility) => facility.definitionId === "base:facility.power-and-cooling-1",
      ),
    ).toBe(false);
    const completed = advance(weekEight, 1);
    const facility = completed.labs[state.run.playerLabId]?.facilities.instances.find(
      (candidate) => candidate.definitionId === "base:facility.power-and-cooling-1",
    );
    expect(facility).toMatchObject({
      completedAt: 9,
    });
    expect(facility?.modifierIds).toHaveLength(1);
    const modifierId = facility?.modifierIds[0];
    const facilityModifier =
      modifierId === undefined ? undefined : completed.modifiers[modifierId];
    expect(facilityModifier?.labId).toBe(completed.run.playerLabId);
    expect(Object.values(completed.projects)[0]).toMatchObject({
      status: "completed",
      progress: 1,
    });
    expect(completed.score.entries).toContainEqual(
      expect.objectContaining({
        key: "facility/completion/base:facility.power-and-cooling-1",
        categoryId: "score.institution-building",
        amount: 150,
      }),
    );
  });

  it("builds Data Centre I after its prerequisites and exposes 30,000-GPU support", () => {
    const powered = buildCorePrerequisites();
    const queued = applyCommand(
      powered,
      content,
      constructionCommand(powered, "base:facility.data-centre-1"),
    ).state;
    const completed = advance(queued, 18);
    expect(
      calculateFacilityCapacity(completed, content, completed.run.playerLabId),
    ).toMatchObject({ supportedOwnedGpuCount: 30000 });
    const bigOrder = quoteGpuPurchase(
      completed,
      content,
      completed.run.playerLabId,
      completed.world.currentGpuGenerationId,
      15,
    );
    expect(bigOrder.capacity).toMatchObject({
      supportedPhysicalGpus: 30000,
      met: true,
    });
    expect(
      completed.score.entries
        .filter(
          (entry) =>
            entry.categoryId === "score.institution-building" && entry.amount === 150,
        )
        .map((entry) => entry.key)
        .sort(),
    ).toEqual([
      "facility/completion/base:facility.data-centre-1",
      "facility/completion/base:facility.power-and-cooling-1",
      "facility/completion/base:facility.server-hall",
    ]);
  });
});
