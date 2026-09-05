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
import { createTransaction } from "../../engine/transaction.ts";
import { registerCompletedTrainingArtifact } from "../../endgame/candidate-lifecycle.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import { forecastFinance } from "../../finance/finance.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { validateGameState } from "../../model/schema.ts";
import type {
  CommandId,
  EvaluationId,
  GpuLotId,
  LabId,
  ModelId,
  ModifierId,
  ResearcherId,
} from "../../model/ids.ts";
import { cashMillions, fraction, gpuCount, rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { calculateDomainOutput } from "../../research/research.ts";
import { programmeModifierTarget } from "../../researchers/researchers.ts";
import { projectGameView } from "../game-view.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  let state = addBaselineModelForTest(
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
  for (const rivalId of Object.keys(state.world.rivals).sort() as LabId[]) {
    state = addBaselineModelForTest(state, content, rivalId);
  }
  return state;
}

describe("projectGameView", () => {
  it("shows the movable fundraising inputs without exposing their weights", () => {
    const state = newState();
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const fundraising = view.fundraising;
    const breakdown = fundraising.fundingScoreBreakdown;
    expect(breakdown.productTraction).toBeGreaterThanOrEqual(0);
    expect(breakdown.recentCapability).toBeGreaterThanOrEqual(0);
    expect(breakdown.lifetimeAura).toBeGreaterThanOrEqual(0);
    expect(breakdown.scandalPenalty).toBeGreaterThanOrEqual(0);
    // The constants come from the engine, not a hardcoded UI copy of them.
    expect(fundraising.roundFractionOfMarkPercent).toBe(20);
    expect(fundraising.conditionCashPremiumPercent).toBe(22);
    expect(fundraising.recentRoundAuraSurchargePercent).toBe(15);
    expect(fundraising.recentRoundsInWindow).toBe(0);
  });

  it("gives the operational defences a ledger, built only from visible state", () => {
    const state = newState();
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const containment = view.models.containment;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    expect(containment.practicalControl.base).toBe(lab.safety.practicalControlStrength);
    expect(containment.securityPosture.base).toBe(lab.safety.securityPosture);
    expect(containment.defence).toBeCloseTo(
      0.7 * containment.practicalControl.effective +
        0.3 * containment.securityPosture.effective,
      10,
    );
    // Perfect defence divides risk by 4; the divisor is linear in defence.
    expect(containment.escalationDivisor).toBeCloseTo(
      Math.round((1 + (3 * containment.defence) / 100) * 100) / 100,
      10,
    );
    expect(containment.safetyCulture.level).toBe(lab.safety.safetyCulture);
    expect(containment.safetyCulture.incidentHazardMultiplier).toBeCloseTo(
      Math.round((1.25 - 0.007 * lab.safety.safetyCulture) * 100) / 100,
      10,
    );
    expect([8, 25, 50]).toContain(containment.safetyCulture.principledDeparturePercent);
  });

  it("uses calendar dates rather than internal ticks for GPU deliveries", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    state.run.tick = tick(485);
    state.run.calendar = calendarFromTick(state.run.tick);
    lab.compute.deliveries.push({
      lotId: "run:gpu-lot:player:calendar-label" as GpuLotId,
      generationId: contentId("base:gpu.blackwell"),
      ownership: "owned",
      physicalCount: gpuCount(80_000),
      reliability: rating(90),
      acquisitionCostMillions: cashMillions(432),
      recurringCostMillionsPerCycle: cashMillions(33.6),
      resaleFraction: fraction(0.25),
      orderedAt: tick(472),
      dueAt: tick(487),
      conditions: [],
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.meta.dateLabel).toBe("2021 · WEEK 18");
    expect(view.compute.pendingDeliveries[0]?.label).toBe(
      "80,000 Blackwell · due 2021 · WEEK 20",
    );
  });

  it("uses the valuation M/B/T/Q ladder for the overview cash headline", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    lab.finance.cash = cashMillions(163_843.7);

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.finance.balanceLabel).toBe("$163.8B");
    expect(view.topBar.finance.balanceLabel).toBe("$163.8B");
  });

  it("uses M/B/T/Q notation for model-serving revenue", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const segment = lab === undefined ? undefined : Object.values(lab.market.segments)[0];
    if (lab === undefined || segment === undefined) {
      throw new Error("test player market segment missing");
    }
    lab.market.weeksAccruedThisCycle = 4;
    segment.accruedRevenueMillions = cashMillions(1_184_860.6);

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const revenue = view.finance.linesPerCycle.find(
      (line) => line.category === "product-revenue",
    );

    expect(revenue).toMatchObject({
      description: "Model serving revenue",
      amountMillions: 1_184_860.6,
      amountLabel: "$1.18T",
    });
  });

  it("combines owned GPU operating costs in the visible finance breakdown", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const firstLot = lab?.compute.lots[0];
    if (lab === undefined || firstLot === undefined) {
      throw new Error("test player GPU lot missing");
    }
    lab.compute.lots.push({
      ...structuredClone(firstLot),
      id: "run:gpu-lot:player:display-aggregation" as never,
      recurringCostMillionsPerCycle: cashMillions(0.123456),
    });
    const forecast = forecastFinance(state, content, state.run.playerLabId);
    const rawComputePowerLines = forecast.linesPerCycle.filter(
      (line) => line.category === "compute-power",
    );
    expect(rawComputePowerLines).toHaveLength(2);

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const displayedComputePowerLines = view.finance.linesPerCycle.filter(
      (line) => line.category === "compute-power",
    );
    expect(displayedComputePowerLines).toHaveLength(1);
    expect(displayedComputePowerLines[0]).toMatchObject({
      description: "Owned GPU electricity, cooling and operations",
      sourceId: "finance:compute-power",
    });
    expect(displayedComputePowerLines[0]?.amountMillions).toBeCloseTo(
      rawComputePowerLines.reduce((sum, line) => sum + line.amountMillions, 0),
      9,
    );
  });

  it("projects the canonical default training forecast for the overview", () => {
    const state = newState();
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.models.trainingForecast).toMatchObject({
      source: "default-if-started-today",
      durationWeeks: 8,
      postureLabel: "Normal run",
      canStart: true,
      blockers: [],
    });
    expect(view.models.trainingForecast.committedTeraflops).toBeGreaterThan(0);
    expect(
      view.models.trainingForecast.estimatedFrontierCapabilityRange[0],
    ).toBeLessThanOrEqual(view.models.trainingForecast.estimatedFrontierCapability);
    expect(view.models.trainingForecast.estimatedFrontierCapability).toBeLessThanOrEqual(
      view.models.trainingForecast.estimatedFrontierCapabilityRange[1],
    );
    expect(
      view.models.trainingForecast.nominalTierBand.expected.name.length,
    ).toBeGreaterThan(0);
  });

  it("projects the canonical programme output multiplier with live researcher effects", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    const programId = contentId("base:domain.architectures");
    const leadId = "base:researcher.geoffrey-hintoff" as unknown as ResearcherId;
    const diffuserId = "base:researcher.ash-vashwani" as unknown as ResearcherId;
    const lead = state.researchers[leadId];
    const diffuser = state.researchers[diffuserId];
    if (lead === undefined || diffuser === undefined) {
      throw new Error("researcher fixture missing");
    }
    lead.employerLabId = state.run.playerLabId;
    lead.employedAt = state.run.tick;
    lead.status = "employed";
    lead.housing = "housed";
    lead.assignment = {
      kind: "capability-program",
      targetId: programId,
      role: "lead",
      assignedAt: state.run.tick,
    };
    diffuser.employerLabId = state.run.playerLabId;
    diffuser.employedAt = state.run.tick;
    diffuser.status = "employed";
    diffuser.housing = "housed";
    lab.roster.researcherIds.push(leadId, diffuserId);

    const diffusionId = "modifier:selector-diffusion" as ModifierId;
    state.modifiers[diffusionId] = {
      id: diffusionId,
      source: { kind: "system", id: "selector-diffusion" },
      labId: state.run.playerLabId,
      target: "lab.research.diffusionRate",
      operation: "add",
      value: 0.5,
      startsAt: state.run.tick,
      tags: [],
    };
    const outputId = "modifier:selector-programme-output" as ModifierId;
    state.modifiers[outputId] = {
      id: outputId,
      source: { kind: "system", id: "selector-programme-output" },
      labId: state.run.playerLabId,
      target: programmeModifierTarget(programId),
      operation: "multiply",
      value: 1.1,
      startsAt: state.run.tick,
      tags: [],
    };
    const penaltyId = "modifier:selector-programme-penalty" as ModifierId;
    state.modifiers[penaltyId] = {
      id: penaltyId,
      source: { kind: "system", id: "selector-programme-penalty" },
      labId: state.run.playerLabId,
      target: "lab.research.capability.output",
      operation: "multiply",
      value: 0.9,
      startsAt: state.run.tick,
      endsAt: tick(state.run.tick + 8),
      tags: [],
    };

    const canonical = calculateDomainOutput(
      state,
      content,
      state.run.playerLabId,
      programId,
    );
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const projected = view.research.techTree.programmes.find(
      (programme) => programme.programId === programId,
    );

    expect(projected?.assignedResearcherPercentagePoints).toBe(15);
    expect(projected?.diffusion.percentagePoints).toBeCloseTo(2.5, 10);
    expect(projected?.researchOutputMultiplier).toBeCloseTo(canonical.outputModifier, 10);
    expect(canonical.modifierContributions.map((entry) => entry.modifierId)).toContain(
      outputId,
    );
    expect(projected?.outputLedger.totalMultiplier).toBeCloseTo(
      canonical.outputModifier,
      10,
    );
    expect(projected?.outputLedger.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "lead",
          sourceKind: "programme lead",
          effectLabel: "+15%",
          tone: "positive",
        }),
        expect.objectContaining({
          group: "diffusion",
          sourceKind: "knowledge diffusion",
          effectLabel: "+2.5%",
          tone: "positive",
        }),
        expect.objectContaining({
          group: "effect",
          sourceLabel: "System · Selector Programme Output",
          effectLabel: "+10%",
          tone: "positive",
        }),
        expect.objectContaining({
          group: "effect",
          sourceLabel: "System · Selector Programme Penalty",
          effectLabel: "−10%",
          tone: "negative",
          remainingWeeks: 8,
        }),
      ]),
    );
    expect(projected?.outputLedger.otherEffectCount).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(projected?.outputLedger)).not.toMatch(/run:|base:/);
  });

  it("hides rival secret papers and exposes them immediately when published", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const paperId = contentId("base:paper.perceptron");
    const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    if (rivalLabId === undefined) throw new Error("rival fixture missing");
    const rivalLab = state.labs[rivalLabId];
    if (rivalLab === undefined) throw new Error("rival lab missing");
    rivalLab.research.discoveredPaperIds.push(paperId);
    state.world.paperRace.discoveries[paperId] = {
      paperId,
      discovererLabId: rivalLabId,
      discoveredAt: state.run.tick,
      publicationPolicy: "keep-secret",
      policyChosenAt: state.run.tick,
    };

    const context = {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    };
    const secretView = projectGameView(state, content, context);
    expect(secretView.research.papers.some((paper) => paper.paperId === paperId)).toBe(
      false,
    );
    expect(
      secretView.research.techTree.papers.find((paper) => paper.paperId === paperId)
        ?.worldFirstLabName,
    ).toBeUndefined();

    const discovery = state.world.paperRace.discoveries[paperId];
    if (discovery === undefined) throw new Error("paper discovery fixture missing");
    discovery.publicationPolicy = "publish-openly";
    const publicView = projectGameView(state, content, context);
    expect(
      publicView.research.papers.find((paper) => paper.paperId === paperId),
    ).toMatchObject({
      playerHasDiscovered: false,
      playerKnowsPaper: true,
      knowledgeSource: "publication",
    });
    expect(
      publicView.research.techTree.papers.find((paper) => paper.paperId === paperId),
    ).toMatchObject({ status: "published", statusLabel: "Public knowledge" });
  });

  it("turns stored rival incident audit text into a named player-facing report", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    if (rivalLabId === undefined) throw new Error("rival fixture missing");
    const rivalLab = state.labs[rivalLabId];
    const rival = state.world.rivals[rivalLabId];
    if (rivalLab === undefined || rival === undefined) {
      throw new Error("rival state fixture missing");
    }
    const incidentId = `rival-incident:${rivalLabId}:test`;
    rival.incidents.push({
      id: incidentId,
      occurredAt: state.run.tick,
      severity: "high",
      consequences: ["shared-restrictions"],
      riskAtCheck: rating(80),
      triggerProbability: fraction(0.2),
      draw: fraction(0.1),
    });
    state.decisionLog.push({
      tick: state.run.tick,
      summary: `${rivalLabId} high incident contained as: shared-restrictions.`,
      category: "narrative",
      source: { kind: "system", id: incidentId },
      relatedIds: [rivalLabId],
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const expectedLabName = content.labs[rivalLab.definitionId]?.displayName;

    expect(view.decisionLog.at(-1)?.summary).toBe(
      `${expectedLabName} contained a serious laboratory incident. Shared restrictions were imposed across every frontier lab.`,
    );
  });

  it("humanizes internal entity IDs stored by older researcher feed entries", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const researcher = Object.values(state.researchers)[0];
    if (rivalLabId === undefined || researcher === undefined) {
      throw new Error("people feed projection fixture missing");
    }
    const rivalLab = state.labs[rivalLabId];
    const researcherName =
      content.researchers.definitions[researcher.definitionId]?.displayName;
    const rivalLabName =
      rivalLab === undefined
        ? undefined
        : content.labs[rivalLab.definitionId]?.displayName;
    if (researcherName === undefined || rivalLabName === undefined) {
      throw new Error("people feed display-name fixture missing");
    }
    state.decisionLog.push(
      {
        tick: state.run.tick,
        summary: `${rivalLabId} made ${researcher.definitionId} an explicit offer.`,
      },
      {
        tick: state.run.tick,
        summary: `${researcher.definitionId} left the lab (poached); knowledge-transfer rules now apply.`,
      },
      {
        tick: state.run.tick,
        summary: `Delayed knowledge transfer from ${researcher.definitionId} reached ${rivalLabId}.`,
      },
    );

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.decisionLog.slice(-2).map((entry) => entry.summary)).toEqual([
      `${rivalLabName} made ${researcherName} an explicit offer.`,
      `${researcherName} left the lab (poached).`,
    ]);
    expect(
      view.decisionLog.some((entry) =>
        entry.summary.startsWith("Delayed knowledge transfer from "),
      ),
    ).toBe(false);
  });

  it("projects training reservations separately from player-schedulable GPUs", () => {
    const initial = newState();
    const lab = initial.labs[initial.run.playerLabId];
    if (lab?.models.currentModelId === undefined) {
      throw new Error("training reservation fixture missing current model");
    }
    const state = applyCommand(initial, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:test-training-reservation" as CommandId,
        expectedTick: initial.run.tick,
        issuedBy: "player",
      },
      labId: initial.run.playerLabId,
      parentModelId: lab.models.currentModelId,
      durationWeeks: 5,
      posture: "normal",
    }).state;

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.compute).toMatchObject({
      totalPhysicalGpus: 2_000,
      totalOwnedPhysicalGpus: 2_000,
      sellablePhysicalGpus: 0,
      reservedPhysicalGpus: 2_000,
      allocatablePhysicalGpus: 0,
    });
    expect(view.compute.generationMix).toContainEqual(
      expect.objectContaining({
        ownedPhysicalGpus: 2_000,
        sellablePhysicalGpus: 0,
      }),
    );
    expect(view.compute.reservations).toEqual([
      expect.objectContaining({
        displayName: "Next Aquarius generation · Prototype training",
        kind: "training",
        status: "active",
        statusLabel: "In use now",
        requestedPhysicalGpus: 2_000,
        reservedPhysicalGpus: 2_000,
        unmetPhysicalGpus: 0,
      }),
    ]);
    expect(
      view.compute.allocation.serving.physicalGpusPerWeek +
        view.compute.allocation.capabilities.physicalGpusPerWeek +
        view.compute.allocation.safety.physicalGpusPerWeek,
    ).toBe(0);
    expect(view.models.trainingForecast).toMatchObject({
      source: "active-run",
      durationWeeks: 5,
      postureLabel: "Normal run",
      canStart: true,
      blockers: [],
    });

    const queuedState = structuredClone(state) as DeepMutable<GameState>;
    const queuedProject = Object.values(queuedState.projects).find(
      (project) => project.payload.kind === "training",
    );
    if (queuedProject === undefined) throw new Error("training project missing");
    queuedProject.status = "queued";
    delete queuedProject.startedAt;
    const queuedView = projectGameView(queuedState, content, {
      viewerLabId: queuedState.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(queuedView.compute).toMatchObject({
      totalPhysicalGpus: 2_000,
      // The future commitment still prevents the hardware from being sold out
      // from under the queued run, but it does not consume live compute.
      sellablePhysicalGpus: 0,
      reservedPhysicalGpus: 0,
      allocatablePhysicalGpus: 2_000,
      reservations: [],
    });
    expect(
      queuedView.compute.allocation.serving.physicalGpusPerWeek +
        queuedView.compute.allocation.capabilities.physicalGpusPerWeek +
        queuedView.compute.allocation.safety.physicalGpusPerWeek,
    ).toBe(2_000);

    const delayed = structuredClone(state) as DeepMutable<GameState>;
    const trainingProject = Object.values(delayed.projects).find(
      (project) => project.payload.kind === "training",
    );
    if (trainingProject === undefined || trainingProject.payload.kind !== "training") {
      throw new Error("active training project missing");
    }
    const plannedTotalFlop = view.facilities.projects.find(
      (project) => project.kind === "training",
    )?.training?.plannedTotalFlop;
    trainingProject.expectedDurationWeeks += 2;
    trainingProject.payload.failureChecks.push({
      checkpoint: 0.3,
      checkedAt: tick(delayed.run.tick),
      successProbability: 0.5,
      draw: 0.6,
      outcome: "delay-and-cost",
      delayWeeks: 2,
      extraCostMillions: cashMillions(0.1),
      capabilityPenalty: 0,
    });
    const delayedView = projectGameView(delayed, content, {
      viewerLabId: delayed.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const delayedTraining = delayedView.facilities.projects.find(
      (project) => project.kind === "training",
    )?.training;
    expect(delayedTraining?.delayWeeks).toBe(2);
    expect(delayedTraining?.plannedDurationWeeks).toBe(5);
    expect(delayedTraining?.plannedTotalFlop).toBe(plannedTotalFlop);
    expect(delayedView.models.trainingForecast.durationWeeks).toBe(5);
  });

  it("explains active bonuses without exposing internal source identifiers", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const paperId = contentId("base:paper.backpropagation");
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    const currentModel =
      lab.models.currentModelId === undefined
        ? undefined
        : state.models[lab.models.currentModelId];
    if (currentModel === undefined) throw new Error("player model missing");
    delete currentModel.flags["deployment:public-launch:aura-awarded"];
    lab.research.discoveredPaperIds.push(paperId);
    state.world.paperRace.discoveries[paperId] = {
      paperId,
      discovererLabId: state.run.playerLabId,
      discoveredAt: state.run.tick,
    };
    state.score.entries.push({
      key: `paper/world-first/${paperId}`,
      tick: state.run.tick,
      categoryId: "score.scientific-legacy",
      amount: 1_000,
      source: { kind: "system", id: paperId },
      explanationKey: "score.paper.world-first",
    });
    state.score.awardedKeys[`paper/world-first/${paperId}`] = true;
    const modifierId = "run:modifier:test:leader-speed" as ModifierId;
    state.modifiers[modifierId] = {
      id: modifierId,
      source: {
        kind: "leader",
        id: "base:leader.thomas-hassabi/test-bonus",
      },
      labId: state.run.playerLabId,
      target: "lab.research.output",
      operation: "multiply",
      value: 1.2,
      startsAt: state.run.tick,
      tags: ["test"],
    };
    const consistencyModifierId = "run:modifier:test:research-consistency" as ModifierId;
    state.modifiers[consistencyModifierId] = {
      id: consistencyModifierId,
      source: {
        kind: "researcher",
        id: "base:researcher.test-consistency",
      },
      labId: state.run.playerLabId,
      target: "lab.research.domain.reinforcement-agency.weeklyVarianceWidth",
      operation: "multiply",
      value: 0.7,
      startsAt: state.run.tick,
      tags: ["test"],
    };

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const projected = view.activeModifiers.find(
      (modifier) => modifier.modifierId === modifierId,
    );

    expect(projected).toMatchObject({
      sourceKind: "leader",
      sourceLabel: "Dennis Hassabi",
      targetLabel: "Research Output",
      effectLabel: "×1.2 (+20%)",
      temporary: false,
    });
    expect(projected?.explanation).toContain("stack multiplicatively");
    const demandGrowth = view.activeModifiers.find(
      (modifier) =>
        modifier.sourceLabel === "Dennis Hassabi" &&
        modifier.targetLabel === "Customer market reach",
    );
    expect(demandGrowth).toMatchObject({
      effectLabel: "×0.85 (−15%)",
      temporary: false,
    });
    expect(demandGrowth?.explanation).toContain("no hidden demand ramp or decay");
    const consistency = view.activeModifiers.find(
      (modifier) => modifier.modifierId === consistencyModifierId,
    );
    expect(consistency).toMatchObject({
      targetLabel: "Reinforcement Learning & Agency week-to-week progress variation",
      effectLabel: "×0.7 (−30%)",
      temporary: false,
    });
    expect(consistency?.explanation).toContain("30% more consistent");
    expect(consistency?.explanation).toContain("not average research speed");
    const foundingMandate = view.activeModifiers.find(
      (modifier) => modifier.sourceKind === "founding mandate",
    );
    expect(foundingMandate).toMatchObject({
      sourceKind: "founding mandate",
      sourceLabel: "Founding mandate · Build the Science",
      temporary: false,
    });
    expect(
      JSON.stringify({
        sourceLabel: projected?.sourceLabel,
        targetLabel: projected?.targetLabel,
        effectLabel: projected?.effectLabel,
        explanation: projected?.explanation,
      }),
    ).not.toMatch(/base:|run:/);
    expect(JSON.stringify(view.finance.linesPerCycle)).not.toMatch(/base:/);
    expect(view.finance.linesPerCycle.map((line) => line.description)).toContain(
      "Rented Office I operations",
    );
    expect(view.facilities.completed.map((facility) => facility.displayName)).toEqual(
      expect.arrayContaining(["Rented Office I", "Server Rack"]),
    );
    const model = view.models.cards[0];
    expect(model?.deployment.auraPreviewByPolicy["internal-only"].auraAward).toBe(0);
    expect(
      model?.deployment.auraPreviewByPolicy["guarded-api"].auraAward,
    ).toBeGreaterThan(0);
    expect(
      model?.deployment.auraPreviewByPolicy["weights-release"].auraAward,
    ).toBeGreaterThan(
      model?.deployment.auraPreviewByPolicy["guarded-api"].auraAward ?? 0,
    );
    expect(view.research.papers[0]).toMatchObject({
      paperId,
      discovererLabName: "DeepBrain",
      worldFirst: true,
      playerHasDiscovered: true,
      discoveryScoreAward: 1_000,
      publicationScoreAward: 1_100,
      baseAuraAward: 10,
    });
    expect(view.research.papers[0]?.unlockLabels).toEqual([]);
    expect(JSON.stringify(view.research.papers[0]?.unlockLabels)).not.toContain(
      "Gradient Trained Deep Networks",
    );
    expect(JSON.stringify(view.research.papers[0]?.unlockLabels)).not.toMatch(/base:/);
    const projectedPaper = view.research.techTree.papers.find(
      (paper) => paper.paperId === paperId,
    );
    expect(projectedPaper).toMatchObject({
      title: "Learning representations by back-propagating errors",
      status: "discovered",
      primaryDomainName: "Architectures",
      primarySourceUrl: "https://doi.org/10.1038/323533a0",
    });
    expect(projectedPaper?.archiveExplanation).toContain(
      "correct answer tells us that the whole system was wrong",
    );
    const architectureTree = view.research.techTree.programmes.find(
      (programme) => programme.programId === contentId("base:domain.architectures"),
    );
    expect(
      view.research.techTree.programmes
        .filter((programme) => programme.kind === "safety")
        .map((programme) => programme.description),
    ).toEqual([
      "Primary role: safer future weights. Improves alignment and corrigibility at training time, plus a smaller practical-control bonus.",
      "Primary role: better evidence. Narrows hidden training-time safety variation and improves estimate accuracy; it does not directly subtract deception.",
      "Primary role: stronger lab defence. Improves security and containment after training; it does not change the model's intent.",
    ]);
    expect(architectureTree?.milestones).toHaveLength(5);
    expect(architectureTree?.milestones[0]).toMatchObject({
      threshold: 20,
      status: "next",
    });
    expect(architectureTree?.milestones[0]?.options).toHaveLength(2);
    expect(
      architectureTree?.milestones[0]?.options.flatMap((option) => option.effectLabels),
    ).toEqual(
      expect.arrayContaining([
        "Architectures research speed +13.9%",
        "All research speed +2.3%",
      ]),
    );
  });

  it("reveals buildable facilities plus exactly one prerequisite wave", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const project = () =>
      projectGameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).facilities.catalogue;

    const opening = project();
    expect(
      opening
        .filter((facility) => !facility.upcoming)
        .map((facility) => facility.displayName)
        .sort(),
    ).toEqual([
      "Headquarters I",
      "Power and Cooling I",
      "Press Office",
      "Server Hall",
      "Server Rack",
    ]);
    const openingHeadquarters = opening.find(
      (facility) => facility.displayName === "Headquarters I",
    );
    expect(openingHeadquarters?.bonusMajorProjectSlots).toBe(1);
    expect(openingHeadquarters?.benefits.map((benefit) => benefit.label)).toContain(
      "Adds 1 major-project slot while operational",
    );
    expect(openingHeadquarters?.benefits.map((benefit) => benefit.label)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/Executive overhead/i)]),
    );
    const openingPowerAndCooling = opening.find(
      (facility) => facility.displayName === "Power and Cooling I",
    );
    expect(openingPowerAndCooling?.benefits.map((benefit) => benefit.label)).toEqual(
      expect.arrayContaining(["Owned-GPU operating cost decreases by 10%"]),
    );
    expect(
      opening.flatMap((facility) => facility.benefits.map((benefit) => benefit.label)),
    ).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^(?:Unlocks later construction:|Awards \d+ run score on completion$)/,
        ),
      ]),
    );
    expect(
      opening
        .filter((facility) => facility.upcoming)
        .map((facility) => facility.displayName)
        .sort(),
    ).toEqual([
      "Alignment Institute I",
      "Data Centre I",
      "Research Campus I",
      "Staff Commons",
    ]);
    expect(
      opening.find((facility) => facility.displayName === "Data Centre I"),
    ).toMatchObject({
      upcoming: true,
      unmetPrerequisiteDisplayNames: ["Server Hall", "Power and Cooling I"],
    });
    expect(
      JSON.stringify(project().flatMap((facility) => facility.blockers)),
    ).not.toMatch(/base:facility/);

    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.facilities.instances.push({
      definitionId: contentId("base:facility.headquarters-1"),
      completedAt: tick(0),
      majorProjectSlotBonus: 1,
      modifierIds: [],
    });
    expect(
      projectGameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).facilities.capacity,
    ).toMatchObject({
      baseMajorProjectSlots: 2,
      facilityBonusMajorProjectSlots: 1,
      majorProjectSlots: 3,
      availableMajorProjectSlots: 3,
      maximumMajorProjectSlots: 5,
    });

    expect(project().map((facility) => facility.displayName)).toEqual(
      expect.arrayContaining([
        "Alignment Institute I",
        "Research Campus I",
        "Staff Commons",
      ]),
    );
    expect(
      project()
        .filter((facility) => !facility.upcoming)
        .map((facility) => facility.displayName),
    ).toEqual(
      expect.arrayContaining([
        "Alignment Institute I",
        "Research Campus I",
        "Staff Commons",
      ]),
    );
    const diffusionBenefit = project()
      .find((facility) => facility.displayName === "Research Campus I")
      ?.benefits.find((benefit) => benefit.label === "Knowledge diffusion rate +0.25");
    expect(diffusionBenefit).toMatchObject({
      label: "Knowledge diffusion rate +0.25",
      tone: "positive",
      help: {
        label: "Knowledge diffusion",
      },
    });
    expect(diffusionBenefit?.help?.body).toContain("programmes they are not assigned to");
    expect(project().map((facility) => facility.displayName)).not.toContain(
      "Headquarters II",
    );
    expect(project().map((facility) => facility.displayName)).not.toContain("Biofoundry");

    state.run.phase = "scaling";
    expect(project().map((facility) => facility.displayName)).toContain(
      "Headquarters II",
    );
  });

  it("shows exact discovery gates and prosperity contributions without tag-invented claims", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    state.run.phase = "frontier";
    state.world.currentGpuGenerationId = contentId("base:gpu.markov");
    const completed = new Set(
      lab.facilities.instances.map((instance) => instance.definitionId),
    );
    for (const definition of Object.values(content.facilities)) {
      if (completed.has(definition.id)) continue;
      lab.facilities.instances.push({
        definitionId: definition.id,
        completedAt: tick(0),
        majorProjectSlotBonus: definition.bonusMajorProjectSlots,
        modifierIds: [],
      });
    }

    const catalogue = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    }).facilities.catalogue;
    const facility = (displayName: string) =>
      catalogue.find((candidate) => candidate.displayName === displayName);

    expect(
      catalogue.flatMap((candidate) =>
        candidate.benefits.map((benefit) => benefit.label),
      ),
    ).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^(?:Enables facility-gated|Adds a serving-specialised home|Can satisfy staff-facility)/,
        ),
      ]),
    );
    const alignmentDiscoveries = facility("Alignment Institute I")?.benefits.find(
      (benefit) => benefit.label === "Required for 4 discoveries",
    );
    expect(alignmentDiscoveries).toMatchObject({
      label: "Required for 4 discoveries",
      help: { label: "Discovery prerequisites" },
    });
    expect(facility("Boson Factory")?.benefits).toContainEqual(
      expect.objectContaining({ label: "Required for 1 discovery" }),
    );
    const biofoundryProsperity = facility("Biofoundry")?.benefits.find((benefit) =>
      benefit.label.startsWith("Endgame benefit:"),
    );
    expect(biofoundryProsperity?.label).toBe(
      "Endgame benefit: Medicine +20 readiness · Energy & climate +8 readiness · Materials & abundance +8 readiness",
    );
    expect(biofoundryProsperity?.help).toEqual({
      label: "Endgame benefit",
      body: "Adds readiness to these public-benefit programmes during the AGI endgame. Facility contributions are capped at 20 readiness per programme.",
    });
  });

  it("reveals late datacentres one power stage and hardware era at a time", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    state.run.phase = "frontier";
    lab.finance.cash = cashMillions(1_000_000);
    const complete = (definitionId: string): void => {
      lab.facilities.instances.push({
        definitionId: contentId(definitionId),
        completedAt: state.run.tick,
        modifierIds: [],
      });
    };
    for (const definitionId of [
      "base:facility.power-and-cooling-1",
      "base:facility.data-centre-1",
      "base:facility.power-and-cooling-2",
      "base:facility.data-centre-2",
    ]) {
      complete(definitionId);
    }
    const catalogue = () =>
      projectGameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).facilities.catalogue;

    expect(
      catalogue().find(
        (facility) => facility.definitionId === "base:facility.power-and-cooling-4",
      ),
    ).toBeUndefined();
    expect(
      catalogue().find(
        (facility) => facility.definitionId === "base:facility.power-and-cooling-5",
      ),
    ).toBeUndefined();

    for (const [tier, generationId] of [
      [3, state.world.currentGpuGenerationId],
      [4, contentId("base:gpu.rubin")],
      [5, contentId("base:gpu.markov")],
    ] as const) {
      state.world.currentGpuGenerationId = generationId;
      const powerId = `base:facility.power-and-cooling-${String(tier)}`;
      const dataCentreId = `base:facility.data-centre-${String(tier)}`;
      expect(
        catalogue().find((facility) => facility.definitionId === powerId),
      ).toMatchObject({
        upcoming: false,
        available: true,
        majorProjectSlotsRequired: tier >= 4 ? 2 : 1,
      });
      expect(
        catalogue().find((facility) => facility.definitionId === dataCentreId),
      ).toMatchObject({
        upcoming: true,
        available: false,
        unmetPrerequisiteDisplayNames: [content.facilities[powerId]?.displayName],
      });

      complete(powerId);
      expect(
        catalogue().find((facility) => facility.definitionId === dataCentreId),
      ).toMatchObject({
        upcoming: false,
        available: true,
        majorProjectSlotsRequired: tier >= 4 ? 2 : 1,
        unmetPrerequisiteDisplayNames: [],
      });
      complete(dataCentreId);

      if (tier === 3) {
        expect(
          catalogue().find(
            (facility) => facility.definitionId === "base:facility.power-and-cooling-4",
          ),
        ).toBeUndefined();
      }
      if (tier === 4) {
        expect(
          catalogue().find(
            (facility) => facility.definitionId === "base:facility.power-and-cooling-5",
          ),
        ).toBeUndefined();
      }
    }
  });

  it("projects a confirmed GPU allocation before the next simulation week", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab fixture missing");
    const allocation = structuredClone(lab.compute.allocation);
    state.run.queuedOrders.push({
      kind: "set-gpu-allocation",
      labId: state.run.playerLabId,
      allocation,
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.compute.queuedAllocation).toEqual({
      ...allocation,
    });
  });

  it("projects presentation queue items as player-safe display records", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const definition = Object.values(content.capabilityTiers.definitions)[0];
    if (lab?.models.currentModelId === undefined || definition === undefined) {
      throw new Error("presentation projection fixture missing");
    }
    state.presentationQueue.push({
      key: `capability-tier:${lab.models.currentModelId}:${definition.id}`,
      kind: "capability-tier",
      attention: "modal",
      definitionId: definition.id,
      modelId: lab.models.currentModelId,
      createdAt: state.run.tick,
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.presentationQueue).toEqual([
      {
        key: `capability-tier:${lab.models.currentModelId}:${definition.id}`,
        kind: "capability-tier",
        attention: "modal",
        definitionId: definition.id,
        modelId: lab.models.currentModelId,
        createdAtTick: state.run.tick,
        title: definition.name,
        summary: definition.summary,
        tierLevel: definition.level,
        modelDisplayName:
          state.models[lab.models.currentModelId]?.displayName ?? "The current model",
        ownerLabId: state.run.playerLabId,
        ownerLabName: content.labs[lab.definitionId]?.displayName ?? "Your lab",
        ownerAiName: content.labs[lab.definitionId]?.aiFamily ?? "Unknown AI programme",
        isPlayerModel: true,
        unlockLabels: definition.unlockTags.map((tag) =>
          tag
            .replaceAll("-", " ")
            .replace(/\b\w/g, (character) => character.toUpperCase()),
        ),
      },
    ]);
    expect(JSON.stringify(view.presentationQueue)).not.toMatch(
      /trueCapability|draw|threshold/,
    );
  });

  it("projects a Safety Practice celebration with exact permanent benefits", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    const definition =
      content.evaluations.definitions[contentId("base:evaluation.alignment-interview")];
    if (modelId === undefined || definition === undefined) {
      throw new Error("Safety Practice presentation fixture missing");
    }
    state.presentationQueue.push({
      key: "safety-practice-level:evaluation:test:2",
      kind: "safety-practice-level",
      attention: "modal",
      evaluationId: "evaluation:test" as EvaluationId,
      definitionId: definition.id,
      modelId,
      fromLevel: 1,
      toLevel: 2,
      previousPracticeXp: 1,
      newPracticeXp: 2,
      practiceXpGained: 1,
      createdAt: state.run.tick,
    });
    expect(() => validateGameState(state)).not.toThrow();

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.presentationQueue.at(-1)).toEqual({
      key: "safety-practice-level:evaluation:test:2",
      kind: "safety-practice-level",
      attention: "modal",
      evaluationId: "evaluation:test",
      modelId,
      modelDisplayName: state.models[modelId]?.displayName,
      evaluationDisplayName: definition.displayName,
      createdAtTick: state.run.tick,
      fromLevel: 1,
      toLevel: 2,
      fromLabel: "Ad hoc",
      toLabel: "Repeatable checks",
      previousPracticeXp: 1,
      newPracticeXp: 2,
      practiceXpGained: 1,
      previousBenefits: {
        auditTimeReductionPercent: 0,
        evaluationCashReductionPercent: 0,
        estimateUncertaintyReduction: 0,
        anomalyDetectionBonusPercent: 0.4,
      },
      currentBenefits: {
        auditTimeReductionPercent: 4,
        evaluationCashReductionPercent: 3,
        estimateUncertaintyReduction: 1,
        anomalyDetectionBonusPercent: 0.8,
      },
      nextLevel: 3,
      nextThreshold: 5,
      pointsToNextLevel: 3,
    });
    expect(JSON.stringify(view.presentationQueue.at(-1))).not.toMatch(
      /hiddenSafety|hiddenInternalCandour|trueCapability|draw|randomKey/,
    );
  });

  it("projects ordinary and candidate incidents as player-safe modal alarms", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("incident presentation fixture missing");
    state.presentationQueue.push(
      {
        key: "model-incident-result:test",
        kind: "model-incident-result",
        attention: "modal",
        modelId,
        occurredAt: state.run.tick,
        category: "major",
        severity: rating(63),
        contained: true,
        threatLabel: "HACKING / UNAUTHORISED ACCESS",
        headline: "The model accessed a protected system.",
        auraLoss: 8,
        fineMillions: 12,
        governmentTrustLost: 7,
        governmentAttentionAdded: 10,
      },
      {
        key: "candidate-containment-incident:test",
        kind: "candidate-containment-incident",
        attention: "modal",
        modelId,
        incidentId: "candidate-incident:test",
        incidentClass: "copying-attempt",
        incidentKind: "active-incident",
        origin: "weekly-pressure",
        createdAt: state.run.tick,
      },
    );
    expect(() => validateGameState(state)).not.toThrow();

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.presentationQueue[0]).toMatchObject({
      kind: "model-incident-result",
      attention: "modal",
      threatLabel: "HACKING / UNAUTHORISED ACCESS",
      governmentTrustLost: 7,
      governmentAttentionAdded: 10,
      researchOutputReductionPercent: 0,
    });
    expect(view.presentationQueue[1]).toMatchObject({
      kind: "candidate-containment-incident",
      attention: "modal",
      classLabel: "WEIGHT THEFT / COPYING ATTEMPT",
      localBreach: false,
    });
    expect(JSON.stringify(view.presentationQueue)).not.toMatch(
      /trueAlignment|corrigibility|superintelligenceTruth|threshold|draw/,
    );
  });

  it("projects a proof verdict from its safe snapshot after the crisis has closed", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("proof presentation model missing");
    expect(state.endgame.stage).toBe("inactive");
    state.presentationQueue.push({
      key: "capability-proof-result:proof:stale",
      kind: "capability-proof-result",
      attention: "modal",
      modelId,
      historyId: "proof:stale",
      challengeId: "generalist-gauntlet",
      verifierId: "independent-institutional",
      attemptIndex: 0,
      resultId: "disputed",
      claimScope: "broad-superintelligence",
      evidenceStrength: 46,
      integrityLabel: "Durable",
      summary: "The candidate did not produce a durable pass.",
      consequence: "Regulators opened an inquiry.",
      accessLevelAtProof: 2,
      createdAt: state.run.tick,
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.presentationQueue.at(-1)).toMatchObject({
      kind: "capability-proof-result",
      outcome: "disputed",
      resultId: "disputed",
      challengeName: "Generalist gauntlet",
      verifierName: "Independent institutional verification",
      evidenceStrength: 46,
      consequence: "Regulators opened an inquiry.",
    });
    expect(JSON.stringify(view.presentationQueue.at(-1))).not.toMatch(
      /hiddenAudit|draw|genuineSuperintelligence|trueCapability/,
    );
  });

  it("projects a rival candidacy setback using only public names and elapsed time", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rivalLab = rivalLabId === undefined ? undefined : state.labs[rivalLabId];
    const modelId = rivalLab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (rivalLabId === undefined || rivalLab === undefined || model === undefined) {
      throw new Error("rival setback projection fixture missing");
    }
    state.run.tick = tick(40);
    state.run.calendar = calendarFromTick(40);
    state.presentationQueue.push({
      key: `rival-candidate-setback:false-dawn:${rivalLabId}:${model.id}:12`,
      kind: "rival-candidate-setback",
      attention: "modal",
      outcome: "false-dawn",
      labId: rivalLabId,
      modelId: model.id,
      createdAt: tick(40),
      countdownStartedAt: tick(12),
    });
    expect(() => validateGameState(state)).not.toThrow();

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.presentationQueue.at(-1)).toEqual({
      key: `rival-candidate-setback:false-dawn:${rivalLabId}:${model.id}:12`,
      kind: "rival-candidate-setback",
      attention: "modal",
      outcome: "false-dawn",
      rivalLabId,
      rivalLabName: content.labs[rivalLab.definitionId]?.displayName,
      rivalAiName: content.labs[rivalLab.definitionId]?.aiFamily,
      modelId: model.id,
      modelDisplayName: model.displayName,
      createdAtTick: 40,
      countdownStartedAtTick: 12,
      elapsedWeeks: 28,
    });
    expect(JSON.stringify(view.presentationQueue.at(-1))).not.toMatch(
      /superintelligenceTruth|probabilityAtFirstCrossing|randomKey|draw|trueCapability/,
    );
  });

  it("compares every newly evaluated player model with its predecessor", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const previousModelId = lab?.models.currentModelId;
    const previousModel =
      previousModelId === undefined ? undefined : state.models[previousModelId];
    const tierTwo = content.capabilityTiers.orderedIds
      .map((id) => content.capabilityTiers.definitions[id])
      .find((definition) => definition?.level === 2);
    if (
      lab === undefined ||
      previousModel === undefined ||
      previousModel.measuredCapability === undefined ||
      tierTwo === undefined
    ) {
      throw new Error("model comparison fixture missing");
    }
    previousModel.displayName = "Aquarius-1";
    previousModel.measuredCapability.frontierCapability = rating(40);
    previousModel.measuredCapability.values.reasoning = rating(40);
    previousModel.reliability = rating(50);

    const successor = structuredClone(previousModel);
    successor.id = "run:model:player:tier-comparison" as ModelId;
    successor.displayName = "Aquarius-2";
    successor.generationIndex += 1;
    successor.trainedAt = tick(previousModel.trainedAt + 1);
    successor.flags = {};
    const successorEstimate = successor.measuredCapability;
    if (successorEstimate === undefined) {
      throw new Error("successor comparison estimate missing");
    }
    successorEstimate.frontierCapability = rating(25);
    successorEstimate.values.language = rating(35);
    successorEstimate.values.reasoning = rating(20);
    state.models[successor.id] = successor;
    lab.models.modelIds.push(successor.id);
    lab.models.currentModelId = successor.id;
    state.presentationQueue.push({
      key: `capability-tier:${successor.id}:${tierTwo.id}`,
      kind: "capability-tier",
      attention: "modal",
      definitionId: tierTwo.id,
      modelId: successor.id,
      createdAt: state.run.tick,
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.presentationQueue[0]).toMatchObject({
      kind: "capability-tier",
      modelDisplayName: "Aquarius-2",
      tierLevel: 2,
      previousModelComparison: {
        kind: "lower-tier",
        previousModelDisplayName: "Aquarius-1",
        previousTierLevel: 3,
        tierDelta: -1,
        frontierCapabilityDelta: -15,
      },
    });
  });

  it("projects autonomy requests with benefits and public safety implications", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (lab === undefined || modelId === undefined || model === undefined) {
      throw new Error("autonomy presentation fixture missing");
    }
    if (model.measuredCapability === undefined) {
      throw new Error("autonomy presentation requires measured capability");
    }
    model.measuredCapability.frontierCapability = rating(50);
    state.presentationQueue.push({
      key: `autonomy-unlock:${modelId}:4`,
      kind: "autonomy-unlock",
      attention: "modal",
      modelId,
      level: 4,
      createdAt: state.run.tick,
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.presentationQueue[0]).toMatchObject({
      key: `autonomy-unlock:${modelId}:4`,
      kind: "autonomy-unlock",
      level: 4,
      levelName: "Laboratory operator",
      unlockCapability: 50,
      safetyTone: "critical",
    });
    const projectedRequest = view.presentationQueue[0];
    if (projectedRequest?.kind !== "autonomy-unlock") {
      throw new Error("projected autonomy request missing");
    }
    expect(projectedRequest.benefitLabel).toContain("Research output");
    expect(projectedRequest.safetyLabel).toContain("escalation chain");
    expect(projectedRequest.exposedSystems).toContain("Laboratory control systems");
    expect(view.models.autonomy.levels[5]).toMatchObject({
      unlockCapability: 75,
      fullAccelerationCapability: 100,
      maximumResearchMultiplier: 6,
    });
    expect(JSON.stringify(view.presentationQueue)).not.toMatch(
      /trueAlignment|deceptiveCapability|deceptiveIntent|situationalAwareness/,
    );
  });

  it("does not leak hidden model safety through the autonomy risk label", () => {
    const unsafe = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = unsafe.labs[unsafe.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : unsafe.models[modelId];
    if (modelId === undefined || model === undefined) {
      throw new Error("autonomy leak fixture missing");
    }
    model.accessLevel = 3;
    model.hiddenSafety.trueAlignment = rating(0);
    model.hiddenSafety.corrigibility = rating(0);
    model.hiddenSafety.situationalAwareness = rating(100);
    model.hiddenSafety.deceptiveCapability = rating(100);
    model.hiddenSafety.deceptiveIntent = rating(100);
    const safe = structuredClone(unsafe);
    const safeModel = safe.models[modelId];
    if (safeModel === undefined) throw new Error("autonomy leak fixture missing");
    safeModel.hiddenSafety.trueAlignment = rating(100);
    safeModel.hiddenSafety.corrigibility = rating(100);
    safeModel.hiddenSafety.situationalAwareness = rating(0);
    safeModel.hiddenSafety.deceptiveCapability = rating(0);
    safeModel.hiddenSafety.deceptiveIntent = rating(0);
    const context = {
      viewerLabId: unsafe.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    };
    const unsafeView = projectGameView(unsafe, content, context);
    const safeView = projectGameView(safe, content, context);
    expect(unsafeView.models.autonomy.riskLabel).toBe(safeView.models.autonomy.riskLabel);
    expect(unsafeView.models.autonomy.riskLabel).toContain("not knowable");
    expect(unsafeView.models.cards[0]?.safetyAssessment).toEqual(
      safeView.models.cards[0]?.safetyAssessment,
    );
  });

  it("keeps undetected autonomy activity out of the player view until revealed", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) {
      throw new Error("autonomy visibility fixture missing");
    }
    lab.autonomy.escalations.push({
      id: "autonomy:hidden-probe",
      stage: "experiments",
      modelId,
      detectedAt: state.run.tick,
      status: "ignored",
    });
    lab.autonomy.escapedWeightsAt = state.run.tick;
    const context = {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    };

    const hidden = projectGameView(state, content, context);
    expect(hidden.models.autonomy.incidents).toEqual([]);
    expect(hidden.models.autonomy.escapedWeights).toBe(false);

    state.run.tick = tick(state.run.tick + 6);
    const revealed = projectGameView(state, content, context);
    expect(revealed.models.autonomy.escapedWeights).toBe(true);
    expect(revealed.models.autonomy.incidents).toEqual([]);
  });

  it("identifies a model-specific reauthorization from retained predecessor access", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const previousModelId = lab?.models.currentModelId;
    const previousModel =
      previousModelId === undefined ? undefined : state.models[previousModelId];
    if (
      lab === undefined ||
      previousModelId === undefined ||
      previousModel === undefined
    ) {
      throw new Error("autonomy reauthorization fixture missing");
    }
    previousModel.displayName = "Aquarius-1";
    previousModel.accessLevel = 2;
    const successor = structuredClone(previousModel);
    successor.id = "run:model:player:reauthorization" as ModelId;
    successor.displayName = "Aquarius-2";
    successor.generationIndex += 1;
    successor.trainedAt = tick(previousModel.trainedAt + 1);
    successor.accessLevel = 0;
    successor.flags = {};
    if (successor.measuredCapability === undefined) {
      throw new Error("autonomy reauthorization requires measured capability");
    }
    successor.measuredCapability.frontierCapability = rating(14.05196406862016);
    state.models[successor.id] = successor;
    lab.models.modelIds.push(successor.id);
    lab.models.currentModelId = successor.id;
    state.presentationQueue.push({
      key: `autonomy-unlock:${successor.id}:1`,
      kind: "autonomy-unlock",
      attention: "modal",
      modelId: successor.id,
      level: 1,
      createdAt: state.run.tick,
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.presentationQueue[0]).toMatchObject({
      kind: "autonomy-unlock",
      modelDisplayName: "Aquarius-2",
      level: 1,
      unlockCapability: 14.05196406862016,
      previousAuthorisedModelDisplayName: "Aquarius-1",
    });

    const queuedRequest = state.presentationQueue[0];
    if (queuedRequest?.kind !== "autonomy-unlock") {
      throw new Error("autonomy reauthorization queue item missing");
    }
    queuedRequest.level = 3;
    successor.measuredCapability.frontierCapability = rating(35);
    const genuinelyNewRung = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(genuinelyNewRung.presentationQueue[0]).not.toHaveProperty(
      "previousAuthorisedModelDisplayName",
    );
  });

  it("projects rival ranges, relationships, and legal diplomacy without hidden truth", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rival = rivalId === undefined ? undefined : state.world.rivals[rivalId];
    const modelId =
      rivalId === undefined ? undefined : state.labs[rivalId]?.models.currentModelId;
    if (rivalId === undefined || rival === undefined || modelId === undefined) {
      throw new Error("rival world projection fixture missing");
    }
    rival.candidateCountdown = {
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
      estimateNoiseUnit: 0.75,
      finalYearWarningIssued: true,
    };
    state.world.rivalSignals.push({
      id: `signal:${rivalId}`,
      labId: rivalId,
      kind: "benchmark",
      occurredAt: tick(3),
      subjectId: modelId,
      actualValue: 60,
      noiseUnit: -0.5,
      baseErrorRadius: 10,
      summary: "A newer noisy benchmark should not displace candidate evidence.",
    });
    state.world.rivalSignals.push({
      id: `signal:${rivalId}:candidate`,
      labId: rivalId,
      kind: "candidate",
      occurredAt: tick(0),
      subjectId: modelId,
      actualValue: 90,
      noiseUnit: 0,
      baseErrorRadius: 6,
      summary: "Credible evidence identifies a qualifying rival candidate.",
    });
    state.world.rivalSignals.push({
      id: `signal:${rivalId}:incident`,
      labId: rivalId,
      kind: "incident",
      occurredAt: tick(1),
      subjectId: modelId,
      actualValue: 99,
      noiseUnit: 0.5,
      baseErrorRadius: 5,
      summary: "A later incident signal should not be mistaken for capability.",
    });
    state.world.rivalSignals.push({
      id: `signal:${rivalId}:autonomy`,
      labId: rivalId,
      kind: "autonomy",
      occurredAt: tick(2),
      subjectId: modelId,
      actualValue: 4,
      noiseUnit: 0.25,
      baseErrorRadius: 0.75,
      summary: "Analysts report an expansion of model-directed research access.",
    });

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: { [rivalId]: 25 },
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const projected = view.world.rivals.find((candidate) => candidate.labId === rivalId);

    expect(view.world.rivals).toHaveLength(4);
    expect(projected?.leaderId).toMatch(/^base:leader\./);
    expect(projected?.leaderName.length).toBeGreaterThan(0);
    expect(projected?.candidateCountdown?.confidence).toBe("low");
    expect(projected?.candidateCountdown?.estimateRangeWeeks).toHaveLength(2);
    expect(projected?.candidateCountdown?.finalDeploymentWarningActive).toBe(true);
    expect(projected?.latestCapabilitySignal?.kind).toBe("candidate");
    expect(projected?.latestCapabilitySignal?.estimateRange).toHaveLength(2);
    expect(projected?.latestCapabilitySignal?.estimateRange[0]).toBeGreaterThanOrEqual(
      88,
    );
    expect(projected?.latestCapabilitySignal?.estimateRange[1]).toBeGreaterThanOrEqual(
      88,
    );
    expect(projected?.latestAutonomySignal?.levelRange).toHaveLength(2);
    expect(projected?.latestAutonomySignal?.summary).toContain("model-directed");
    expect(projected?.diplomacyOptions).toHaveLength(4);
    expect(projected?.diplomacyOptions[0]?.benefits.length).toBeGreaterThan(0);
    expect(projected?.diplomacyOptions[0]?.strategicUse).toContain("coalition");
    expect(projected?.diplomacyOptions[0]?.limitation).toContain("weekly research");
    expect(JSON.stringify(view.world)).not.toMatch(
      /actualValue|noiseUnit|estimateNoiseUnit|completesAt|acceptanceProbability|draw/,
    );
  });

  it("projects the canonical first-crossing prior without redrawing from current FC", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model === undefined) throw new Error("test player model missing");
    model.trueCapability = {
      language: rating(92),
      reasoning: rating(92),
      agency: rating(92),
      toolUse: rating(92),
      multimodality: rating(92),
      scientificAbility: rating(92),
      embodiment: rating(92),
    };
    model.measuredCapability = {
      values: structuredClone(model.trueCapability),
      frontierCapability: rating(92),
      confidence: "high",
      evidenceFlags: ["selector-prior-fixture"],
    };
    model.accessLevel = 0;
    model.deployment.policy = "internal-only";
    model.deployment.exposure = 0;

    const tx = createTransaction(state);
    expect(
      registerCompletedTrainingArtifact(tx, model.id, new RandomOracleV1(state.run.seed)),
    ).toBe(true);
    const registered = tx.commit({ description: "register selector prior fixture" });
    const variant = structuredClone(registered.state) as DeepMutable<GameState>;
    const variantModel = variant.models[model.id];
    const artifact = variantModel?.candidateArtifact;
    if (variantModel?.measuredCapability === undefined || artifact === undefined) {
      throw new Error("registered candidate artifact missing");
    }
    variantModel.measuredCapability.frontierCapability = rating(97);
    artifact.candidateBasis = {
      kind: "derived-from-qualified",
      sourceModelId: "run:model:player:missing-source" as ModelId,
      qualifyingSourceModelId: "run:model:player:missing-qualifier" as ModelId,
      derivedAt: variant.run.tick,
    };

    const view = projectGameView(variant, content, {
      viewerLabId: variant.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const projected = view.models.candidateCustody.artifacts.find(
      (candidate) => candidate.modelId === model.id,
    );
    expect(projected).toMatchObject({
      firstCrossingFrontierCapability: 92,
      firstCrossingPriorPercent: 20,
      currentFrontierCapability: 97,
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /superintelligenceTruth|probabilityAtFirstCrossing|randomKey|draw/,
    );
  });

  it("projects held and consumed successor continuity without exposing a hidden grant", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("test player lab missing");
    state.endgameHistory.verifiedCandidateRetirementCount = 1;
    state.endgameHistory.successorEfficiencyGrantConsumed = false;
    lab.flags["endgame:successor-efficiency-rate"] = 0.04;

    const held = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(held.models.successorTrainingContinuity).toEqual({
      status: "held",
      ratePercent: 4,
    });

    state.endgameHistory.successorEfficiencyGrantConsumed = true;
    delete lab.flags["endgame:successor-efficiency-rate"];
    const consumed = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(consumed.models.successorTrainingContinuity).toEqual({
      status: "consumed",
    });
  });

  it("uses compact money notation for every AGI candidate work", () => {
    const state = newState();
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(
      view.models.candidateProgramme.components.map((item) => item.costLabel),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("$25B"),
        expect.stringContaining("$40B"),
        expect.stringContaining("$30B"),
        expect.stringContaining("$20B"),
      ]),
    );
  });
});
