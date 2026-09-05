import { describe, expect, it } from "vitest";
import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";
import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { GameState } from "../../model/state.ts";
import { seed128 } from "../../random/seed.ts";
import { syncAllResearcherAbilityModifiers } from "../../researchers/researchers.ts";
import {
  resolveModifierValue,
  resolveResearcherStack,
} from "../../engine/modifier-resolver.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
function hire(name: string): GameState {
  const base = createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.thomas-hassabi"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
  const draft = structuredClone(base) as DeepMutable<GameState>;
  const r = Object.values(draft.researchers).find(
    (x) => content.researchers.definitions[x.definitionId]?.displayName === name,
  );
  if (r === undefined) throw new Error(`${name} missing`);
  r.employerLabId = draft.run.playerLabId;
  r.employedAt = draft.run.tick;
  r.status = "employed";
  r.housing = "housed";
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  lab.roster.researcherIds.push(r.id);
  const tx = createTransaction(draft);
  syncAllResearcherAbilityModifiers(tx, content);
  return tx.commit({ description: "hire" }).state;
}

describe("effects the sim used to discard", () => {
  it("reads a researcher's checkpoint-risk effect", () => {
    // Read here excluding researchers, with the researcher slice taken from a
    // DIFFERENT string: 8 researchers paid nothing while advertising a benefit.
    const s = hire("Kai-Ming Ho");
    const v = resolveModifierValue(s, "lab.training.technicalFailureHazard", 1, {
      labId: s.run.playerLabId,
      clampMin: 0,
    }).final;
    expect(v).toBeLessThan(1);
  });

  it("reads a researcher's programme-variance effect", () => {
    // Sterling's passive was authored on the domain-wide string, which is read
    // with researchers EXCLUDED, while the programme-scoped form beside it is
    // the one researchers are read from. It was his passive's only effect.
    const s = hire("David Sterling");
    const v = resolveResearcherStack(
      s,
      "lab.research.program.base:domain.reinforcement-agency.weeklyVarianceWidth",
      1,
      { labId: s.run.playerLabId },
    ).final;
    expect(v).toBeLessThan(1);
  });

  it("replaces discarded all-research bonuses with named programme effects", () => {
    const allResearchEffects = Object.values(content.researchers.definitions).flatMap(
      (definition) =>
        [definition.signature, definition.passive]
          .flatMap((ability) => ability?.effects ?? [])
          .filter((effect) => effect.target === "lab.research.all.output"),
    );
    expect(allResearchEffects).toEqual([]);

    const s = hire("Vladimir Mnich");
    const v = resolveResearcherStack(
      s,
      "lab.research.program.base:domain.reinforcement-agency.output",
      1,
      { labId: s.run.playerLabId },
    ).final;
    expect(v).toBeGreaterThan(1);
  });
});
