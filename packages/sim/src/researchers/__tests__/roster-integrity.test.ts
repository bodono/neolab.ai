import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
  type ResearcherDefinition,
  type ResearcherModifierDefinition,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { isConsumedTarget } from "../../engine/consumed-targets.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { resolveResearcherStack } from "../../engine/modifier-resolver.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { ResearcherId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { calendarFromTick } from "../../model/state.ts";
import { tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectPeopleAbilityView } from "../../selectors/people-view.ts";
import { researcherCommitmentTargets } from "../commitments.ts";
import { syncResearcherAbilityModifiers } from "../researchers.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

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

function abilityEffects(
  definition: ResearcherDefinition,
): readonly ResearcherModifierDefinition[] {
  return [definition.signature, definition.passive].flatMap((ability) =>
    ability === undefined
      ? []
      : [...ability.effects, ...ability.modes.flatMap((mode) => mode.effects)],
  );
}

function allStandingEffects(
  definition: ResearcherDefinition,
): readonly ResearcherModifierDefinition[] {
  return [...abilityEffects(definition), ...definition.compact.attachedEffects];
}

describe("star-researcher roster integrity", () => {
  it("keeps every promise to one plainly stated binary condition", () => {
    for (const definition of Object.values(content.researchers.definitions)) {
      const check = definition.compact.check;
      expect(definition.compact.requirement.trim(), definition.displayName).not.toBe("");
      expect("items" in check, definition.displayName).toBe(false);
      if ("tags" in check) {
        expect(check.tags, definition.displayName).toHaveLength(1);
      }

      const targets = researcherCommitmentTargets(check);
      const abstractTargets = [
        ...targets.actionTags,
        ...targets.projectTags,
        ...targets.reviewTags,
        ...targets.requiredFlags,
      ];
      expect(abstractTargets.length, definition.displayName).toBeLessThanOrEqual(1);

      expect(
        definition.compact.fulfilmentEffects.length,
        `${definition.displayName} promise reward`,
      ).toBeGreaterThan(0);
      for (const reward of definition.compact.fulfilmentEffects) {
        expect(
          [
            "researcher.moraleTarget",
            "researcher.loyalty",
            "researcher.departurePressure",
          ],
          `${definition.displayName} promise reward target`,
        ).toContain(reward.target);
        expect(reward.value, `${definition.displayName} promise reward value`).not.toBe(
          0,
        );
      }
    }
  });

  it("uses one truthful compute lever and conservative stacking bands", () => {
    const throughputValues: number[] = [];
    const programmeValues = new Map<string, number[]>();

    for (const definition of Object.values(content.researchers.definitions)) {
      const effects = allStandingEffects(definition);
      const ownThroughput = effects.filter(
        (effect) => effect.target === "lab.compute.workloadThroughput",
      );
      const ownThroughputProduct = ownThroughput.reduce(
        (product, effect) => product * effect.value,
        1,
      );
      expect(
        ownThroughputProduct,
        `${definition.displayName} total throughput`,
      ).toBeLessThanOrEqual(1.08);

      for (const effect of effects) {
        expect(effect.target, definition.displayName).not.toMatch(
          /\.starting(?:Level)?$/,
        );
        expect(effect.target, definition.displayName).not.toBe("serving.gpusPerRequest");
        expect(effect.target, definition.displayName).not.toMatch(
          /^(?:assigned|paired)Programme\./,
        );
        expect(effect.target, definition.displayName).not.toMatch(
          /assignedTrainingRun|training.*Effectiveness/i,
        );

        if (effect.target === "lab.compute.workloadThroughput") {
          expect(effect.operation, definition.displayName).toBe("multiply");
          expect(effect.value, definition.displayName).toBeGreaterThanOrEqual(1.02);
          expect(effect.value, definition.displayName).toBeLessThanOrEqual(1.06);
          throughputValues.push(effect.value);
        }

        if (/^(?:domain|safety)\.[a-z0-9-]+\.researchOutput$/.test(effect.target)) {
          expect(effect.operation, definition.displayName).toBe("multiply");
          expect(effect.value, definition.displayName).toBeGreaterThan(1);
          expect(effect.value, definition.displayName).toBeLessThanOrEqual(1.05);
          const values = programmeValues.get(effect.target) ?? [];
          values.push(effect.value);
          programmeValues.set(effect.target, values);
        }
      }
    }

    const strongestEightThroughput = [...throughputValues]
      .sort((left, right) => right - left)
      .slice(0, 8)
      .reduce((product, value) => product * value, 1);
    expect(strongestEightThroughput).toBeLessThan(1.6);

    for (const [target, values] of programmeValues) {
      const strongestEight = [...values]
        .sort((left, right) => right - left)
        .slice(0, 8)
        .reduce((product, value) => product * value, 1);
      expect(strongestEight, target).toBeLessThan(1.48);
    }
  });

  it("gives every authored effect a live, distinct researcher modifier", () => {
    for (const definition of Object.values(content.researchers.definitions)) {
      const authored = allStandingEffects(definition);
      for (const effect of authored) {
        expect(
          isConsumedTarget(effect.target),
          `${definition.displayName}: ${effect.target}`,
        ).toBe(true);
        expect(effect.operation, `${definition.displayName}: ${effect.target}`).toMatch(
          /^(?:add|multiply)$/,
        );
        expect(
          effect.operation === "multiply" ? effect.value : Math.abs(effect.value),
          `${definition.displayName}: ${effect.target}`,
        ).not.toBe(effect.operation === "multiply" ? 1 : 0);
      }

      const draft = structuredClone(newState()) as DeepMutable<GameState>;
      const researcherId = definition.id as unknown as ResearcherId;
      const researcher = draft.researchers[researcherId];
      const lab = draft.labs[draft.run.playerLabId];
      if (researcher === undefined || lab === undefined) {
        throw new Error(`Missing runtime researcher ${definition.id}`);
      }
      researcher.employerLabId = lab.id;
      researcher.employedAt = tick(0);
      researcher.status = "employed";
      researcher.housing = "housed";
      researcher.compact = {
        includedInOffer: true,
        status: "tracking",
        windowStartedAt: tick(0),
      };
      lab.roster.researcherIds.push(researcher.id);
      draft.talentMarket.visibleResearcherIds =
        draft.talentMarket.visibleResearcherIds.filter(
          (candidateId) => candidateId !== researcher.id,
        );
      draft.run.tick = tick(4);
      draft.run.calendar = calendarFromTick(4);

      const tx = createTransaction(draft);
      syncResearcherAbilityModifiers(tx, content, researcher.id);
      const state = tx.commit({ description: "roster integrity sync" }).state;
      const modifiers = Object.values(state.modifiers).filter(
        (modifier) =>
          modifier.source.kind === "researcher" &&
          modifier.source.id?.startsWith(`${researcher.id}/`) === true,
      );

      // No current ability uses modes, so every authored line must materialise.
      // If modes are introduced later, this assertion forces their activation
      // cases to be tested explicitly rather than silently weakening coverage.
      expect(
        definition.signature.modes.length + (definition.passive?.modes.length ?? 0),
        `${definition.displayName} untested modes`,
      ).toBe(0);
      expect(modifiers, definition.displayName).toHaveLength(authored.length);
      expect(
        new Set(modifiers.map((modifier) => modifier.target)).size,
        `${definition.displayName} duplicate runtime target`,
      ).toBe(modifiers.length);

      for (const modifier of modifiers) {
        const base = modifier.operation === "multiply" ? 1 : 0;
        const resolved = resolveResearcherStack(state, modifier.target, base, {
          labId: lab.id,
        });
        expect(resolved.final, `${definition.displayName}: ${modifier.target}`).not.toBe(
          base,
        );
        expect(
          resolved.contributions.some(
            (contribution) => contribution.modifierId === modifier.id,
          ),
          `${definition.displayName}: ${modifier.target}`,
        ).toBe(true);
      }
    }
  });

  it("renders every authored benefit with a human label", () => {
    for (const definition of Object.values(content.researchers.definitions)) {
      for (const ability of [definition.signature, definition.passive]) {
        if (ability === undefined) continue;
        const projected = projectPeopleAbilityView(ability);
        for (const effect of [
          ...projected.effects,
          ...projected.modes.flatMap((mode) => mode.effects),
        ]) {
          expect(effect.targetLabel, definition.displayName).not.toContain(" · ");
        }
      }
    }
  });
});
