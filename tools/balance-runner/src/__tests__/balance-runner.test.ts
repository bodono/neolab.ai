import { TRAINING_SAMPLE_WEEKS } from "../available-commands.ts";
import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import {
  contentId,
  type CompiledContent,
  type EventDefinition,
} from "@neolab/content-schema";
import {
  addBaselineModelForTest,
  applyCommand,
  cashMillions,
  createNewGame,
  fraction,
  projectGameView,
  rating,
  seed128,
  tick,
  type CommandId,
  type DeepMutable,
  type GameCommand,
  type GameState,
  type LabId,
} from "@neolab/sim";

import { listAvailableCommands } from "../available-commands.ts";
import { INITIAL_POLICIES, hasObservedSevereCandidateEvidence } from "../policies.ts";
import { mergeBalanceReports } from "../aggregate.ts";
import {
  dimensionSummaryCsv,
  eventSummaryCsv,
  policySummaryCsv,
  resourceCurvesCsv,
  runSummaryCsv,
  targetSummaryCsv,
} from "../report.ts";
import {
  buildRunSpecifications,
  isHumanDecisionCommand,
  replayBalanceRun,
  rivalCandidateOutcomes,
  runBalanceBatch,
  stalledEndgameStages,
} from "../runner.ts";
import type { AvailableCommandView, PolicyView } from "../types.ts";

const content = loadCompiledContent();
const LONG_HORIZON_TEST_TIMEOUT_MS = 90_000;
// The two canonical-trajectory canaries each simulate 900-1160 weeks of a
// single run; roughly two minutes apiece on a busy machine.
const CANONICAL_TRAJECTORY_TIMEOUT_MS = 300_000;

describe("human decision accounting", () => {
  it("counts v2 endgame choices but not the automatic world-waiting reveal", () => {
    const v2Decisions = [
      "nominate-candidate",
      "commit-capability-proof",
      "commit-candidate-safety-response",
      "resolve-pressure-collision",
      "enter-final-review",
      "choose-deployment-mode",
      "resolve-rollout-decision",
      "resolve-containment-failure",
      "configure-candidate-retirement",
      "transmit-candidate-retirement",
      "resolve-candidate-incident",
      "choose-post-retirement-path",
      "choose-false-dawn-path",
      "transmit-deployment",
    ];
    for (const kind of v2Decisions) {
      expect(isHumanDecisionCommand({ kind }), kind).toBe(true);
    }
    expect(isHumanDecisionCommand({ kind: "advance-world-waiting" })).toBe(false);
    expect(isHumanDecisionCommand({ kind: "start-evaluation" })).toBe(false);
  });
});

describe("rival candidacy outcome accounting", () => {
  it("distinguishes starts, setbacks, delays, and terminal rival outcomes", () => {
    const created = createNewGame(
      {
        seed: seed128("00000000000000000000000000000001"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-it-right"),
      },
      content,
    );
    const rivalLabId = Object.keys(created.world.rivals)[0] as LabId | undefined;
    if (rivalLabId === undefined) throw new Error("rival fixture missing");
    const state = structuredClone(
      addBaselineModelForTest(created, content, rivalLabId),
    ) as DeepMutable<GameState>;
    const modelId = state.labs[rivalLabId]?.models.modelIds[0];
    if (modelId === undefined) throw new Error("rival model fixture missing");
    const model = state.models[modelId];
    if (model === undefined) throw new Error("rival model state missing");
    state.lineageSIRecords[model.lineageId] = {
      lineageId: model.lineageId,
      superintelligenceTruth: "not-genuine",
      probabilityAtFirstCrossing: fraction(0.325),
      randomKey: "fixture/balance-rival-prior",
      draw: fraction(0.9),
      firstQualifyingModelId: model.id,
      firstQualifyingFrontierCapability: rating(94),
      firstQualifyingWeek: tick(9),
      rulesVersion: state.engineRulesVersion,
    };
    const entries = [
      [10, `rival-candidate:${rivalLabId}:${modelId}`],
      [15, `rival-candidate-incident:${rivalLabId}:${modelId}:1`],
      [20, `rival-candidate-delayed:${rivalLabId}:${modelId}:1`],
      [30, `rival-false-dawn:${rivalLabId}:${modelId}`],
      [40, `rival-candidate-contained:${rivalLabId}:${modelId}`],
      [50, "base:ending.rival-ascendance"],
      [60, "base:ending.the-door-opened-elsewhere"],
    ] as const;
    state.decisionLog.push(
      ...entries.map(([at, id]) => ({
        tick: tick(at),
        summary: id,
        category: "narrative" as const,
        source: { kind: "system" as const, id },
        relatedIds: [rivalLabId, modelId],
      })),
    );

    expect(rivalCandidateOutcomes(state)).toMatchObject({
      countdownStarts: 1,
      uniqueCandidateArtifacts: 1,
      countdownClosures: 5,
      resolutionAttempts: 6,
      terminalDeployments: 2,
      containmentIncidents: 1,
      falseDawns: 1,
      emergencyContainments: 1,
      deploymentDelays: 1,
      successfulDeployments: 1,
      catastrophes: 1,
      activeCountdownsAtEnd: 0,
      candidatePriorSamples: 1,
      firstQualifyingCapabilityMin: 94,
      firstQualifyingCapabilityMean: 94,
      firstQualifyingCapabilityMax: 94,
      superintelligencePriorMean: 0.325,
      guaranteedGenuineCandidates: 0,
      notGenuineCandidates: 1,
      firstCountdownStartedAt: 10,
      firstResolvedAt: 15,
      lastResolvedAt: 60,
    });
  });
});

describe("endgame policy coverage", () => {
  it("enumerates and groups both mandatory False Dawn futures", () => {
    const initial = addBaselineModelForTest(
      createNewGame(
        {
          seed: seed128("00000000000000000000000000000001"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-it-right"),
        },
        content,
      ),
      content,
    );
    const prepared = structuredClone(initial) as DeepMutable<GameState>;
    const modelId = prepared.labs[prepared.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : prepared.models[modelId];
    if (modelId === undefined || model === undefined) {
      throw new Error("False Dawn balance fixture is missing its model");
    }
    const presentationKey = `endgame-return:base:ending.false-dawn:${modelId}:0`;
    prepared.endgameHistory.pendingFalseDawnChoice = {
      presentationKey,
      phase: "choice",
      modelId,
      cooldownUntil: tick(52),
      crisisWeeksSpent: 8,
      // The runner and command validator intentionally inspect only the durable
      // choice identity. The privileged crisis audit is exercised in sim tests.
      // The one exception is the moratorium forecast on the endgame-return
      // presentation, which reads observed reviewer independence off this
      // record, so that field has to be real rather than cast away.
      crisisBase: { evidence: { reviewerIndependence: 0 } } as DeepMutable<
        NonNullable<GameState["endgameHistory"]["pendingFalseDawnChoice"]>["crisisBase"]
      >,
      rolloutAudit: {} as DeepMutable<
        NonNullable<GameState["endgameHistory"]["pendingFalseDawnChoice"]>["rolloutAudit"]
      >,
    };
    prepared.presentationQueue.push({
      key: presentationKey,
      kind: "endgame-return",
      attention: "modal",
      endingId: contentId("base:ending.false-dawn"),
      modelId,
      createdAt: prepared.run.tick,
      cooldownUntil: tick(52),
      crisisWeeksSpent: 8,
    });

    const commandsFor = (policyId: PolicyView["policyId"]) =>
      listAvailableCommands(prepared, content, policyId).filter(
        (
          candidate,
        ): candidate is AvailableCommandView & {
          readonly command: Extract<
            GameCommand,
            { readonly kind: "choose-false-dawn-path" }
          >;
        } => candidate.command.kind === "choose-false-dawn-path",
      );
    const balanced = INITIAL_POLICIES.find((policy) => policy.id === "balanced");
    const safety = INITIAL_POLICIES.find((policy) => policy.id === "safety-institution");
    if (balanced === undefined || safety === undefined) {
      throw new Error("False Dawn policy fixtures are missing");
    }

    const balancedAvailable = commandsFor(balanced.id);
    expect(balancedAvailable.map((candidate) => candidate.command.path).sort()).toEqual([
      "durable-moratorium",
      "successor-programme",
    ]);
    expect(
      balanced.decide(
        {
          game: projectGameView(prepared, content, {
            viewerLabId: prepared.run.playerLabId,
            intelligenceRatings: {},
            evidenceAccess: { evaluationIds: [], anomalyIds: [] },
          }),
          seed: prepared.run.seed,
          policyId: balanced.id,
        },
        balancedAvailable,
      ),
    ).toMatchObject([{ kind: "choose-false-dawn-path", path: "successor-programme" }]);

    const safetyAvailable = commandsFor(safety.id);
    expect(
      safety.decide(
        {
          game: projectGameView(prepared, content, {
            viewerLabId: prepared.run.playerLabId,
            intelligenceRatings: {},
            evidenceAccess: { evaluationIds: [], anomalyIds: [] },
          }),
          seed: prepared.run.seed,
          policyId: safety.id,
        },
        safetyAvailable,
      ),
    ).toMatchObject([{ kind: "choose-false-dawn-path", path: "durable-moratorium" }]);

    const failedChoice = prepared.endgameHistory.pendingFalseDawnChoice;
    if (failedChoice === undefined) throw new Error("False Dawn choice disappeared");
    failedChoice.phase = "moratorium-failed";
    const failedAvailable = commandsFor(safety.id);
    expect(failedAvailable.map((candidate) => candidate.command.path)).toEqual([
      "successor-programme",
    ]);
    expect(
      safety.decide(
        {
          game: projectGameView(prepared, content, {
            viewerLabId: prepared.run.playerLabId,
            intelligenceRatings: {},
            evidenceAccess: { evaluationIds: [], anomalyIds: [] },
          }),
          seed: prepared.run.seed,
          policyId: safety.id,
        },
        failedAvailable,
      ),
    ).toMatchObject([{ kind: "choose-false-dawn-path", path: "successor-programme" }]);

    prepared.presentationQueue = [];
    expect(commandsFor(balanced.id)).toEqual([]);
  });

  it("conditions cautious retirement on player-visible severe evidence", () => {
    const view = (overall: "Concerning" | "Mixed") =>
      ({
        game: {
          endgame: {
            active: true,
            stageActions: {
              kind: "evidence-sprint",
              dossier: { overall, findings: [] },
            },
          },
          models: { candidateCustody: { artifacts: [] } },
        },
      }) as unknown as PolicyView;

    expect(hasObservedSevereCandidateEvidence(view("Concerning"))).toBe(true);
    expect(hasObservedSevereCandidateEvidence(view("Mixed"))).toBe(false);

    const confirmedSignal = {
      game: {
        endgame: { active: true, stageActions: { kind: "confirmation" } },
        models: {
          candidateCustody: {
            artifacts: [
              {
                lastReviewedSignal: { outcome: "confirmed-safety-signal" },
              },
            ],
          },
        },
      },
    } as unknown as PolicyView;
    expect(hasObservedSevereCandidateEvidence(confirmedSignal)).toBe(true);
  });

  it("lets the commercial policy exercise the narrow prosperity route", () => {
    const policy = INITIAL_POLICIES.find((candidate) => candidate.id === "commercial");
    if (policy === undefined) throw new Error("commercial policy missing");
    const seed = seed128("00000000000000000000000000000001");
    const state = addBaselineModelForTest(
      createNewGame(
        {
          seed,
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-it-right"),
        },
        content,
      ),
      content,
    );
    const labId = state.run.playerLabId;
    const modelId = state.labs[labId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("player model missing");
    const projected = projectGameView(state, content, {
      viewerLabId: labId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const meta = (id: string) => ({
      commandId: `test:${id}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    });
    const available: readonly AvailableCommandView[] = [
      {
        id: "route:narrow",
        category: "deployment",
        command: {
          kind: "choose-deployment-mode",
          meta: meta("narrow"),
          labId,
          modeId: "narrow-prosperity-mission",
          confirmationText: "AUTHORISE PROSPERITY MISSION",
        },
        summary: "Narrow prosperity mission",
        tags: ["mandatory", "commercial"],
        cashCostMillions: 0,
        cashGainMillions: 0,
      },
      {
        id: "route:adaptive",
        category: "deployment",
        command: {
          kind: "choose-deployment-mode",
          meta: meta("adaptive"),
          labId,
          modeId: "adaptive-monitored-rollout",
          confirmationText: "AUTHORISE MONITORED ROLLOUT",
        },
        summary: "Adaptive monitored rollout",
        tags: ["mandatory", "safety"],
        cashCostMillions: 0,
        cashGainMillions: 0,
      },
      {
        id: "deploy-now",
        category: "deployment",
        command: {
          kind: "transmit-deployment",
          meta: meta("deploy-now"),
          labId,
          modelId,
          confirmationText: "DEPLOY TEST",
        },
        summary: "Deploy now",
        tags: ["aggressive"],
        cashCostMillions: 0,
        cashGainMillions: 0,
      },
    ];
    const decision = policy.decide(
      {
        game: { ...projected, endgame: { active: true } },
        seed,
        policyId: policy.id,
      } as unknown as PolicyView,
      available,
    );
    expect(decision).toHaveLength(1);
    expect(decision[0]).toMatchObject({
      kind: "choose-deployment-mode",
      modeId: "narrow-prosperity-mission",
    });
  });
});

describe("endgame stage stall accounting", () => {
  it("uses stage-specific allowances and ignores long but valid recovery", () => {
    expect(
      stalledEndgameStages({
        "candidate-activation": 2,
        confirmation: 40,
        recovery: 70,
        "world-waiting": 1,
      }),
    ).toEqual(["candidate-activation", "world-waiting"]);
  });
});

function request() {
  return {
    seeds: [seed128("00000000000000000000000000000001")],
    difficultyIds: [contentId("base:difficulty.standard")],
    leaderIds: [contentId("base:leader.thomas-hassabi")],
    mandateIds: [contentId("base:mandate.build-it-right")],
    policies: INITIAL_POLICIES,
    maxTicks: 12,
    traceSampleRate: 1,
    matrixMode: "paired" as const,
    content,
  };
}

describe("runBalanceBatch", () => {
  // Runs 20 full simulations; shares worker CPU with the rest of the suite.
  it(
    "runs every required policy through the real simulation deterministically",
    { timeout: LONG_HORIZON_TEST_TIMEOUT_MS },
    async () => {
      const first = await runBalanceBatch(request());
      const second = await runBalanceBatch(request());

      expect(first.runCount).toBe(10);
      expect(first.policySummaries.map((summary) => summary.policyId)).toEqual([
        "balanced",
        "capability-first",
        "coalition-builder",
        "commercial",
        "never-fund-serving",
        "never-train-model",
        "open-science",
        "random-legal",
        "safety-institution",
        "secretive-proprietary",
      ]);
      expect(first.runs).toEqual(second.runs);
      expect(first.runs.every((run) => run.rejectedPolicyCommands === 0)).toBe(true);
      expect(first.reportFormat).toBe(2);
      expect(first.content.hash).toBe(content.manifest.bundleHash);
      expect(first.matrix.totalConfigurations).toBe(10);
      expect(first.endingOutcomes).toEqual({
        "player-victory": 0,
        "non-extinction-loss": 0,
        "human-extinction": 0,
        incomplete: 10,
      });
      expect(first.rivalCompetitiveness).toMatchObject({
        frontierEntrySamples: 0,
        atLeastTwoPlausibleRate: null,
      });
      expect(
        first.runs.every(
          (run) =>
            run.rivalCompetitiveness.plausibilityMeasurement === "run-end-fallback",
        ),
      ).toBe(true);

      const sampled = first.runs[0];
      if (sampled?.replay === undefined) throw new Error("sampled replay missing");
      expect(
        replayBalanceRun(
          sampled,
          sampled.replay.commands,
          content,
          first.requestedMaxTicks,
        ),
      ).toBe(sampled.replay.finalStateHash);
    },
  ); // Two full ten-policy batches plus replay verification exceed 5 s in CI;
  // the options-object timeout above governs.

  it("exports stable policy and run CSV schemas", async () => {
    const report = await runBalanceBatch(request());
    expect(policySummaryCsv(report)).toContain("player_world_first_share");
    expect(runSummaryCsv(report)).toContain("plausible_rival_count");
    expect(runSummaryCsv(report)).toContain("rival_false_dawns");
    expect(runSummaryCsv(report)).toContain("ending_outcome");
    expect(runSummaryCsv(report).split("\n")).toHaveLength(12);
    expect(dimensionSummaryCsv(report)).toContain("mean_estimated_real_minutes");
    expect(resourceCurvesCsv(report)).toContain("mean_physical_gpus");
    expect(targetSummaryCsv(report)).toContain("harness.minimum-seeded-runs");
    expect(targetSummaryCsv(report)).toContain("ending.human-extinction");
  });

  it("does not oversubscribe major-project capacity while fundraising and productising", async () => {
    const policies = INITIAL_POLICIES.filter(
      (policy) => policy.id === "capability-first" || policy.id === "never-fund-serving",
    );
    const report = await runBalanceBatch({
      ...request(),
      policies,
      maxTicks: 104,
      traceSampleRate: 0,
    });

    expect(report.runs).toHaveLength(2);
    expect(report.runs.every((run) => run.rejectedPolicyCommands === 0)).toBe(true);
  }, 15_000);

  it("buys its way out of the insolvency trap in the opening weeks", async () => {
    // Aura is a hard gate on fundraising, and before customers or papers the
    // only recurring source is a standing-income building. A lab that never
    // builds one reaches a state where it cannot raise, cannot spend and cannot
    // recover.
    //
    // The bound is what the two competing invariants leave room for. The rule
    // first lived in the training-priority block, gated on newestModel, and
    // fired around tick 44 -- long after the tick-88 insolvencies it exists to
    // prevent. Moved ahead of everything it fired at tick 1 and broke the older
    // rule that every lab trains something before starting optional projects.
    // It now fires as soon as the bootstrap run is under way, landing near tick
    // 18: after the commitment to a first model, and with the whole danger
    // window still ahead of it.
    const policies = INITIAL_POLICIES.filter(
      (policy) => policy.id === "capability-first" || policy.id === "never-fund-serving",
    );
    const report = await runBalanceBatch({
      ...request(),
      policies,
      maxTicks: 52,
      traceSampleRate: 0,
    });

    for (const run of report.runs) {
      const pressOffice = run.facilities.find(
        (facility) => facility.definitionId === "base:facility.press-office",
      );
      expect(pressOffice).toBeDefined();
      expect(pressOffice?.completedAt).toBeLessThanOrEqual(26);
    }
  }, 20_000);

  it("uses frontier-scale training and durable procurement after Foundation", () => {
    const policy = INITIAL_POLICIES.find(
      (candidate) => candidate.id === "capability-first",
    );
    if (policy === undefined) throw new Error("capability-first policy missing");

    const seed = seed128("00000000000000000000000000000001");
    const state = addBaselineModelForTest(
      createNewGame(
        {
          seed,
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-it-right"),
        },
        content,
      ),
      content,
    );
    const lab = state.labs[state.run.playerLabId];
    const parentModelId = lab?.models.currentModelId;
    if (lab === undefined || parentModelId === undefined) {
      throw new Error("opening player model missing");
    }
    const projected = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const gameAt = (tick: number) => ({
      ...projected,
      meta: {
        ...projected.meta,
        tick,
        calendar: { year: 2016, week: 2 },
        phase: "scaling" as const,
      },
      models: {
        ...projected.models,
        currentModelId: parentModelId,
        commercialModelId: parentModelId,
        cards: projected.models.cards.map((card) => ({
          ...card,
          generationIndex: 1,
          trainedAtTick: 0,
          isCurrentModel: true,
          isCommercialModel: true,
        })),
      },
      finance: {
        ...projected.finance,
        balanceMillions: 100,
        runway: {
          ...projected.finance.runway,
          isInfinite: false,
          weeks: 40,
          band: "healthy" as const,
        },
      },
    });
    const candidate = (
      id: string,
      category: AvailableCommandView["category"],
      command: GameCommand,
      cashCostMillions: number,
    ): AvailableCommandView => ({
      id,
      category,
      command,
      summary: id,
      tags: ["capability"],
      cashCostMillions,
      cashGainMillions: 0,
    });
    const meta = (id: string, tickValue: number) => ({
      commandId: `test:${id}` as CommandId,
      expectedTick: tick(tickValue),
      issuedBy: "player" as const,
    });
    const training = policy.decide(
      { game: gameAt(16), seed, policyId: policy.id },
      ([9, 15] as const).map((durationWeeks) =>
        candidate(
          `training:${String(durationWeeks)}w`,
          "training",
          {
            kind: "start-training-run",
            meta: meta(`training:${String(durationWeeks)}w`, 16),
            labId: state.run.playerLabId,
            parentModelId,
            durationWeeks,
            posture: "normal" as const,
          },
          0,
        ),
      ),
    );
    expect(
      training
        .filter((command) => command.kind === "start-training-run")
        .map((command) =>
          command.kind === "start-training-run" ? command.durationWeeks : "",
        ),
    ).toEqual([TRAINING_SAMPLE_WEEKS.ambitious]);

    const procurement = policy.decide({ game: gameAt(130), seed, policyId: policy.id }, [
      candidate(
        "training:product-fallback",
        "training",
        {
          kind: "start-training-run",
          meta: meta("training:product-fallback", 130),
          labId: state.run.playerLabId,
          parentModelId,
          durationWeeks: TRAINING_SAMPLE_WEEKS.standard,
          posture: "normal" as const,
        },
        8,
      ),
      candidate(
        "facility:power",
        "facility",
        {
          kind: "start-facility-construction",
          meta: meta("facility:power", 130),
          labId: state.run.playerLabId,
          definitionId: contentId("base:facility.power-and-cooling-1"),
        },
        7,
      ),
      candidate(
        "gpu:reserved",
        "gpu",
        {
          kind: "buy-gpus",
          meta: meta("gpu:reserved", 130),
          labId: state.run.playerLabId,
          generationId: state.world.currentGpuGenerationId,
          thousandUnits: 5,
        },
        0.8,
      ),
    ]);
    expect(
      procurement
        .filter((command) => command.kind === "start-facility-construction")
        .map((command) =>
          command.kind === "start-facility-construction" ? command.definitionId : "",
        ),
    ).toEqual(["base:facility.power-and-cooling-1"]);

    const balanced = INITIAL_POLICIES.find(
      (candidatePolicy) => candidatePolicy.id === "balanced",
    );
    if (balanced === undefined) throw new Error("balanced policy missing");
    const trainingBlockedOnCompute = balanced.decide(
      { game: gameAt(130), seed, policyId: balanced.id },
      [
        candidate(
          "training:product-fallback",
          "training",
          {
            kind: "start-training-run",
            meta: meta("training:product-fallback", 130),
            labId: state.run.playerLabId,
            parentModelId,
            posture: "normal" as const,
          },
          8,
        ),
        candidate(
          "facility:tempting",
          "facility",
          {
            kind: "start-facility-construction",
            meta: meta("facility:tempting", 130),
            labId: state.run.playerLabId,
            definitionId: contentId("base:facility.robotics-lab"),
          },
          1,
        ),
        candidate(
          "gpu:frontier",
          "gpu",
          {
            kind: "buy-gpus",
            meta: meta("gpu:frontier", 130),
            labId: state.run.playerLabId,
            generationId: state.world.currentGpuGenerationId,
            thousandUnits: 20,
          },
          20,
        ),
      ],
    );
    expect(trainingBlockedOnCompute.map((command) => command.kind)).toContain("buy-gpus");
    expect(trainingBlockedOnCompute.map((command) => command.kind)).not.toContain(
      "start-training-run",
    );
    expect(trainingBlockedOnCompute.map((command) => command.kind)).not.toContain(
      "start-facility-construction",
    );

    const ordinaryGame = gameAt(10);
    const raceEmergencyGame = {
      ...ordinaryGame,
      world: {
        ...ordinaryGame.world,
        rivals: ordinaryGame.world.rivals.map((rival, index) =>
          index === 0
            ? {
                ...rival,
                candidateCountdown: {
                  modelName: "Rival Candidate",
                  estimateRangeWeeks: [8, 24] as const,
                  estimateLabel: "2–6 months",
                  confidence: "low" as const,
                  urgency: "urgent" as const,
                  finalDeploymentWarningActive: true,
                  stage: "confirmation" as const,
                  stageLabel: "Confirming the candidate",
                },
              }
            : rival,
        ),
      },
    };
    const emergencyResponse = balanced.decide(
      { game: raceEmergencyGame, seed, policyId: balanced.id },
      [
        candidate(
          "training:frontier-emergency",
          "training",
          {
            kind: "start-training-run",
            meta: meta("training:frontier-emergency", 10),
            labId: state.run.playerLabId,
            parentModelId,
            durationWeeks: TRAINING_SAMPLE_WEEKS.ambitious,
            posture: "normal" as const,
          },
          30,
        ),
        candidate(
          "facility:still-tempting",
          "facility",
          {
            kind: "start-facility-construction",
            meta: meta("facility:still-tempting", 10),
            labId: state.run.playerLabId,
            definitionId: contentId("base:facility.robotics-lab"),
          },
          1,
        ),
      ],
    );
    expect(
      emergencyResponse
        .filter((command) => command.kind === "start-training-run")
        .map((command) =>
          command.kind === "start-training-run" ? command.durationWeeks : undefined,
        ),
    ).toEqual([TRAINING_SAMPLE_WEEKS.ambitious]);
  });

  // TODO(coalition-redesign): re-enable with the redesigned mechanic.
  it.skip("enumerates rival signatory assets for coalition groundwork", () => {
    const initial = createNewGame(
      {
        seed: seed128("00000000000000000000000000000001"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-it-right"),
      },
      content,
    );
    const prepared = structuredClone(initial) as DeepMutable<GameState>;
    const player = prepared.labs[prepared.run.playerLabId];
    const rivals = Object.keys(prepared.world.rivals).sort() as LabId[];
    if (player === undefined || rivals.length < 2) {
      throw new Error("coalition balance fixture missing");
    }
    player.finance.cash = cashMillions(100);
    player.aura.spendable = 100;
    player.aura.lifetime = 100;
    const proposed = applyCommand(prepared, content, {
      kind: "propose-coalition",
      meta: {
        commandId: "test:balance-coalition" as CommandId,
        expectedTick: prepared.run.tick,
        issuedBy: "player",
      },
      labId: prepared.run.playerLabId,
      rivalLabIds: rivals.slice(0, 2),
      governmentMember: true,
      independentBodyMember: true,
    }).state;

    const assetCommands = listAvailableCommands(proposed, content, "coalition-builder")
      .map((candidate) => candidate.command)
      .filter(
        (
          command,
        ): command is Extract<
          GameCommand,
          { readonly kind: "start-coalition-project" }
        > =>
          command.kind === "start-coalition-project" &&
          command.projectType === "asset-contribution",
      );

    expect(assetCommands).toHaveLength(8);
    expect(new Set(assetCommands.map((command) => command.contributorLabId))).toEqual(
      new Set(rivals.slice(0, 2)),
    );
    expect(
      assetCommands.every(
        (command) => command.contributorLabId !== proposed.run.playerLabId,
      ),
    ).toBe(true);
  });

  it("bootstraps every core strategy into a first trained model before optional projects", async () => {
    const corePolicies = INITIAL_POLICIES.filter(
      (policy) =>
        policy.id !== "random-legal" &&
        policy.id !== "never-fund-serving" &&
        policy.id !== "never-train-model",
    );
    const report = await runBalanceBatch({
      ...request(),
      policies: corePolicies,
      maxTicks: 40,
      traceSampleRate: 1,
    });

    expect(report.runs).toHaveLength(corePolicies.length);
    for (const run of report.runs) {
      if (run.replay === undefined) {
        throw new Error(`bootstrap replay missing for ${run.policyId}`);
      }
      const commands = run.replay.commands;
      const firstTrainingIndex = commands.findIndex(
        (entry) => entry.command.kind === "start-training-run",
      );
      const firstOptionalProjectIndex = commands.findIndex(
        (entry) =>
          entry.command.kind === "start-evaluation" ||
          entry.command.kind === "start-facility-construction" ||
          entry.command.kind === "recruit-researcher",
      );
      expect(firstTrainingIndex, run.policyId).toBeGreaterThanOrEqual(0);
      expect(
        firstOptionalProjectIndex < 0 || firstTrainingIndex < firstOptionalProjectIndex,
        run.policyId,
      ).toBe(true);
      expect(run.rejectedPolicyCommands, run.policyId).toBe(0);
    }
  }, 15_000);

  it("keeps open science commercially viable while publishing for prestige", async () => {
    const openScience = INITIAL_POLICIES.find((policy) => policy.id === "open-science");
    if (openScience === undefined) throw new Error("open-science policy missing");

    const report = await runBalanceBatch({
      ...request(),
      policies: [openScience],
      maxTicks: 80,
      traceSampleRate: 1,
    });
    const run = report.runs[0];
    if (run?.replay === undefined) throw new Error("open-science replay missing");

    expect(run.status).toBe("incomplete");
    expect(
      run.replay.commands
        .filter((entry) => entry.command.kind === "set-public-price")
        .map((entry) =>
          entry.command.kind === "set-public-price" ? entry.command.priceTier : undefined,
        ),
    ).not.toContain("free-preview");
    expect(
      run.replay.commands
        .filter((entry) => entry.command.kind === "set-model-deployment-policy")
        .map((entry) =>
          entry.command.kind === "set-model-deployment-policy"
            ? entry.command.policy
            : undefined,
        ),
    ).toContain("guarded-api");
    const publicationPolicies = run.replay.commands
      .filter((entry) => entry.command.kind === "choose-publication-policy")
      .map((entry) =>
        entry.command.kind === "choose-publication-policy"
          ? entry.command.policy
          : undefined,
      );
    expect(publicationPolicies.every((policy) => policy === "publish-openly")).toBe(true);
  }, 10_000);

  // TODO(coalition-redesign): re-enable with the redesigned mechanic.
  it.skip("builds and ratifies one meaningful coalition instead of farming groundwork", async () => {
    const coalitionBuilder = INITIAL_POLICIES.find(
      (policy) => policy.id === "coalition-builder",
    );
    if (coalitionBuilder === undefined) {
      throw new Error("coalition-builder policy missing");
    }

    const report = await runBalanceBatch({
      ...request(),
      policies: [coalitionBuilder],
      maxTicks: 400,
      traceSampleRate: 1,
    });
    const run = report.runs[0];
    if (run?.replay === undefined) throw new Error("coalition replay missing");
    const coalitionProjects = run.replay.commands
      .map((entry) => entry.command)
      .filter(
        (
          command,
        ): command is Extract<
          GameCommand,
          { readonly kind: "start-coalition-project" }
        > => command.kind === "start-coalition-project",
      );

    expect(run.milestones.candidateOrViableCoalition).toBe(true);
    expect(
      run.replay.commands.some((entry) => entry.command.kind === "ratify-coalition"),
    ).toBe(true);
    for (const projectType of [
      "charter-drafting",
      "shared-evaluation-protocol",
      "verification-mechanism",
    ] as const) {
      const count = coalitionProjects.filter(
        (command) => command.projectType === projectType,
      ).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(3);
    }
    const assetContributions = coalitionProjects.filter(
      (command) => command.projectType === "asset-contribution",
    ).length;
    expect(assetContributions).toBeGreaterThanOrEqual(1);
    expect(assetContributions).toBeLessThanOrEqual(2);
    expect(run.rejectedPolicyCommands).toBe(0);
  }, 30_000);

  it("keeps the commercial model lifecycle stable instead of farming repeat projects", async () => {
    const commercial = INITIAL_POLICIES.find((policy) => policy.id === "commercial");
    if (commercial === undefined) throw new Error("commercial policy missing");

    const report = await runBalanceBatch({
      ...request(),
      policies: [commercial],
      maxTicks: 40,
      traceSampleRate: 1,
    });
    const run = report.runs[0];
    if (run?.replay === undefined) throw new Error("commercial replay missing");

    const productisationByModel = new Map<string, number>();
    for (const entry of run.replay.commands) {
      if (entry.command.kind !== "start-productisation") continue;
      productisationByModel.set(
        entry.command.modelId,
        (productisationByModel.get(entry.command.modelId) ?? 0) + 1,
      );
    }

    expect([...productisationByModel.values()].every((count) => count === 1)).toBe(true);
    expect(
      run.replay.commands
        .filter((entry) => entry.command.kind === "set-model-deployment-policy")
        .map((entry) =>
          entry.command.kind === "set-model-deployment-policy"
            ? entry.command.policy
            : undefined,
        ),
    ).toEqual(["open-api"]);
    expect(run.rejectedPolicyCommands).toBe(0);
  }, 10_000);

  it("sets scripted allocation, pricing, and research postures without resubmitting them", async () => {
    const commercial = INITIAL_POLICIES.find((policy) => policy.id === "commercial");
    if (commercial === undefined) throw new Error("commercial policy missing");

    const report = await runBalanceBatch({
      ...request(),
      policies: [commercial],
      maxTicks: 80,
      traceSampleRate: 1,
    });
    const run = report.runs[0];
    if (run?.replay === undefined) throw new Error("commercial replay missing");

    expect(
      run.replay.commands.filter((entry) => entry.command.kind === "set-public-price"),
    ).toHaveLength(1);
    const allocations = run.replay.commands.filter(
      (entry) => entry.command.kind === "set-gpu-allocation",
    );
    expect(allocations.length).toBeGreaterThan(0);
    expect(
      allocations.every(
        (entry, index) =>
          index === 0 ||
          JSON.stringify(entry.command) !==
            JSON.stringify(allocations[index - 1]?.command),
      ),
    ).toBe(true);
    expect(run.rejectedPolicyCommands).toBe(0);
  }, 15_000);

  it("funds every capability programme in the balanced generalist posture", () => {
    const balanced = INITIAL_POLICIES.find((policy) => policy.id === "balanced");
    if (balanced === undefined) throw new Error("balanced policy missing");
    const initial = createNewGame(
      {
        seed: seed128("00000000000000000000000000000001"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-it-right"),
      },
      content,
    );
    const allocation = listAvailableCommands(initial, content, balanced.id)
      .map((candidate) => candidate.command)
      .find(
        (command): command is Extract<GameCommand, { kind: "set-gpu-allocation" }> =>
          command.kind === "set-gpu-allocation" &&
          command.allocation.capabilityBasisPoints === 6_000 &&
          command.allocation.servingFleetShareBasisPoints === 6_250,
      );
    if (allocation === undefined) throw new Error("balanced allocation missing");

    const weights = allocation.allocation.capabilityDomainWeights;
    expect(Object.keys(weights).sort()).toEqual(
      Object.keys(content.research.capabilityDomains).sort(),
    );
    expect(Object.values(weights).every((weight) => weight > 0)).toBe(true);
    expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBe(10_000);

    const decisions = balanced.decide(
      {
        game: projectGameView(initial, content, {
          viewerLabId: initial.run.playerLabId,
          intelligenceRatings: {},
          evidenceAccess: { evaluationIds: [], anomalyIds: [] },
        }),
        seed: initial.run.seed,
        policyId: balanced.id,
      },
      listAvailableCommands(initial, content, balanced.id),
    );
    expect(decisions.filter((command) => command.kind === "set-gpu-allocation")).toEqual([
      allocation,
    ]);
  });

  // Re-pinned 2026-07-31 after the serving waterfall landed. Serving is now a
  // fixed claim sized by demand rather than a share of whatever reservations
  // leave behind, so a project starting no longer quietly cuts revenue: the
  // balanced policy runs solvent to the horizon on every seed below, where it
  // previously went insolvent around week 350 on the first of them.
  //
  // Measured across five seeds: the player takes NO world firsts at all, and
  // rivals discover the whole literature. The floor this test used to carry
  // only ever passed on one seed and would be asserting a fiction now, so it
  // is gone; the ceiling is the guard that always mattered, and it is checked
  // on every seed. That the player never wins a race is a real balance finding
  // rather than a test problem, and it wants a design answer.
  it(
    "keeps the seeded balanced paper race inside the coarse Stage 6 band",
    async () => {
      const balanced = INITIAL_POLICIES.find((policy) => policy.id === "balanced");
      if (balanced === undefined) throw new Error("balanced policy missing");

      const report = await runBalanceBatch({
        ...request(),
        seeds: [
          seed128("00000000000000000000000000000001"),
          seed128("00000000000000000000000000000002"),
          seed128("00000000000000000000000000000003"),
        ],
        policies: [balanced],
        maxTicks: 705,
        traceSampleRate: 0,
      });
      expect(report.runs).toHaveLength(3);

      for (const run of report.runs) {
        expect(run.rejectedPolicyCommands).toBe(0);
        expect(run.totalDiscoveredPapers).toBeGreaterThan(0);
        // The real guard: the player must never own the whole literature.
        expect(run.playerWorldFirstShare).toBeLessThanOrEqual(0.75);
        // A share only means something on a run that reached the late game; an
        // insolvency in year two is what made this unpinnable before.
        expect(run.ticks).toBeGreaterThan(400);
      }
    },
    CANONICAL_TRAJECTORY_TIMEOUT_MS,
  );

  // The deterministic candidate gate can end a policy's run before the world
  // records Frontier entry. The measurement must therefore be explicit about
  // whether it sampled at Frontier entry or used the documented run-end
  // fallback; it must never silently label one as the other.
  it(
    "measures rival plausibility at the first canonical Frontier entry",
    async () => {
      const secretive = INITIAL_POLICIES.find(
        (policy) => policy.id === "secretive-proprietary",
      );
      if (secretive === undefined) throw new Error("secretive policy missing");

      const report = await runBalanceBatch({
        ...request(),
        policies: [secretive],
        maxTicks: 1_100,
        traceSampleRate: 0,
      });
      const run = report.runs[0];
      if (run === undefined) throw new Error("secretive run missing");

      const frontierEntry = run.phaseEntryTicks.frontier;
      expect(run.rivalCompetitiveness).toMatchObject(
        frontierEntry === undefined
          ? {
              plausibilityMeasurement: "run-end-fallback",
              plausibilityMeasuredAtTick: run.ticks,
            }
          : {
              plausibilityMeasurement: "frontier-entry",
              plausibilityMeasuredAtTick: frontierEntry,
            },
      );
      expect(report.rivalCompetitiveness.frontierEntrySamples).toBe(
        frontierEntry === undefined ? 0 : 1,
      );
      expect(
        report.targets.find((target) => target.id === "rivals.leading-rival-emerges")
          ?.sampleSize,
      ).toBe(frontierEntry === undefined ? 0 : 1);
      expect(runSummaryCsv(report)).toContain(
        frontierEntry === undefined ? "run-end-fallback" : "frontier-entry",
      );
    },
    CANONICAL_TRAJECTORY_TIMEOUT_MS,
  );

  it(
    "lets a genuine rival candidate resolve before the long horizon",
    async () => {
      const coalition = INITIAL_POLICIES.find(
        (policy) => policy.id === "coalition-builder",
      );
      if (coalition === undefined) throw new Error("coalition policy missing");

      const report = await runBalanceBatch({
        ...request(),
        seeds: [seed128("00000000000000000000000000000002")],
        policies: [coalition],
        maxTicks: 1160,
        traceSampleRate: 0,
      });
      const run = report.runs[0];
      if (run === undefined) throw new Error("coalition run missing");

      expect(run.status).toBe("lost");
      expect(run.endingId).toMatch(
        /base:ending\.(?:rival-ascendance|the-door-opened-elsewhere)/,
      );
      expect(
        run.rivalCompetitiveness.candidateOutcomes.successfulDeployments +
          run.rivalCompetitiveness.candidateOutcomes.catastrophes,
      ).toBeGreaterThan(0);
    },
    CANONICAL_TRAJECTORY_TIMEOUT_MS,
  );

  it("calibrates structured Very likely promises from resolved checks", async () => {
    const definition: EventDefinition = {
      id: contentId("base:event.test.very-likely-calibration"),
      version: 1,
      category: "research",
      severity: "decision",
      phase: "any",
      trigger: { kind: "opportunity" },
      prerequisites: { type: "always" },
      baseWeight: 1,
      weightModifiers: [],
      cooldown: { group: "very-likely-calibration", weeks: 0 },
      unique: true,
      expiryWeeks: 4,
      defaultOptionId: "attempt",
      titleKey: "event.test.very-likely.title",
      bodyKey: "event.test.very-likely.body",
      evidence: [],
      tokenBindings: [],
      options: [
        {
          id: "attempt",
          labelKey: "event.test.very-likely.attempt.label",
          requirements: { type: "always" },
          knownCosts: [],
          previewKey: "event.test.very-likely.attempt.preview",
          immediateEffects: [],
          checks: [
            {
              id: "result",
              outcomes: [
                {
                  id: "success",
                  minimumInclusive: 0,
                  maximumExclusive: 1,
                  effects: [],
                  memories: [],
                },
              ],
              likelihoodPromise: {
                label: "very-likely",
                successOutcomeIds: ["success"],
              },
            },
          ],
          memories: [],
          confirmationRequired: false,
        },
      ],
      followUps: [],
      telemetryTags: ["test"],
    };
    const eventContent: CompiledContent = {
      ...content,
      events: {
        definitions: { [definition.id]: definition },
        orderedIds: [definition.id],
      },
    };
    const balanced = INITIAL_POLICIES.find((policy) => policy.id === "balanced");
    if (balanced === undefined) throw new Error("balanced policy missing");

    const report = await runBalanceBatch({
      ...request(),
      content: eventContent,
      policies: [balanced],
      maxTicks: 35,
    });
    expect(report.eventCalibration.veryLikelySuccessRate).toBe(1);
    expect(report.eventCalibration.likelihoodPromises["very-likely"]).toEqual({
      trials: 1,
      successes: 1,
      successRate: 1,
    });
    expect(
      report.targets.find((target) => target.id === "events.very-likely-success"),
    ).toMatchObject({ status: "pass", sampleSize: 1, actual: 1 });
    expect(eventSummaryCsv(report)).toContain("likelihood-successes,very-likely,1");
  });

  it("expands and shards the full Cartesian matrix by stable global ordinal", () => {
    const matrixRequest = {
      ...request(),
      seeds: [
        seed128("00000000000000000000000000000001"),
        seed128("00000000000000000000000000000002"),
      ],
      policies: INITIAL_POLICIES.slice(0, 2),
      difficultyIds: [
        contentId("base:difficulty.standard"),
        contentId("base:difficulty.frontier"),
      ],
      leaderIds: [
        contentId("base:leader.thomas-hassabi"),
        contentId("base:leader.sam-altmann"),
      ],
      mandateIds: [
        contentId("base:mandate.build-it-right"),
        contentId("base:mandate.build-the-science"),
      ],
      matrixMode: "cartesian" as const,
    };
    const full = buildRunSpecifications(matrixRequest);
    const shard = buildRunSpecifications({
      ...matrixRequest,
      shard: { index: 1, count: 3 },
    });
    expect(full).toHaveLength(32);
    expect(new Set(full.map((specification) => specification.runKey)).size).toBe(32);
    expect(shard.map((specification) => specification.ordinal)).toEqual(
      full
        .filter((specification) => specification.ordinal % 3 === 1)
        .map((specification) => specification.ordinal),
    );

    const nightlyShard = buildRunSpecifications({
      ...request(),
      policies: INITIAL_POLICIES,
      difficultyIds: Object.keys(content.difficulties).sort().map(contentId),
      leaderIds: Object.keys(content.leaders).sort().map(contentId),
      mandateIds: Object.keys(content.mandates).sort().map(contentId),
      matrixMode: "cartesian",
      shard: { index: 0, count: 10 },
    });
    expect(nightlyShard).toHaveLength(60);
    expect(new Set(nightlyShard.map((specification) => specification.policyId))).toEqual(
      new Set(INITIAL_POLICIES.map((policy) => policy.id)),
    );
  });

  it("assigns every independent run a distinct seed while cycling policies", () => {
    const independent = buildRunSpecifications({
      ...request(),
      seeds: [
        seed128("00000000000000000000000000000001"),
        seed128("00000000000000000000000000000002"),
        seed128("00000000000000000000000000000003"),
      ],
      policies: INITIAL_POLICIES.slice(0, 2),
      matrixMode: "independent",
    });
    expect(independent).toHaveLength(3);
    expect(new Set(independent.map((specification) => specification.seed)).size).toBe(3);
    expect(independent.map((specification) => specification.policyId)).toEqual([
      INITIAL_POLICIES[0]?.id,
      INITIAL_POLICIES[1]?.id,
      INITIAL_POLICIES[0]?.id,
    ]);
  });

  it("rebuilds aggregates only from one complete, non-overlapping shard set", async () => {
    const short = { ...request(), maxTicks: 2 };
    const [whole, left, right] = await Promise.all([
      runBalanceBatch(short),
      runBalanceBatch({ ...short, shard: { index: 0, count: 2 } }),
      runBalanceBatch({ ...short, shard: { index: 1, count: 2 } }),
    ]);
    const merged = mergeBalanceReports([right, left], content, "2026-07-22T00:00:00Z");
    expect(merged.runs).toEqual(whole.runs);
    expect(merged.winFunnel).toEqual(whole.winFunnel);
    expect(merged.dimensionSummaries).toEqual(whole.dimensionSummaries);
    expect(merged.matrix.shard).toBeUndefined();
    await expect(
      Promise.resolve().then(() => mergeBalanceReports([left], content)),
    ).rejects.toThrow("Incomplete shard set");
  });

  it("rejects empty and invalid run requests", async () => {
    await expect(runBalanceBatch({ ...request(), seeds: [] })).rejects.toThrow(
      "At least one seed",
    );
    await expect(runBalanceBatch({ ...request(), traceSampleRate: 2 })).rejects.toThrow(
      "traceSampleRate",
    );
    await expect(
      runBalanceBatch({ ...request(), shard: { index: 2, count: 2 } }),
    ).rejects.toThrow("shard");
  });
});
