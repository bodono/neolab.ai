import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import type {
  ProposeCoalitionCommand,
  RatifyCoalitionCommand,
  StartCoalitionProjectCommand,
} from "../../commands/types.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { applyEffect } from "../../engine/effect-executor.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { CoalitionId, CommandId, LabId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { cashMillions, gpuCount, tick } from "../../model/units.ts";
import { completeReadyProjects } from "../../projects/project-framework.ts";
import { seed128 } from "../../random/seed.ts";
import {
  COALITION_MECHANIC_ENABLED,
  evaluateCoalitionEligibility,
  recordCoalitionBetrayal,
} from "../coalition.ts";

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

function preparedState(): {
  readonly state: GameState;
  readonly rivals: readonly [LabId, LabId];
} {
  const draft = mutable(newState());
  const rivals = Object.keys(draft.world.rivals).sort() as LabId[];
  const first = rivals[0];
  const second = rivals[1];
  const player = draft.labs[draft.run.playerLabId];
  if (first === undefined || second === undefined || player === undefined) {
    throw new Error("Coalition fixture missing");
  }
  player.finance.cash = cashMillions(100);
  player.aura.spendable = 100;
  player.aura.lifetime = 100;
  for (const rivalId of [first, second]) {
    const relationship = draft.world.rivals[rivalId]?.relationship;
    if (relationship === undefined) throw new Error("Relationship fixture missing");
    relationship.trust = 40;
  }
  const contributedLot = draft.labs[first]?.compute.lots[0];
  if (contributedLot === undefined) throw new Error("Compute fixture missing");
  contributedLot.physicalCount = gpuCount(contributedLot.physicalCount * 3);
  return { state: draft, rivals: [first, second] };
}

function commandId(value: string): CommandId {
  return value as CommandId;
}

function propose(): {
  readonly state: GameState;
  readonly coalitionId: CoalitionId;
  readonly rivals: readonly [LabId, LabId];
} {
  const prepared = preparedState();
  const command: ProposeCoalitionCommand = {
    kind: "propose-coalition",
    meta: {
      commandId: commandId("coalition-propose"),
      expectedTick: tick(0),
      issuedBy: "player",
    },
    labId: prepared.state.run.playerLabId,
    rivalLabIds: prepared.rivals,
    governmentMember: false,
    independentBodyMember: false,
  };
  expect(validateCommand(prepared.state, content, command).ok).toBe(true);
  const state = applyCommand(prepared.state, content, command).state;
  const coalitionId = Object.keys(state.world.coalitions)[0] as CoalitionId | undefined;
  if (coalitionId === undefined) throw new Error("Coalition proposal missing");
  return { state, coalitionId, rivals: prepared.rivals };
}

function completeGroundwork(): ReturnType<typeof propose> {
  let result = propose();
  const projectRequests: readonly {
    readonly projectType: StartCoalitionProjectCommand["projectType"];
    readonly contributorLabId?: LabId;
    readonly assetKind?: StartCoalitionProjectCommand["assetKind"];
  }[] = [
    { projectType: "charter-drafting" },
    { projectType: "charter-drafting" },
    { projectType: "shared-evaluation-protocol" },
    { projectType: "shared-evaluation-protocol" },
    { projectType: "verification-mechanism" },
    { projectType: "verification-mechanism" },
    {
      projectType: "asset-contribution",
      contributorLabId: result.rivals[0],
      assetKind: "compute",
    },
  ];
  for (const [index, request] of projectRequests.entries()) {
    const command: StartCoalitionProjectCommand = {
      kind: "start-coalition-project",
      meta: {
        commandId: commandId(`coalition-project-${String(index)}`),
        expectedTick: result.state.run.tick,
        issuedBy: "player",
      },
      labId: result.state.run.playerLabId,
      coalitionId: result.coalitionId,
      projectType: request.projectType,
      ...(request.contributorLabId === undefined
        ? {}
        : { contributorLabId: request.contributorLabId }),
      ...(request.assetKind === undefined ? {} : { assetKind: request.assetKind }),
    };
    const validation = validateCommand(result.state, content, command);
    expect(validation.ok).toBe(true);
    result = { ...result, state: applyCommand(result.state, content, command).state };
    const tx = createTransaction(result.state);
    tx.update((draft) => {
      const projectId = draft.world.coalitions[result.coalitionId]?.projectIds.at(-1);
      if (projectId === undefined) throw new Error("Coalition project missing");
      const project = draft.projects[projectId];
      if (project === undefined) throw new Error("Coalition project state missing");
      expect(project.status).toBe("active");
      project.progress = 1;
    });
    completeReadyProjects(tx, content);
    result = {
      ...result,
      state: tx.commit({ description: "complete coalition groundwork project" }).state,
    };
  }
  return result;
}

describe("coalition mechanic disable switch", () => {
  it("rejects every coalition command while the mechanic is off", () => {
    expect(COALITION_MECHANIC_ENABLED).toBe(false);
    const state = newState();
    const rivals = Object.keys(state.world.rivals).sort() as LabId[];
    const [first, second] = rivals;
    if (first === undefined || second === undefined) {
      throw new Error("rival fixture missing");
    }
    const meta = (id: string) => ({
      commandId: `command:${id}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    });
    const coalitionId = "run:coalition:world:0000" as CoalitionId;
    const commands = [
      {
        kind: "propose-coalition" as const,
        meta: meta("propose"),
        labId: state.run.playerLabId,
        rivalLabIds: [first, second],
        governmentMember: true,
        independentBodyMember: true,
      },
      {
        kind: "start-coalition-project" as const,
        meta: meta("project"),
        labId: state.run.playerLabId,
        coalitionId,
        projectType: "charter-drafting" as const,
      },
      {
        kind: "ratify-coalition" as const,
        meta: meta("ratify"),
        labId: state.run.playerLabId,
        coalitionId,
      },
    ];
    for (const command of commands) {
      const validation = validateCommand(state, content, command);
      expect(validation.ok, `${command.kind} should be refused`).toBe(false);
      if (validation.ok) continue;
      expect(validation.errors.map((error) => error.code)).toContain(
        "coalition-disabled",
      );
    }
  });

  it("never forms a coalition during ordinary play", () => {
    let state = newState();
    for (let week = 0; week < 8; week += 1) {
      state = advanceOneTick(state, content).state;
    }
    expect(Object.keys(state.world.coalitions)).toEqual([]);
  });
});

// TODO(coalition-redesign): these cases document the disabled mechanic's
// behaviour and stay skipped until the redesign lands. They exercise the
// machinery directly (not through the gated commands), so they are the
// starting point for whatever replaces it. See coalition.ts.
describe.skip("coalition groundwork", () => {
  it("moves proposal through project-backed negotiation to ratification", () => {
    const proposed = propose();
    expect(proposed.state.world.coalitions[proposed.coalitionId]).toMatchObject({
      status: "proposed",
      memberLabIds: [proposed.state.run.playerLabId, ...proposed.rivals],
      charterClarity: 0,
      sharedProtocolQuality: 0,
      verification: 0,
    });
    const completed = completeGroundwork();
    const coalition = completed.state.world.coalitions[completed.coalitionId];
    expect(coalition).toMatchObject({
      status: "ratifying",
      charterClarity: 60,
      sharedProtocolQuality: 60,
      verification: 60,
      formationAuraSpent: 25,
    });
    expect(coalition?.assets).toEqual([
      expect.objectContaining({
        contributorLabId: completed.rivals[0],
        kind: "compute",
        uniqueToPlayer: true,
      }),
    ]);
    const eligibility = evaluateCoalitionEligibility(
      completed.state,
      completed.coalitionId,
    );
    expect(eligibility.eligible).toBe(false);
    expect(
      eligibility.checks.find((check) => check.id === "formation-period"),
    ).toMatchObject({
      satisfied: false,
    });
    expect(JSON.stringify(coalition)).not.toContain("eligible");
  });

  it("ratifies after 26 weeks, scores once, and pauses signatory countdowns", () => {
    const completed = completeGroundwork();
    const due = mutable(completed.state);
    due.run.tick = tick(26);
    due.run.calendar = calendarFromTick(26);
    const countdownOwner = completed.rivals[0];
    const modelId = due.labs[countdownOwner]?.models.currentModelId;
    if (modelId === undefined) throw new Error("Countdown model missing");
    const rivalState = due.world.rivals[countdownOwner];
    if (rivalState === undefined) throw new Error("Countdown rival missing");
    rivalState.candidateCountdown = {
      modelId,
      startedAt: tick(0),
      completesAt: tick(40),
      status: "active",
      modifiers: {
        baseWeeks: 78,
        safetyCommitmentWeeks: 6,
        raceUrgencyWeeks: 2,
        politicalProcessWeeks: 2,
        incidentDelayWeeks: 4,
        sharedStandardsWeeks: 0,
        finalWeeks: 40,
      },
      estimateNoiseUnit: 0,
      finalYearWarningIssued: false,
    };
    const command: RatifyCoalitionCommand = {
      kind: "ratify-coalition",
      meta: {
        commandId: commandId("coalition-ratify"),
        expectedTick: due.run.tick,
        issuedBy: "player",
      },
      labId: due.run.playerLabId,
      coalitionId: completed.coalitionId,
    };
    const validation = validateCommand(due, content, command);
    expect(validation.ok).toBe(true);
    const result = applyCommand(due, content, command);
    expect(result.state.world.coalitions[completed.coalitionId]).toMatchObject({
      status: "active",
      activatedAt: 26,
    });
    expect(result.state.world.rivals[countdownOwner]?.candidateCountdown).toMatchObject({
      status: "paused",
      pausedAt: 26,
      remainingWeeksAtPause: 14,
    });
    expect(result.state.score.entries).toContainEqual(
      expect.objectContaining({
        key: `coalition/charter-ratified/${completed.coalitionId}`,
        categoryId: "score.race-operations",
        amount: 750,
      }),
    );
    expect(result.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "coalition-ratified",
        coalitionId: completed.coalitionId,
      }),
    );
  });

  it("derives every hard prerequisite and blocks an unresolved betrayal", () => {
    const completed = completeGroundwork();
    const due = mutable(completed.state);
    due.run.tick = tick(26);
    due.run.calendar = calendarFromTick(26);
    expect(evaluateCoalitionEligibility(due, completed.coalitionId).eligible).toBe(true);
    const tx = createTransaction(due);
    recordCoalitionBetrayal(
      tx,
      completed.coalitionId,
      completed.rivals[0],
      "Concealed unilateral training",
    );
    const betrayed = tx.commit({ description: "coalition betrayal" }).state;
    const eligibility = evaluateCoalitionEligibility(betrayed, completed.coalitionId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.checks.find((check) => check.id === "betrayals")).toMatchObject({
      satisfied: false,
    });
  });

  it("accepts the alternate one-rival plus government and independent-body composition", () => {
    const prepared = preparedState();
    const command: ProposeCoalitionCommand = {
      kind: "propose-coalition",
      meta: {
        commandId: commandId("coalition-alternate-composition"),
        expectedTick: prepared.state.run.tick,
        issuedBy: "player",
      },
      labId: prepared.state.run.playerLabId,
      rivalLabIds: [prepared.rivals[0]],
      governmentMember: true,
      independentBodyMember: true,
    };
    const state = applyCommand(prepared.state, content, command).state;
    const coalitionId = Object.keys(state.world.coalitions)[0] as CoalitionId;
    const check = evaluateCoalitionEligibility(state, coalitionId).checks.find(
      (candidate) => candidate.id === "member-composition",
    );
    expect(check?.satisfied).toBe(true);
  });

  it("lets authored inspection events improve a forming coalition through a typed effect", () => {
    const proposed = propose();
    const tx = createTransaction(proposed.state);
    applyEffect(
      tx,
      {
        kind: "add-coalition-rating",
        rating: "verification",
        amount: 12,
      },
      { kind: "event", id: "coalition.inspection.fixture" },
    );
    const result = tx.commit({ description: "coalition inspection event effect" });
    expect(result.state.world.coalitions[proposed.coalitionId]?.verification).toBe(12);
    expect(result.state.decisionLog.at(-1)?.source).toEqual({
      kind: "event",
      id: "coalition.inspection.fixture",
    });
  });
});
