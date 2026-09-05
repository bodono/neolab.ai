import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { ResearcherId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { quoteResearcherBenefits } from "../researchers.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): DeepMutable<GameState> {
  return structuredClone(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
  ) as DeepMutable<GameState>;
}

/** A researcher with a ramping signature, so current and full differ on hire. */
function rampingResearcher(state: DeepMutable<GameState>) {
  const found = Object.values(state.researchers).find((researcher) => {
    const definition = content.researchers.definitions[researcher.definitionId];
    return (
      definition !== undefined &&
      definition.signature.rampWeeks > 1 &&
      definition.signature.effects.some((effect) => effect.operation === "multiply")
    );
  });
  if (found === undefined) throw new Error("no ramping researcher in content");
  return found;
}

function hire(state: DeepMutable<GameState>, researcherId: ResearcherId): void {
  const researcher = state.researchers[researcherId];
  const lab = state.labs[state.run.playerLabId];
  if (researcher === undefined || lab === undefined) throw new Error("fixture missing");
  researcher.employerLabId = state.run.playerLabId;
  researcher.employedAt = state.run.tick;
  researcher.status = "employed";
  researcher.housing = "housed";
  lab.roster.researcherIds.push(researcher.id);
}

describe("the unified researcher benefit breakdown", () => {
  it("does not author run-once first-project bonuses for researchers", () => {
    for (const definition of Object.values(content.researchers.definitions)) {
      const effects = [...definition.signature.effects, ...definition.passive.effects];
      expect(
        effects.some(
          (effect) => effect.target === "lab.product.firstProject.durationWeeks",
        ),
        definition.displayName,
      ).toBe(false);
    }
  });

  it("shows an unhired candidate their full strength, marked inactive", () => {
    const state = newState();
    const candidate = rampingResearcher(state);
    const rows = quoteResearcherBenefits(state, content, candidate.id);

    expect(rows.length).toBeGreaterThan(0);
    // Every row reads at its full authored strength and says why it is not
    // paying out, rather than silently vanishing from the dossier.
    for (const row of rows) {
      expect(row.active).toBe(false);
      expect(row.inactiveReason).toBeDefined();
      expect(row.currentValue).toBe(row.operation === "multiply" ? 1 : 0);
    }
    const signature = rows.filter((row) => row.kind === "signature");
    expect(signature.length).toBeGreaterThan(0);
    for (const row of signature) expect(row.fullValue).not.toBe(1);
  });

  it("keeps the full strength identical before and after hiring", () => {
    const before = newState();
    const candidate = rampingResearcher(before);
    const beforeRows = quoteResearcherBenefits(before, content, candidate.id);

    const after = newState();
    hire(after, candidate.id);
    const afterRows = quoteResearcherBenefits(after, content, candidate.id);

    // This is the bug the split surfaces caused: the dossier promised one
    // number and the roster then showed a smaller one. Full strength is the
    // same row either side of the hire; only currentValue moves.
    const full = (rows: readonly { key: string; fullValue: number }[]) =>
      Object.fromEntries(rows.map((row) => [row.key, row.fullValue]));
    expect(full(afterRows)).toEqual(full(beforeRows));
  });

  it("ramps current strength up to full over the authored weeks", () => {
    const state = newState();
    const researcher = rampingResearcher(state);
    const definition = content.researchers.definitions[researcher.definitionId];
    if (definition === undefined) throw new Error("definition missing");
    hire(state, researcher.id);

    const signatureAt = (weeks: number) => {
      const advanced = structuredClone(state);
      advanced.run.tick = tick(Number(advanced.run.tick) + weeks);
      return quoteResearcherBenefits(advanced, content, researcher.id).filter(
        (row) => row.kind === "signature",
      );
    };

    const early = signatureAt(0);
    const settled = signatureAt(definition.signature.rampWeeks + 2);
    expect(early.length).toBeGreaterThan(0);
    for (const row of early) {
      expect(row.active).toBe(true);
      expect(row.atFullStrength).toBe(false);
    }
    for (const row of settled) {
      expect(row.atFullStrength).toBe(true);
      expect(row.currentValue).toBeCloseTo(row.fullValue, 10);
    }
  });

  it("includes the generic lead bonus neither surface used to show", () => {
    const state = newState();
    const researcher = rampingResearcher(state);
    hire(state, researcher.id);
    const definition = content.researchers.definitions[researcher.definitionId];
    if (definition === undefined) throw new Error("definition missing");
    const best = Math.max(...Object.values(definition.skills));
    const domain = Object.keys(definition.skills).find(
      (key) => definition.skills[key] === best,
    );
    if (domain === undefined) throw new Error("no skills");

    const unassigned = quoteResearcherBenefits(state, content, researcher.id).find(
      (row) => row.kind === "generic",
    );
    expect(unassigned?.active).toBe(false);
    expect(unassigned?.inactiveReason).toBe("Not leading a programme");

    const led = structuredClone(state);
    const seat = led.researchers[researcher.id];
    if (seat === undefined) throw new Error("researcher missing");
    seat.assignment = {
      kind: "capability-program",
      targetId: "base:domain.architectures",
      role: "lead",
      assignedAt: tick(0),
    };
    const generic = quoteResearcherBenefits(led, content, researcher.id).find(
      (row) => row.kind === "generic",
    );
    expect(generic?.active).toBe(true);
    // 3% a skill point; the content skill scale naturally tops out at five.
    const skill = definition.skills["architectures"] ?? 0;
    expect(generic?.currentValue).toBeCloseTo(skill * 3, 10);
  });

  it("halves live strength for an unhoused researcher without moving full", () => {
    const state = newState();
    const researcher = rampingResearcher(state);
    hire(state, researcher.id);
    const seat = state.researchers[researcher.id];
    if (seat === undefined) throw new Error("researcher missing");
    seat.housing = "unhoused";

    const rows = quoteResearcherBenefits(state, content, researcher.id).filter(
      (row) => row.kind === "passive" && row.operation === "multiply",
    );
    for (const row of rows) {
      expect(row.atFullStrength).toBe(false);
      // Half the distance from neutral, per unhousedStrengthMultiplier.
      expect(row.currentValue - 1).toBeCloseTo((row.fullValue - 1) * 0.5, 10);
    }
  });
});
