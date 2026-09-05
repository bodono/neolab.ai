import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { CommandId, ModelId, ProjectId } from "../../model/ids.ts";
import type { GameState, ProjectPayload, ProjectState } from "../../model/state.ts";
import { cashMillions, rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectTrainingLossTelemetry } from "../loss-curve.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function startedTrainingState(): GameState {
  const initial = addBaselineModelForTest(
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
  const lab = initial.labs[initial.run.playerLabId];
  if (lab?.models.currentModelId === undefined) {
    throw new Error("training fixture is missing its parent model");
  }
  return applyCommand(initial, content, {
    kind: "start-training-run",
    meta: {
      commandId: "command:test-loss-curve" as CommandId,
      expectedTick: initial.run.tick,
      issuedBy: "player",
    },
    labId: initial.run.playerLabId,
    parentModelId: lab.models.currentModelId,
    durationWeeks: 5,
    posture: "normal",
  }).state;
}

type MutableTrainingProject = DeepMutable<ProjectState> & {
  payload: DeepMutable<Extract<ProjectPayload, { kind: "training" }>>;
};

function requireTrainingProject(state: DeepMutable<GameState>): MutableTrainingProject {
  const lab = state.labs[state.run.playerLabId];
  const project = lab?.projects.projectIds
    .map((projectId) => state.projects[projectId])
    .find((candidate) => candidate?.payload.kind === "training");
  if (project?.payload.kind !== "training") {
    throw new Error("training fixture is missing its project");
  }
  return project as MutableTrainingProject;
}

describe("projectTrainingLossTelemetry", () => {
  it("is deterministic, run-specific, observed-only, and independent of hidden stats", () => {
    const state = structuredClone(startedTrainingState()) as DeepMutable<GameState>;
    const project = requireTrainingProject(state);
    if (project.payload.kind !== "training") throw new Error("unreachable");
    project.status = "active";
    project.payload.weeksElapsed = 3;
    project.expectedDurationWeeks = 12;
    project.progress = 0.25;

    const first = projectTrainingLossTelemetry(state, content, state.run.playerLabId);
    const repeated = projectTrainingLossTelemetry(state, content, state.run.playerLabId);

    expect(repeated).toEqual(first);
    expect(first.curves).toHaveLength(1);
    expect(first.curves[0]?.points.at(-1)?.trainingFractionBasisPoints).toBe(2_500);

    const hiddenStatsChanged = structuredClone(state);
    const parentModelId = project.payload.parentModelId;
    const parentModel =
      parentModelId === undefined ? undefined : hiddenStatsChanged.models[parentModelId];
    if (parentModel === undefined) throw new Error("parent model fixture missing");
    parentModel.trueCapability.reasoning = rating(100);
    parentModel.hiddenSafety.trueAlignment = rating(0);
    parentModel.hiddenSafety.deceptiveCapability = rating(100);
    expect(
      projectTrainingLossTelemetry(
        hiddenStatsChanged,
        content,
        hiddenStatsChanged.run.playerLabId,
      ),
    ).toEqual(first);

    const secondProject = structuredClone(project);
    secondProject.id = "run:project:player:loss-curve-2" as ProjectId;
    secondProject.payload.futureModelId = "run:model:player:loss-curve-2" as ModelId;
    secondProject.completionOrder += 1;
    state.projects[secondProject.id] = secondProject;
    state.labs[state.run.playerLabId]?.projects.projectIds.push(secondProject.id);
    const twoRuns = projectTrainingLossTelemetry(state, content, state.run.playerLabId);
    expect(twoRuns.curves).toHaveLength(2);
    expect(twoRuns.curves[0]?.points).not.toEqual(twoRuns.curves[1]?.points);
  });

  it("spikes a failed run and retains only the latest failed baseline", () => {
    const state = structuredClone(startedTrainingState()) as DeepMutable<GameState>;
    const completed = requireTrainingProject(state);
    if (completed.payload.kind !== "training") throw new Error("unreachable");
    completed.status = "completed";
    completed.createdAt = tick(1);
    completed.payload.weeksElapsed = completed.expectedDurationWeeks;
    completed.progress = 1;

    const olderFailure = structuredClone(completed);
    olderFailure.id = "run:project:player:failed-old" as ProjectId;
    olderFailure.payload.futureModelId = "run:model:player:failed-old" as ModelId;
    olderFailure.status = "failed";
    olderFailure.createdAt = tick(8);
    olderFailure.completionOrder += 1;
    olderFailure.progress = 0.7;
    olderFailure.payload.failureChecks = [
      {
        checkpoint: 0.7,
        checkedAt: tick(9),
        successProbability: 0.4,
        draw: 0.95,
        outcome: "total-loss",
        delayWeeks: 0,
        extraCostMillions: cashMillions(0),
        capabilityPenalty: 0,
      },
    ];

    const latestFailure = structuredClone(olderFailure);
    latestFailure.id = "run:project:player:failed-latest" as ProjectId;
    latestFailure.payload.futureModelId = "run:model:player:failed-latest" as ModelId;
    latestFailure.createdAt = tick(18);
    latestFailure.completionOrder += 1;
    latestFailure.progress = 0.35;
    const olderFailureCheck = latestFailure.payload.failureChecks[0];
    if (olderFailureCheck === undefined) {
      throw new Error("failed-run fixture is missing its terminal check");
    }
    latestFailure.payload.failureChecks = [
      {
        ...olderFailureCheck,
        checkpoint: 0.35,
        checkedAt: tick(19),
      },
    ];
    state.projects[olderFailure.id] = olderFailure;
    state.projects[latestFailure.id] = latestFailure;
    state.labs[state.run.playerLabId]?.projects.projectIds.push(
      olderFailure.id,
      latestFailure.id,
    );

    const withLatestFailure = projectTrainingLossTelemetry(
      state,
      content,
      state.run.playerLabId,
    );
    expect(withLatestFailure.curves.map((curve) => curve.projectId)).toContain(
      latestFailure.id,
    );
    expect(withLatestFailure.curves.map((curve) => curve.projectId)).not.toContain(
      olderFailure.id,
    );
    const failedCurve = withLatestFailure.curves.find(
      (curve) => curve.role === "failed-baseline",
    );
    expect(failedCurve).toMatchObject({
      projectId: latestFailure.id,
      failedAtBasisPoints: 3_500,
    });
    expect(failedCurve?.points.at(-1)?.validationPerplexity).toBeGreaterThan(
      failedCurve?.points.at(-2)?.validationPerplexity ?? Number.POSITIVE_INFINITY,
    );

    latestFailure.status = "completed";
    latestFailure.progress = 1;
    latestFailure.payload.weeksElapsed = latestFailure.expectedDurationWeeks;
    const afterNewerSuccess = projectTrainingLossTelemetry(
      state,
      content,
      state.run.playerLabId,
    );
    expect(
      afterNewerSuccess.curves.some((curve) => curve.role === "failed-baseline"),
    ).toBe(false);
  });

  it("keeps ten successful historical curves and reports the omitted count", () => {
    const state = structuredClone(startedTrainingState()) as DeepMutable<GameState>;
    const original = requireTrainingProject(state);
    if (original.payload.kind !== "training") throw new Error("unreachable");
    original.status = "completed";
    original.progress = 1;
    original.payload.weeksElapsed = original.expectedDurationWeeks;

    for (let index = 1; index < 12; index += 1) {
      const project = structuredClone(original);
      project.id = `run:project:player:success-${String(index)}` as ProjectId;
      project.payload.futureModelId =
        `run:model:player:success-${String(index)}` as ModelId;
      project.createdAt = tick(index + 1);
      project.completionOrder += index;
      state.projects[project.id] = project;
      state.labs[state.run.playerLabId]?.projects.projectIds.push(project.id);
    }

    const telemetry = projectTrainingLossTelemetry(state, content, state.run.playerLabId);
    expect(telemetry.curves).toHaveLength(10);
    expect(telemetry.omittedSuccessfulRuns).toBe(2);
    expect(telemetry.maximumHistoricalRuns).toBe(10);

    const latestFailure = structuredClone(original);
    latestFailure.id = "run:project:player:failure-after-history" as ProjectId;
    latestFailure.payload.futureModelId =
      "run:model:player:failure-after-history" as ModelId;
    latestFailure.status = "failed";
    latestFailure.createdAt = tick(20);
    latestFailure.completionOrder += 20;
    latestFailure.progress = 0.7;
    latestFailure.payload.failureChecks = [
      {
        checkpoint: 0.7,
        checkedAt: tick(21),
        successProbability: 0.4,
        draw: 0.95,
        outcome: "total-loss",
        delayWeeks: 0,
        extraCostMillions: cashMillions(0),
        capabilityPenalty: 0,
      },
    ];
    state.projects[latestFailure.id] = latestFailure;
    state.labs[state.run.playerLabId]?.projects.projectIds.push(latestFailure.id);

    const withLatestFailure = projectTrainingLossTelemetry(
      state,
      content,
      state.run.playerLabId,
    );
    expect(withLatestFailure.curves).toHaveLength(10);
    expect(
      withLatestFailure.curves.filter((curve) => curve.role === "history"),
    ).toHaveLength(9);
    expect(
      withLatestFailure.curves.filter((curve) => curve.role === "failed-baseline"),
    ).toHaveLength(1);
    expect(withLatestFailure.omittedSuccessfulRuns).toBe(3);
  });
});
