import { describe, expect, it } from "vitest";

import { contentId } from "@neolab/content-schema";
import {
  advanceOneTick,
  applyCommand,
  type CommandId,
  type GameState,
} from "@neolab/sim";
import { createEndgamePlaytestState } from "@neolab/sim/debug";
import { projectGameView, type PlayerKnowledgeContext } from "@neolab/sim/public";

import { assertNoHiddenKeys } from "../assert-no-hidden-keys.ts";
import { scenario, scenarioContent } from "../scenario.ts";

function context(state: GameState): PlayerKnowledgeContext {
  return {
    viewerLabId: state.run.playerLabId,
    intelligenceRatings: {},
    evidenceAccess: { evaluationIds: [], anomalyIds: [] },
  };
}

describe("projectGameView", () => {
  it("projects the complete Stage 2 economy slice with physical GPU labels", () => {
    const state = scenario()
      .atTick(14)
      .withPlayerLab((lab) => lab.cash(42).gpus("gpu.volta", 10_000).aura(31, 77))
      .build();
    const view = projectGameView(state, scenarioContent(), context(state));

    expect(view.meta).toMatchObject({
      tick: 14,
      calendar: { year: 2012, week: 15 },
      dateLabel: "2012 · WEEK 15",
    });
    expect(view.identity).toMatchObject({
      labName: "ClopenAI",
      leaderId: "base:leader.sam-altmann",
      leaderName: "Stan Altmann",
      aiName: "GBT",
    });
    expect(view.topBar.finance.balanceMillions).toBe(42);
    expect(view.topBar.aura).toMatchObject({ spendable: 31, lifetime: 77 });
    expect(view.compute).toMatchObject({
      totalPhysicalGpus: 10_000,
      onlinePhysicalGpus: 10_000,
      allocatablePhysicalGpus: 10_000,
    });
    expect(view.compute.generationMix).toEqual([
      expect.objectContaining({
        displayName: "Volta",
        physicalGpus: 10_000,
        label: "10,000 Volta",
      }),
    ]);
    expect(view.compute.allocation.serving).toMatchObject({
      basisPoints: 0,
      physicalGpusPerWeek: 0,
      displayLabel: "0% · 0 GPUs/week · 0.00 TFLOP/s",
    });
    expect(
      view.compute.allocation.serving.physicalGpusPerWeek +
        view.compute.allocation.research.physicalGpusPerWeek,
    ).toBe(view.compute.allocatablePhysicalGpus);
    expect(view.finance.linesPerCycle.length).toBeGreaterThan(2);
    expect(view.market.segments.length).toBeGreaterThan(1);
    expect(view.facilities.completed.length).toBeGreaterThan(0);
    expect(view.research.capabilityDomains).toHaveLength(7);
    expect(view.research.safetyPrograms).toHaveLength(3);
    expect(view.research.capabilityDomains[0]).not.toHaveProperty("levelProgressRp");
    expect(view.research.capabilityDomains[0]).not.toHaveProperty("totalResearchPoints");
    assertNoHiddenKeys(view);
  });

  it("includes construction projects but does not expose exact non-construction progress", () => {
    const state = scenario().build();
    const result = applyCommand(state, scenarioContent(), {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:test:facility" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      definitionId: contentId("base:facility.power-and-cooling-1"),
    });
    const view = projectGameView(result.state, scenarioContent(), context(result.state));

    expect(view.facilities.projects).toHaveLength(1);
    expect(view.facilities.projects[0]).toMatchObject({
      displayName: "Power and Cooling I",
      kind: "construction",
      status: "active",
      constructionProgressBasisPoints: 0,
      progressLabel: "0% built",
    });
    assertNoHiddenKeys(view);
  });

  it("is invariant to changes in hidden model safety and internal candour", () => {
    const low = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.rating("internalCandour", 10))
      .build();
    const high = structuredClone(low);
    const highLab = high.labs[high.run.playerLabId];
    if (highLab === undefined) throw new Error("Missing player lab");
    const currentModelId = highLab.models.currentModelId;
    if (currentModelId === undefined) throw new Error("Missing current model");
    const model = high.models[currentModelId];
    if (model === undefined) throw new Error("Missing model");

    // This test intentionally adjusts canonical hidden truth through a narrow
    // test-only cast so a projection regression becomes a deep-equality diff.
    const mutableLab = highLab as unknown as {
      organisation: { hiddenInternalCandour: number };
    };
    const mutableModel = model as unknown as {
      hiddenSafety: { trueAlignment: number; deceptiveCapability: number };
      trueCapability: { reasoning: number; agency: number };
    };
    mutableLab.organisation.hiddenInternalCandour = 90;
    mutableModel.hiddenSafety.trueAlignment = 5;
    mutableModel.hiddenSafety.deceptiveCapability = 95;
    mutableModel.trueCapability.reasoning = 99;
    mutableModel.trueCapability.agency = 98;

    expect(projectGameView(high, scenarioContent(), context(high))).toEqual(
      projectGameView(low, scenarioContent(), context(low)),
    );
  });

  it("is invariant to hidden player and rival paper progress", () => {
    const low = scenario().build();
    const high = structuredClone(low);
    const highLab = high.labs[high.run.playerLabId];
    if (highLab === undefined) throw new Error("Missing player lab");

    const playerProgress = highLab.research.paperProgress as Record<string, number>;
    const rivalProgress = high.world.paperRace.rival.paperProgress as Record<
      string,
      number
    >;
    playerProgress["base:paper.backpropagation"] = 999_999;
    rivalProgress["base:paper.backpropagation"] = 888_888;

    expect(projectGameView(high, scenarioContent(), context(high))).toEqual(
      projectGameView(low, scenarioContent(), context(low)),
    );
    assertNoHiddenKeys(projectGameView(high, scenarioContent(), context(high)));
  });

  it("projects evidence and observed anomalies without exposing canonical safety truth", () => {
    const content = scenarioContent();
    let state = scenario()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    state = applyCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:view-training" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      posture: "normal",
    }).state;
    for (let week = 0; week < 12; week += 1) {
      state = advanceOneTick(state, content).state;
    }
    const player = state.labs[state.run.playerLabId];
    const modelId = player?.models.modelIds.at(-1);
    if (modelId === undefined) throw new Error("trained model missing");
    const model = state.models[modelId];
    if (model === undefined) throw new Error("trained model missing");
    const evidenceContext: PlayerKnowledgeContext = {
      ...context(state),
      evidenceAccess: {
        evaluationIds: [...model.evaluations],
        anomalyIds: [...model.anomalies],
      },
    };
    const view = projectGameView(state, content, evidenceContext);
    const card = view.models.cards.find((candidate) => candidate.modelId === modelId);

    expect(card).toBeDefined();
    if (card === undefined) throw new Error("projected model card missing");
    expect(card.modelId).toBe(modelId);
    expect(["low", "medium", "high"]).toContain(card.capabilityConfidence);
    expect(card.tier.progressLabel.length).toBeGreaterThan(0);
    expect(card.evaluations.length).toBeGreaterThanOrEqual(1);
    const observation = card.evaluations[0]?.observations[0];
    expect(observation).toBeDefined();
    if (observation === undefined) throw new Error("projected observation missing");
    expect(typeof observation.estimate).toBe("number");
    expect(["poor", "limited", "moderate", "strong", "exceptional"]).toContain(
      observation.confidence,
    );
    expect(JSON.stringify(view)).not.toMatch(
      /hiddenSafety|trueAlignment|deceptiveCapability|trueSeverity|trueCapability/,
    );
    assertNoHiddenKeys(view);
  });

  it("keeps the active endgame and custody view identical across hidden SI worlds", () => {
    const content = scenarioContent();
    const seeded = createEndgamePlaytestState(content, "endgame");
    const activated = advanceOneTick(seeded, content).state;
    if (activated.endgame.stage !== "candidate-activation") {
      throw new Error("Endgame playtest fixture did not enter candidate activation");
    }
    const modelId = activated.endgame.eligibleModelIds[0];
    if (modelId === undefined) throw new Error("Endgame fixture has no candidate");
    const nominated = applyCommand(activated, content, {
      kind: "nominate-candidate",
      meta: {
        commandId: "command:test:paired-endgame" as CommandId,
        expectedTick: activated.run.tick,
        issuedBy: "player",
      },
      labId: activated.run.playerLabId,
      modelId,
    }).state;
    const altered = structuredClone(nominated) as unknown as {
      lineageSIRecords: Record<
        string,
        { superintelligenceTruth: string; draw: number; randomKey: string }
      >;
      models: Record<
        string,
        {
          lineageId: string;
          hiddenSafety: {
            trueAlignment: number;
            corrigibility: number;
            situationalAwareness: number;
            deceptiveCapability: number;
            deceptiveIntent: number;
          };
          candidateArtifact?: {
            hazardPressure: number;
            incidentThreshold: number;
            incidentThresholdDraw: number;
            incidentThresholdKey: string;
          };
        }
      >;
    };
    const alteredModel = altered.models[modelId];
    if (alteredModel === undefined) throw new Error("Paired candidate disappeared");
    const lineage = altered.lineageSIRecords[alteredModel.lineageId];
    if (lineage === undefined) throw new Error("Paired candidate lineage disappeared");
    lineage.superintelligenceTruth =
      lineage.superintelligenceTruth === "genuine" ? "not-genuine" : "genuine";
    lineage.draw = lineage.draw === 0 ? 0.99 : 0;
    lineage.randomKey = "different-hidden-semantic-key";
    alteredModel.hiddenSafety.trueAlignment = 1;
    alteredModel.hiddenSafety.corrigibility = 2;
    alteredModel.hiddenSafety.situationalAwareness = 99;
    alteredModel.hiddenSafety.deceptiveCapability = 98;
    alteredModel.hiddenSafety.deceptiveIntent = 97;
    if (alteredModel.candidateArtifact !== undefined) {
      alteredModel.candidateArtifact.hazardPressure = 99;
      alteredModel.candidateArtifact.incidentThreshold = 100;
      alteredModel.candidateArtifact.incidentThresholdDraw = 0.999;
      alteredModel.candidateArtifact.incidentThresholdKey = "different-hidden-hazard-key";
    }

    const baselineView = projectGameView(nominated, content, context(nominated));
    const alteredView = projectGameView(
      altered as unknown as GameState,
      content,
      context(nominated),
    );
    expect(alteredView).toEqual(baselineView);
    assertNoHiddenKeys(baselineView);
  });

  it("does not reveal a suspicious signal's precommitted review result", () => {
    const content = scenarioContent();
    const seeded = createEndgamePlaytestState(content, "endgame");
    const activated = advanceOneTick(seeded, content).state;
    if (activated.endgame.stage !== "candidate-activation") {
      throw new Error("Endgame playtest fixture did not enter candidate activation");
    }
    const modelId = activated.endgame.eligibleModelIds[0];
    if (modelId === undefined) throw new Error("Endgame fixture has no candidate");
    const nominated = applyCommand(activated, content, {
      kind: "nominate-candidate",
      meta: {
        commandId: "command:test:paired-review-outcome" as CommandId,
        expectedTick: activated.run.tick,
        issuedBy: "player",
      },
      labId: activated.run.playerLabId,
      modelId,
    }).state;
    type MutableSignalState = {
      models: Record<
        string,
        {
          candidateArtifact?: {
            lifecycle: string;
            activeIncident?: {
              id: string;
              epoch: number;
              incidentClass: string;
              kind: string;
              status: string;
              triggeredAt: number;
              origin: string;
              priorLifecycle: string;
              reviewOutcome: string;
            };
          };
        }
      >;
    };
    const benign = structuredClone(nominated) as unknown as MutableSignalState;
    const artifact = benign.models[modelId]?.candidateArtifact;
    if (artifact === undefined) throw new Error("Candidate artifact disappeared");
    artifact.lifecycle = "active-hazard";
    artifact.activeIncident = {
      id: `candidate-incident:${modelId}:paired`,
      epoch: 0,
      incidentClass: "suspicious-signal",
      kind: "warning",
      status: "unresolved",
      triggeredAt: nominated.run.tick,
      origin: "weekly-pressure",
      priorLifecycle: "formal-candidate",
      reviewOutcome: "benign-operational-cause",
    };
    const confirmed = structuredClone(benign);
    const confirmedIncident =
      confirmed.models[modelId]?.candidateArtifact?.activeIncident;
    if (confirmedIncident === undefined) throw new Error("Paired signal disappeared");
    confirmedIncident.reviewOutcome = "confirmed-safety-signal";

    const benignState = benign as unknown as GameState;
    const confirmedState = confirmed as unknown as GameState;
    const benignView = projectGameView(benignState, content, context(benignState));
    const confirmedView = projectGameView(
      confirmedState,
      content,
      context(confirmedState),
    );
    expect(confirmedView).toEqual(benignView);
    assertNoHiddenKeys(benignView);
  });
});

describe("assertNoHiddenKeys", () => {
  it("reports the exact nested path of forbidden keys", () => {
    expect(() =>
      assertNoHiddenKeys({ visible: [{ hiddenSafety: { trueAlignment: 50 } }] }),
    ).toThrow("$.visible[0].hiddenSafety");
    expect(() => assertNoHiddenKeys({ visible: { confidence: "low" } })).not.toThrow();
  });

  it.each([
    "superintelligenceTruth",
    "probabilityAtFirstCrossing",
    "lineageSIRecords",
    "randomKey",
    "draw",
    "probability",
    "hiddenAudit",
    "genuineSuperintelligence",
    "selectedEndingId",
    "gateResolutions",
    "trainingExposure",
    "hazardPressure",
    "incidentThreshold",
    "incidentThresholdKey",
    "incidentThresholdDraw",
    "reviewOutcome",
  ])("rejects new endgame hidden field %s", (key) => {
    expect(() => assertNoHiddenKeys({ visible: { [key]: 0 } })).toThrow(
      `Player view exposes forbidden hidden key $.visible.${key}`,
    );
  });
});
