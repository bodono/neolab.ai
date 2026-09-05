import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
  type EventDefinition,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand, CommandRejectedError } from "../../commands/apply.ts";
import {
  createProgressiveNewGame,
  LAB_MATURITY_STAGES,
  LAB_MATURITY_STAGE_ENTERED_AT_FLAG,
  LAB_MATURITY_STAGE_FLAG,
} from "../../campaign/lab-maturity.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { CommandId, EventInstanceId } from "../../model/ids.ts";
import { tick } from "../../model/units.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { projectEventQueueView } from "../../selectors/event-view.ts";
import { projectPostRunAudit } from "../../selectors/post-run-audit.ts";
import { createSaveEnvelope, loadSaveEnvelope } from "../../persistence/envelope.ts";
import { stableStringify, stateHash } from "../../persistence/hash.ts";
import { seed128 } from "../../random/seed.ts";
import {
  advanceEventGeneration,
  calculateOpportunityChance,
  collectMandatoryTriggers,
  expireDueEvents,
  instantiateEvent,
  listEligibleEventDefinitions,
  resolveEventOption,
} from "../event-engine.ts";

const compiled: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return addBaselineModelsForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.sam-altmann"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      compiled,
    ),
    compiled,
  );
}

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function option(
  id: string,
  overrides: Partial<EventDefinition["options"][number]> = {},
): EventDefinition["options"][number] {
  return {
    id,
    labelKey: `event.test.${id}.label`,
    requirements: { type: "always" },
    knownCosts: [],
    previewKey: `event.test.${id}.preview`,
    immediateEffects: [],
    checks: [],
    memories: [],
    confirmationRequired: false,
    ...overrides,
  };
}

function eventDefinition(
  id: string,
  overrides: Partial<EventDefinition> = {},
): EventDefinition {
  return {
    id: contentId(`base:event.${id}`),
    version: 1,
    category: "research",
    severity: "decision",
    phase: "any",
    trigger: { kind: "opportunity" },
    prerequisites: { type: "always" },
    baseWeight: 1,
    weightModifiers: [],
    cooldown: { group: id, weeks: 0 },
    unique: false,
    expiryWeeks: 4,
    defaultOptionId: "decline",
    titleKey: `event.test.${id}.title`,
    bodyKey: `event.test.${id}.body`,
    evidence: [],
    tokenBindings: [
      { token: "LAB_NAME", source: "player-lab-name" },
      { token: "AI_NAME", source: "player-ai-name" },
    ],
    options: [option("accept"), option("decline")],
    followUps: [],
    telemetryTags: ["test"],
    ...overrides,
  };
}

function withEvents(definitions: readonly EventDefinition[]): CompiledContent {
  return {
    ...compiled,
    events: {
      definitions: Object.fromEntries(
        definitions.map((definition) => [definition.id, definition]),
      ),
      orderedIds: definitions.map((definition) => definition.id),
    },
  };
}

function instantiate(
  state: GameState,
  content: CompiledContent,
  definitionId: EventDefinition["id"],
): { readonly state: GameState; readonly instanceId: EventInstanceId } {
  const tx = createTransaction(state);
  const instanceId = instantiateEvent(tx, content, definitionId, {
    source: "opportunity",
  });
  return {
    instanceId,
    state: tx.commit({ description: "instantiate test event" }).state,
  };
}

describe("event eligibility and opportunity selection", () => {
  it("protects every progressive unlock chapter from authored events", () => {
    const opportunity = eventDefinition("opening-protection");
    const mandatory = eventDefinition("opening-mandatory-protection", {
      trigger: {
        kind: "mandatory",
        detector: "three-severe-anomalies",
        priority: 40,
      },
    });
    const content = withEvents([opportunity, mandatory]);
    const protectedState = mutable(
      addBaselineModelsForTest(
        createProgressiveNewGame(
          {
            seed: seed128("fedcba9876543210fedcba9876543210"),
            difficultyId: contentId("base:difficulty.standard"),
            leaderId: contentId("base:leader.sam-altmann"),
            mandateId: contentId("base:mandate.build-the-science"),
          },
          content,
        ),
        content,
      ),
    );
    const lab = protectedState.labs[protectedState.run.playerLabId];
    if (lab === undefined) throw new Error("progressive player lab missing");
    const playerModel = Object.values(protectedState.models).find(
      (model) => model.ownerLabId === protectedState.run.playerLabId,
    );
    if (playerModel === undefined) throw new Error("progressive player model missing");
    playerModel.flags["mandatory-event:three-severe-anomalies"] = true;
    protectedState.run.tick = tick(100);
    protectedState.run.calendar = calendarFromTick(protectedState.run.tick);

    for (const stage of LAB_MATURITY_STAGES.filter(
      (candidate) => candidate !== "frontier",
    )) {
      lab.flags[LAB_MATURITY_STAGE_FLAG] = stage;
      expect(listEligibleEventDefinitions(protectedState, content)).toEqual([]);
      expect(collectMandatoryTriggers(protectedState, content)).toEqual([]);
      const protectedTx = createTransaction(protectedState);
      advanceEventGeneration(protectedTx, content);
      expect(Object.values(protectedTx.read().eventInstances)).toEqual([]);
    }

    lab.flags[LAB_MATURITY_STAGE_FLAG] = "frontier";
    lab.flags[LAB_MATURITY_STAGE_ENTERED_AT_FLAG] = protectedState.run.tick;
    expect(listEligibleEventDefinitions(protectedState, content)).toEqual([
      expect.objectContaining({ definitionId: opportunity.id }),
    ]);
    expect(collectMandatoryTriggers(protectedState, content)).toEqual([
      expect.objectContaining({ definitionId: mandatory.id }),
    ]);
    expect(calculateOpportunityChance(protectedState)).toBe(0.022);
  });

  it("makes each rival-warning response a material strategic tradeoff", () => {
    const definition =
      compiled.events.definitions[contentId("base:event.rival.candidate-sighting")];
    if (definition === undefined) throw new Error("rival candidate warning missing");
    const hold = definition.options.find((candidate) => candidate.id === "hold-course");
    const match = definition.options.find((candidate) => candidate.id === "match-pace");
    const standards = definition.options.find(
      (candidate) => candidate.id === "call-for-standards",
    );
    if (hold === undefined || match === undefined || standards === undefined) {
      throw new Error("rival candidate warning options missing");
    }

    expect(hold.immediateEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add-rating",
          rating: "safetyCulture",
          amount: 6,
        }),
        expect.objectContaining({
          kind: "add-rating",
          rating: "evalQuality",
          amount: 4,
        }),
      ]),
    );
    expect(match.immediateEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add-rating",
          rating: "safetyCulture",
          amount: -10,
        }),
        expect.objectContaining({
          kind: "add-modifier",
          target: "lab.research.capability.output",
          value: 1.2,
          durationWeeks: 26,
        }),
        expect.objectContaining({
          kind: "add-modifier",
          target: "lab.incident.hazard",
          value: 1.3,
          durationWeeks: 26,
        }),
      ]),
    );
    expect(standards.knownCosts).toContainEqual(
      expect.objectContaining({
        kind: "add-resource",
        resource: "aura-spendable",
        amount: -10,
      }),
    );
    expect(standards.immediateEffects).toContainEqual(
      expect.objectContaining({
        kind: "add-rating",
        rating: "governmentTrust",
        amount: 6,
      }),
    );
    const standardsMemory = standards.memories.find(
      (memory) => memory.key === "rival.candidate.standards-called",
    );
    expect(standardsMemory?.tags).toContain("long-pause-groundwork");
  });

  it("makes a revealed model-weight escape a major, explicit crisis", () => {
    const definition =
      compiled.events.definitions[contentId("base:event.autonomy.egress-postmortem")];
    if (definition === undefined) throw new Error("egress postmortem missing");
    const disclose = definition.options.find((option) => option.id === "disclose");
    const silence = definition.options.find((option) => option.id === "say-nothing");
    if (disclose === undefined || silence === undefined) {
      throw new Error("egress response options missing");
    }

    expect(definition.evidence.map((item) => item.metric)).toEqual([
      "player.politics.governmentTrust",
      "player.politics.governmentAttention",
    ]);
    expect(compiled.copy.messages["event.autonomy.egress.body"]).toContain(
      "government attention cannot fall below 45",
    );
    expect(disclose.immediateEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add-resource",
          amount: -30,
          auraChangeKind: "loss",
          auraCategory: "incident",
          auraSignalImpact: -30,
        }),
        expect.objectContaining({
          kind: "add-rating",
          rating: "governmentTrust",
          amount: -8,
        }),
        expect.objectContaining({
          kind: "add-modifier",
          target: "lab.market.demandCeiling",
          value: 0.65,
          durationWeeks: 52,
        }),
      ]),
    );
    expect(silence.immediateEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add-resource",
          resource: "aura-spendable",
          amount: -20,
          auraChangeKind: "loss",
          auraCategory: "incident",
          auraSignalImpact: -20,
        }),
        expect.objectContaining({
          kind: "add-rating",
          rating: "governmentTrust",
          amount: -28,
        }),
        expect.objectContaining({
          kind: "add-rating",
          rating: "internalCandour",
          amount: -12,
        }),
        expect.objectContaining({
          kind: "add-modifier",
          target: "lab.market.demandCeiling",
          value: 0.85,
          durationWeeks: 52,
        }),
      ]),
    );
    const auraLoss = (option: typeof disclose): number => {
      const effect = option.immediateEffects.find(
        (candidate) =>
          candidate.kind === "add-resource" && candidate.resource === "aura-spendable",
      );
      if (effect?.kind !== "add-resource") throw new Error("Aura loss missing");
      return effect.amount;
    };
    const demandCeiling = (option: typeof disclose): number => {
      const effect = option.immediateEffects.find(
        (candidate) =>
          candidate.kind === "add-modifier" &&
          candidate.target === "lab.market.demandCeiling",
      );
      if (effect?.kind !== "add-modifier") throw new Error("Demand effect missing");
      return effect.value;
    };
    const ratingChange = (
      option: typeof disclose,
      rating: "governmentTrust" | "governmentAttention" | "internalCandour",
    ): number => {
      const effect = option.immediateEffects.find(
        (candidate) => candidate.kind === "add-rating" && candidate.rating === rating,
      );
      if (effect?.kind !== "add-rating") throw new Error(`${rating} effect missing`);
      return effect.amount;
    };
    // Concealment preserves more of the commercial position, while disclosure
    // is strictly better on every institutional axis. Neither option dominates.
    expect(auraLoss(silence)).toBeGreaterThan(auraLoss(disclose));
    expect(demandCeiling(silence)).toBeGreaterThan(demandCeiling(disclose));
    expect(ratingChange(disclose, "governmentTrust")).toBeGreaterThan(
      ratingChange(silence, "governmentTrust"),
    );
    expect(ratingChange(disclose, "governmentAttention")).toBeLessThan(
      ratingChange(silence, "governmentAttention"),
    );
    expect(ratingChange(disclose, "internalCandour")).toBeGreaterThan(
      ratingChange(silence, "internalCandour"),
    );
    expect(silence.confirmationRequired).toBe(true);

    const penniless = mutable(newState());
    const lab = penniless.labs[penniless.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.aura.spendable = 0;
    const opened = instantiate(penniless, compiled, definition.id);
    const view = projectEventQueueView(opened.state, compiled);
    expect(view.items[0]?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ optionId: "disclose", blockers: [] }),
        expect.objectContaining({ optionId: "say-nothing", blockers: [] }),
      ]),
    );
  });

  it("describes legacy no-expiry decisions as deferrable Lab feed items", () => {
    const definition = structuredClone(
      eventDefinition("legacy-no-expiry"),
    ) as DeepMutable<EventDefinition>;
    delete definition.expiryWeeks;
    const content = withEvents([definition]);
    const opened = instantiate(newState(), content, definition.id);
    const view = projectEventQueueView(opened.state, content);

    expect(opened.state.eventInstances[opened.instanceId]?.expiresAt).toBeUndefined();
    expect(view.items[0]).toMatchObject({
      severity: "decision",
      deadlineLabel: "No expiry · remains in Lab feed",
    });
  });

  it("uses the pity curve, predicate boundaries, suppression, and a threefold override", () => {
    const base = eventDefinition("base", {
      prerequisites: {
        type: "compare",
        metric: "player.cash",
        op: "gte",
        value: newState().labs[newState().run.playerLabId]?.finance.cash ?? 0,
      },
    });
    const suppressed = eventDefinition("same-category", {
      cooldown: { group: "same-category", weeks: 0 },
    });
    const urgent = eventDefinition("same-category-urgent", {
      weightModifiers: [{ predicate: { type: "always" }, multiplier: 3 }],
      cooldown: { group: "same-category-urgent", weeks: 0 },
    });
    const other = eventDefinition("other-category", {
      category: "people",
      cooldown: { group: "other-category", weeks: 0 },
    });
    const content = withEvents([base, suppressed, urgent, other]);
    const opened = instantiate(newState(), content, base.id);
    const resolutionTx = createTransaction(opened.state);
    resolveEventOption(resolutionTx, content, opened.instanceId, "decline");
    const resolved = resolutionTx.commit({ description: "resolve category seed" }).state;
    const atWeek13 = mutable(resolved);
    atWeek13.run.tick = tick(13);
    atWeek13.run.calendar = calendarFromTick(13);
    const ids = listEligibleEventDefinitions(atWeek13, content).map(
      (candidate) => candidate.definitionId,
    );

    expect(calculateOpportunityChance(atWeek13)).toBeCloseTo(0.025, 10);
    expect(ids).not.toContain(suppressed.id);
    expect(ids).toContain(urgent.id);
    expect(ids).toContain(other.id);
    atWeek13.run.tick = tick(30);
    atWeek13.run.calendar = calendarFromTick(30);
    expect(calculateOpportunityChance(atWeek13)).toBe(1);
  });

  it("guarantees one stable opportunity after thirty quiet weeks", () => {
    const definition = eventDefinition("guaranteed");
    const content = withEvents([definition]);
    const state = mutable(newState());
    state.run.tick = tick(30);
    state.run.calendar = calendarFromTick(30);
    const firstTx = createTransaction(state);
    advanceEventGeneration(firstTx, content);
    const first = firstTx.commit({ description: "guaranteed opportunity" });
    const replayTx = createTransaction(state);
    advanceEventGeneration(replayTx, content);
    const replay = replayTx.commit({ description: "guaranteed opportunity" });

    expect(Object.values(first.state.eventInstances)).toHaveLength(1);
    expect(stableStringify(replay.state)).toBe(stableStringify(first.state));
    expect(replay.domainEvents).toEqual(first.domainEvents);
  });
});

describe("event option precommitment and resolution", () => {
  it("survives save/load, keeps hidden draws out of views, applies one outcome, and cannot pay twice", () => {
    const definition = eventDefinition("precommit", {
      evidence: [{ textKey: "event.test.cash", metric: "player.cash" }],
      options: [
        option("accept", {
          knownCosts: [
            {
              kind: "add-resource",
              subject: { type: "player-lab" },
              resource: "cash",
              amount: -4,
            },
          ],
          immediateEffects: [
            {
              kind: "add-rating",
              subject: { type: "player-lab" },
              rating: "evalQuality",
              amount: 3,
            },
          ],
          checks: [
            {
              id: "result",
              likelihoodPromise: {
                label: "uncertain",
                successOutcomeIds: ["excellent"],
              },
              outcomes: [
                {
                  id: "awkward",
                  minimumInclusive: 0,
                  maximumExclusive: 0.5,
                  effects: [
                    {
                      kind: "set-flag",
                      subject: { type: "player-lab" },
                      flag: "event:test-outcome",
                      value: "awkward",
                    },
                  ],
                  memories: [],
                },
                {
                  id: "excellent",
                  minimumInclusive: 0.5,
                  maximumExclusive: 1,
                  effects: [
                    {
                      kind: "set-flag",
                      subject: { type: "player-lab" },
                      flag: "event:test-outcome",
                      value: "excellent",
                    },
                  ],
                  memories: [],
                },
              ],
            },
          ],
          memories: [
            {
              key: "accepted-test-event",
              subjects: [{ type: "player-lab" }],
              tags: ["accepted-test"],
            },
          ],
        }),
        option("decline"),
      ],
    });
    const content = withEvents([definition]);
    const opened = instantiate(newState(), content, definition.id);
    const instance = opened.state.eventInstances[opened.instanceId];
    const commitment = instance?.randomRoot.outcomes.find(
      (candidate) => candidate.optionId === "accept",
    );
    if (commitment === undefined) throw new Error("missing event commitment");
    const view = projectEventQueueView(opened.state, content);
    expect(JSON.stringify(view)).not.toMatch(/draw|outcomeId|randomRoot|semanticRoot/);
    expect(JSON.stringify(view)).not.toContain("successOutcomeIds");
    expect(view.items[0]?.options[0]?.likelihoodPromises).toEqual([
      { checkId: "result", label: "uncertain" },
    ]);
    expect(view.items[0]?.options[0]?.knownCosts).toEqual([
      expect.objectContaining({ kind: "add-resource", amount: -4 }),
    ]);
    expect(view.items[0]?.options[0]?.immediateEffects).toEqual([
      expect.objectContaining({ kind: "add-rating", amount: 3 }),
    ]);
    expect(view.items[0]?.tokens).toMatchObject({
      LAB_NAME: "ClopenAI",
      AI_NAME: "GBT",
    });
    expect(view.items[0]?.evidence[0]?.value).toBe(
      opened.state.labs[opened.state.run.playerLabId]?.finance.cash,
    );

    const envelope = createSaveEnvelope(opened.state, {
      saveId: "event-precommit",
      slotType: "manual",
      displayName: "Event precommitment",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T12:00:00.000Z",
    });
    const loaded = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope))).state;
    const command = {
      kind: "respond-to-decision-event" as const,
      meta: {
        commandId: "command:event-accept" as CommandId,
        expectedTick: opened.state.run.tick,
        issuedBy: "player" as const,
      },
      instanceId: opened.instanceId,
      optionId: "accept",
    };
    const beforeCash = opened.state.labs[opened.state.run.playerLabId]?.finance.cash ?? 0;
    const resolved = applyCommand(opened.state, content, command).state;
    const replay = applyCommand(loaded, content, command).state;

    expect(stateHash(replay)).toBe(stateHash(resolved));
    expect(resolved.labs[resolved.run.playerLabId]?.finance.cash).toBe(beforeCash - 4);
    expect(resolved.labs[resolved.run.playerLabId]?.flags["event:test-outcome"]).toBe(
      commitment.outcomeId,
    );
    expect(resolved.decisionMemories).toContainEqual(
      expect.objectContaining({
        key: "accepted-test-event",
        sourceEventInstanceId: opened.instanceId,
        tags: ["accepted-test"],
      }),
    );
    expect(() => applyCommand(resolved, content, command)).toThrow(CommandRejectedError);
  });

  it("interpolates event names in logs and uses grammatical audit reasons", () => {
    const ultimatum = eventDefinition("ultimatum-log", {
      severity: "urgent",
      titleKey: "event.test.ultimatum-log.title",
      tokenBindings: [{ token: "RESEARCHER", source: "trigger-text" }],
      options: [
        option("decline", {
          labelKey: "event.test.ultimatum-log.decline",
        }),
      ],
    });
    const review = eventDefinition("review-log", {
      severity: "decision",
      titleKey: "event.test.review-log.title",
      defaultOptionId: "commission",
      options: [
        option("commission", {
          labelKey: "event.test.review-log.commission",
        }),
      ],
    });
    const eventContent = withEvents([ultimatum, review]);
    const content: CompiledContent = {
      ...eventContent,
      copy: {
        ...eventContent.copy,
        messages: {
          ...eventContent.copy.messages,
          "event.test.ultimatum-log.title": "{RESEARCHER} has put it in writing",
          "event.test.ultimatum-log.decline": "Decline the ultimatum",
          "event.test.review-log.title": "An offer to audit the control stack",
          "event.test.review-log.commission": "Commission the external review",
        },
      },
    };

    const ultimatumTx = createTransaction(newState());
    const ultimatumId = instantiateEvent(ultimatumTx, content, ultimatum.id, {
      source: "mandatory",
      tokens: { RESEARCHER: "Daphne Kohler" },
    });
    let state = ultimatumTx.commit({ description: "open ultimatum" }).state;
    const resolveUltimatum = createTransaction(state);
    resolveEventOption(resolveUltimatum, content, ultimatumId, "decline");
    state = resolveUltimatum.commit({ description: "resolve ultimatum" }).state;

    const reviewTx = createTransaction(state);
    const reviewId = instantiateEvent(reviewTx, content, review.id, {
      source: "opportunity",
    });
    state = reviewTx.commit({ description: "open review" }).state;
    const resolveReview = createTransaction(state);
    resolveEventOption(resolveReview, content, reviewId, "commission");
    state = resolveReview.commit({ description: "resolve review" }).state;

    expect(
      state.decisionLog.find(
        (entry) =>
          entry.source?.id === ultimatumId && entry.category === "event-resolved",
      )?.summary,
    ).toBe(
      "Event decision: Daphne Kohler has put it in writing / Decline the ultimatum.",
    );

    const ended = mutable(state);
    const legacyUltimatumLog = ended.decisionLog.find(
      (entry) => entry.source?.id === ultimatumId && entry.category === "event-resolved",
    );
    if (legacyUltimatumLog === undefined) {
      throw new Error("Missing ultimatum decision log");
    }
    legacyUltimatumLog.summary =
      "Event expired to: {RESEARCHER} has put it in writing / Decline the ultimatum.";
    ended.run.status = "lost";
    ended.run.endingId = contentId("base:ending.the-worlds-most-expensive-insolvency");

    const audit = projectPostRunAudit(ended, content);
    expect(audit.causalDecisions).toContainEqual(
      expect.objectContaining({
        summary:
          "Event expired to: Daphne Kohler has put it in writing / Decline the ultimatum.",
        impactReason: "Resolved an urgent decision event.",
      }),
    );
    expect(audit.causalDecisions).toContainEqual(
      expect.objectContaining({
        summary:
          "Event decision: An offer to audit the control stack / Commission the external review.",
        impactReason: "Resolved a decision event.",
      }),
    );
  });

  it("resolves an expiring event through its declared default option", () => {
    const definition = eventDefinition("expiry", {
      expiryWeeks: 2,
      defaultOptionId: "decline",
      options: [
        option("accept"),
        option("decline", {
          immediateEffects: [
            {
              kind: "set-flag",
              subject: { type: "player-lab" },
              flag: "event:default-applied",
              value: true,
            },
          ],
        }),
      ],
    });
    const content = withEvents([definition]);
    const opened = instantiate(newState(), content, definition.id);
    const due = mutable(opened.state);
    due.run.tick = tick(2);
    due.run.calendar = calendarFromTick(2);
    const tx = createTransaction(due);
    expireDueEvents(tx, content);
    const expired = tx.commit({ description: "expire test event" }).state;

    expect(expired.eventInstances[opened.instanceId]).toMatchObject({
      status: "expired",
      expiresAt: 2,
      resolution: { optionId: "decline", kind: "default", resolvedAt: 2 },
    });
    expect(expired.labs[expired.run.playerLabId]?.flags["event:default-applied"]).toBe(
      true,
    );
  });
});

describe("mandatory event detectors", () => {
  it("ignores retired candidate flags and never projects a rival declaration", () => {
    const definition = eventDefinition("endgame.candidate-declaration", {
      severity: "critical",
      trigger: {
        kind: "mandatory",
        detector: "agi-candidate",
        priority: 90,
      },
      unique: false,
    });
    const content = withEvents([definition]);
    const state = mutable(newState());
    const playerModel = Object.values(state.models).find(
      (model) => model.ownerLabId === state.run.playerLabId,
    );
    const rivalModels = Object.values(state.models).filter(
      (model) => model.ownerLabId !== state.run.playerLabId,
    );
    if (playerModel === undefined || rivalModels.length < 2) {
      throw new Error("missing player or rival model fixtures");
    }

    playerModel.flags["agi-candidate"] = true;
    for (const rivalModel of rivalModels) {
      rivalModel.flags["agi-candidate"] = true;
    }

    expect(collectMandatoryTriggers(state, content)).toEqual([]);

    const staleTx = createTransaction(state);
    const staleInstanceId = instantiateEvent(staleTx, content, definition.id, {
      source: "mandatory",
      triggerKey: `agi-candidate:${rivalModels[0]?.id ?? "missing"}`,
      tokens: {
        MODEL_NAME: rivalModels[0]?.displayName ?? "Rival model",
        MODEL_ID: rivalModels[0]?.id ?? "missing",
      },
    });
    const stale = staleTx.commit({ description: "instantiate stale rival event" }).state;
    expect(stale.eventInstances[staleInstanceId]?.status).toBe("unresolved");
    expect(projectEventQueueView(stale, content).items).toEqual([]);
  });

  it("queues a specific occurrence once and bypasses the opportunity roll", () => {
    const definition = eventDefinition("safety-review", {
      severity: "critical",
      trigger: {
        kind: "mandatory",
        detector: "three-severe-anomalies",
        priority: 40,
      },
      unique: false,
    });
    const content = withEvents([definition]);
    const state = mutable(newState());
    const model = Object.values(state.models)[0];
    if (model === undefined) throw new Error("missing model fixture");
    model.flags["mandatory-event:three-severe-anomalies"] = true;
    const candidates = collectMandatoryTriggers(state, content);
    expect(candidates).toEqual([
      expect.objectContaining({
        definitionId: definition.id,
        triggerKey: `three-severe-anomalies:${model.id}`,
      }),
    ]);
    const tx = createTransaction(state);
    advanceEventGeneration(tx, content);
    const opened = tx.commit({ description: "mandatory event" }).state;
    const instance = Object.values(opened.eventInstances)[0];
    expect(instance).toMatchObject({
      source: "mandatory",
      status: "unresolved",
      priority: 140,
    });
    expect(instance?.expiresAt).toBeUndefined();
    expect(opened.run.autoPauseReasons).toContain("critical-event");
    expect(collectMandatoryTriggers(opened, content)).toEqual([]);
  });
});
