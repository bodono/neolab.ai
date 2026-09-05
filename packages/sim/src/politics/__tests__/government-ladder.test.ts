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
import { resolveModifierValue } from "../../engine/modifier-resolver.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { instantiateEvent, resolveEventOption } from "../../events/event-engine.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { CommandId } from "../../model/ids.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectGameView } from "../../selectors/game-view.ts";

/**
 * These exercise the SHIPPED event catalogue rather than a synthetic fixture:
 * a pending government intervention can only leave "pending-event" if the
 * authored event's options record a government-response memory tag. Without
 * authored events the ladder jams permanently, which is what this guards.
 */
const content: CompiledContent = validateCompiledContent(rawBundle);

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

/** Quarter boundary with enough pressure to trigger an intervention. */
function pressuredLab(): GameState {
  const state = mutable(newState());
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  if (lab === undefined || modelId === undefined) throw new Error("missing fixture");
  state.run.tick = tick(12);
  state.run.calendar = calendarFromTick(12);
  lab.politics.governmentAttention = rating(100);
  lab.politics.governmentTrust = rating(0);
  lab.politics.captureConcern = rating(100);
  lab.politics.strategicDependence = rating(0);
  state.incidents.push({
    key: "ladder-fixture",
    modelId,
    occurredAt: tick(12),
    observedSeverity: rating(100),
    category: "major",
    contained: true,
    catastropheLegal: false,
    audit: ["fixture"],
  });
  return state;
}

describe("shipped government ladder", () => {
  it("ships one authored event for every mandatory detector the engine can fire", () => {
    const detectors = new Set(
      Object.values(content.events.definitions)
        .filter((definition) => definition.trigger.kind === "mandatory")
        .map((definition) =>
          definition.trigger.kind === "mandatory" ? definition.trigger.detector : "",
        ),
    );
    expect(detectors).toContain("government-reporting");
    expect(detectors).toContain("government-licensing");
    expect(detectors).toContain("government-restriction");
    expect(detectors).toContain("government-nationalisation");
    expect(detectors).toContain("critical-runway");
    expect(detectors).toContain("researcher-ultimatum");
    expect(detectors).toContain("three-severe-anomalies");
    expect(detectors).toContain("agi-candidate");
    expect(detectors).toContain("rival-candidate");
  });

  it("resolves a pending intervention once the authored event is answered", () => {
    const quarter = advanceOneTick(pressuredLab(), content).state;
    const intervention = quarter.labs[quarter.run.playerLabId]?.politics.interventions[0];
    expect(intervention?.status).toBe("pending-event");
    expect(
      projectGameView(quarter, content, {
        viewerLabId: quarter.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).politics.pendingInterventions[0]?.decisionState,
    ).toBe("scheduled");

    const opened = advanceOneTick(quarter, content).state;
    const instance = Object.values(opened.eventInstances).find(
      (candidate) => candidate.tokens["INTERVENTION_ID"] === intervention?.id,
    );
    if (instance === undefined) throw new Error("no authored government event opened");
    expect(
      projectGameView(opened, content, {
        viewerLabId: opened.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).politics.pendingInterventions[0]?.decisionState,
    ).toBe("open");

    const answered = applyCommand(opened, content, {
      kind: "respond-to-decision-event",
      meta: {
        commandId: "command:ladder-comply" as CommandId,
        expectedTick: opened.run.tick,
        issuedBy: "player",
      },
      instanceId: instance.id,
      optionId: content.events.definitions[instance.definitionId]?.options[0]?.id ?? "",
    }).state;
    expect(
      projectGameView(answered, content, {
        viewerLabId: answered.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).politics.pendingInterventions[0]?.decisionState,
    ).toBe("answered");

    // synchroniseGovernmentEventResponses runs on the following tick.
    const settled = advanceOneTick(answered, content).state;
    const resolved = settled.labs[settled.run.playerLabId]?.politics.interventions.find(
      (candidate) => candidate.id === intervention?.id,
    );
    expect(resolved?.status).not.toBe("pending-event");
    expect(resolved?.response).toBeDefined();
    expect(settled.run.status).toBe("active");
  });

  it("makes refusing the shipped qualifying takeover end in nationalisation", () => {
    const quarter = advanceOneTick(pressuredLab(), content).state;
    const opened = advanceOneTick(quarter, content).state;
    const instance = Object.values(opened.eventInstances).find(
      (candidate) =>
        candidate.definitionId ===
        contentId("base:event.government.nationalisation-crisis"),
    );
    if (instance === undefined) throw new Error("nationalisation decision did not open");

    const refused = applyCommand(opened, content, {
      kind: "respond-to-decision-event",
      meta: {
        commandId: "command:refuse-shipped-nationalisation" as CommandId,
        expectedTick: opened.run.tick,
        issuedBy: "player",
      },
      instanceId: instance.id,
      optionId: "resist",
    }).state;
    const nationalised = advanceOneTick(refused, content).state;

    expect(nationalised.run.status).toBe("lost");
    expect(nationalised.run.endingId).toBe("base:ending.nationalised-future");
  });

  it("keeps every authored event's copy resolvable from the shipped catalogue", () => {
    const messages = content.copy.messages;
    for (const definition of Object.values(content.events.definitions)) {
      expect(messages[definition.titleKey]).toBeDefined();
      expect(messages[definition.bodyKey]).toBeDefined();
      for (const line of definition.evidence) {
        expect(messages[line.textKey]).toBeDefined();
      }
      for (const option of definition.options) {
        expect(messages[option.labelKey]).toBeDefined();
        expect(messages[option.previewKey]).toBeDefined();
      }
    }
  });

  it("makes deployment-restriction compliance materially safer and slower", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.politics.governmentTrust = rating(60);
    lab.politics.governmentAttention = rating(40);

    const openTx = createTransaction(state);
    const instanceId = instantiateEvent(
      openTx,
      content,
      contentId("base:event.government.deployment-restriction"),
      { source: "mandatory" },
    );
    const opened = openTx.commit({ description: "open restriction fixture" }).state;
    const resolveTx = createTransaction(opened);
    resolveEventOption(resolveTx, content, instanceId, "comply");
    const resolved = resolveTx.commit({ description: "comply with restriction" }).state;
    const resolvedLab = resolved.labs[resolved.run.playerLabId];

    expect(resolvedLab?.politics.governmentTrust).toBe(72);
    expect(resolvedLab?.politics.governmentAttention).toBe(32);
    expect(resolveModifierValue(resolved, "lab.market.acquisitionRate", 1).final).toBe(
      0.5,
    );
    expect(resolveModifierValue(resolved, "lab.product.durationWeeks", 1).final).toBe(
      1.25,
    );
    expect(resolveModifierValue(resolved, "lab.incident.hazard", 1).final).toBe(0.6);
  });

  it("makes defying a deployment restriction a severe safety and political gamble", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.aura.spendable = 100;
    lab.aura.lifetime = 100;
    lab.politics.governmentTrust = rating(60);
    lab.politics.governmentAttention = rating(40);
    lab.organisation.hiddenInternalCandour = rating(70);

    const openTx = createTransaction(state);
    const instanceId = instantiateEvent(
      openTx,
      content,
      contentId("base:event.government.deployment-restriction"),
      { source: "mandatory" },
    );
    const opened = openTx.commit({ description: "open restriction fixture" }).state;
    const resolveTx = createTransaction(opened);
    resolveEventOption(resolveTx, content, instanceId, "defy");
    const resolved = resolveTx.commit({ description: "defy restriction" }).state;
    const resolvedLab = resolved.labs[resolved.run.playerLabId];

    expect(resolvedLab?.aura.spendable).toBe(75);
    expect(resolvedLab?.politics.governmentTrust).toBe(28);
    expect(resolvedLab?.politics.governmentAttention).toBe(68);
    expect(resolvedLab?.organisation.hiddenInternalCandour).toBe(62);
    expect(resolveModifierValue(resolved, "lab.incident.hazard", 1).final).toBe(1.6);
  });

  it("makes both peaceful nationalisation settlements durable and consequential", () => {
    const settle = (optionId: "cooperate" | "golden-share"): GameState => {
      const state = mutable(newState());
      const lab = state.labs[state.run.playerLabId];
      if (lab === undefined) throw new Error("missing player lab");
      lab.aura.spendable = 100;
      lab.aura.lifetime = 100;
      lab.politics.governmentAttention = rating(80);
      lab.politics.governmentTrust = rating(40);
      lab.politics.strategicDependence = rating(10);
      const openTx = createTransaction(state);
      const instanceId = instantiateEvent(
        openTx,
        content,
        contentId("base:event.government.nationalisation-crisis"),
        { source: "mandatory" },
      );
      const opened = openTx.commit({ description: "open takeover fixture" }).state;
      const resolveTx = createTransaction(opened);
      resolveEventOption(resolveTx, content, instanceId, optionId);
      return resolveTx.commit({ description: `settle via ${optionId}` }).state;
    };

    const oversight = settle("cooperate");
    const oversightLab = oversight.labs[oversight.run.playerLabId];
    expect(oversightLab?.politics.governmentAttention).toBe(60);
    expect(oversightLab?.politics.governmentTrust).toBe(52);
    expect(resolveModifierValue(oversight, "lab.research.all.output", 1).final).toBe(
      0.94,
    );
    expect(resolveModifierValue(oversight, "lab.incident.hazard", 1).final).toBe(0.8);

    const goldenShare = settle("golden-share");
    const goldenShareLab = goldenShare.labs[goldenShare.run.playerLabId];
    expect(goldenShareLab?.aura.spendable).toBe(90);
    expect(goldenShareLab?.politics.governmentAttention).toBe(68);
    expect(goldenShareLab?.politics.strategicDependence).toBe(20);
    expect(resolveModifierValue(goldenShare, "lab.research.all.output", 1).final).toBe(
      0.97,
    );
    expect(resolveModifierValue(goldenShare, "lab.incident.hazard", 1).final).toBe(0.9);
  });

  it("makes the deployment carve-out an expensive gamble with distinct outcomes", () => {
    const definition =
      content.events.definitions[
        contentId("base:event.government.deployment-restriction")
      ];
    const carveOut = definition?.options.find((option) => option.id === "carve-out");
    const check = carveOut?.checks.find(
      (candidate) => candidate.id === "carve-out-talks",
    );
    const granted = check?.outcomes.find((outcome) => outcome.id === "granted");
    const partial = check?.outcomes.find((outcome) => outcome.id === "partial");

    expect(carveOut?.knownCosts).toContainEqual(
      expect.objectContaining({
        kind: "add-resource",
        resource: "aura-spendable",
        amount: -20,
      }),
    );
    expect(carveOut?.immediateEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add-rating",
          rating: "governmentTrust",
          amount: -6,
        }),
        expect.objectContaining({
          kind: "add-rating",
          rating: "governmentAttention",
          amount: 8,
        }),
      ]),
    );
    expect(granted?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add-modifier",
          target: "lab.market.acquisitionRate",
          value: 0.8,
        }),
        expect.objectContaining({
          kind: "add-modifier",
          target: "lab.incident.hazard",
          value: 0.85,
        }),
      ]),
    );
    expect(partial?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add-rating",
          rating: "governmentTrust",
          amount: -12,
        }),
        expect.objectContaining({
          kind: "add-modifier",
          target: "lab.market.acquisitionRate",
          value: 0.5,
        }),
        expect.objectContaining({
          kind: "add-modifier",
          target: "lab.product.durationWeeks",
          value: 1.35,
        }),
      ]),
    );
  });
});
