import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
  type ContentId,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { resolveModifierValue } from "../../engine/modifier-resolver.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { ModifierId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { seed128 } from "../../random/seed.ts";
import { reconcilePaperBenefits } from "../papers.ts";
import { chooseGenericAdvance, reconcileGenericAdvanceModifiers } from "../research.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const multimodalityOutput = "lab.research.program.base:domain.multimodality.output";
const interpretabilityOutput = "lab.research.interpretability.output";
const sharedEmbeddings20 = contentId("base:advance.multimodality.20.shared-embeddings");
const evaluationGallery40 = contentId("base:advance.multimodality.40.evaluation-gallery");
const sharedEmbeddings60 = contentId("base:advance.multimodality.60.shared-embeddings");

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

function choose(state: GameState, optionId: ContentId): GameState {
  const advance = content.research.genericAdvances[optionId];
  if (advance === undefined) throw new Error(`Missing advance ${optionId}`);
  const tx = createTransaction(state);
  chooseGenericAdvance(
    tx,
    content,
    state.run.playerLabId,
    advance.programId,
    advance.threshold,
    optionId,
  );
  return tx.commit({ description: `choose ${optionId}` }).state;
}

function resolvedOutput(state: GameState, target: string): number {
  return resolveModifierValue(state, target, 1, {
    labId: state.run.playerLabId,
    includeUnscoped: false,
  }).final;
}

describe("research bonus reconciliation", () => {
  it("aligns the dense Multimodality paper catalogue with peer programmes", () => {
    const catalogueMultiplier = (target: string): number =>
      Object.values(content.papers.definitions)
        .flatMap((paper) => paper.unlockEffects)
        .filter(
          (effect) =>
            effect.target === target &&
            effect.operation === "multiply" &&
            typeof effect.value === "number",
        )
        .reduce(
          (product, effect) =>
            product * (typeof effect.value === "number" ? effect.value : 1),
          1,
        );

    const multimodality = catalogueMultiplier("lab.research.domain.multimodality.output");
    const architectures = catalogueMultiplier("lab.research.domain.architectures.output");
    const robotics = catalogueMultiplier(
      "lab.research.domain.robotics-embodiment.output",
    );

    expect(multimodality).toBeGreaterThan(robotics);
    expect(multimodality).toBeLessThan(architectures);
  });

  it("makes Highway Networks a real stepping stone to residual architectures", () => {
    const highwayId = contentId("base:paper.highway-networks");
    const highway = content.papers.definitions[highwayId];
    const resnet = content.papers.definitions[contentId("base:paper.resnet")];

    expect(highway?.unlockEffects).toContainEqual({
      target: "lab.training.technicalFailureHazard",
      operation: "multiply",
      value: 0.97,
    });
    if (resnet?.prerequisites.kind !== "all") {
      throw new Error("ResNet fixture is missing its prerequisite conjunction");
    }
    expect(
      resnet.prerequisites.items.some(
        (item) => item.kind === "paper-known" && item.paperId === highwayId,
      ),
    ).toBe(true);
  });

  it("compounds every permanent specialisation choice", () => {
    let state = choose(newState(), sharedEmbeddings20);
    expect(resolvedOutput(state, multimodalityOutput)).toBeCloseTo(1.1395);

    state = choose(state, evaluationGallery40);
    expect(resolvedOutput(state, multimodalityOutput)).toBeCloseTo(1.1395);
    expect(resolvedOutput(state, interpretabilityOutput)).toBeCloseTo(1.169063);

    state = choose(state, sharedEmbeddings60);
    expect(resolvedOutput(state, multimodalityOutput)).toBeCloseTo(1.1395 * 1.2712);
    expect(resolvedOutput(state, interpretabilityOutput)).toBeCloseTo(1.169063);

    const sharedModifiers = Object.values(state.modifiers).filter((modifier) =>
      [sharedEmbeddings20, sharedEmbeddings60].includes(modifier.source.id as ContentId),
    );
    expect(sharedModifiers).toHaveLength(2);
    expect(
      sharedModifiers.find((modifier) => modifier.source.id === sharedEmbeddings20)
        ?.endsAt,
    ).toBeUndefined();
    expect(
      sharedModifiers.find((modifier) => modifier.source.id === sharedEmbeddings60)
        ?.labId,
    ).toBe(state.run.playerLabId);
  });

  it("reactivates and scopes permanent generic-advance modifiers in old saves", () => {
    let state = choose(newState(), sharedEmbeddings20);
    state = choose(state, sharedEmbeddings60);
    const legacy = structuredClone(state) as DeepMutable<GameState>;
    for (const modifier of Object.values(legacy.modifiers)) {
      if (!modifier.tags.includes("generic-advance")) continue;
      delete modifier.labId;
      if (modifier.source.id === sharedEmbeddings20) {
        modifier.endsAt = legacy.run.tick;
      }
    }

    const tx = createTransaction(legacy);
    reconcileGenericAdvanceModifiers(tx, content, legacy.run.playerLabId);
    const reconciled = tx.commit({ description: "reconcile old advances" }).state;

    expect(resolvedOutput(reconciled, multimodalityOutput)).toBeCloseTo(1.1395 * 1.2712);
    const oldModifier = Object.values(reconciled.modifiers).find(
      (modifier) => modifier.source.id === sharedEmbeddings20,
    );
    const currentModifier = Object.values(reconciled.modifiers).find(
      (modifier) => modifier.source.id === sharedEmbeddings60,
    );
    expect(oldModifier?.endsAt).toBeUndefined();
    expect(oldModifier?.labId).toBe(reconciled.run.playerLabId);
    expect(currentModifier?.labId).toBe(reconciled.run.playerLabId);
  });

  it("refreshes an existing paper modifier to the currently authored value", () => {
    const paperId = contentId("base:paper.alexnet");
    const paper = content.papers.definitions[paperId];
    const authoredEffect = paper?.unlockEffects.find(
      (effect) =>
        effect.target === "lab.research.domain.multimodality.output" &&
        effect.operation === "multiply" &&
        typeof effect.value === "number",
    );
    if (
      paper === undefined ||
      authoredEffect === undefined ||
      typeof authoredEffect.value !== "number"
    ) {
      throw new Error("AlexNet paper fixture is missing its output effect");
    }

    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab fixture missing");
    lab.research.discoveredPaperIds.push(paperId);
    lab.flags[`paper-effects-applied:${paperId}`] = true;
    const modifierId = "modifier:test:legacy-paper" as ModifierId;
    state.modifiers[modifierId] = {
      id: modifierId,
      source: { kind: "system", id: paperId },
      labId: state.run.playerLabId,
      target: multimodalityOutput,
      operation: "multiply",
      value: 1.12,
      startsAt: state.run.tick,
      tags: ["paper-unlock", paperId, "lab.research.domain.multimodality.output"],
    };

    const tx = createTransaction(state);
    reconcilePaperBenefits(tx, content);
    const reconciled = tx.commit({ description: "refresh paper balance" }).state;
    expect(reconciled.modifiers[modifierId]?.value).toBe(authoredEffect.value);
  });

  it("backfills new modifier benefits for papers already known in a save", () => {
    const paperId = contentId("base:paper.highway-networks");
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab fixture missing");
    lab.research.discoveredPaperIds.push(paperId);
    lab.flags[`paper-effects-applied:${paperId}`] = true;

    const reconcile = (input: GameState): GameState => {
      const tx = createTransaction(input);
      reconcilePaperBenefits(tx, content);
      return tx.commit({ description: "backfill paper benefit" }).state;
    };
    const once = reconcile(state);
    const twice = reconcile(once);
    const highwayModifiers = Object.values(twice.modifiers).filter(
      (modifier) =>
        modifier.source.id === paperId &&
        modifier.labId === twice.run.playerLabId &&
        modifier.target === "lab.training.technicalFailureHazard",
    );

    expect(highwayModifiers).toHaveLength(1);
    expect(highwayModifiers[0]?.value).toBe(0.97);
  });
});
