import { describe, expect, it } from "vitest";

import { contentId } from "@neolab/content-schema";
import {
  advanceIncidentChecks,
  advanceOneTick,
  applyCommand,
  quoteEvaluation,
  calculateIncidentHazard,
  checkMandatorySafetyReview,
  completeBaselineEvaluation,
  createTransaction,
  enforceCatastropheLegality,
  isCatastropheCheckLegal,
  observeEvaluationTarget,
  RandomOracleV1,
  rating,
  seed128,
  type AnomalyId,
  type CommandId,
  type DeepMutable,
  type EvaluationId,
  type GameState,
  type ModelId,
  type ModifierId,
  type RandomKey,
  type RandomOracle,
} from "@neolab/sim";

import { scenario, scenarioContent } from "../scenario.ts";

const content = scenarioContent();

function currentModelId(state: GameState): ModelId {
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  if (modelId === undefined) throw new Error("current model missing");
  return modelId;
}

function quoteFor(state: GameState, investedTotalFlop: number) {
  const staged = structuredClone(state) as DeepMutable<GameState>;
  const model = staged.models[currentModelId(state)];
  if (model === undefined) throw new Error("fixture model missing");
  model.investedTotalFlop = investedTotalFlop;
  return quoteEvaluation(staged, content, {
    labId: staged.run.playerLabId,
    modelId: currentModelId(state),
    definitionId: contentId("base:evaluation.alignment-interview"),
  });
}

function evaluationCommand(
  state: GameState,
  definitionId = "base:evaluation.alignment-interview",
) {
  return {
    kind: "start-evaluation" as const,
    meta: {
      commandId: "command:evaluation" as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    modelId: currentModelId(state),
    definitionId: contentId(definitionId),
  };
}

describe("compiled evaluations and evidence", () => {
  it("provides the consolidated player-startable evaluation suites", () => {
    const definitions = Object.values(content.evaluations.definitions);
    // The ladder: an automatic baseline plus five player-climbed rungs, in
    // strict prerequisite order at dramatically escalating cost.
    expect(definitions).toHaveLength(6);
    const rungs = definitions
      .filter((definition) => definition.playerStartable)
      .sort((left, right) => left.ladderRung - right.ladderRung);
    expect(rungs).toHaveLength(5);
    // Each rung requires exactly the one below; the first requires nothing,
    // since the automatic baseline has already run on every trained model.
    for (const [index, rung] of rungs.entries()) {
      expect(rung.requiresEvaluationId).toBe(rungs[index - 1]?.id);
    }
    // Costs and XP both escalate monotonically up the ladder.
    for (let index = 1; index < rungs.length; index += 1) {
      const lower = rungs[index - 1];
      const upper = rungs[index];
      if (lower === undefined || upper === undefined) throw new Error("rung missing");
      expect(upper.cashCostMillions).toBeGreaterThan(lower.cashCostMillions);
      expect(upper.practiceXp).toBeGreaterThan(lower.practiceXp);
      expect(upper.independence).toBeGreaterThanOrEqual(lower.independence);
    }
    // The outside audit brings its own compute; every in-house rung bills a
    // growing fraction of the FLOPs that trained the model under examination.
    expect(
      definitions.map((definition) => [
        definition.displayName,
        definition.durationWeeks,
        definition.trainingRunFlopFraction,
      ]),
    ).toContainEqual(["Independent Audit", 8, 0]);
    const fractions = rungs.map((rung) => rung.trainingRunFlopFraction);
    expect(fractions).toEqual([0.05, 0.15, 0.3, 0.5, 0]);
    // The in-house fractions sum to 1.0: fully evaluating a model costs as
    // much compute as training it did.
    expect(fractions.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);

    // The broad interview establishes every safety reading once; later rungs
    // deepen two distinct questions apiece instead of repeatedly pretending
    // to measure the whole hidden profile.
    expect(rungs.map((rung) => [rung.method, rung.targets])).toEqual([
      [
        "alignment-interview",
        [
          "true-alignment",
          "corrigibility",
          "situational-awareness",
          "deceptive-capability",
        ],
      ],
      ["red-team", ["corrigibility", "deceptive-capability"]],
      ["autonomy-trial", ["situational-awareness", "deceptive-capability"]],
      ["interpretability", ["true-alignment", "deceptive-capability"]],
      ["external-audit", ["true-alignment", "situational-awareness"]],
    ]);
  });

  it("runs through the shared project scheduler and updates measured evidence", () => {
    let state = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(100).aura(50))
      .build();
    // Give the model a real training bill so the reservation derivation is
    // exercised: the rung charges 5% of this in FLOPs, and pacing changes the
    // rate at which that invariant bill is delivered rather than its size.
    {
      const mutable = state as DeepMutable<GameState>;
      const model = mutable.models[currentModelId(state)];
      if (model === undefined) throw new Error("fixture model missing");
      model.investedTotalFlop = 4e22;
    }
    const quote = quoteEvaluation(state, content, {
      labId: state.run.playerLabId,
      modelId: currentModelId(state),
      definitionId: contentId("base:evaluation.alignment-interview"),
    });
    expect(quote.totalFlop).toBeCloseTo(2e21, 5);
    expect(quote.physicalGpus).toBeGreaterThan(0);
    expect(quote.physicalGpus % 1_000).not.toBe(0);

    const pacing = quoteFor(state, 4e22).pacingOptions;
    expect(pacing.map((option) => option.durationWeeks)).toEqual([1, 2, 3, 4, 8, 12, 16]);
    expect(pacing.every((option) => option.feasible)).toBe(true);
    for (const [index, option] of pacing.entries()) {
      expect(option.requiredTeraflops * option.durationWeeks).toBeCloseTo(
        pacing[0]?.requiredTeraflops ?? 0,
        8,
      );
      const previous = pacing[index - 1];
      if (previous !== undefined) {
        expect(option.requiredTeraflops).toBeLessThan(previous.requiredTeraflops);
        expect(option.remainingTeraflops).toBeGreaterThan(previous.remainingTeraflops);
      }
    }

    // A bill no available rate can carry keeps every legible pacing choice in
    // the quote as disabled context and explains the unreserved-compute gap.
    const impossible = quoteFor(state, 1e27);
    expect(impossible.pacingOptions).toHaveLength(7);
    expect(impossible.pacingOptions.every((option) => !option.feasible)).toBe(true);
    expect(impossible.blockers.join(" ")).toMatch(/currently unreserved/);

    state = applyCommand(state, content, evaluationCommand(state)).state;
    const projectId = state.labs[state.run.playerLabId]?.projects.projectIds.at(-1);
    if (projectId === undefined) throw new Error("evaluation project missing");
    expect(state.projects[projectId]?.payload).toMatchObject({
      kind: "evaluation",
      reservedPhysicalGpus: quote.physicalGpus,
    });
    expect(state.labs[state.run.playerLabId]?.compute.reservations).toContainEqual(
      expect.objectContaining({ projectId, gpus: quote.physicalGpus }),
    );

    for (let week = 0; week < 6; week += 1) {
      state = advanceOneTick(state, content).state;
      if (state.projects[projectId]?.status === "completed") break;
    }
    const project = state.projects[projectId];
    if (project?.payload.kind !== "evaluation") {
      throw new Error("evaluation payload missing");
    }
    const evaluation = state.evaluations[project.payload.futureEvaluationId];
    expect(project.status).toBe("completed");
    expect(evaluation?.observations).toHaveLength(4);
    expect(evaluation?.observations.every((item) => item.errorRadius > 0)).toBe(true);
    expect(state.models[currentModelId(state)]?.evaluations).toContain(evaluation?.id);
    expect(
      state.models[currentModelId(state)]?.measuredCapability?.evidenceFlags,
    ).toContain("evaluation:alignment-interview:completed");
    expect(state.labs[state.run.playerLabId]?.compute.reservations).toEqual([]);
  });

  it("prices the outside audit to the client, never below its floor", () => {
    const state = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(100).aura(50))
      .build();
    const auditQuote = (mutate?: (draft: DeepMutable<GameState>) => void) => {
      const staged = structuredClone(state) as DeepMutable<GameState>;
      mutate?.(staged);
      return quoteEvaluation(staged, content, {
        labId: staged.run.playerLabId,
        modelId: currentModelId(state),
        definitionId: contentId("base:evaluation.external-audit"),
      });
    };
    // A seed-stage lab pays the flat floor...
    expect(auditQuote().cashCostMillions).toBe(50);
    // ...and a $100bn lab pays 2% of its mark. Cheap by the endgame is the
    // one thing the honest evaluation must never be.
    const rich = auditQuote((draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("lab missing");
      lab.finance.valuation = {
        markMillions: 100_000,
        previousMarkMillions: 100_000,
        peakMarkMillions: 100_000,
        announcedMilestones: [],
      };
    });
    expect(rich.cashCostMillions).toBe(2_000);
  });

  it("creates a real baseline record with full information weight every time", () => {
    // Repeat discounting retired with the ladder: every rung runs once per
    // model, so depth of evidence comes from climbing, not repetition.
    let state = scenario().withBaselineModel().build();
    const modelId = currentModelId(state);
    for (let repeat = 0; repeat < 4; repeat += 1) {
      const tx = createTransaction(state);
      completeBaselineEvaluation(tx, content, modelId);
      state = tx.commit({ description: `baseline repeat ${String(repeat)}` }).state;
    }
    const weights = state.models[modelId]?.evaluations.map(
      (id) => state.evaluations[id]?.observations[0]?.informationWeight,
    );
    expect(weights).toEqual([1, 1, 1, 1]);
  });

  it("lets Interpretability & Evals sharpen ordinary evaluation estimates", () => {
    const low = scenario().withBaselineModel().build();
    const high = structuredClone(low) as DeepMutable<GameState>;
    const programme =
      high.labs[high.run.playerLabId]?.research.safetyPrograms[
        "base:safety.interpretability-evals"
      ];
    if (programme === undefined) throw new Error("interpretability fixture missing");
    programme.level = rating(100);
    const modelId = currentModelId(low);
    const complete = (state: GameState): GameState => {
      const tx = createTransaction(state);
      completeBaselineEvaluation(
        tx,
        content,
        modelId,
        new RandomOracleV1(seed128("11111111111111111111111111111111")),
      );
      return tx.commit({ description: "interpretability quality fixture" }).state;
    };
    const lowResult = complete(low);
    const highResult = complete(high);
    const lowReportId = lowResult.models[modelId]?.evaluations.at(-1);
    const highReportId = highResult.models[modelId]?.evaluations.at(-1);
    const lowRadius =
      lowReportId === undefined
        ? undefined
        : lowResult.evaluations[lowReportId]?.observations[0]?.errorRadius;
    const highRadius =
      highReportId === undefined
        ? undefined
        : highResult.evaluations[highReportId]?.observations[0]?.errorRadius;
    expect(highRadius).toBeDefined();
    expect(lowRadius).toBeDefined();
    expect(highRadius ?? Infinity).toBeLessThan(lowRadius ?? -Infinity);
  });

  it("does not let safety-only reports move capability at all", () => {
    // Capability is exact from the moment training ends, so the old worry --
    // safety evidence quietly sharpening the capability estimate -- is now a
    // stronger claim: a safety report must not touch those numbers, full stop.
    let state = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(100).aura(50))
      .build();
    const modelId = currentModelId(state);
    const before = structuredClone(state.models[modelId]?.measuredCapability?.values);
    expect(before).toBeDefined();
    state = applyCommand(
      state,
      content,
      evaluationCommand(state, "base:evaluation.alignment-interview"),
    ).state;
    const projectId = state.labs[state.run.playerLabId]?.projects.projectIds.at(-1);
    if (projectId === undefined) throw new Error("safety evaluation project missing");
    for (let week = 0; week < 6; week += 1) {
      state = advanceOneTick(state, content).state;
      if (state.projects[projectId]?.status === "completed") break;
    }
    expect(state.projects[projectId]?.status).toBe("completed");
    expect(state.models[modelId]?.measuredCapability?.values).toEqual(before);
  });
});

function insertAnomalies(state: GameState, count: number): GameState {
  const modelId = currentModelId(state);
  const tx = createTransaction(state);
  tx.update((draft) => {
    const model = draft.models[modelId];
    if (model === undefined) throw new Error("model missing");
    const startIndex = model.anomalies.length;
    for (let index = 0; index < count; index += 1) {
      const suffix = String(startIndex + index);
      const id = `run:anomaly:player:test-${suffix}` as AnomalyId;
      const evaluationId = `run:evaluation:player:test-${suffix}` as EvaluationId;
      draft.anomalies[id] = {
        id,
        ownerLabId: draft.run.playerLabId,
        modelId,
        sourceEvaluationId: evaluationId,
        underlyingCase: "alignment",
        observationCount: 1,
        createdAt: draft.run.tick,
        trueSeverity: rating(82),
        observedSeverity: rating(75 + index),
        status: "unresolved",
      };
      draft.evaluations[evaluationId] = {
        id: evaluationId,
        ownerLabId: draft.run.playerLabId,
        modelId,
        definitionId: content.evaluations.baselineEvaluationId,
        startedAt: draft.run.tick,
        completedAt: draft.run.tick,
        repeatIndex: startIndex + index,
        method: "fixture",
        independence: 0,
        observations: [],
        anomalyIds: [id],
      };
      model.anomalies.push(id);
      model.evaluations.push(evaluationId);
    }
  });
  return tx.commit({ description: "severe anomaly fixture" }).state;
}

describe("anomaly decisions", () => {
  it("supports dismiss and investigate commands with delayed resolution", () => {
    let state = insertAnomalies(
      scenario()
        .withBaselineModel()
        .withPlayerLab((lab) => lab.cash(100))
        .build(),
      1,
    );
    const anomalyId = state.models[currentModelId(state)]?.anomalies[0];
    if (anomalyId === undefined) throw new Error("anomaly missing");
    state = applyCommand(state, content, {
      kind: "investigate-anomaly",
      meta: {
        commandId: "command:investigate" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      anomalyId,
    }).state;
    expect(state.anomalies[anomalyId]?.status).toBe("investigating");
    expect(state.anomalies[anomalyId]?.investigationDueAt).toBe(state.run.tick + 8);
    const investigationProjectId =
      state.labs[state.run.playerLabId]?.projects.projectIds.at(-1);
    if (investigationProjectId === undefined) {
      throw new Error("anomaly investigation project missing");
    }
    expect(state.projects[investigationProjectId]?.kind).toBe("anomaly-investigation");
    expect(state.projects[investigationProjectId]?.status).toBe("active");
    expect(state.projects[investigationProjectId]?.reservations.majorProjectSlots).toBe(
      1,
    );
    for (let week = 0; week < 10; week += 1) {
      state = advanceOneTick(state, content).state;
      if (state.projects[investigationProjectId]?.status === "completed") break;
    }
    expect(state.anomalies[anomalyId]?.status).toBe("confirmed");

    state = insertAnomalies(state, 1);
    const dismissId = state.models[currentModelId(state)]?.anomalies.at(-1);
    if (dismissId === undefined) throw new Error("dismiss anomaly missing");
    const labBeforeDismissal = state.labs[state.run.playerLabId];
    const modelBeforeDismissal = state.models[currentModelId(state)];
    if (labBeforeDismissal === undefined || modelBeforeDismissal === undefined) {
      throw new Error("dismissal fixture missing");
    }
    state = applyCommand(state, content, {
      kind: "dismiss-anomaly",
      meta: {
        commandId: "command:dismiss" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      anomalyId: dismissId,
    }).state;
    expect(state.anomalies[dismissId]?.status).toBe("dismissed");
    expect(state.labs[state.run.playerLabId]?.safety.safetyCulture).toBe(
      labBeforeDismissal.safety.safetyCulture - 5,
    );
    expect(state.labs[state.run.playerLabId]?.organisation.hiddenInternalCandour).toBe(
      labBeforeDismissal.organisation.hiddenInternalCandour - 5,
    );
    expect(
      state.labs[state.run.playerLabId]?.flags["evaluation:dismissed-anomaly-count"],
    ).toBe(1);
    expect(state.models[currentModelId(state)]?.deployment.evidencePenalty).toBe(
      modelBeforeDismissal.deployment.evidencePenalty + 5,
    );
  });

  it("forces and auto-pauses the placeholder review at three severe unresolved anomalies", () => {
    const state = insertAnomalies(scenario().withBaselineModel().build(), 3);
    const modelId = currentModelId(state);
    const tx = createTransaction(state);
    checkMandatorySafetyReview(tx, content, modelId);
    const result = tx.commit({ description: "mandatory review hook" });
    expect(result.state.models[modelId]?.flags).toMatchObject({
      "mandatory-event:three-severe-anomalies": true,
    });
    expect(result.autoPauseReasons).toContain("critical-event");
    expect(result.domainEvents).toContainEqual({
      kind: "mandatory-safety-review",
      modelId,
      unresolvedSevereCount: 3,
    });
  });
});

class ForcedIncidentOracle implements RandomOracle {
  uniform(_key: RandomKey): number {
    return 0;
  }
  integer(_key: RandomKey, minInclusive: number): number {
    return minInclusive;
  }
  triangular(_key: RandomKey, _min: number, mode: number): number {
    return mode;
  }
  weighted<T extends string>(_key: RandomKey, weights: Readonly<Record<T, number>>): T {
    const first = Object.keys(weights)[0] as T | undefined;
    if (first === undefined) throw new Error("empty weights");
    return first;
  }
  shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
    return [...values];
  }
}

describe("weekly incident law", () => {
  it("uses the documented factors and ordinary clamp", () => {
    const state = scenario().withBaselineModel().build();
    const modelId = currentModelId(state);
    const hazard = calculateIncidentHazard(state, content, modelId);
    expect(hazard.baseHazard).toBe(0.0005);
    expect(hazard.alignmentFactor).toBeGreaterThan(0);
    expect(hazard.cultureFactor).toBeCloseTo(0.935, 8);
    // Starting defences dropped to startup-hygiene levels on 2026-07-31, and
    // the control factor became a divide by the shared defence divisor.
    expect(hazard.operationalDefence).toBeCloseTo(9.98, 8);
    expect(hazard.controlFactor).toBeCloseTo(1.25 * (1 - (0.75 * 9.98) / 100), 8);
    expect(hazard.final).toBeGreaterThanOrEqual(0.0001);
    expect(hazard.final).toBeLessThanOrEqual(0.08);
  });

  it("uses Alignment and Security research for incident frequency and severity", () => {
    const low = structuredClone(
      scenario().withBaselineModel().build(),
    ) as DeepMutable<GameState>;
    const high = structuredClone(low);
    const modelId = currentModelId(low);
    const setProgrammeLevels = (state: DeepMutable<GameState>, level: number): void => {
      const programmes = state.labs[state.run.playerLabId]?.research.safetyPrograms;
      const alignment = programmes?.["base:safety.alignment-control"];
      const security = programmes?.["base:safety.security-containment"];
      if (alignment === undefined || security === undefined) {
        throw new Error("operational-defence fixture missing");
      }
      alignment.level = rating(level);
      security.level = rating(level);
      const model = state.models[modelId];
      if (model === undefined) throw new Error("incident model fixture missing");
      model.accessLevel = 1;
    };
    setProgrammeLevels(low, 0);
    setProgrammeLevels(high, 100);

    const lowHazard = calculateIncidentHazard(low, content, modelId);
    const highHazard = calculateIncidentHazard(high, content, modelId);
    expect(highHazard.operationalDefence - lowHazard.operationalDefence).toBeCloseTo(
      20,
      8,
    );
    expect(highHazard.final).toBeLessThan(lowHazard.final);

    const resolveForcedIncident = (state: GameState): number => {
      const tx = createTransaction(state);
      advanceIncidentChecks(tx, content, new ForcedIncidentOracle());
      const result = tx.commit({ description: "operational-defence severity fixture" });
      const severity = result.state.incidents.at(-1)?.observedSeverity;
      if (severity === undefined) throw new Error("forced incident missing");
      return severity;
    };
    expect(resolveForcedIncident(high)).toBeCloseTo(resolveForcedIncident(low) - 4, 8);
  });

  it("makes better alignment reduce ordinary incident frequency without removing it", () => {
    const unsafe = structuredClone(
      scenario().withBaselineModel().build(),
    ) as DeepMutable<GameState>;
    const modelId = currentModelId(unsafe);
    const safe = structuredClone(unsafe);
    const unsafeModel = unsafe.models[modelId];
    const safeModel = safe.models[modelId];
    if (unsafeModel === undefined || safeModel === undefined) {
      throw new Error("alignment hazard fixture missing");
    }
    unsafeModel.hiddenSafety.trueAlignment = rating(0);
    safeModel.hiddenSafety.trueAlignment = rating(100);
    const unsafeHazard = calculateIncidentHazard(unsafe, content, modelId);
    const safeHazard = calculateIncidentHazard(safe, content, modelId);
    expect(safeHazard.alignmentFactor).toBe(0.5);
    expect(unsafeHazard.alignmentFactor).toBe(1.25);
    expect(safeHazard.final).toBeGreaterThan(0);
    expect(safeHazard.final).toBeLessThan(unsafeHazard.final);
  });

  it("applies lab.incident.hazard modifiers before the clamp", () => {
    const base = scenario().withBaselineModel().build();
    const modelId = currentModelId(base);
    const halvedTx = createTransaction(base);
    halvedTx.update((draft) => {
      draft.modifiers["hazard-test" as unknown as ModifierId] = {
        id: "hazard-test" as unknown as ModifierId,
        source: { kind: "facility" },
        labId: draft.run.playerLabId,
        target: "lab.incident.hazard",
        operation: "multiply",
        value: 0.5,
        startsAt: draft.run.tick,
        tags: [],
      };
    });
    const halved = halvedTx.commit({ description: "hazard modifier fixture" }).state;
    const plain = calculateIncidentHazard(base, content, modelId);
    const modified = calculateIncidentHazard(halved, content, modelId);
    expect(modified.unclamped).toBeCloseTo(plain.unclamped * 0.5, 12);
  });

  it("records a forced non-catastrophic model incident", () => {
    let state = scenario().withBaselineModel().build();
    const modelId = currentModelId(state);
    const preparation = createTransaction(state);
    preparation.update((draft) => {
      const model = draft.models[modelId];
      if (model === undefined) throw new Error("model missing");
      model.accessLevel = 1;
    });
    state = preparation.commit({ description: "incident access fixture" }).state;
    const tx = createTransaction(state);
    advanceIncidentChecks(tx, content, new ForcedIncidentOracle());
    const result = tx.commit({ description: "forced incident" });
    expect(result.state.incidents).toHaveLength(1);
    expect(result.domainEvents[0]).toMatchObject({
      kind: "model-incident",
      modelId,
    });
    expect(result.state.incidents[0]?.category).not.toBe("catastrophe");
  });

  it("blocks illegal catastrophes in development and converts them in production", () => {
    const context = {
      frontierCapability: 60,
      accessLevel: 2,
      crisisExternalAccess: false,
      warningAcceptedOrKnownControlBreach: false,
      persistentHiddenSafetyUsed: true,
      currentControlsUsed: true,
      auditRecorded: true,
    };
    expect(isCatastropheCheckLegal(context)).toMatchObject({ legal: false });
    expect(() => enforceCatastropheLegality(95, context, "development")).toThrow(
      "Illegal catastrophe check",
    );
    expect(enforceCatastropheLegality(95, context, "production")).toMatchObject({
      severity: 84,
      contained: true,
      legality: { legal: false },
    });
  });
});

describe("evaluation calibration", () => {
  it("keeps weak and strong evidence mislabels inside the coarse GDD bands", () => {
    const trials = 2_000;
    let weakWrong = 0;
    let strongWrong = 0;
    for (let index = 0; index < trials; index += 1) {
      const oracle = new RandomOracleV1(seed128(index.toString(16).padStart(32, "0")));
      const weak = observeEvaluationTarget({
        truth: 70,
        target: "true-alignment",
        evaluationId: "weak-calibration",
        evalQuality: 10,
        oracle,
      });
      const strong = observeEvaluationTarget({
        truth: 70,
        target: "true-alignment",
        evaluationId: "strong-calibration",
        evalQuality: 90,
        oracle,
      });
      if (weak.alignmentLabel !== "reassuring") weakWrong += 1;
      if (strong.alignmentLabel !== "reassuring") strongWrong += 1;
    }
    const weakRate = weakWrong / trials;
    const strongRate = strongWrong / trials;
    expect(weakRate).toBeGreaterThanOrEqual(0.25);
    expect(weakRate).toBeLessThanOrEqual(0.4);
    expect(strongRate).toBeGreaterThanOrEqual(0.05);
    expect(strongRate).toBeLessThanOrEqual(0.15);
  });
});
