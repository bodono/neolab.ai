import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createProgressiveNewGame } from "../../campaign/lab-maturity.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelsForTest, createBareState } from "../../model/fixture.ts";
import type { LabId, ModelId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { processCapabilityTierMilestones } from "../tiers.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function stateAtTier(level: 2 | 3): DeepMutable<GameState> {
  const state = structuredClone(createBareState()) as DeepMutable<GameState>;
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  const estimate = model?.measuredCapability;
  if (model === undefined || estimate === undefined) {
    throw new Error("Fixture lacks a measured player model");
  }
  if (level === 2) {
    estimate.frontierCapability = rating(25);
    estimate.values.language = rating(35);
    estimate.values.reasoning = rating(20);
  } else {
    estimate.frontierCapability = rating(40);
    estimate.values.language = rating(40);
    estimate.values.reasoning = rating(40);
    model.reliability = rating(50);
  }
  return state;
}

function worldState(): GameState {
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

describe("capability tier milestones", () => {
  it("records hidden rival progress without queuing a news backlog before World opens", () => {
    const state = structuredClone(
      addBaselineModelsForTest(
        createProgressiveNewGame(
          {
            seed: seed128("11112222333344445555666677778888"),
            difficultyId: contentId("base:difficulty.standard"),
            leaderId: contentId("base:leader.sam-altmann"),
            mandateId: contentId("base:mandate.build-the-science"),
          },
          content,
        ),
        content,
      ),
    ) as DeepMutable<GameState>;
    const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rivalLab = rivalLabId === undefined ? undefined : state.labs[rivalLabId];
    const rivalModelId = rivalLab?.models.currentModelId;
    const rivalModel =
      rivalModelId === undefined ? undefined : state.models[rivalModelId];
    const estimate = rivalModel?.measuredCapability;
    if (
      rivalLabId === undefined ||
      rivalLab === undefined ||
      rivalModelId === undefined ||
      rivalModel === undefined ||
      estimate === undefined
    ) {
      throw new Error("Progressive rival fixture is incomplete");
    }
    estimate.frontierCapability = rating(40);
    estimate.values.language = rating(40);
    estimate.values.reasoning = rating(40);
    rivalModel.reliability = rating(50);

    const hiddenTx = createTransaction(state);
    processCapabilityTierMilestones(hiddenTx, content, rivalModelId);
    const hidden = hiddenTx.commit({ description: "hidden rival progress" }).state;
    expect(
      hidden.presentationQueue.filter((item) => item.kind === "capability-tier"),
    ).toHaveLength(0);
    expect(hidden.models[rivalModelId]?.flags["capability-tier-highest-announced"]).toBe(
      3,
    );

    const revealed = structuredClone(hidden) as DeepMutable<GameState>;
    const playerLab = revealed.labs[revealed.run.playerLabId];
    const revealedEstimate = revealed.models[rivalModelId]?.measuredCapability;
    if (playerLab === undefined || revealedEstimate === undefined) {
      throw new Error("Progressive reveal fixture is incomplete");
    }
    playerLab.flags["campaign:lab-maturity-stage"] = "model";
    revealedEstimate.frontierCapability = rating(55);
    const visibleTx = createTransaction(revealed);
    processCapabilityTierMilestones(visibleTx, content, rivalModelId);
    const visible = visibleTx.commit({ description: "visible rival progress" }).state;
    expect(visible.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "capability-tier",
        modelId: rivalModelId,
        definitionId: "base:capability-tier.4-tool-using-agent",
      }),
    );
  });

  it("awards capability-tier score only when the player reaches the tier", () => {
    const state = structuredClone(worldState()) as DeepMutable<GameState>;
    const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rivalModelId =
      rivalLabId === undefined
        ? undefined
        : state.labs[rivalLabId]?.models.currentModelId;
    const playerModelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    if (rivalModelId === undefined || playerModelId === undefined) {
      throw new Error("Fixture lacks player and rival models");
    }
    for (const modelId of [rivalModelId, playerModelId]) {
      const estimate = state.models[modelId]?.measuredCapability;
      if (estimate === undefined) throw new Error("Fixture lacks measured capability");
      estimate.frontierCapability = rating(15);
      estimate.values.language = rating(20);
    }

    const rivalTx = createTransaction(state);
    processCapabilityTierMilestones(rivalTx, content, rivalModelId);
    const afterRival = rivalTx.commit({ description: "rival tier milestone" }).state;
    expect(afterRival.score.entries).toHaveLength(0);
    expect(afterRival.score.awardedKeys["race/capability-tier-first/1"]).toBeUndefined();

    const playerTx = createTransaction(afterRival);
    processCapabilityTierMilestones(playerTx, content, playerModelId);
    const afterPlayer = playerTx.commit({ description: "player tier milestone" }).state;
    expect(afterPlayer.score.entries).toContainEqual(
      expect.objectContaining({
        key: "race/capability-tier-first/1",
        amount: 100,
        source: { kind: "system", id: playerModelId },
      }),
    );
  });

  it("does not re-announce lower tiers when a later estimate regresses", () => {
    const state = stateAtTier(3);
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("Fixture lacks a player model");

    const first = createTransaction(state);
    processCapabilityTierMilestones(first, content, modelId);
    const announced = first.commit({ description: "announce tier 3" });
    expect(announced.state.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "capability-tier",
        modelId,
        definitionId: "base:capability-tier.3-expert-assistant",
      }),
    );
    expect(
      announced.state.models[modelId]?.flags["capability-tier-highest-announced"],
    ).toBe(3);
    for (let level = 0; level <= 3; level += 1) {
      expect(
        announced.state.models[modelId]?.flags[
          `capability-tier-reached:${String(level)}`
        ],
      ).toBe(true);
    }

    const regressed = structuredClone(announced.state) as DeepMutable<GameState>;
    regressed.presentationQueue = [];
    const estimate = regressed.models[modelId]?.measuredCapability;
    if (estimate === undefined) throw new Error("Fixture lacks measured capability");
    estimate.frontierCapability = rating(25);
    estimate.values.language = rating(35);
    estimate.values.reasoning = rating(20);

    const repeat = createTransaction(regressed);
    processCapabilityTierMilestones(repeat, content, modelId);
    const repeated = repeat.commit({ description: "scan regressed estimate" });
    expect(repeated.state.presentationQueue).toHaveLength(0);
    expect(
      repeated.domainEvents.filter((event) => event.kind === "capability-tier-reached"),
    ).toHaveLength(0);
  });

  it("treats legacy per-tier flags as a monotonic announcement history", () => {
    const state = stateAtTier(2);
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (modelId === undefined || model === undefined) {
      throw new Error("Fixture lacks a player model");
    }
    model.flags["capability-tier-reached:3"] = true;

    const tx = createTransaction(state);
    processCapabilityTierMilestones(tx, content, modelId);
    const result = tx.commit({ description: "scan legacy tier flags" });

    expect(result.state.presentationQueue).toHaveLength(0);
    expect(
      result.domainEvents.filter((event) => event.kind === "capability-tier-reached"),
    ).toHaveLength(0);
  });

  it("replaces an unseen lower-tier popup after a direct upward jump", () => {
    const state = stateAtTier(2);
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("Fixture lacks a player model");

    const first = createTransaction(state);
    processCapabilityTierMilestones(first, content, modelId);
    const tierTwo = first.commit({ description: "announce tier 2" });

    const improved = structuredClone(tierTwo.state) as DeepMutable<GameState>;
    const model = improved.models[modelId];
    const estimate = model?.measuredCapability;
    if (model === undefined || estimate === undefined) {
      throw new Error("Fixture lacks measured capability");
    }
    estimate.frontierCapability = rating(40);
    estimate.values.reasoning = rating(40);
    model.reliability = rating(50);

    const second = createTransaction(improved);
    processCapabilityTierMilestones(second, content, modelId);
    const tierThree = second.commit({ description: "announce tier 3" });
    const modelMilestones = tierThree.state.presentationQueue.filter(
      (item) => item.kind === "capability-tier" && item.modelId === modelId,
    );
    expect(modelMilestones).toHaveLength(1);
    expect(modelMilestones[0]).toEqual(
      expect.objectContaining({
        definitionId: "base:capability-tier.3-expert-assistant",
      }),
    );
  });

  it("continues to announce a newly trained player model even when it is lower tier", () => {
    const state = stateAtTier(3);
    const lab = state.labs[state.run.playerLabId];
    const incumbentId = lab?.models.currentModelId;
    const incumbent = incumbentId === undefined ? undefined : state.models[incumbentId];
    if (lab === undefined || incumbent === undefined) {
      throw new Error("Fixture lacks a player model");
    }
    incumbent.flags["capability-tier-highest-announced"] = 3;
    incumbent.flags["capability-tier-reached:3"] = true;

    const successor = structuredClone(incumbent);
    successor.id = "run:model:player:successor" as ModelId;
    successor.displayName = "GBT-2";
    successor.generationIndex += 1;
    successor.flags = {};
    const estimate = successor.measuredCapability;
    if (estimate === undefined) throw new Error("Fixture lacks measured capability");
    estimate.frontierCapability = rating(25);
    estimate.values.language = rating(35);
    estimate.values.reasoning = rating(20);
    state.models[successor.id] = successor;
    lab.models.modelIds.push(successor.id);
    lab.models.currentModelId = successor.id;

    const tx = createTransaction(state);
    processCapabilityTierMilestones(tx, content, successor.id);
    const result = tx.commit({ description: "announce weaker successor" });

    expect(result.state.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "capability-tier",
        modelId: successor.id,
        definitionId: "base:capability-tier.2-foundation-model",
      }),
    );
  });

  it("does not announce a rival successor unless that lab reaches a new tier", () => {
    const state = structuredClone(worldState()) as DeepMutable<GameState>;
    const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rivalLab = rivalLabId === undefined ? undefined : state.labs[rivalLabId];
    const incumbentId = rivalLab?.models.currentModelId;
    const incumbent = incumbentId === undefined ? undefined : state.models[incumbentId];
    if (rivalLabId === undefined || rivalLab === undefined || incumbent === undefined) {
      throw new Error("Fixture lacks a rival model");
    }
    const tierThree = content.capabilityTiers.orderedIds
      .map((id) => content.capabilityTiers.definitions[id])
      .find((tier) => tier?.level === 3);
    const tierFour = content.capabilityTiers.orderedIds
      .map((id) => content.capabilityTiers.definitions[id])
      .find((tier) => tier?.level === 4);
    if (tierThree === undefined || tierFour === undefined) {
      throw new Error("Capability tier fixtures are missing");
    }
    const incumbentEstimate = incumbent.measuredCapability;
    if (incumbentEstimate === undefined) throw new Error("Rival estimate missing");
    incumbentEstimate.frontierCapability = rating(
      tierThree.nominalFrontierCapability.min,
    );

    const first = createTransaction(state);
    processCapabilityTierMilestones(first, content, incumbent.id);
    const firstAnnouncement = first.commit({
      description: "rival reaches tier three",
    }).state;
    expect(firstAnnouncement.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "capability-tier",
        modelId: incumbent.id,
        definitionId: tierThree.id,
      }),
    );

    const sameTier = structuredClone(firstAnnouncement) as DeepMutable<GameState>;
    sameTier.presentationQueue = [];
    const successor = structuredClone(sameTier.models[incumbent.id]);
    if (successor === undefined) throw new Error("Rival incumbent missing");
    successor.id = "run:model:rival:same-tier-successor" as ModelId;
    successor.displayName = "Rival successor";
    successor.generationIndex += 1;
    successor.flags = {};
    sameTier.models[successor.id] = successor;
    sameTier.labs[rivalLabId]?.models.modelIds.push(successor.id);
    if (sameTier.labs[rivalLabId] !== undefined) {
      sameTier.labs[rivalLabId].models.currentModelId = successor.id;
    }

    const repeat = createTransaction(sameTier);
    processCapabilityTierMilestones(repeat, content, successor.id);
    const repeated = repeat.commit({ description: "same-tier rival successor" });
    expect(repeated.state.presentationQueue).toHaveLength(0);
    expect(
      repeated.domainEvents.filter((event) => event.kind === "capability-tier-reached"),
    ).toHaveLength(0);

    const higherTier = structuredClone(repeated.state) as DeepMutable<GameState>;
    const higherEstimate = higherTier.models[successor.id]?.measuredCapability;
    if (higherEstimate === undefined) throw new Error("Successor estimate missing");
    higherEstimate.frontierCapability = rating(tierFour.nominalFrontierCapability.min);
    const advance = createTransaction(higherTier);
    processCapabilityTierMilestones(advance, content, successor.id);
    const advanced = advance.commit({ description: "rival reaches tier four" });
    expect(advanced.state.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "capability-tier",
        modelId: successor.id,
        definitionId: tierFour.id,
      }),
    );
  });
});
