import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { validateCommand } from "../../commands/validate.ts";
import { applyEffect } from "../../engine/effect-executor.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { instantiateEvent, resolveEventOption } from "../../events/event-engine.ts";
import type { CommandId, LabId, ResearcherId } from "../../model/ids.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { cashMillions, rating, tick } from "../../model/units.ts";
import { createSaveEnvelope, loadSaveEnvelope } from "../../persistence/envelope.ts";
import { randomKey } from "../../random/key.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  addBaselineModelForTest,
  addBaselineModelsForTest,
} from "../../model/fixture.ts";
import {
  advanceResearcherSalaryReviews,
  advanceResearcherCrises,
  calculateDeparturePressure,
  calculateResearcherStateTargets,
  checkResearcherDeparture,
  departResearcher,
  hasAcceptedUltimatumProtection,
  ORGANISATION_DRIFT_RATE,
  ORGANISATION_TARGET_FLAGS,
  quoteDismissal,
  quoteRetentionOffer,
  startPoachingAttempt,
  updateOrganisationRatings,
  updateResearcherStates,
} from "../people.ts";
import { addResearcherPromise, evaluateResearcherPromises } from "../promises.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const architectures = contentId("base:domain.architectures");

function newState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.sam-altmann"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function setTick(state: DeepMutable<GameState>, value: number): void {
  state.run.tick = tick(value);
  state.run.calendar = calendarFromTick(value);
}

function employ(state: DeepMutable<GameState>, researcherId: ResearcherId): void {
  const researcher = state.researchers[researcherId];
  const lab = state.labs[state.run.playerLabId];
  if (researcher === undefined || lab === undefined) throw new Error("fixture missing");
  researcher.employerLabId = state.run.playerLabId;
  researcher.employedAt = state.run.tick;
  researcher.status = "employed";
  researcher.housing = "housed";
  delete researcher.unhousedSince;
  researcher.assignment = {
    kind: "capability-program",
    targetId: architectures,
    role: "lead",
    assignedAt: state.run.tick,
  };
  researcher.contract = {
    salaryPerCycle: cashMillions(1),
    signingCash: cashMillions(9),
    auraCost: 14,
    agreedAt: state.run.tick,
  };
  lab.roster.researcherIds.push(researcherId);
  state.talentMarket.visibleResearcherIds =
    state.talentMarket.visibleResearcherIds.filter((id) => id !== researcherId);
}

function firstCandidate(state: GameState): ResearcherId {
  const researcherId = state.talentMarket.visibleResearcherIds[0];
  if (researcherId === undefined) throw new Error("candidate fixture missing");
  return researcherId;
}

function funded(state: GameState): GameState {
  const draft = mutable(state);
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  lab.finance.cash = cashMillions(500);
  lab.aura.spendable = 100;
  lab.aura.lifetime = 100;
  return draft;
}

describe("organisation and researcher drift", () => {
  /**
   * Reviews re-mark the contract to the live market -- base pay times yearly
   * inflation times the AGI-proximity boom (salaries double every 20 points
   * of world frontier capability) -- instead of compounding a flat 5%. The
   * fixture world has no models, so the boom term is 1 and the arithmetic
   * below is pure base x 1.06^year.
   */
  it("re-marks a below-market contract to the market at its annual review", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const base =
      content.researchers.definitions[draft.researchers[researcherId]?.definitionId ?? ""]
        ?.contract.baseSalaryPerCycle ?? 0;
    expect(base).toBeGreaterThan(0);
    const researcher = draft.researchers[researcherId];
    if (researcher?.contract === undefined) throw new Error("contract missing");
    researcher.contract.salaryPerCycle = cashMillions(base * 0.5);
    setTick(draft, 51);

    const firstTx = createTransaction(draft);
    const firstAdjustments = advanceResearcherSalaryReviews(firstTx, content);
    const firstReview = firstTx.commit({ description: "first salary review" }).state;
    const expected = Math.round(base * 1.06 * 100) / 100;
    expect(firstAdjustments).toEqual([
      {
        researcherId,
        previousSalaryPerCycle: base * 0.5,
        nextSalaryPerCycle: expected,
      },
    ]);
    expect(firstReview.researchers[researcherId]?.contract?.salaryPerCycle).toBe(
      expected,
    );
    expect(firstReview.decisionLog.at(-1)?.summary).toContain("annual market review");

    const nextYear = mutable(firstReview);
    setTick(nextYear, 103);
    const secondTx = createTransaction(nextYear);
    advanceResearcherSalaryReviews(secondTx, content);
    const secondReview = secondTx.commit({ description: "second salary review" }).state;
    expect(secondReview.researchers[researcherId]?.contract?.salaryPerCycle).toBe(
      Math.round(base * 1.06 ** 2 * 100) / 100,
    );
  });

  it("prices the review off the world frontier, and never cuts pay", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const definitionId = draft.researchers[researcherId]?.definitionId ?? "";
    const base =
      content.researchers.definitions[definitionId]?.contract.baseSalaryPerCycle ?? 0;
    const researcher = draft.researchers[researcherId];
    if (researcher?.contract === undefined) throw new Error("contract missing");
    // Signed cheap in the foundation era; the world then reaches frontier 40.
    // The market reads the best measured model in state.models regardless of
    // owner, so anyone's breakthrough raises everyone's payroll.
    researcher.contract.salaryPerCycle = cashMillions(base);
    const withModel = structuredClone(
      addBaselineModelForTest(draft, content),
    ) as DeepMutable<GameState>;
    const frontierModel = Object.values(withModel.models)[0];
    if (frontierModel?.measuredCapability === undefined) {
      throw new Error("frontier model fixture missing");
    }
    frontierModel.measuredCapability.frontierCapability = rating(40);
    setTick(withModel, 51);

    const boomTx = createTransaction(withModel);
    const adjustments = advanceResearcherSalaryReviews(boomTx, content);
    // 2^(40/20) = 4x boom on top of one year of 6% inflation.
    expect(adjustments[0]?.nextSalaryPerCycle).toBe(
      Math.round(base * 1.06 * 4 * 100) / 100,
    );

    // A contract already above the market is left alone, never cut.
    const rich = mutable(newState());
    const richResearcherId = firstCandidate(rich);
    employ(rich, richResearcherId);
    const richResearcher = rich.researchers[richResearcherId];
    if (richResearcher?.contract === undefined) throw new Error("contract missing");
    richResearcher.contract.salaryPerCycle = cashMillions(99);
    setTick(rich, 51);
    const richTx = createTransaction(rich);
    const richAdjustments = advanceResearcherSalaryReviews(richTx, content);
    expect(richAdjustments[0]?.nextSalaryPerCycle).toBe(99);
  });

  it("moves every rating by exactly 1.5% of its distance to target", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const lab = draft.labs[draft.run.playerLabId];
    const researcher = draft.researchers[researcherId];
    if (lab === undefined || researcher === undefined) throw new Error("fixture missing");
    // researchFreedom, then engineeringQuality, were the example ratings here
    // until each was removed as frozen; the drift rule they exercised is
    // shared by every organisation rating.
    lab.flags[ORGANISATION_TARGET_FLAGS.internalCandour] = 80;

    const organisationTx = createTransaction(draft);
    const changes = updateOrganisationRatings(organisationTx);
    const organisation = organisationTx.commit({ description: "rating drift" }).state;
    const candourDrift = changes.find((c) => c.key === "internalCandour");
    const startingCandour = 50;
    expect(candourDrift).toMatchObject({ oldValue: startingCandour, target: 80 });
    expect(
      organisation.labs[draft.run.playerLabId]?.organisation.hiddenInternalCandour,
    ).toBeCloseTo(startingCandour + (80 - startingCandour) * ORGANISATION_DRIFT_RATE, 12);

    const researcherDraft = mutable(organisation);
    const mutableResearcher = researcherDraft.researchers[researcherId];
    if (mutableResearcher === undefined) throw new Error("researcher missing");
    mutableResearcher.morale = rating(20);
    mutableResearcher.loyalty = rating(30);
    mutableResearcher.burnout = rating(80);
    mutableResearcher.departurePressure = rating(40);
    const targets = calculateResearcherStateTargets(
      researcherDraft,
      content,
      researcherId,
    );
    const peopleTx = createTransaction(researcherDraft);
    updateResearcherStates(peopleTx, content);
    const drifted = peopleTx.commit({ description: "researcher drift" }).state;
    const after = drifted.researchers[researcherId];
    expect(after?.morale).toBeCloseTo(20 + (targets.morale - 20) * 0.015, 12);
    expect(after?.loyalty).toBeCloseTo(30 + (targets.loyalty - 30) * 0.015, 12);
    expect(after?.burnout).toBeCloseTo(80 + (targets.burnout - 80) * 0.015, 12);
    expect(after?.departurePressure).toBeCloseTo(
      40 + (targets.departurePressure - 40) * 0.015,
      12,
    );
  });
});

describe("first-class promises", () => {
  it("tracks maintained progress, resolves once, and applies kept memory", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const promiseTx = createTransaction(draft);
    addResearcherPromise(promiseTx, {
      researcherId,
      label: "Protected architecture programme",
      dueInWeeks: 4,
      condition: {
        kind: "assignment-maintained",
        assignmentKind: "capability-program",
        targetId: architectures,
        requiredWeeks: 3,
      },
      severity: "major",
      keptMemory: { morale: 5, loyalty: 7, burnout: -2, departurePressure: -8 },
      brokenMemory: { morale: -10, loyalty: -12, burnout: 4, departurePressure: 15 },
    });
    let state = promiseTx.commit({ description: "make promise" }).state;

    for (let week = 0; week < 3; week += 1) {
      const atWeek = mutable(state);
      setTick(atWeek, week);
      const tx = createTransaction(atWeek);
      evaluateResearcherPromises(tx);
      state = tx.commit({ description: `promise week ${String(week)}` }).state;
    }
    const researcher = state.researchers[researcherId];
    expect(researcher?.promises[0]).toMatchObject({
      status: "kept",
      progress: 1,
      satisfiedWeeks: 3,
      resolvedAt: 2,
    });
    expect(researcher?.loyalty).toBe(57);
    expect(researcher?.memories).toContainEqual(
      expect.objectContaining({ kind: "promise-kept", flagrant: false }),
    );

    const repeatedTx = createTransaction(state);
    evaluateResearcherPromises(repeatedTx);
    const repeated = repeatedTx.commit({ description: "promise idempotence" }).state;
    expect(repeated.researchers[researcherId]?.memories).toHaveLength(1);
  });

  it("supports declarative promise effects and records a flagrant breach", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const addTx = createTransaction(draft);
    applyEffect(
      addTx,
      {
        kind: "add-researcher-promise",
        researcherId,
        label: "The committee will receive a real veto",
        dueInWeeks: 2,
        condition: {
          kind: "lab-flag-equals",
          flag: "committee:real-veto",
          value: true,
        },
        severity: "flagrant",
        keptMemory: { morale: 5, loyalty: 8, burnout: 0, departurePressure: -5 },
        brokenMemory: { morale: -20, loyalty: -20, burnout: 5, departurePressure: 25 },
      },
      { kind: "event", id: "test:promise" },
    );
    const pending = addTx.commit({ description: "event promise" }).state;
    const due = mutable(pending);
    setTick(due, 2);
    const evaluateTx = createTransaction(due);
    evaluateResearcherPromises(evaluateTx);
    const broken = evaluateTx.commit({ description: "break promise" }).state;
    expect(broken.researchers[researcherId]?.promises[0]).toMatchObject({
      status: "broken",
      resolvedAt: 2,
    });
    expect(broken.researchers[researcherId]?.memories).toContainEqual(
      expect.objectContaining({ kind: "promise-broken", flagrant: true }),
    );
    expect(broken.researchers[researcherId]?.loyalty).toBe(30);
  });
});

describe("departure checks and ultimatums", () => {
  it("runs and stores the deterministic quarterly departure check", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    setTick(draft, 13);
    const tx = createTransaction(draft);
    advanceResearcherCrises(tx, content);
    const checked = tx.commit({ description: "quarterly people check" }).state;
    expect(checked.researchers[researcherId]?.departureChecks).toHaveLength(1);
    expect(checked.researchers[researcherId]?.departureChecks[0]).toMatchObject({
      checkedAt: 13,
      reason: "quarterly",
    });
  });

  // Being alone at the frontier is its own retention problem: the best team in
  // the world is the one every rival is calling.
  it("charges a frontier leader extra departure pressure for the lead itself", () => {
    const withModels = addBaselineModelsForTest(newState(), content);
    const level = mutable(withModels);
    for (const labId of Object.keys(level.labs).sort() as LabId[]) {
      const modelId = level.labs[labId]?.models.modelIds[0];
      const model = modelId === undefined ? undefined : level.models[modelId];
      if (model === undefined) throw new Error("lead fixture missing");
      for (const key of Object.keys(
        model.trueCapability,
      ) as (keyof typeof model.trueCapability)[]) {
        model.trueCapability[key] = rating(40);
      }
    }
    const researcherId = firstCandidate(level);
    employ(level, researcherId);
    expect(calculateDeparturePressure(level, researcherId).frontierPull).toBe(0);

    const ahead = mutable(level);
    const modelId = ahead.labs[ahead.run.playerLabId]?.models.modelIds[0];
    const model = modelId === undefined ? undefined : ahead.models[modelId];
    if (model === undefined) throw new Error("lead fixture missing");
    for (const key of Object.keys(
      model.trueCapability,
    ) as (keyof typeof model.trueCapability)[]) {
      model.trueCapability[key] = rating(90);
    }
    const led = calculateDeparturePressure(ahead, researcherId);
    expect(led.frontierPull).toBe(15);
    expect(led.target).toBe(calculateDeparturePressure(level, researcherId).target + 15);
  });

  it("stores the departure draw and gives a loyal researcher an ultimatum first", () => {
    const draft = mutable(funded(newState()));
    const researcherId = content.researchers.orderedIds
      .map((id) => id as unknown as ResearcherId)
      .find(
        (id) =>
          new RandomOracleV1(draft.run.seed).uniform(
            randomKey("researcher-departure", id, "0", "provocation"),
          ) < 0.9,
      );
    if (researcherId === undefined) throw new Error("departure fixture missing");
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.departurePressure = rating(100);
    researcher.loyalty = rating(50);

    const checkTx = createTransaction(draft);
    const check = checkResearcherDeparture(checkTx, content, researcherId, "provocation");
    const warned = checkTx.commit({ description: "departure check" }).state;
    expect(check).toMatchObject({ probability: 0.9, outcome: "ultimatum" });
    expect(check.draw).toBeLessThan(check.probability);
    expect(warned.researchers[researcherId]?.ultimatum).toMatchObject({
      status: "pending",
      expiresAt: 4,
    });

    const response = {
      kind: "resolve-researcher-ultimatum" as const,
      meta: {
        commandId: "command:accept-ultimatum" as CommandId,
        expectedTick: warned.run.tick,
        issuedBy: "player" as const,
      },
      labId: warned.run.playerLabId,
      researcherId,
      response: "accept-conditions" as const,
    };
    const validation = validateCommand(warned, content, response);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.preview.ultimatumResponse).toMatchObject({
        auraCost: 3,
        createsPromise: true,
      });
    }
    const retained = applyCommand(warned, content, response).state;
    expect(retained.researchers[researcherId]?.ultimatum).toMatchObject({
      status: "accepted",
      response: "accept-conditions",
    });
    expect(retained.researchers[researcherId]?.promises.at(-1)).toMatchObject({
      severity: "flagrant",
      dueAt: 52,
    });
    expect(retained.labs[retained.run.playerLabId]?.aura.spendable).toBe(97);

    const beforeNextQuarter = mutable(retained);
    setTick(beforeNextQuarter, 12);
    const protectedResearcher = beforeNextQuarter.researchers[researcherId];
    if (protectedResearcher === undefined) throw new Error("researcher missing");
    expect(
      hasAcceptedUltimatumProtection(protectedResearcher, beforeNextQuarter.run.tick),
    ).toBe(true);
    const protectedTx = createTransaction(beforeNextQuarter);
    advanceResearcherCrises(protectedTx, content);
    const protectedState = protectedTx.commit({
      description: "accepted ultimatum protection",
    }).state;
    expect(protectedState.researchers[researcherId]?.status).toBe("employed");
    expect(protectedState.researchers[researcherId]?.departureChecks).toHaveLength(1);
  });

  it("does not run a routine departure check during an accepted settlement", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.departurePressure = rating(100);
    researcher.loyalty = rating(10);
    researcher.ultimatum = {
      id: "ultimatum:protected",
      reason: "provocation",
      issuedAt: tick(8),
      expiresAt: tick(12),
      status: "accepted",
      response: "accept-conditions",
      resolvedAt: tick(12),
    };
    setTick(draft, 13);

    const tx = createTransaction(draft);
    advanceResearcherCrises(tx, content);
    const protectedState = tx.commit({ description: "protected quarter" }).state;
    expect(protectedState.researchers[researcherId]?.status).toBe("employed");
    expect(protectedState.researchers[researcherId]?.departureChecks).toHaveLength(0);
  });

  it("turns meeting terms in the decision popup into a 52-week settlement", () => {
    const draft = mutable(funded(newState()));
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.departurePressure = rating(100);
    researcher.loyalty = rating(10);
    researcher.ultimatum = {
      id: "ultimatum:popup",
      reason: "quarterly",
      issuedAt: tick(0),
      expiresAt: tick(4),
      status: "pending",
    };

    const openTx = createTransaction(draft);
    const instanceId = instantiateEvent(
      openTx,
      content,
      contentId("base:event.people.resignation-ultimatum"),
      {
        source: "mandatory",
        triggerKey: "researcher-ultimatum:ultimatum:popup",
        tokens: {
          RESEARCHER: "Jo Pineau",
          RESEARCHER_ID: researcherId,
          ULTIMATUM_ID: "ultimatum:popup",
        },
      },
    );
    const opened = openTx.commit({ description: "open ultimatum popup" }).state;
    const resolveTx = createTransaction(opened);
    resolveEventOption(resolveTx, content, instanceId, "meet-terms");
    const settled = resolveTx.commit({ description: "meet researcher terms" }).state;

    expect(settled.researchers[researcherId]?.ultimatum).toMatchObject({
      status: "accepted",
      response: "accept-conditions",
      resolvedAt: 0,
    });
    expect(settled.researchers[researcherId]?.promises.at(-1)).toMatchObject({
      label: "One-year protected working arrangement",
      dueAt: 52,
    });

    const protectedQuarter = mutable(settled);
    setTick(protectedQuarter, 13);
    const advanceTx = createTransaction(protectedQuarter);
    advanceResearcherCrises(advanceTx, content);
    const advanced = advanceTx.commit({
      description: "protected departure review",
    }).state;
    expect(advanced.researchers[researcherId]?.status).toBe("employed");
    expect(advanced.researchers[researcherId]?.departureChecks).toHaveLength(0);
  });

  it.each(["accept-conditions", "wish-well"] as const)(
    "invalidates the matching event after a %s response in the People workspace",
    (response) => {
      const draft = mutable(funded(newState()));
      const researcherId = firstCandidate(draft);
      employ(draft, researcherId);
      const researcher = draft.researchers[researcherId];
      if (researcher === undefined) throw new Error("researcher missing");
      researcher.ultimatum = {
        id: "ultimatum:people-response",
        reason: "quarterly",
        issuedAt: tick(0),
        expiresAt: tick(4),
        status: "pending",
      };

      const openTx = createTransaction(draft);
      const instanceId = instantiateEvent(
        openTx,
        content,
        contentId("base:event.people.resignation-ultimatum"),
        {
          source: "mandatory",
          triggerKey: "researcher-ultimatum:ultimatum:people-response",
          tokens: {
            RESEARCHER: "Jo Pineau",
            RESEARCHER_ID: researcherId,
            ULTIMATUM_ID: "ultimatum:people-response",
          },
        },
      );
      const opened = openTx.commit({ description: "open ultimatum popup" }).state;
      const resolved = applyCommand(opened, content, {
        kind: "resolve-researcher-ultimatum",
        meta: {
          commandId: `command:people-${response}` as CommandId,
          expectedTick: opened.run.tick,
          issuedBy: "player",
        },
        labId: opened.run.playerLabId,
        researcherId,
        response,
      }).state;

      expect(resolved.eventInstances[instanceId]).toMatchObject({
        status: "invalidated",
        invalidationReason: "Ultimatum resolved through the People workspace",
      });
    },
  );

  it("rejects a stale event whose exact ultimatum is no longer pending", () => {
    const draft = mutable(funded(newState()));
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.ultimatum = {
      id: "ultimatum:stale-event",
      reason: "quarterly",
      issuedAt: tick(0),
      expiresAt: tick(4),
      status: "pending",
    };

    const openTx = createTransaction(draft);
    const instanceId = instantiateEvent(
      openTx,
      content,
      contentId("base:event.people.resignation-ultimatum"),
      {
        source: "mandatory",
        triggerKey: "researcher-ultimatum:ultimatum:stale-event",
        tokens: {
          RESEARCHER: "Jo Pineau",
          RESEARCHER_ID: researcherId,
          ULTIMATUM_ID: "ultimatum:stale-event",
        },
      },
    );
    const stale = mutable(openTx.commit({ description: "open ultimatum popup" }).state);
    const staleResearcher = stale.researchers[researcherId];
    if (staleResearcher?.ultimatum === undefined) {
      throw new Error("ultimatum missing");
    }
    staleResearcher.ultimatum.status = "resolved";
    staleResearcher.ultimatum.response = "wish-well";
    staleResearcher.ultimatum.resolvedAt = stale.run.tick;

    const validation = validateCommand(stale, content, {
      kind: "respond-to-decision-event",
      meta: {
        commandId: "command:stale-ultimatum-event" as CommandId,
        expectedTick: stale.run.tick,
        issuedBy: "player",
      },
      instanceId,
      optionId: "meet-terms",
    });

    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("stale event unexpectedly validated");
    expect(validation.errors).toContainEqual({
      code: "event-option-blocked",
      message: "This ultimatum is no longer pending",
    });
  });

  it("invalidates the matching event when a pending researcher departs", () => {
    const draft = mutable(funded(newState()));
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.ultimatum = {
      id: "ultimatum:departure",
      reason: "quarterly",
      issuedAt: tick(0),
      expiresAt: tick(4),
      status: "pending",
    };

    const openTx = createTransaction(draft);
    const instanceId = instantiateEvent(
      openTx,
      content,
      contentId("base:event.people.resignation-ultimatum"),
      {
        source: "mandatory",
        triggerKey: "researcher-ultimatum:ultimatum:departure",
        tokens: {
          RESEARCHER: "Jo Pineau",
          RESEARCHER_ID: researcherId,
          ULTIMATUM_ID: "ultimatum:departure",
        },
      },
    );
    const opened = openTx.commit({ description: "open ultimatum popup" }).state;
    const departureTx = createTransaction(opened);
    departResearcher(departureTx, content, researcherId, "poached");
    const departed = departureTx.commit({ description: "researcher poached" }).state;

    expect(departed.eventInstances[instanceId]).toMatchObject({
      status: "invalidated",
      invalidationReason:
        "The researcher departed before the ultimatum event was resolved",
    });
  });

  it("allows a low-loyalty researcher to leave without an ultimatum", () => {
    const draft = mutable(newState());
    const researcherId = content.researchers.orderedIds
      .map((id) => id as unknown as ResearcherId)
      .find(
        (id) =>
          new RandomOracleV1(draft.run.seed).uniform(
            randomKey("researcher-departure", id, "0", "provocation"),
          ) < 0.9,
      );
    if (researcherId === undefined) throw new Error("departure fixture missing");
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.departurePressure = rating(100);
    researcher.loyalty = rating(10);
    const tx = createTransaction(draft);
    const check = checkResearcherDeparture(tx, content, researcherId, "provocation");
    const departed = tx.commit({ description: "immediate departure" }).state;
    expect(check.outcome).toBe("departed");
    expect(departed.researchers[researcherId]?.status).toBe("departed");
    expect(departed.researchers[researcherId]?.employerLabId).toBeUndefined();
    expect(departed.researchers[researcherId]?.assignment).toBeUndefined();
    expect(departed.researchers[researcherId]?.ultimatum).toBeUndefined();
    expect(departed.labs[departed.run.playerLabId]?.roster.researcherIds).not.toContain(
      researcherId,
    );
  });

  it("records a rival departure against the rival without pausing the player", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    const researcher = draft.researchers[researcherId];
    const rivalLabId = Object.keys(draft.labs).find(
      (labId) => labId !== draft.run.playerLabId,
    ) as LabId | undefined;
    const rival = rivalLabId === undefined ? undefined : draft.labs[rivalLabId];
    if (researcher === undefined || rivalLabId === undefined || rival === undefined) {
      throw new Error("rival departure fixture missing");
    }
    researcher.employerLabId = rivalLabId;
    researcher.employedAt = draft.run.tick;
    researcher.status = "employed";
    researcher.housing = "housed";
    rival.roster.researcherIds.push(researcherId);
    draft.talentMarket.visibleResearcherIds =
      draft.talentMarket.visibleResearcherIds.filter((id) => id !== researcherId);

    const tx = createTransaction(draft);
    departResearcher(tx, content, researcherId, "voluntary");
    const result = tx.commit({ description: "rival departure" });

    expect(result.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "researcher-departed",
        researcherId,
        formerLabId: rivalLabId,
      }),
    );
    expect(result.state.run.autoPauseReasons).not.toContain("resignation-ultimatum");
    expect(result.state.decisionLog.at(-1)?.relatedIds).toContain(rivalLabId);
    expect(result.state.presentationQueue).not.toContainEqual(
      expect.objectContaining({ kind: "researcher-departure" }),
    );
  });

  it("turns eight weeks of Unhoused status into a visible ultimatum", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.housing = "unhoused";
    researcher.unhousedSince = tick(0);
    setTick(draft, 8);
    const tx = createTransaction(draft);
    advanceResearcherCrises(tx, content);
    const warned = tx.commit({ description: "unhoused ultimatum" });
    expect(warned.state.researchers[researcherId]?.ultimatum).toMatchObject({
      reason: "provocation",
      status: "pending",
      expiresAt: 12,
    });
    expect(warned.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "researcher-ultimatum-issued" }),
    );
  });
});

describe("poaching, knowledge transfer, retention, and dismissal", () => {
  it.each(["voluntary", "dismissed", "ultimatum-expired"] as const)(
    "queues a durable modal when a player researcher leaves (%s)",
    (reason) => {
      const draft = mutable(newState());
      const researcherId = firstCandidate(draft);
      employ(draft, researcherId);
      const definitionId = draft.researchers[researcherId]?.definitionId;
      const tx = createTransaction(draft);

      departResearcher(tx, content, researcherId, reason);
      const result = tx.commit({ description: `${reason} departure` });

      expect(result.state.presentationQueue).toContainEqual({
        key: `researcher-departure:${researcherId}:0`,
        kind: "researcher-departure",
        attention: "modal",
        researcherId,
        definitionId,
        reason,
        createdAt: 0,
      });
    },
  );

  it("preserves a separate modal for every player departure in the same week", () => {
    const draft = mutable(newState());
    const [firstResearcherId, secondResearcherId] =
      draft.talentMarket.visibleResearcherIds;
    if (firstResearcherId === undefined || secondResearcherId === undefined) {
      throw new Error("multiple departure fixture missing");
    }
    employ(draft, firstResearcherId);
    employ(draft, secondResearcherId);
    const tx = createTransaction(draft);

    departResearcher(tx, content, firstResearcherId, "voluntary");
    departResearcher(tx, content, secondResearcherId, "dismissed");
    const result = tx.commit({ description: "multiple departures" });

    const departures = result.state.presentationQueue.filter(
      (item) => item.kind === "researcher-departure",
    );
    expect(departures).toHaveLength(2);
    expect(departures.map((item) => item.researcherId)).toEqual([
      firstResearcherId,
      secondResearcherId,
    ]);
  });

  it("runs rumour to counteroffer to departure, then transfers only copied progress", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    const lab = draft.labs[draft.run.playerLabId];
    if (researcher === undefined || lab === undefined) throw new Error("fixture missing");
    researcher.departurePressure = rating(100);
    researcher.loyalty = rating(10);
    const definition = content.researchers.definitions[researcher.definitionId];
    const paperId = definition?.paperHooks.ids[0];
    if (paperId === undefined) throw new Error("paper hook fixture missing");
    lab.research.paperProgress[paperId] = 100;

    const startTx = createTransaction(draft);
    startPoachingAttempt(startTx, content, researcherId, "lab:rival-1", 100);
    const signalled = startTx.commit({ description: "poaching rumour" });
    expect(signalled.state.researchers[researcherId]?.poaching).toMatchObject({
      stage: "rumour",
      counterofferAt: 2,
      resolvesAt: 4,
    });
    expect(signalled.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "researcher-poaching-rumour" }),
    );
    const poachingPresentation = signalled.state.presentationQueue.find(
      (item) => item.kind === "researcher-poaching",
    );
    expect(poachingPresentation?.key).toMatch(/^researcher-poaching:/);
    expect(poachingPresentation).toMatchObject({
      kind: "researcher-poaching",
      attention: "modal",
      researcherId,
      rivalLabId: "lab:rival-1",
      createdAt: 0,
    });
    expect(poachingPresentation?.poachingId).toBe(
      signalled.state.researchers[researcherId]?.poaching?.id,
    );

    const weekTwo = mutable(signalled.state);
    setTick(weekTwo, 2);
    weekTwo.run.autoPauseReasons = [];
    const counterTx = createTransaction(weekTwo);
    advanceResearcherCrises(counterTx, content);
    const counter = counterTx.commit({ description: "poaching counteroffer" });
    expect(counter.state.researchers[researcherId]?.poaching?.stage).toBe("counteroffer");
    expect(counter.state.run.autoPauseReasons).toEqual([]);
    expect(counter.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "researcher-poaching-counteroffer" }),
    );

    const weekFour = mutable(counter.state);
    setTick(weekFour, 4);
    const resolutionTx = createTransaction(weekFour);
    advanceResearcherCrises(resolutionTx, content);
    const resolved = resolutionTx.commit({ description: "poaching resolution" });
    const departed = resolved.state.researchers[researcherId];
    expect(departed?.poaching).toMatchObject({
      stage: "resolved",
      outcome: "departed",
      departureProbability: 0.95,
    });
    expect(departed?.knowledgeTransfer?.fraction).toBeGreaterThanOrEqual(0.2);
    expect(departed?.knowledgeTransfer?.fraction).toBeLessThanOrEqual(0.6);
    expect(departed?.knowledgeTransfer?.progressByPaper[paperId]).toBeGreaterThan(0);
    expect(resolved.state.presentationQueue).not.toContainEqual(
      expect.objectContaining({ kind: "researcher-poaching" }),
    );
    expect(resolved.state.presentationQueue).toContainEqual({
      key: `researcher-departure:${researcherId}:4`,
      kind: "researcher-departure",
      attention: "modal",
      researcherId,
      definitionId: departed?.definitionId,
      reason: "poached",
      rivalLabId: "lab:rival-1",
      createdAt: 4,
    });
    expect(
      resolved.state.labs[draft.run.playerLabId]?.research.paperProgress[paperId],
    ).toBe(100);

    const knowledgeTransfer = departed?.knowledgeTransfer;
    if (knowledgeTransfer === undefined) {
      throw new Error("knowledge transfer fixture missing");
    }
    const dueAt = knowledgeTransfer.dueAt;
    const due = mutable(resolved.state);
    setTick(due, dueAt);
    const transferTx = createTransaction(due);
    advanceResearcherCrises(transferTx, content);
    const transferred = transferTx.commit({ description: "knowledge transfer" });
    expect(transferred.state.world.paperRace.rival.paperProgress[paperId]).toBe(
      knowledgeTransfer.progressByPaper[paperId],
    );
    expect(
      transferred.state.labs[draft.run.playerLabId]?.research.paperProgress[paperId],
    ).toBe(100);
  });

  it("resolves a submitted counteroffer as a successful stay", () => {
    const draft = mutable(funded(newState()));
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("researcher fixture missing");
    researcher.loyalty = rating(100);
    researcher.departurePressure = rating(0);

    const startTx = createTransaction(draft);
    startPoachingAttempt(startTx, content, researcherId, "lab:rival-1", 0);
    const approached = startTx.commit({ description: "poaching approach" }).state;
    const response = applyCommand(approached, content, {
      kind: "submit-retention-offer",
      meta: {
        commandId: "command:successful-retention" as CommandId,
        expectedTick: approached.run.tick,
        issuedBy: "player",
      },
      labId: approached.run.playerLabId,
      researcherId,
      offer: {
        package: "serious",
      },
    }).state;
    expect(response.researchers[researcherId]?.poaching?.playerRetentionStrength).toBe(
      13,
    );

    const resolutionWeek = mutable(response);
    const resolvesAt = resolutionWeek.researchers[researcherId]?.poaching?.resolvesAt;
    if (resolvesAt === undefined) throw new Error("poaching resolution fixture missing");
    setTick(resolutionWeek, resolvesAt);
    const resolutionTx = createTransaction(resolutionWeek);
    advanceResearcherCrises(resolutionTx, content);
    const resolved = resolutionTx.commit({ description: "successful retention" });
    const retained = resolved.state.researchers[researcherId];

    expect(retained).toMatchObject({
      status: "employed",
      employerLabId: draft.run.playerLabId,
      poaching: {
        stage: "resolved",
        outcome: "stayed",
        departureProbability: 0.05,
      },
    });
    const stayMemory = retained?.memories.find(
      (memory) => memory.kind === "poaching-resolved",
    );
    expect(stayMemory?.summary).toMatch(/Stayed after .*rival lab's offer/i);
    expect(resolved.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "researcher-poaching-resolved",
        researcherId,
        departed: false,
      }),
    );
    expect(resolved.domainEvents).not.toContainEqual(
      expect.objectContaining({
        kind: "researcher-departed",
        researcherId,
      }),
    );
    expect(resolved.state.labs[draft.run.playerLabId]?.roster.researcherIds).toContain(
      researcherId,
    );
    expect(resolved.state.decisionLog.at(-1)?.summary).toMatch(
      /accepted the lab's retention offer.+will stay/,
    );
  });

  it("prices standard counteroffers from current salary without inflating their strength", () => {
    const draft = mutable(funded(newState()));
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const researcher = draft.researchers[researcherId];
    if (researcher?.contract === undefined) throw new Error("researcher fixture missing");
    researcher.contract.salaryPerCycle = cashMillions(4);

    const startTx = createTransaction(draft);
    startPoachingAttempt(startTx, content, researcherId, "lab:rival-1", 60);
    const approached = startTx.commit({ description: "poaching approach" }).state;

    expect(
      quoteRetentionOffer(approached, approached.run.playerLabId, researcherId, {
        package: "reassurance",
      }),
    ).toMatchObject({ signingCash: 2, auraSpend: 0, strengthGain: 3 });
    expect(
      quoteRetentionOffer(approached, approached.run.playerLabId, researcherId, {
        package: "serious",
      }),
    ).toMatchObject({ signingCash: 6, auraSpend: 1, strengthGain: 13 });

    const retained = applyCommand(approached, content, {
      kind: "submit-retention-offer",
      meta: {
        commandId: "command:scaled-retention" as CommandId,
        expectedTick: approached.run.tick,
        issuedBy: "player",
      },
      labId: approached.run.playerLabId,
      researcherId,
      offer: { package: "serious" },
    }).state;
    expect(retained.labs[retained.run.playerLabId]?.finance.cash).toBe(494);
    expect(retained.labs[retained.run.playerLabId]?.aura.spendable).toBe(99);
    expect(retained.researchers[researcherId]?.poaching?.playerRetentionStrength).toBe(
      13,
    );
  });

  it("accepts a visible retention offer with an optional tracked promise", () => {
    const draft = mutable(funded(newState()));
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const startTx = createTransaction(draft);
    startPoachingAttempt(startTx, content, researcherId, "lab:rival-1", 60);
    const approached = startTx.commit({ description: "poaching approach" }).state;
    const command = {
      kind: "submit-retention-offer" as const,
      meta: {
        commandId: "command:retention" as CommandId,
        expectedTick: approached.run.tick,
        issuedBy: "player" as const,
      },
      labId: approached.run.playerLabId,
      researcherId,
      offer: {
        package: "serious" as const,
        promise: {
          label: "Four weeks of protected focus",
          dueInWeeks: 4,
          condition: {
            kind: "assignment-maintained" as const,
            assignmentKind: "capability-program" as const,
            targetId: architectures,
            requiredWeeks: 4,
          },
          severity: "major" as const,
          keptMemory: { morale: 4, loyalty: 5, burnout: -2, departurePressure: -5 },
          brokenMemory: {
            morale: -10,
            loyalty: -12,
            burnout: 4,
            departurePressure: 15,
          },
        },
      },
    };
    const validation = validateCommand(approached, content, command);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.preview.retentionOffer).toMatchObject({
        strengthGain: 25,
        resultingPlayerRetentionStrength: 25,
      });
    }
    const retained = applyCommand(approached, content, command).state;
    expect(retained.researchers[researcherId]?.poaching?.playerRetentionStrength).toBe(
      25,
    );
    expect(retained.researchers[researcherId]?.promises).toHaveLength(1);
    expect(retained.labs[retained.run.playerLabId]?.finance.cash).toBe(498.5);
    expect(retained.labs[retained.run.playerLabId]?.aura.spendable).toBe(99);
    const envelope = createSaveEnvelope(retained, {
      saveId: "people-state",
      slotType: "manual",
      displayName: "People state round trip",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T00:00:00.000Z",
    });
    expect(loadSaveEnvelope(envelope).state.researchers[researcherId]).toEqual(
      retained.researchers[researcherId],
    );

    const repeated = validateCommand(retained, content, {
      ...command,
      meta: {
        ...command.meta,
        commandId: "command:retention-repeat" as CommandId,
      },
    });
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) {
      expect(repeated.errors.map((error) => error.message)).toContain(
        "A retention response is already on record",
      );
    }
  });

  it("requires confirmation and applies quoted dismissal consequences", () => {
    const draft = mutable(funded(newState()));
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const quote = quoteDismissal(draft, content, draft.run.playerLabId, researcherId);
    expect(quote).toMatchObject({
      severanceCash: 2,
      auraLoss: 3,
      blockers: [],
    });
    const command = {
      kind: "dismiss-researcher" as const,
      meta: {
        commandId: "command:dismiss" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player" as const,
      },
      labId: draft.run.playerLabId,
      researcherId,
      confirmed: true as const,
    };
    const unconfirmed = {
      ...command,
      confirmed: false,
    } as unknown as typeof command;
    expect(validateCommand(draft, content, unconfirmed)).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: "dismissal-not-confirmed" })],
    });
    const validation = validateCommand(draft, content, command);
    expect(validation.ok).toBe(true);
    if (validation.ok) expect(validation.preview.dismissal).toEqual(quote);
    const dismissed = applyCommand(draft, content, command).state;
    expect(dismissed.researchers[researcherId]?.status).toBe("departed");
    expect(dismissed.labs[draft.run.playerLabId]?.finance.cash).toBe(498);
    expect(dismissed.labs[draft.run.playerLabId]?.aura.spendable).toBe(97);
  });

  it("reassigns an employed researcher through a validated command", () => {
    const draft = mutable(newState());
    const researcherId = firstCandidate(draft);
    employ(draft, researcherId);
    const command = {
      kind: "assign-researcher" as const,
      meta: {
        commandId: "command:reassign" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player" as const,
      },
      labId: draft.run.playerLabId,
      researcherId,
      assignment: {
        kind: "safety-program" as const,
        targetId: contentId("base:safety.alignment-control"),
        role: "advisor" as const,
      },
    };
    const validation = validateCommand(draft, content, command);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.preview.researcherAssignment).toMatchObject({
        researcherId,
        assignment: command.assignment,
        blockers: [],
      });
    }
    const result = applyCommand(draft, content, command);
    expect(result.state.researchers[researcherId]?.assignment).toEqual({
      ...command.assignment,
      assignedAt: draft.run.tick,
    });
    expect(result.domainEvents).toContainEqual({
      kind: "researcher-assigned",
      researcherId,
      assignmentKind: "safety-program",
      targetId: contentId("base:safety.alignment-control"),
      role: "advisor",
    });
  });
});
