import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import type { ConductRivalDiplomacyCommand } from "../../commands/types.ts";
import { validateCommand } from "../../commands/validate.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { CommandId, LabId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { validateGameState } from "../../model/schema.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { cashMillions, rating, tick } from "../../model/units.ts";
import { randomKey } from "../../random/key.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { projectRivalRelationships, quoteRivalDiplomacy } from "../diplomacy.ts";
import {
  calculateRivalIncidentRisk,
  resolveRivalHighSeverityFailure,
  RIVAL_INCIDENT_CONSEQUENCES,
} from "../incidents.ts";
import { advanceRivalTalentMoves } from "../policy.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return addBaselineModelsForTest(
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
}

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function firstRival(state: Readonly<GameState>): LabId {
  const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
  if (rivalLabId === undefined) throw new Error("Rival fixture missing");
  return rivalLabId;
}

describe("rival relationships and diplomacy", () => {
  it("initialises four-value relationships and projects only qualitative bands", () => {
    const state = newState();
    const views = projectRivalRelationships(state);
    expect(views).toHaveLength(4);
    for (const strategy of Object.values(state.world.rivals)) {
      expect(Object.keys(strategy.relationship).sort()).toEqual([
        "dependence",
        "perceivedHonesty",
        "strategicFear",
        "trust",
      ]);
      expect(
        Object.values(strategy.relationship).every(
          (value) => value >= -100 && value <= 100,
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(views)).not.toMatch(/acceptanceProbability|draw/);
    expect(views[0]?.trust).toMatch(/very-low|low|neutral|high|very-high/);
  });

  it("refuses diplomacy commands while the mechanic is disabled", () => {
    const draft = mutable(newState());
    const playerLabId = draft.run.playerLabId;
    const rivalLabId = firstRival(draft);
    const validation = validateCommand(draft, content, {
      kind: "conduct-rival-diplomacy",
      meta: {
        commandId: "diplomacy-disabled" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      rivalLabId,
      action: "share-incident-information",
    });
    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("diplomacy should be refused");
    expect(validation.errors.map((error) => error.code)).toContain("diplomacy-disabled");
  });

  // TODO(diplomacy-redesign): re-enable with the redesigned mechanic. This
  // exercises the full quote → validate → resolve → cooldown flow and is the
  // starting point for whatever replaces it.
  it.skip("quotes, validates, resolves, audits, and cools down a diplomacy command", () => {
    const draft = mutable(newState());
    const playerLabId = draft.run.playerLabId;
    const rivalLabId = firstRival(draft);
    const relationship = draft.world.rivals[rivalLabId]?.relationship;
    const player = draft.labs[playerLabId];
    if (relationship === undefined || player === undefined) {
      throw new Error("Diplomacy fixture missing");
    }
    relationship.trust = 100;
    relationship.dependence = 100;
    relationship.perceivedHonesty = 100;
    relationship.strategicFear = -100;
    player.finance.cash = cashMillions(100);
    player.aura.spendable = 100;
    player.aura.lifetime = 100;

    const action = "share-incident-information" as const;
    const oracle = new RandomOracleV1(draft.run.seed);
    const commandId = Array.from(
      { length: 100 },
      (_, index) => `diplomacy-${String(index)}`,
    ).find(
      (candidate) =>
        oracle.uniform(
          randomKey("rival-diplomacy", playerLabId, rivalLabId, action, candidate),
        ) < 0.5,
    );
    if (commandId === undefined)
      throw new Error("Could not find deterministic fixture draw");
    const command: ConductRivalDiplomacyCommand = {
      kind: "conduct-rival-diplomacy",
      meta: {
        commandId: commandId as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      rivalLabId,
      action,
    };
    const quote = quoteRivalDiplomacy(draft, playerLabId, rivalLabId, action);
    expect(quote).not.toHaveProperty("acceptanceProbability");
    const validation = validateCommand(draft, content, command);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("Diplomacy fixture did not validate");
    expect(validation.preview.rivalDiplomacy).toEqual(quote);

    const result = applyCommand(draft, content, command);
    const strategy = result.state.world.rivals[rivalLabId];
    expect(strategy?.diplomacyHistory.at(-1)).toMatchObject({
      id: commandId,
      action,
      accepted: true,
    });
    expect(strategy?.agreements.at(-1)).toMatchObject({
      action,
      establishedAt: 0,
      expiresAt: 13,
    });
    expect(result.state.labs[playerLabId]?.finance.cash).toBe(
      100 - quote.cashCostMillions,
    );
    expect(result.state.labs[playerLabId]?.aura.spendable).toBe(100 - quote.auraCost);
    expect(result.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "rival-diplomacy-resolved",
        rivalLabId,
        action,
        accepted: true,
      }),
    );
    const blocked = validateCommand(result.state, content, {
      ...command,
      meta: {
        ...command.meta,
        commandId: "diplomacy-repeat" as CommandId,
      },
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("Active agreement was not blocked");
    expect(blocked.errors.some((error) => error.code === "diplomacy-blocked")).toBe(true);
  });

  it("honours an active non-poaching agreement in the Stage 4 talent chain", () => {
    const draft = mutable(newState());
    draft.run.tick = tick(52);
    draft.run.calendar = calendarFromTick(52);
    const researcher = Object.values(draft.researchers)[0];
    if (researcher === undefined) {
      throw new Error("Non-poaching fixture missing");
    }
    for (const strategy of Object.values(draft.world.rivals)) {
      strategy.currentPlanId = "talent-raid";
      strategy.agreements.push({
        action: "non-poaching-agreement",
        establishedAt: tick(1),
        expiresAt: tick(60),
        sourceCommandId: `non-poach-fixture:${strategy.labId}`,
      });
    }
    researcher.status = "employed";
    researcher.housing = "housed";
    researcher.employerLabId = draft.run.playerLabId;
    draft.labs[draft.run.playerLabId]?.roster.researcherIds.push(researcher.id);

    const tx = createTransaction(draft);
    advanceRivalTalentMoves(tx, content, new RandomOracleV1(draft.run.seed));
    const after = tx.commit({ description: "active non-poaching agreement" }).state;
    expect(after.researchers[researcher.id]?.poaching).toBeUndefined();
  });
});

describe("contained rival incidents", () => {
  it("converts a critical failure to exactly two allowed consequences without ending the run", () => {
    const state = newState();
    const rivalLabId = firstRival(state);
    const tx = createTransaction(state);
    resolveRivalHighSeverityFailure(
      tx,
      rivalLabId,
      "critical",
      new RandomOracleV1(state.run.seed),
      { riskAtCheck: 90, triggerProbability: 0.25, triggerDraw: 0.01 },
    );
    const result = tx.commit({ description: "forced contained rival incident" });
    const incident = result.state.world.rivals[rivalLabId]?.incidents.at(-1);
    expect(incident?.consequences).toHaveLength(2);
    expect(
      incident?.consequences.every((consequence) =>
        RIVAL_INCIDENT_CONSEQUENCES.includes(consequence),
      ),
    ).toBe(true);
    expect(result.state.run.status).toBe("active");
    expect(result.state.run.endingId).toBeUndefined();
    expect(result.state.world.rivalSignals.at(-1)?.kind).toBe("incident");
    const logEntry = result.state.decisionLog.at(-1);
    expect(logEntry?.summary).toContain(
      "A rival lab contained a critical laboratory incident.",
    );
    expect(logEntry?.summary).not.toContain("run:lab:rival:");
    expect(logEntry?.summary).not.toContain("shared-restrictions");
    expect(result.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "rival-incident-resolved",
        labId: rivalLabId,
        severity: "critical",
      }),
    );
  });

  it("does not read the player's hidden model safety when calculating rival risk", () => {
    const baseline = newState();
    const changed = mutable(baseline);
    const playerModelId = changed.labs[changed.run.playerLabId]?.models.currentModelId;
    const playerModel =
      playerModelId === undefined ? undefined : changed.models[playerModelId];
    if (playerModel === undefined) throw new Error("Player model fixture missing");
    playerModel.hiddenSafety.trueAlignment = rating(0);
    playerModel.hiddenSafety.corrigibility = rating(0);
    playerModel.hiddenSafety.situationalAwareness = rating(100);
    playerModel.hiddenSafety.deceptiveCapability = rating(100);
    const rivalLabId = firstRival(baseline);
    expect(calculateRivalIncidentRisk(changed, rivalLabId)).toEqual(
      calculateRivalIncidentRisk(baseline, rivalLabId),
    );
  });

  it("defaults new Stage 6.3 fields when loading a pre-S6.3 version-3 state", () => {
    const legacy = structuredClone(newState()) as unknown as Record<string, unknown>;
    const world = legacy["world"] as Record<string, unknown>;
    const rivals = world["rivals"] as Record<string, Record<string, unknown>>;
    for (const strategy of Object.values(rivals)) {
      delete strategy["relationship"];
      delete strategy["agreements"];
      delete strategy["diplomacyHistory"];
      delete strategy["incidents"];
    }
    const loaded = validateGameState(legacy);
    for (const strategy of Object.values(loaded.world.rivals)) {
      expect(strategy.relationship).toEqual({
        trust: 0,
        strategicFear: 0,
        dependence: 0,
        perceivedHonesty: 0,
      });
      expect(strategy.agreements).toEqual([]);
      expect(strategy.diplomacyHistory).toEqual([]);
      expect(strategy.incidents).toEqual([]);
    }
  });
});
