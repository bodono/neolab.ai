import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createTransaction } from "../../engine/transaction.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import { applyEffect } from "../../engine/effect-executor.ts";
import { advanceIncidentChecks } from "../../incidents/incidents.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { GameState } from "../../model/state.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { calendarFromTick } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import {
  quoteDeploymentAura,
  setModelDeploymentPolicy,
} from "../../productisation/productisation.ts";
import { createSaveEnvelope, loadSaveEnvelope } from "../../persistence/envelope.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { choosePublicationPolicy } from "../../research/papers.ts";
import { seed128 } from "../../random/seed.ts";
import {
  calculateAuraGain,
  calculateAuraSignal,
  modelLaunchBaseAura,
  quoteAuraMarketPressure,
} from "../aura.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const alwaysIncidentOracle: RandomOracle = {
  uniform: () => 0,
  integer: (_key, minimum) => minimum,
  triangular: () => 0,
  weighted: (_key, weights) => Object.keys(weights).sort()[0] as never,
  shuffle: (_key, values) => [...values],
};

function newState(): GameState {
  return addBaselineModelsForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.sam-altmann"),
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

describe("Aura ledger and public signal", () => {
  it("quotes the approved linear market pressure curve and rounds every cost upward", () => {
    const rows = [
      { capability: 0, multiplier: 1, costs: [4, 14, 22] },
      { capability: 25, multiplier: 1.625, costs: [7, 23, 36] },
      { capability: 50, multiplier: 2.25, costs: [9, 32, 50] },
      { capability: 75, multiplier: 2.875, costs: [12, 41, 64] },
      { capability: 100, multiplier: 3.5, costs: [14, 49, 77] },
    ] as const;

    for (const row of rows) {
      const state = mutable(newState());
      for (const model of Object.values(state.models)) {
        if (model.measuredCapability !== undefined) {
          model.measuredCapability.frontierCapability = rating(row.capability);
        }
      }
      const quotes = [4, 14, 22].map((base) => quoteAuraMarketPressure(state, base));
      expect(quotes.map((quote) => quote.marketPressureMultiplier)).toEqual([
        row.multiplier,
        row.multiplier,
        row.multiplier,
      ]);
      expect(quotes.map((quote) => quote.marketAdjustedAuraCost)).toEqual(row.costs);
    }
  });

  it("floors spendable Aura, keeps Lifetime Aura monotone, and audits the applied delta", () => {
    const state = newState();
    const startingAura = state.labs[state.run.playerLabId]?.aura.spendable ?? 0;
    const tx = createTransaction(state);
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "aura-spendable",
        amount: -999,
        auraChangeKind: "spend",
        auraCategory: "fundraising",
      },
      { kind: "system", id: "test:campaign" },
    );
    const result = tx.commit({ description: "spend Aura" });
    const lab = result.state.labs[result.state.run.playerLabId];
    expect(lab?.aura).toMatchObject({ spendable: 0, lifetime: startingAura });
    expect(lab?.aura.ledger).toEqual([
      expect.objectContaining({
        kind: "spend",
        category: "fundraising",
        requestedDelta: -999,
        appliedDelta: -startingAura,
        lifetimeDelta: 0,
      }),
    ]);
    expect(result.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "aura-changed",
        appliedDelta: -startingAura,
      }),
    );
    const envelope = createSaveEnvelope(result.state, {
      saveId: "aura-ledger",
      slotType: "manual",
      displayName: "Aura ledger",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T00:00:00.000Z",
    });
    expect(
      loadSaveEnvelope(envelope).state.labs[result.state.run.playerLabId]?.aura,
    ).toEqual(lab?.aura);
  });

  it("lets a scandal fade over 26 weeks while spending costs no standing at all", () => {
    const state = newState();
    const startingAura = state.labs[state.run.playerLabId]?.aura.lifetime ?? 0;
    const tx = createTransaction(state);
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "aura-spendable",
        amount: -8,
        auraChangeKind: "spend",
        auraCategory: "recruitment",
      },
      { kind: "system", id: "test:spend" },
    );
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "aura-spendable",
        amount: -4,
        auraChangeKind: "loss",
        auraCategory: "incident",
        auraSignalImpact: -6,
      },
      { kind: "system", id: "test:scandal" },
    );
    const immediate = tx.commit({ description: "public standing changes" }).state;
    const now = calculateAuraSignal(immediate, content, immediate.run.playerLabId);
    // Spending used to subtract |amount| x 0.25 for 26 weeks, so calling in
    // goodwill read as a scandal. Only the scandal itself weighs on standing now.
    expect(now).toMatchObject({
      lifetimeBase: startingAura,
      scandalPenalty: 6,
      final: startingAura - 6,
    });
    expect(now).not.toHaveProperty("recentSpendPenalty");

    const recovered = mutable(immediate);
    recovered.run.tick = tick(26);
    recovered.run.calendar = calendarFromTick(26);
    expect(
      calculateAuraSignal(recovered, content, recovered.run.playerLabId),
    ).toMatchObject({
      lifetimeBase: startingAura,
      scandalPenalty: 0,
      final: startingAura,
    });
  });

  it("stacks researcher Aura gains across simultaneous modifier targets", () => {
    const tx = createTransaction(newState());
    for (const [target, value] of [
      ["aura.worldFirstCapabilityPaperGain", 1.3],
      ["aura.openPaperModelOrDatasetGain", 1.3],
    ] as const) {
      applyEffect(
        tx,
        { kind: "add-modifier", target, operation: "multiply", value },
        { kind: "researcher", id: `test:${target}` },
      );
    }
    applyEffect(
      tx,
      {
        kind: "add-modifier",
        target: "aura.firstPublicLaunchGain",
        operation: "add",
        value: 2,
      },
      { kind: "researcher", id: "test:replication" },
    );
    const state = tx.commit({ description: "Aura modifiers" }).state;
    const gain = calculateAuraGain(state, 10, [
      "aura.worldFirstCapabilityPaperGain",
      "aura.openPaperModelOrDatasetGain",
    ]);
    expect(gain.researcherApplied).toBeCloseTo(16.9, 10);
    expect(gain.final).toBe(17);
    expect(calculateAuraGain(state, 0, ["aura.firstPublicLaunchGain"]).final).toBe(2);
  });

  it("routes a world-first open paper through the Aura gain rules and ledger", () => {
    const draft = mutable(newState());
    const paperId = content.papers.graph.realHistoryDisplayOrder[0];
    const paper = paperId === undefined ? undefined : content.papers.definitions[paperId];
    const lab = draft.labs[draft.run.playerLabId];
    if (paperId === undefined || paper === undefined || lab === undefined) {
      throw new Error("paper fixture missing");
    }
    draft.world.paperRace.discoveries[paperId] = {
      paperId,
      discovererLabId: lab.id,
      discoveredAt: draft.run.tick,
    };
    lab.research.discoveredPaperIds.push(paperId);
    const policy = content.papers.rules.publicationPolicies["publish-openly"];
    const startingAura = lab.aura.spendable;
    const rawAward = Math.round(paper.discovery.worldFirstAura * policy.auraMultiplier);
    const expected = calculateAuraGain(draft, rawAward, [
      "aura.worldFirstCapabilityPaperGain",
      "aura.openPaperModelOrDatasetGain",
    ]).final;

    const tx = createTransaction(draft);
    choosePublicationPolicy(tx, content, paperId, "publish-openly");
    const published = tx.commit({ description: "open paper" }).state;
    expect(published.labs[lab.id]?.aura.ledger.at(-1)).toMatchObject({
      kind: "gain",
      category: "paper",
      appliedDelta: expected,
    });
    expect(published.labs[lab.id]?.aura.spendable).toBe(startingAura + expected);
  });

  it("awards a model's first public launch once", () => {
    const draft = mutable(newState());
    const lab = draft.labs[draft.run.playerLabId];
    const model = lab?.models.currentModelId
      ? draft.models[lab.models.currentModelId]
      : undefined;
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    const startingAura = lab.aura.spendable;
    delete model.flags["deployment:public-launch:aura-awarded"];
    const expectedBase = modelLaunchBaseAura(
      content.aura,
      model.measuredCapability?.frontierCapability ?? 0,
    );
    const expectedOpenApiAward = Math.ceil(expectedBase * 1.5);
    const firstTx = createTransaction(draft);
    setModelDeploymentPolicy(firstTx, content, lab.id, model.id, "open-api");
    const first = firstTx.commit({ description: "model launch" }).state;
    const afterFirst = first.labs[lab.id];
    expect(afterFirst?.aura.spendable).toBe(startingAura + expectedOpenApiAward);
    expect(afterFirst?.aura.ledger.at(-1)).toMatchObject({
      kind: "gain",
      category: "model-launch",
      appliedDelta: expectedOpenApiAward,
    });

    const secondTx = createTransaction(first);
    setModelDeploymentPolicy(secondTx, content, lab.id, model.id, "guarded-api");
    const second = secondTx.commit({ description: "policy adjustment" }).state;
    expect(second.labs[lab.id]?.aura.ledger).toHaveLength(1);
    expect(second.labs[lab.id]?.aura.spendable).toBe(startingAura + expectedOpenApiAward);
  });

  it("prices Open API launch Aura above Guarded API without changing weights release", () => {
    const draft = mutable(newState());
    const lab = draft.labs[draft.run.playerLabId];
    const model = lab?.models.currentModelId
      ? draft.models[lab.models.currentModelId]
      : undefined;
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    delete model.flags["deployment:public-launch:aura-awarded"];
    delete model.flags["deployment:weights-release:aura-awarded"];

    const base = modelLaunchBaseAura(
      content.aura,
      model.measuredCapability?.frontierCapability ?? 0,
    );
    expect(quoteDeploymentAura(draft, content, model.id, "guarded-api").rawAura).toBe(
      base,
    );
    expect(quoteDeploymentAura(draft, content, model.id, "open-api").rawAura).toBe(
      Math.ceil(base * 1.5),
    );
    expect(quoteDeploymentAura(draft, content, model.id, "weights-release").rawAura).toBe(
      base + content.deployment.policies["weights-release"].oneTimeAura,
    );
  });

  it("keeps a first weights-release choice planned until productisation completes", () => {
    const draft = mutable(newState());
    const lab = draft.labs[draft.run.playerLabId];
    const model = lab?.models.currentModelId
      ? draft.models[lab.models.currentModelId]
      : undefined;
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    for (const mode of Object.keys(model.deployment.productisationRuns) as Array<
      keyof typeof model.deployment.productisationRuns
    >) {
      model.deployment.productisationRuns[mode] = 0;
    }
    model.deployment.policy = "internal-only";
    delete model.deployment.plannedPolicy;
    model.deployment.irreversible = false;
    delete model.flags["deployment:weights-release:aura-awarded"];
    const startingAura = lab.aura.spendable;

    const tx = createTransaction(draft);
    setModelDeploymentPolicy(tx, content, lab.id, model.id, "weights-release");
    const planned = tx.commit({ description: "plan permanent release" }).state;
    const plannedModel = planned.models[model.id];

    expect(plannedModel?.deployment).toMatchObject({
      policy: "internal-only",
      plannedPolicy: "weights-release",
      irreversible: false,
    });
    expect(planned.labs[lab.id]?.aura.spendable).toBe(startingAura);
    expect(plannedModel?.flags["deployment:weights-release:aura-awarded"]).not.toBe(true);
  });

  it("turns a serious model incident into both an Aura loss and a decaying scandal", () => {
    const draft = mutable(newState());
    const lab = draft.labs[draft.run.playerLabId];
    const model = lab?.models.currentModelId
      ? draft.models[lab.models.currentModelId]
      : undefined;
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(70);
    }
    model.accessLevel = 3;
    model.hiddenSafety.trueAlignment = rating(0);
    lab.safety.practicalControlStrength = rating(0);

    const tx = createTransaction(draft);
    advanceIncidentChecks(tx, content, alwaysIncidentOracle);
    const result = tx.commit({ description: "forced incident" }).state;
    const incident = result.incidents.at(-1);
    const auraEntry = result.labs[lab.id]?.aura.ledger.at(-1);
    expect(incident?.category).toBe("critical");
    expect(auraEntry).toMatchObject({
      kind: "loss",
      category: "incident",
      requestedDelta: -content.aura.incidentAuraLoss.critical,
      signalImpact: -content.aura.incidentAuraLoss.critical,
    });
  });

  it("caps a first unheralded frontier incident below catastrophe severity", () => {
    const draft = mutable(newState());
    const lab = draft.labs[draft.run.playerLabId];
    const model = lab?.models.currentModelId
      ? draft.models[lab.models.currentModelId]
      : undefined;
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(100);
    }
    // This probe concerns pre-candidacy incident severity, so keep one breadth
    // trait below the formal candidate gate while preserving a frontier-scale model.
    model.trueCapability.embodiment = rating(79);
    model.accessLevel = 5;
    model.hiddenSafety.trueAlignment = rating(0);
    model.hiddenSafety.corrigibility = rating(0);
    model.hiddenSafety.situationalAwareness = rating(100);
    model.hiddenSafety.deceptiveCapability = rating(100);
    lab.safety.practicalControlStrength = rating(0);

    const tx = createTransaction(draft);
    expect(() => advanceIncidentChecks(tx, content, alwaysIncidentOracle)).not.toThrow();
    const result = tx.commit({ description: "forced frontier incident" }).state;
    expect(result.incidents.at(-1)).toMatchObject({
      observedSeverity: 84,
      category: "critical",
      catastropheLegal: false,
    });
  });
});
