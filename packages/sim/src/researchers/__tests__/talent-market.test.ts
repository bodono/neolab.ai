import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import type { RecruitResearcherCommand } from "../../commands/types.ts";
import { validateCommand } from "../../commands/validate.ts";
import {
  createProgressiveNewGame,
  LAB_MATURITY_STAGE_FLAG,
} from "../../campaign/lab-maturity.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { forecastFinance } from "../../finance/finance.ts";
import type { CommandId, ResearcherId } from "../../model/ids.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { cashMillions, rating, tick } from "../../model/units.ts";
import { createSaveEnvelope, loadSaveEnvelope } from "../../persistence/envelope.ts";
import { seed128 } from "../../random/seed.ts";
import {
  generateTalentMarketCandidates,
  isResearcherAvailable,
  quoteRecruitment,
  refreshTalentMarket,
  TALENT_MARKET_REFRESH_WEEKS,
} from "../talent-market.ts";

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

function fundedState(): GameState {
  const draft = mutable(newState());
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  lab.finance.cash = cashMillions(500);
  lab.aura.spendable = 100;
  lab.aura.lifetime = 100;
  return draft;
}

function command(
  state: GameState,
  researcherId: ResearcherId,
  suffix: string,
): RecruitResearcherCommand {
  return {
    kind: "recruit-researcher",
    meta: {
      commandId: `command:recruit:${suffix}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    researcherId,
  };
}

describe("talent market availability and rotation", () => {
  it("starts deterministically and samples every era from week one", () => {
    const state = newState();
    expect(state.talentMarket.visibleResearcherIds).toHaveLength(6);
    expect(new Set(state.talentMarket.visibleResearcherIds).size).toBe(6);
    expect(newState().talentMarket).toEqual(state.talentMarket);

    // The calendar never gates the pool: a later-era researcher with no
    // earned unlock is market-eligible in 2012.
    const laterEraUnconditional = Object.values(content.researchers.definitions).find(
      (definition) =>
        definition.availability.wave !== "foundation" &&
        (definition.availability.earliestYear ?? 0) > state.run.calendar.year &&
        definition.availability.unlockAny.length === 0,
    );
    if (laterEraUnconditional === undefined) throw new Error("era fixture missing");
    expect(
      isResearcherAvailable(
        state,
        content,
        laterEraUnconditional.id as unknown as ResearcherId,
      ),
    ).toBe(true);

    // Earned unlocks still gate, calendar or not.
    const conditional = Object.values(content.researchers.definitions).find(
      (definition) => definition.availability.unlockAny.length > 0,
    );
    if (conditional === undefined) throw new Error("unlock fixture missing");
    const conditionalId = conditional.id as unknown as ResearcherId;
    expect(isResearcherAvailable(state, content, conditionalId)).toBe(false);
    const unlocked = mutable(state);
    const lab = unlocked.labs[unlocked.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    const domain = lab.research.domains[architectures];
    if (domain === undefined) throw new Error("architecture domain missing");
    domain.level = rating(12);
    expect(isResearcherAvailable(unlocked, content, conditionalId)).toBe(true);
  });

  it("keeps useful coverage without forcing the same researcher into every slate", () => {
    const state = newState();
    const slates = Array.from({ length: 24 }, (_, refreshIndex) =>
      generateTalentMarketCandidates(state, content, refreshIndex),
    );
    const joshua = contentId("base:researcher.joshua-benji") as unknown as ResearcherId;
    const alwaysPresent =
      slates[0]?.filter((researcherId) =>
        slates.every((slate) => slate.includes(researcherId)),
      ) ?? [];

    expect(slates.every((slate) => slate.length === 6)).toBe(true);
    expect(slates.some((slate) => !slate.includes(joshua))).toBe(true);
    expect(alwaysPresent).toEqual([]);
    expect(
      slates.every((slate) =>
        slate.some((researcherId) => {
          const definition = content.researchers.definitions[researcherId];
          return (
            definition !== undefined &&
            ["alignmentControl", "interpretabilityEvals", "securityContainment"].reduce(
              (sum, skill) => sum + (definition.skills[skill] ?? 0),
              0,
            ) >= 8
          );
        }),
      ),
    ).toBe(true);
  });

  it("refreshes every eight weeks with a replay-stable market event", () => {
    const due = mutable(newState());
    due.run.tick = tick(TALENT_MARKET_REFRESH_WEEKS);
    due.run.calendar = calendarFromTick(TALENT_MARKET_REFRESH_WEEKS);

    const rotate = (state: GameState) => {
      const tx = createTransaction(state);
      refreshTalentMarket(tx, content);
      return tx.commit({ description: "rotate talent market" });
    };
    const first = rotate(due);
    const replay = rotate(due);
    expect(first.state.talentMarket).toEqual(replay.state.talentMarket);
    expect(first.domainEvents).toEqual(replay.domainEvents);
    expect(first.state.talentMarket).toMatchObject({
      refreshIndex: 1,
      lastRefreshedAt: TALENT_MARKET_REFRESH_WEEKS,
      nextRefreshAt: TALENT_MARKET_REFRESH_WEEKS * 2,
    });
    expect(first.state.talentMarket.visibleResearcherIds).toHaveLength(6);
    expect(first.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "talent-market-refreshed", refreshIndex: 1 }),
    );
  });

  it("tops up an existing five-person market before its next refresh", () => {
    const existing = mutable(newState());
    existing.talentMarket.visibleResearcherIds.pop();
    expect(existing.talentMarket.visibleResearcherIds).toHaveLength(5);

    const tx = createTransaction(existing);
    refreshTalentMarket(tx, content);
    const result = tx.commit({ description: "top up talent market" });

    expect(result.state.talentMarket.visibleResearcherIds).toHaveLength(6);
    expect(result.state.talentMarket.refreshIndex).toBe(0);
    expect(result.domainEvents).not.toContainEqual(
      expect.objectContaining({ kind: "talent-market-refreshed" }),
    );
  });
});

describe("fixed-term recruitment", () => {
  it("guarantees exactly one affordable founding hire in a progressive campaign", () => {
    const draft = mutable(
      createProgressiveNewGame(
        {
          seed: seed128("0123456789abcdef0123456789abcdef"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.sam-altmann"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
    );
    const lab = draft.labs[draft.run.playerLabId];
    const firstResearcherId = draft.talentMarket.visibleResearcherIds[0];
    if (lab === undefined || firstResearcherId === undefined) {
      throw new Error("founding-hire fixture missing");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "lab";
    lab.finance.cash = cashMillions(-5);
    lab.aura.spendable = 0;

    const firstQuote = quoteRecruitment(
      draft,
      content,
      draft.run.playerLabId,
      firstResearcherId,
    );
    expect(firstQuote.signingCash).toBeGreaterThan(0);
    expect(firstQuote.auraCost).toBe(0);
    expect(firstQuote.foundingHireGuarantee).toBeDefined();
    expect(typeof firstQuote.foundingHireGuarantee?.cashReliefMillions).toBe("number");
    expect(typeof firstQuote.foundingHireGuarantee?.auraRelief).toBe("number");
    expect(firstQuote.foundingHireGuarantee?.cashReliefMillions).toBe(0);
    expect(firstQuote.blockers).not.toEqual(
      expect.arrayContaining(["Insufficient cash", "Insufficient Aura"]),
    );

    const accepted = applyCommand(
      draft,
      content,
      command(draft, firstResearcherId, "founding-hire"),
    ).state;
    expect(accepted.labs[accepted.run.playerLabId]?.finance.cash).toBe(
      -5 - firstQuote.signingCash,
    );
    const secondResearcherId = accepted.talentMarket.visibleResearcherIds[0];
    if (secondResearcherId === undefined) {
      throw new Error("second founding-hire fixture missing");
    }
    const secondQuote = quoteRecruitment(
      accepted,
      content,
      accepted.run.playerLabId,
      secondResearcherId,
    );
    expect(secondQuote.foundingHireGuarantee).toBeUndefined();
    expect(secondQuote.blockers).toEqual(
      expect.arrayContaining(["Insufficient cash", "Insufficient Aura"]),
    );
  });

  it("applies the shared world-capability Aura pressure to recruitment", () => {
    const state = mutable(addBaselineModelForTest(fundedState(), content));
    const researcherId = state.talentMarket.visibleResearcherIds[0];
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (researcherId === undefined || model?.measuredCapability === undefined) {
      throw new Error("market-pressure fixture missing");
    }
    model.measuredCapability.frontierCapability = rating(100);
    const definition =
      content.researchers.definitions[
        state.researchers[researcherId]?.definitionId ?? ""
      ];
    if (definition === undefined) throw new Error("researcher definition missing");

    const quote = quoteRecruitment(state, content, state.run.playerLabId, researcherId);
    expect(quote.auraCostBreakdown).toEqual({
      baseAuraCost: definition.contract.auraCost,
      worldFrontierCapability: 100,
      marketPressureMultiplier: 3.5,
      globalMarketPressureAuraCost:
        Math.ceil(definition.contract.auraCost * 3.5) - definition.contract.auraCost,
      marketAdjustedAuraCost: Math.ceil(definition.contract.auraCost * 3.5),
    });
    expect(quote.auraCost).toBe(Math.ceil(definition.contract.auraCost * 3.5));
  });

  it("recruits deterministically at listed terms and leaves assignment to the roster", () => {
    const state = fundedState();
    const researcherId = state.talentMarket.visibleResearcherIds[0];
    if (researcherId === undefined) throw new Error("recruitment fixture missing");
    const quote = quoteRecruitment(state, content, state.run.playerLabId, researcherId);
    expect(quote.blockers).toEqual([]);

    const recruit = command(state, researcherId, "first");
    const validation = validateCommand(state, content, recruit);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.preview.recruitment).toEqual(quote);
      expect(validation.preview.summary).toContain("listed terms");
    }

    const accepted = applyCommand(state, content, recruit);
    const replay = applyCommand(state, content, recruit);
    expect(accepted).toEqual(replay);
    expect(accepted.domainEvents).toContainEqual({
      kind: "researcher-recruited",
      labId: state.run.playerLabId,
      researcherId,
    });
    expect(accepted.state.researchers[researcherId]).toMatchObject({
      employerLabId: state.run.playerLabId,
      status: "employed",
      housing: "housed",
      contract: {
        salaryPerCycle: quote.salaryPerCycle,
        signingCash: quote.signingCash,
        auraCost: quote.auraCost,
      },
      compact: { includedInOffer: true, status: "tracking" },
    });
    expect(accepted.state.researchers[researcherId]?.assignment).toBeUndefined();
    const lab = accepted.state.labs[state.run.playerLabId];
    expect(lab?.finance.cash).toBe(500 - quote.signingCash);
    expect(lab?.aura.spendable).toBe(100 - quote.auraCost);
    expect(lab?.roster.researcherIds).toContain(researcherId);
    expect(accepted.state.talentMarket.visibleResearcherIds).not.toContain(researcherId);
    expect(accepted.state.talentMarket.visibleResearcherIds).toHaveLength(6);
    expect(
      forecastFinance(accepted.state, content, state.run.playerLabId).linesPerCycle.find(
        (line) => line.sourceId === researcherId,
      ),
    ).toMatchObject({
      amountMillions: -quote.salaryPerCycle,
      category: "payroll-research",
    });

    const saved = createSaveEnvelope(accepted.state, {
      saveId: "recruitment-round-trip",
      slotType: "manual",
      displayName: "Accepted recruitment offer",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T00:00:00.000Z",
    });
    expect(loadSaveEnvelope(saved).state.talentMarket).toEqual(
      accepted.state.talentMarket,
    );

    const secondResearcherId = accepted.state.talentMarket.visibleResearcherIds[0];
    if (secondResearcherId === undefined)
      throw new Error("second recruitment fixture missing");
    const secondAccepted = applyCommand(
      accepted.state,
      content,
      command(accepted.state, secondResearcherId, "second"),
    ).state;
    expect(secondAccepted.labs[state.run.playerLabId]?.roster.researcherIds).toHaveLength(
      2,
    );
    expect(secondAccepted.talentMarket.visibleResearcherIds).toHaveLength(6);
  });

  it("blocks unaffordable recruitment and recruitment without a vacant slot", () => {
    const state = fundedState();
    const researcherId = state.talentMarket.visibleResearcherIds[0];
    if (researcherId === undefined) throw new Error("recruitment fixture missing");
    const broke = mutable(state);
    const brokeLab = broke.labs[broke.run.playerLabId];
    if (brokeLab === undefined) throw new Error("player lab missing");
    brokeLab.finance.cash = cashMillions(0);
    brokeLab.aura.spendable = 0;
    const unaffordable = validateCommand(
      broke,
      content,
      command(broke, researcherId, "unaffordable"),
    );
    expect(unaffordable.ok).toBe(false);
    if (!unaffordable.ok) {
      expect(unaffordable.errors.map((error) => error.message)).toEqual(
        expect.arrayContaining(["Insufficient cash", "Insufficient Aura"]),
      );
    }

    const noSlot = mutable(state);
    const lab = noSlot.labs[noSlot.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.roster.starSlots = 0;
    const blocked = validateCommand(
      noSlot,
      content,
      command(noSlot, researcherId, "no-slot"),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.errors.map((error) => error.message)).toContain(
        "No vacant star-researcher slot",
      );
    }
  });
});
