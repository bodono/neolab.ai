import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import { effectiveTeraflopsPerGpu, totalFlopInvested } from "../../compute/flops.ts";
import { resolveGpuReservations } from "../../compute/gpu-portfolio.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { ModelId, ModelLineageId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { cashMillions, gpuCount, rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { quoteTrainingRun, startTrainingRun } from "../../training/training.ts";
import {
  activateEligibleQueuedProjects,
  completeReadyProjects,
} from "../../projects/project-framework.ts";
import {
  SAFETY_PRACTICE_DOSSIER_XP_BY_TIER,
  safetyCaseGainForProgramme,
  safetyPracticeProfile,
  safetyPracticeXpForEvaluation,
} from "../safety-practice.ts";
import {
  EVALUATED_CAPABILITY_HIGH_WATER_FLAG,
  EVALUATION_NOVELTY_SPAN,
  EVALUATION_PRACTICE_DOSSIER_CAP_PER_TIER,
  calculateAnomalyDetectionProbability,
  completeEvaluationProject,
  quoteEvaluation,
  startEvaluation,
} from "../evaluations.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

describe("Safety Practice", () => {
  it("turns accumulated practice into visible operational benefits", () => {
    expect(safetyPracticeProfile(0)).toMatchObject({
      level: 1,
      label: "Ad hoc",
      currentThreshold: 0,
      nextThreshold: 2,
      pointsToNextLevel: 2,
      durationMultiplier: 1,
      cashCostMultiplier: 1,
      confidenceRadiusReduction: 0,
      anomalyDetectionBonus: 0,
    });
    expect(safetyPracticeProfile(65)).toMatchObject({
      level: 8,
      label: "Multi-generation safety programme",
      currentThreshold: 57,
      nextThreshold: 77,
      pointsToNextLevel: 12,
      durationMultiplier: 0.7,
      cashCostMultiplier: 0.8,
      confidenceRadiusReduction: 6,
      anomalyDetectionBonus: 0.26,
    });
    expect(safetyPracticeProfile(100)).toMatchObject({
      level: 10,
      label: "Institutional reflex",
      durationMultiplier: 0.6,
      cashCostMultiplier: 0.75,
      confidenceRadiusReduction: 8,
      anomalyDetectionBonus: 0.4,
    });
    expect(safetyPracticeProfile(99).level).toBe(9);
    expect(safetyPracticeProfile(99).pointsToNextLevel).toBe(1);
  });

  it("calibrates maximum practice to two complete tier-5, tier-6, and tier-7 dossiers", () => {
    const ladder = Object.values(content.evaluations.definitions).filter(
      (definition) => definition.playerStartable,
    );
    for (const tier of [5, 6, 7] as const) {
      const realisedDossierXp = ladder.reduce(
        (sum, definition) =>
          sum + safetyPracticeXpForEvaluation(content, definition, tier),
        0,
      );
      expect(realisedDossierXp).toBeCloseTo(SAFETY_PRACTICE_DOSSIER_XP_BY_TIER[tier], 8);
    }
    const target =
      EVALUATION_PRACTICE_DOSSIER_CAP_PER_TIER *
      ((SAFETY_PRACTICE_DOSSIER_XP_BY_TIER[5] ?? 0) +
        (SAFETY_PRACTICE_DOSSIER_XP_BY_TIER[6] ?? 0) +
        (SAFETY_PRACTICE_DOSSIER_XP_BY_TIER[7] ?? 0));
    expect(target).toBe(100);
    expect(EVALUATION_NOVELTY_SPAN).toBe(3);
    expect(SAFETY_PRACTICE_DOSSIER_XP_BY_TIER.slice(0, 5)).toEqual([0, 1, 1, 2, 3]);
  });

  it("improves anomaly detection continuously with permanent practice XP", () => {
    const probabilityAt = (safetyPracticeXp: number): number =>
      calculateAnomalyDetectionProbability({
        anomalySensitivity: 1,
        safetyDanger: 50,
        safetyPracticeXp,
      });

    expect(probabilityAt(0)).toBeCloseTo(0.43, 8);
    expect(probabilityAt(25)).toBeCloseTo(0.47, 8);
    expect(probabilityAt(50)).toBeCloseTo(0.51, 8);
    expect(probabilityAt(75)).toBeCloseTo(0.55, 8);
    expect(probabilityAt(100)).toBeCloseTo(0.59, 8);
  });

  it("keeps false alarms possible without letting practice amplify their streaks", () => {
    const falseAlarmAt = (safetyPracticeXp: number): number =>
      calculateAnomalyDetectionProbability({
        anomalySensitivity: 0.95,
        safetyDanger: 0,
        safetyPracticeXp,
      });
    expect(falseAlarmAt(0)).toBeCloseTo(0.0285, 8);
    expect(falseAlarmAt(100)).toBeCloseTo(falseAlarmAt(0), 8);

    const sensitivities = Object.values(content.evaluations.definitions)
      .filter((definition) => definition.playerStartable)
      .sort((left, right) => left.ladderRung - right.ladderRung)
      .map((definition) => definition.anomalySensitivity);
    const probabilityOfAtLeastFour = (safetyDanger: number): number => {
      let counts = [1, 0, 0, 0, 0, 0];
      for (const anomalySensitivity of sensitivities) {
        const probability = calculateAnomalyDetectionProbability({
          anomalySensitivity,
          safetyDanger,
          safetyPracticeXp: 100,
        });
        const next = [0, 0, 0, 0, 0, 0];
        for (let count = 0; count <= sensitivities.length; count += 1) {
          next[count] = (next[count] ?? 0) + (counts[count] ?? 0) * (1 - probability);
          if (count < sensitivities.length) {
            next[count + 1] = (next[count + 1] ?? 0) + (counts[count] ?? 0) * probability;
          }
        }
        counts = next;
      }
      return (counts[4] ?? 0) + (counts[5] ?? 0);
    };

    expect(probabilityOfAtLeastFour(0)).toBeLessThan(0.00001);
    expect(probabilityOfAtLeastFour(30)).toBeLessThan(0.04);
    expect(probabilityOfAtLeastFour(80)).toBeGreaterThan(0.65);
  });
});

describe("evaluation compute pacing", () => {
  function pacingFixture(): { state: DeepMutable<GameState>; modelId: ModelId } {
    const state = structuredClone(
      addBaselineModelForTest(
        createNewGame(
          {
            seed: seed128("d123456789abcdefd123456789abcdef"),
            difficultyId: contentId("base:difficulty.standard"),
            leaderId: contentId("base:leader.thomas-hassabi"),
            mandateId: contentId("base:mandate.build-the-science"),
          },
          content,
        ),
        content,
      ),
    ) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (lab === undefined || modelId === undefined || model === undefined) {
      throw new Error("pacing fixture missing");
    }
    lab.finance.cash = cashMillions(500);
    // 5% is exactly 2.90304 zettaFLOP: 4.80 PFLOP/s for one week.
    model.investedTotalFlop = 5.80608e22;
    // Keep the fleet deliberately below the one-week rate so the quote must
    // explain the shortfall and choose the first genuinely feasible pace.
    for (const lot of lab.compute.lots) lot.physicalCount = gpuCount(900);
    return { state, modelId };
  }

  it("offers exact one-to-sixteen-week rates for one invariant FLOP bill", () => {
    const { state, modelId } = pacingFixture();
    const quote = quoteEvaluation(state, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
    });

    expect(quote.totalFlop).toBeCloseTo(2.90304e21, -10);
    expect(quote.pacingOptions.map((option) => option.durationWeeks)).toEqual([
      1, 2, 3, 4, 8, 12, 16,
    ]);
    expect(quote.pacingOptions.map((option) => option.requiredTeraflops)).toEqual([
      4800, 2400, 1600, 1200, 600, 400, 300,
    ]);
    expect(quote.pacingOptions[0]?.feasible).toBe(false);
    expect(quote.durationWeeks).toBe(2);
    expect(quote.blockers).toEqual([]);
  });

  it("makes Safety Practice reduce compute-backed audit work", () => {
    const baseline = pacingFixture();
    const baselineQuote = quoteEvaluation(baseline.state, content, {
      labId: baseline.state.run.playerLabId,
      modelId: baseline.modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
    });
    const practiced = pacingFixture();
    const lab = practiced.state.labs[practiced.state.run.playerLabId];
    if (lab === undefined) throw new Error("pacing fixture missing lab");
    lab.safety.practiceXp = rating(100);
    const practicedQuote = quoteEvaluation(practiced.state, content, {
      labId: practiced.state.run.playerLabId,
      modelId: practiced.modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
    });

    expect(practicedQuote.totalFlop).toBeCloseTo(baselineQuote.totalFlop * 0.6, -10);
    expect(practicedQuote.pacingOptions.at(-1)?.requiredTeraflops).toBeLessThan(
      baselineQuote.pacingOptions.at(-1)?.requiredTeraflops ?? 0,
    );
  });

  it("reports compute shortfalls in FLOP/s and reserves a non-lot-rounded mix", () => {
    const { state, modelId } = pacingFixture();
    const blocked = quoteEvaluation(state, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
      durationWeeks: 1,
    });
    expect(blocked.blockers.join(" ")).toMatch(/Requires .*FLOP\/s.*unreserved/);
    expect(blocked.blockers.join(" ")).not.toContain("GPU");

    const tx = createTransaction(state);
    const projectId = startEvaluation(tx, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
      durationWeeks: 2,
    });
    const committed = tx.commit({ description: "start exact-rate evaluation" }).state;
    const reservation = committed.labs[state.run.playerLabId]?.compute.reservations.find(
      (candidate) => candidate.projectId === projectId,
    );
    expect(reservation).toBeDefined();
    expect((reservation?.gpus ?? 0) % 1000).not.toBe(0);
    expect(
      Object.values(reservation?.generationCounts ?? {}).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(reservation?.gpus);
  });

  it("explains when even the sixteen-week audit exceeds the fleet", () => {
    const { state, modelId } = pacingFixture();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("pacing fixture missing lab");
    for (const lot of lab.compute.lots) lot.physicalCount = gpuCount(10);

    const quote = quoteEvaluation(state, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
    });

    expect(quote.blockers.join(" ")).toMatch(
      /This fleet could complete the audit in approximately \d+ weeks; the longest available schedule is 16 weeks/,
    );
  });

  function sharedFleetFixture(): {
    state: DeepMutable<GameState>;
    modelId: ModelId;
    teraflopsPerGpu: number;
  } {
    const { state, modelId } = pacingFixture();
    const lab = state.labs[state.run.playerLabId];
    const model = state.models[modelId];
    const firstLot = lab?.compute.lots[0];
    if (lab === undefined || model === undefined || firstLot === undefined) {
      throw new Error("shared fleet fixture missing");
    }
    const generation = content.gpuGenerations[firstLot.generationId];
    if (generation === undefined) throw new Error("fixture GPU generation missing");
    lab.finance.cash = cashMillions(1_000_000);
    lab.compute.lots = [
      {
        ...firstLot,
        physicalCount: gpuCount(100_000),
      },
    ];
    const teraflopsPerGpu = effectiveTeraflopsPerGpu(
      state,
      state.run.playerLabId,
      generation,
    );
    const definition =
      content.evaluations.definitions[contentId("base:evaluation.alignment-interview")];
    if (definition === undefined || definition.trainingRunFlopFraction <= 0) {
      throw new Error("fixture evaluation definition missing");
    }
    // Make the one-week evaluation pace require exactly 30,000 of the
    // controlled fleet's GPUs. The two-week pace therefore needs 15,000.
    model.investedTotalFlop =
      totalFlopInvested(teraflopsPerGpu * 30_000, 1) / definition.trainingRunFlopFraction;
    return { state, modelId, teraflopsPerGpu };
  }

  it("counts a queued 80k-GPU training run against evaluation pacing", () => {
    const { state, modelId, teraflopsPerGpu } = sharedFleetFixture();
    const trainingTx = createTransaction(state);
    const trainingProjectId = startTrainingRun(trainingTx, content, {
      labId: state.run.playerLabId,
      parentModelId: modelId,
      posture: "normal",
      durationWeeks: 8,
      committedTeraflops: teraflopsPerGpu * 80_000,
    });
    const withTraining = trainingTx.commit({
      description: "reserve 80k GPUs for queued training",
    }).state;
    expect(withTraining.projects[trainingProjectId]?.status).toBe("queued");
    expect(
      withTraining.labs[state.run.playerLabId]?.compute.reservations.find(
        (reservation) => reservation.projectId === trainingProjectId,
      )?.gpus,
    ).toBe(80_000);

    const quote = quoteEvaluation(withTraining, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
    });
    const oneWeek = quote.pacingOptions.find((option) => option.durationWeeks === 1);
    const twoWeeks = quote.pacingOptions.find((option) => option.durationWeeks === 2);
    expect(oneWeek).toMatchObject({ feasible: false });
    expect(oneWeek?.requiredTeraflops).toBeCloseTo(teraflopsPerGpu * 30_000, 6);
    expect(oneWeek?.availableTeraflops).toBeCloseTo(teraflopsPerGpu * 20_000, 6);
    expect(twoWeeks).toMatchObject({ feasible: true });
    expect(twoWeeks?.requiredTeraflops).toBeCloseTo(teraflopsPerGpu * 15_000, 6);
    expect(quote.durationWeeks).toBe(2);

    const blockedFastPace = quoteEvaluation(withTraining, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
      durationWeeks: 1,
    });
    expect(blockedFastPace.blockers.join(" ")).toMatch(
      /Requires .*FLOP\/s.*currently unreserved/,
    );
  });

  it("counts a queued 30k-GPU evaluation against the training ceiling", () => {
    const { state, modelId, teraflopsPerGpu } = sharedFleetFixture();
    const evaluationTx = createTransaction(state);
    const evaluationProjectId = startEvaluation(evaluationTx, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
      durationWeeks: 1,
    });
    const withEvaluation = evaluationTx.commit({
      description: "reserve 30k GPUs for queued evaluation",
    }).state;
    expect(withEvaluation.projects[evaluationProjectId]?.status).toBe("queued");
    expect(
      withEvaluation.labs[state.run.playerLabId]?.compute.reservations.find(
        (reservation) => reservation.projectId === evaluationProjectId,
      )?.gpus,
    ).toBe(30_000);

    const blockedTraining = quoteTrainingRun(withEvaluation, content, {
      labId: state.run.playerLabId,
      parentModelId: modelId,
      posture: "normal",
      durationWeeks: 8,
      committedTeraflops: teraflopsPerGpu * 80_000,
    });
    expect(blockedTraining.availableTeraflops).toBeCloseTo(teraflopsPerGpu * 70_000, 6);
    expect(blockedTraining.blockers.join(" ")).toMatch(
      /Commitment .* exceeds .* unreserved fleet compute/,
    );

    const fittedTraining = quoteTrainingRun(withEvaluation, content, {
      labId: state.run.playerLabId,
      parentModelId: modelId,
      posture: "normal",
      durationWeeks: 8,
      committedTeraflops: teraflopsPerGpu * 70_000,
    });
    expect(fittedTraining.blockers).toEqual([]);
    expect(fittedTraining.reservedPhysicalGpus).toBe(70_000);
  });

  it("reuses GPU capacity across an evaluation ladder that must run sequentially", () => {
    const { state, modelId } = sharedFleetFixture();
    const firstTx = createTransaction(state);
    const interviewProjectId = startEvaluation(firstTx, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.alignment-interview"),
      durationWeeks: 1,
    });
    const withInterview = firstTx.commit({
      description: "queue evaluation prerequisite",
    }).state;

    const redTeamQuote = quoteEvaluation(withInterview, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.behavioural-red-team"),
      durationWeeks: 1,
    });
    expect(redTeamQuote.blockers).toEqual([]);

    const secondTx = createTransaction(withInterview);
    const redTeamProjectId = startEvaluation(secondTx, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.behavioural-red-team"),
      durationWeeks: 1,
    });
    const autonomyQuote = quoteEvaluation(secondTx.read(), content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.sandboxed-autonomy-trial"),
      durationWeeks: 2,
    });
    expect(autonomyQuote.blockers).toEqual([]);
    const autonomyProjectId = startEvaluation(secondTx, content, {
      labId: state.run.playerLabId,
      modelId,
      definitionId: contentId("base:evaluation.sandboxed-autonomy-trial"),
      durationWeeks: 2,
    });
    activateEligibleQueuedProjects(secondTx, content);
    const queued = secondTx.commit({
      description: "queue dependent evaluation",
    }).state;

    expect(queued.projects[interviewProjectId]?.status).toBe("active");
    expect(queued.projects[redTeamProjectId]?.status).toBe("queued");
    expect(queued.projects[autonomyProjectId]?.status).toBe("queued");
    const interviewGpus =
      queued.labs[state.run.playerLabId]?.compute.reservations.find(
        (reservation) => reservation.projectId === interviewProjectId,
      )?.gpus ?? 0;
    const redTeamGpus =
      queued.labs[state.run.playerLabId]?.compute.reservations.find(
        (reservation) => reservation.projectId === redTeamProjectId,
      )?.gpus ?? 0;
    const autonomyGpus =
      queued.labs[state.run.playerLabId]?.compute.reservations.find(
        (reservation) => reservation.projectId === autonomyProjectId,
      )?.gpus ?? 0;
    const committed = resolveGpuReservations(
      queued,
      content,
      state.run.playerLabId,
      "committed",
    );
    expect(committed.unmetPhysicalGpus).toBe(0);
    expect(committed.reservedPhysicalGpus).toBe(
      Math.max(interviewGpus, redTeamGpus, autonomyGpus),
    );
  });
});

function evaluationFixture(): { state: DeepMutable<GameState>; modelId: ModelId } {
  const state = structuredClone(
    addBaselineModelForTest(
      createNewGame(
        {
          seed: seed128("c123456789abcdefc123456789abcdef"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (lab === undefined || modelId === undefined || model === undefined) {
    throw new Error("fixture missing");
  }
  if (model.measuredCapability === undefined) {
    throw new Error("fixture lacks measured capability");
  }
  model.trueCapability = {
    language: rating(65),
    reasoning: rating(65),
    agency: rating(65),
    toolUse: rating(65),
    multimodality: rating(65),
    scientificAbility: rating(65),
    embodiment: rating(65),
  };
  model.measuredCapability.values = { ...model.trueCapability };
  model.measuredCapability.frontierCapability = rating(65);
  lab.finance.cash = cashMillions(500);
  // The ladder's upper rungs reserve more GPUs than a starting fleet holds --
  // deliberately, since caution competes with training for the same silicon.
  // This lab has bought its way clear of that constraint.
  for (const lot of lab.compute.lots) lot.physicalCount = gpuCount(20_000);
  return { state, modelId };
}

function runRung(state: GameState, modelId: ModelId, draftId: string): GameState {
  const tx = createTransaction(state);
  const projectId = startEvaluation(tx, content, {
    labId: state.run.playerLabId,
    modelId,
    definitionId: contentId(draftId),
  });
  tx.update((draft) => {
    const project = draft.projects[projectId];
    if (project === undefined) throw new Error("evaluation project missing");
    project.status = "active";
    project.startedAt = draft.run.tick;
    project.progress = 1;
  });
  completeEvaluationProject(tx, content, projectId);
  tx.update((draft) => {
    const project = draft.projects[projectId];
    if (project === undefined) throw new Error("evaluation project missing");
    project.status = "completed";
  });
  return tx.commit({ description: `complete ${draftId}` }).state;
}

function addNovelEvaluationModel(
  state: GameState,
  sourceModelId: ModelId,
  suffix: string,
  frontierCapability: number,
): { state: DeepMutable<GameState>; modelId: ModelId } {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const source = draft.models[sourceModelId];
  const lab = draft.labs[draft.run.playerLabId];
  if (
    source === undefined ||
    lab === undefined ||
    source.measuredCapability === undefined
  ) {
    throw new Error("evaluation model fixture missing");
  }
  const modelId = `run:model:player:practice-${suffix}` as ModelId;
  const capability = {
    language: rating(frontierCapability),
    reasoning: rating(frontierCapability),
    agency: rating(frontierCapability),
    toolUse: rating(frontierCapability),
    multimodality: rating(frontierCapability),
    scientificAbility: rating(frontierCapability),
    embodiment: rating(frontierCapability),
  };
  draft.models[modelId] = {
    ...structuredClone(source),
    id: modelId,
    lineageId: modelId as unknown as ModelLineageId,
    displayName: `Practice-${suffix}`,
    trueCapability: capability,
    measuredCapability: {
      ...structuredClone(source.measuredCapability),
      values: { ...capability },
      frontierCapability: rating(frontierCapability),
    },
    evaluations: [],
    anomalies: [],
    flags: {},
  };
  lab.models.modelIds.push(modelId);
  lab.models.currentModelId = modelId;
  return { state: draft, modelId };
}

describe("the evaluation ladder pays XP for novelty, not repetition", () => {
  it("queues one celebratory milestone when permanent practice crosses a level", () => {
    const { state, modelId } = evaluationFixture();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("lab missing");
    lab.safety.practiceXp = rating(1.5);

    const completed = runRung(state, modelId, "base:evaluation.alignment-interview");
    const evaluation = Object.values(completed.evaluations).find(
      (record) => record.modelId === modelId,
    );
    if (evaluation === undefined) throw new Error("evaluation missing");

    expect(
      completed.presentationQueue.filter((item) => item.kind === "safety-practice-level"),
    ).toEqual([
      {
        key: `safety-practice-level:${evaluation.id}:2`,
        kind: "safety-practice-level",
        attention: "modal",
        evaluationId: evaluation.id,
        definitionId: contentId("base:evaluation.alignment-interview"),
        modelId,
        fromLevel: 1,
        toLevel: 2,
        previousPracticeXp: 1.5,
        newPracticeXp: 2.24,
        practiceXpGained: 0.74,
        createdAt: state.run.tick,
      },
    ]);
  });

  it("does not interrupt play when an evaluation adds XP without crossing a level", () => {
    const { state, modelId } = evaluationFixture();
    const completed = runRung(state, modelId, "base:evaluation.alignment-interview");

    expect(
      completed.presentationQueue.some((item) => item.kind === "safety-practice-level"),
    ).toBe(false);
  });

  it("locks a model's novelty at its first rung and pays every later rung on it", () => {
    const { state, modelId } = evaluationFixture();
    const frontier = state.models[modelId]?.measuredCapability?.frontierCapability ?? 0;
    const fraction = Math.min(1, frontier / EVALUATION_NOVELTY_SPAN);
    expect(fraction).toBe(1);

    const before = state.labs[state.run.playerLabId]?.safety.practiceXp ?? 0;
    const evaluationQualityBefore =
      state.labs[state.run.playerLabId]?.safety.evalQuality ?? 0;
    const afterInterview = runRung(state, modelId, "base:evaluation.alignment-interview");
    const interviewDefinition =
      content.evaluations.definitions[contentId("base:evaluation.alignment-interview")];
    if (interviewDefinition === undefined) throw new Error("definition missing");
    const interviewGain =
      (afterInterview.labs[state.run.playerLabId]?.safety.practiceXp ?? 0) - before;
    expect(interviewGain).toBe(
      safetyPracticeXpForEvaluation(content, interviewDefinition, 5),
    );
    expect(afterInterview.labs[state.run.playerLabId]?.safety.evalQuality).toBe(
      evaluationQualityBefore,
    );

    // The second rung pays its own larger XP at the SAME locked fraction --
    // the high-water moved at rung one, but this model's climb was priced
    // when it began.
    const afterRedTeam = runRung(
      afterInterview,
      modelId,
      "base:evaluation.behavioural-red-team",
    );
    const redTeamDefinition =
      content.evaluations.definitions[contentId("base:evaluation.behavioural-red-team")];
    if (redTeamDefinition === undefined) throw new Error("definition missing");
    const redTeamGain =
      (afterRedTeam.labs[state.run.playerLabId]?.safety.practiceXp ?? 0) -
      (afterInterview.labs[state.run.playerLabId]?.safety.practiceXp ?? 0);
    expect(redTeamGain).toBeCloseTo(
      safetyPracticeXpForEvaluation(content, redTeamDefinition, 5),
      8,
    );

    // The grant is recorded on the report, not recomputed later.
    const records = Object.values(afterRedTeam.evaluations);
    expect(records.map((record) => record.practiceXpGranted).sort()).toContain(
      safetyPracticeXpForEvaluation(content, redTeamDefinition, 5),
    );
  });

  it("enforces the climb: a rung cannot be planned before the one below", () => {
    const { state, modelId } = evaluationFixture();
    const tx = createTransaction(state);
    expect(() =>
      startEvaluation(tx, content, {
        labId: state.run.playerLabId,
        modelId,
        definitionId: contentId("base:evaluation.behavioural-red-team"),
      }),
    ).toThrow(/planned in order/);
  });

  it("queues the full ladder but runs each rung only after its prerequisite reports", () => {
    const { state, modelId } = evaluationFixture();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("lab missing");
    lab.finance.cash = cashMillions(1_000_000);
    lab.aura.spendable = 100;
    for (const lot of lab.compute.lots) lot.physicalCount = gpuCount(1_000_000);

    const definitionIds = [
      "base:evaluation.alignment-interview",
      "base:evaluation.behavioural-red-team",
      "base:evaluation.sandboxed-autonomy-trial",
      "base:evaluation.interpretability-audit",
      "base:evaluation.external-audit",
    ].map(contentId);
    const tx = createTransaction(state);
    const projectIds = definitionIds.map((definitionId) =>
      startEvaluation(tx, content, {
        labId: state.run.playerLabId,
        modelId,
        definitionId,
      }),
    );

    activateEligibleQueuedProjects(tx, content, [state.run.playerLabId]);
    expect(projectIds.map((id) => tx.read().projects[id]?.status)).toEqual([
      "active",
      "queued",
      "queued",
      "queued",
      "queued",
    ]);

    for (let index = 0; index < projectIds.length; index += 1) {
      const projectId = projectIds[index];
      if (projectId === undefined) throw new Error("project missing");
      tx.update((draft) => {
        const project = draft.projects[projectId];
        if (project === undefined) throw new Error("evaluation project missing");
        project.progress = 1;
      });
      completeReadyProjects(tx, content);
      activateEligibleQueuedProjects(tx, content, [state.run.playerLabId]);

      const nextProjectId = projectIds[index + 1];
      if (nextProjectId !== undefined) {
        expect(tx.read().projects[nextProjectId]?.status).toBe("active");
      }
      for (const laterProjectId of projectIds.slice(index + 2)) {
        expect(tx.read().projects[laterProjectId]?.status).toBe("queued");
      }
    }

    expect(projectIds.map((id) => tx.read().projects[id]?.status)).toEqual(
      Array.from({ length: projectIds.length }, () => "completed"),
    );
    expect(
      Object.values(tx.read().evaluations).filter(
        (evaluation) => evaluation.modelId === modelId,
      ),
    ).toHaveLength(definitionIds.length);
  });

  it("pays nothing for a model no more capable than one already examined", () => {
    const { state, modelId } = evaluationFixture();
    const lab = state.labs[state.run.playerLabId];
    const frontier = state.models[modelId]?.measuredCapability?.frontierCapability ?? 0;
    if (lab === undefined) throw new Error("lab missing");
    // As if an equally capable model had already been through the ladder.
    lab.flags[EVALUATED_CAPABILITY_HIGH_WATER_FLAG] = frontier;

    const before = lab.safety.practiceXp ?? 0;
    const climbed = runRung(state, modelId, "base:evaluation.alignment-interview");
    expect(climbed.labs[state.run.playerLabId]?.safety.practiceXp ?? 0).toBe(before);
  });

  it("caps each capability tier at two full-dossier-equivalent grants", () => {
    const first = evaluationFixture();
    const afterFirst = runRung(
      first.state,
      first.modelId,
      "base:evaluation.alignment-interview",
    );
    const second = addNovelEvaluationModel(afterFirst, first.modelId, "second", 68);
    const afterSecond = runRung(
      second.state,
      second.modelId,
      "base:evaluation.alignment-interview",
    );
    const third = addNovelEvaluationModel(afterSecond, second.modelId, "third", 71);
    const afterThird = runRung(
      third.state,
      third.modelId,
      "base:evaluation.alignment-interview",
    );
    const firstRung =
      content.evaluations.definitions[contentId("base:evaluation.alignment-interview")];
    if (firstRung === undefined) throw new Error("definition missing");
    const fullGrant = safetyPracticeXpForEvaluation(content, firstRung, 5);

    expect(afterFirst.labs[first.state.run.playerLabId]?.safety.practiceXp).toBe(
      fullGrant,
    );
    expect(afterSecond.labs[first.state.run.playerLabId]?.safety.practiceXp).toBe(
      fullGrant * 2,
    );
    expect(afterThird.labs[first.state.run.playerLabId]?.safety.practiceXp).toBe(
      fullGrant * 2,
    );
    const thirdReport = Object.values(afterThird.evaluations).find(
      (evaluation) => evaluation.modelId === third.modelId,
    );
    expect(thirdReport?.practiceXpGranted).toBe(0);
  });
});

describe("model Safety Case", () => {
  it("rewards each increasingly expensive ladder rung more than the last", () => {
    expect(safetyCaseGainForProgramme("alignment-interpretability", 0)).toBe(5);
    expect(safetyCaseGainForProgramme("alignment-interpretability", 1)).toBe(10);
    expect(safetyCaseGainForProgramme("autonomy-containment", 0)).toBe(20);
    expect(safetyCaseGainForProgramme("alignment-interpretability", 2)).toBe(25);
    expect(safetyCaseGainForProgramme("independent-audit", 0)).toBe(30);
    expect(safetyCaseGainForProgramme("independent-audit", 1)).toBe(0);
  });

  it("caps routine ladder coverage at 90 before warning-signal investigations", () => {
    const ladderTotal =
      safetyCaseGainForProgramme("alignment-interpretability", 0) +
      safetyCaseGainForProgramme("alignment-interpretability", 1) +
      safetyCaseGainForProgramme("autonomy-containment", 0) +
      safetyCaseGainForProgramme("alignment-interpretability", 2) +
      safetyCaseGainForProgramme("independent-audit", 0);

    expect(ladderTotal).toBe(90);
  });
});
