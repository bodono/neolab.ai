import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { resolveModifierValue } from "../../engine/modifier-resolver.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { CommandId } from "../../model/ids.ts";
import type { AutonomyAccessLevel, GameState, ModelState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import {
  CANDIDATE_ACCESS_RULES,
  FULL_ACCELERATION_CAPABILITY,
  measuredFrontierCapability,
} from "../../endgame/access.ts";
import { registerCompletedTrainingArtifact } from "../../endgame/candidate-lifecycle.ts";
import { accessLevelAttention } from "../../politics/politics.ts";
import {
  AUTONOMY_MODIFIER_TAG,
  STANDING_AUTONOMY_REQUIREMENTS,
  autonomyCostLabel,
  processStandingAutonomyUnlocks,
  quoteStandingAutonomy,
} from "../autonomy.ts";

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

/** Current player model with measured capability strong enough for `level`. */
function capableState(level: AutonomyAccessLevel): DeepMutable<GameState> {
  const draft = structuredClone(newState()) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : draft.models[modelId];
  if (lab === undefined || model === undefined) throw new Error("fixture missing");
  const values = model.measuredCapability?.values;
  if (values === undefined) throw new Error("fixture lacks measured capability");
  values.scientificAbility = rating(90);
  values.toolUse = rating(85);
  values.agency = rating(80);
  // State the headline estimate outright at the top of the scale. Acceleration
  // reads this figure, and the sim recomputes it from the vector on every
  // completed evaluation.
  const estimate = model.measuredCapability;
  if (estimate === undefined) throw new Error("fixture lacks measured capability");
  estimate.frontierCapability = rating(FULL_ACCELERATION_CAPABILITY);
  const interpretability =
    lab.research.safetyPrograms["base:safety.interpretability-evals"];
  const security = lab.research.safetyPrograms["base:safety.security-containment"];
  if (interpretability === undefined || security === undefined) {
    throw new Error("safety programmes missing");
  }
  interpretability.level = rating(70);
  security.level = rating(70);
  void level;
  return draft;
}

function autonomyCommand(
  state: GameState,
  level: AutonomyAccessLevel,
  confirmationText?: string,
) {
  return {
    kind: "set-model-autonomy" as const,
    meta: {
      commandId: `command:autonomy-${String(level)}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    level,
    ...(confirmationText === undefined ? {} : { confirmationText }),
  };
}

function autonomyModifiers(state: GameState) {
  return Object.values(state.modifiers).filter((modifier) =>
    modifier.tags?.includes(AUTONOMY_MODIFIER_TAG),
  );
}

function autonomyModifier(state: GameState, target: string) {
  return autonomyModifiers(state).find((modifier) => modifier.target === target);
}

describe("the Autonomy Programme", () => {
  it("unlocks its ladder at the visible capability-tier thresholds", () => {
    expect(
      ([1, 2, 3, 4, 5] as const).map(
        (level) => STANDING_AUTONOMY_REQUIREMENTS[level].frontierCapability,
      ),
    ).toEqual([20, 30, 45, 60, 75]);
  });

  it("blocks meaningful autonomy on a weak model with concrete floors", () => {
    const state = newState();
    const quote = quoteStandingAutonomy(state, state.run.playerLabId, 3);
    expect(quote.canApply).toBe(false);
    expect(quote.blockers.join(" ")).toContain("Unlocks at measured capability 45");
  });

  it("blocks access increases for 52 weeks after a containment rollback", () => {
    const state = capableState(4);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    model.accessLevel = 3;
    lab.autonomy.accessIncreaseLockedUntil = tick(state.run.tick + 52);

    const increase = quoteStandingAutonomy(state, state.run.playerLabId, 4);
    expect(increase.canApply).toBe(false);
    expect(increase.blockers).toContain(
      "Autonomy Programme access cannot be raised for 52 more weeks after the containment rollback",
    );

    const furtherReduction = quoteStandingAutonomy(state, state.run.playerLabId, 2);
    expect(furtherReduction.canApply).toBe(true);

    state.run.tick = lab.autonomy.accessIncreaseLockedUntil;
    const afterCooldown = quoteStandingAutonomy(state, state.run.playerLabId, 4);
    expect(afterCooldown.canApply).toBe(true);
    expect(afterCooldown.blockers.join(" ")).not.toContain("containment rollback");
  });

  it("grants high autonomy with zero safety research -- the call is the player's", () => {
    // The licence gate is gone by design: whether to hand a lab to a model
    // nobody has inspected is the decision the game is about, and the price
    // is paid in consequences (exposure, awareness drift, masked readings),
    // never in a locked door.
    const state = capableState(4);
    const lab = state.labs[state.run.playerLabId];
    const interpretability =
      lab?.research.safetyPrograms["base:safety.interpretability-evals"];
    const security = lab?.research.safetyPrograms["base:safety.security-containment"];
    if (interpretability === undefined || security === undefined) {
      throw new Error("safety programme fixture missing");
    }
    interpretability.level = rating(0);
    security.level = rating(0);
    const quote = quoteStandingAutonomy(state, state.run.playerLabId, 4);
    expect(quote.canApply).toBe(true);
    expect(quote.blockers).toEqual([]);
  });

  it("records standing autonomy grants on an already registered candidate artifact", () => {
    const state = capableState(1);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model === undefined) throw new Error("fixture missing current model");
    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof ModelState["trueCapability"]
    >) {
      model.trueCapability[attribute] = rating(95);
    }

    const registration = createTransaction(state);
    expect(
      registerCompletedTrainingArtifact(
        registration,
        model.id,
        new RandomOracleV1(state.run.seed),
      ),
    ).toBe(true);
    const registered = registration.commit({
      description: "register candidate before autonomy grant",
    }).state;
    expect(registered.models[model.id]?.candidateArtifact?.maximumAccessEver).toBe(0);

    const granted = applyCommand(
      registered,
      content,
      autonomyCommand(registered, 1),
    ).state;
    expect(granted.models[model.id]?.accessLevel).toBe(1);
    expect(granted.models[model.id]?.candidateArtifact?.maximumAccessEver).toBe(1);
  });

  it("requests only the highest rung when one capability jump unlocks several", () => {
    const state = capableState(5);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (modelId === undefined) throw new Error("fixture missing");
    const tx = createTransaction(state);
    processStandingAutonomyUnlocks(tx, modelId);
    const result = tx.commit({ description: "autonomy unlock request" });
    expect(result.state.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "autonomy-unlock",
        modelId,
        level: 5,
        attention: "modal",
      }),
    );
    expect(
      result.state.presentationQueue.filter((item) => item.kind === "autonomy-unlock"),
    ).toHaveLength(1);
    for (const level of [1, 2, 3, 4, 5]) {
      expect(
        result.state.models[modelId]?.flags[
          `autonomy:capability-unlocked:${String(level)}`
        ],
      ).toBe(true);
    }
    expect(result.domainEvents).toContainEqual({
      kind: "autonomy-level-unlocked",
      modelId,
      level: 5,
    });

    const repeat = createTransaction(result.state);
    processStandingAutonomyUnlocks(repeat, modelId);
    const repeated = repeat.commit({ description: "repeat unlock scan" });
    expect(repeated.state.presentationQueue).toEqual(result.state.presentationQueue);
  });

  it("does not surface RSI requests before the progressive Autonomy chapter", () => {
    const state = capableState(1);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) throw new Error("fixture missing");
    lab.flags["campaign:progressive"] = true;
    lab.flags["campaign:lab-maturity-stage"] = "institution";

    const hidden = createTransaction(state);
    processStandingAutonomyUnlocks(hidden, modelId);
    const hiddenResult = hidden.commit({ description: "RSI still hidden" });
    expect(
      hiddenResult.state.presentationQueue.some(
        (item) => item.kind === "autonomy-unlock",
      ),
    ).toBe(false);

    const revealedState = structuredClone(hiddenResult.state) as DeepMutable<GameState>;
    const revealedLab = revealedState.labs[revealedState.run.playerLabId];
    if (revealedLab === undefined) throw new Error("fixture lab missing");
    revealedLab.flags["campaign:lab-maturity-stage"] = "autonomy";
    const revealed = createTransaction(revealedState);
    processStandingAutonomyUnlocks(revealed, modelId);
    const revealedResult = revealed.commit({ description: "RSI revealed" });
    expect(revealedResult.state.presentationQueue).toContainEqual(
      expect.objectContaining({ kind: "autonomy-unlock", modelId }),
    );
  });

  it("grants supervised research tools and multiplies research output for real", () => {
    const state = capableState(2);
    const applied = applyCommand(state, content, autonomyCommand(state, 2)).state;
    const lab = applied.labs[applied.run.playerLabId];
    const model = lab?.models.currentModelId
      ? applied.models[lab.models.currentModelId]
      : undefined;
    expect(model?.accessLevel).toBe(2);
    // The fixture's model measures a full frontier grade, so the rung pays out
    // its whole listed acceleration.
    expect(measuredFrontierCapability(model)).toBe(FULL_ACCELERATION_CAPABILITY);
    expect(autonomyModifier(applied, "lab.research.all.output")?.value).toBeCloseTo(1.2);
    expect(resolveModifierValue(applied, "lab.research.all.output", 1).final).toBeCloseTo(
      1.2,
    );
    // Every rung from the sandbox up also sharpens the lab's own measurements.
    expect(resolveModifierValue(applied, "lab.evidence.displayedQuality", 40).final).toBe(
      50,
    );
  });

  it.each([
    [4, "GRANT LAB CONTROL", 3],
    [5, "GRANT ROOT ACCESS", 6],
  ] as const)(
    "requires the exact typed command before granting autonomy level %i",
    (level, phrase, multiplier) => {
      const state = capableState(level);
      const quote = quoteStandingAutonomy(state, state.run.playerLabId, level);
      expect(quote.canApply).toBe(true);
      expect(quote.blockers).toEqual([]);
      expect(quote.confirmationPhrase).toBe(phrase);

      const missing = validateCommand(state, content, autonomyCommand(state, level));
      expect(missing.ok).toBe(false);
      if (missing.ok) throw new Error("missing confirmation unexpectedly validated");
      expect(missing.errors).toContainEqual(
        expect.objectContaining({ code: "critical-confirmation-required" }),
      );
      expect(
        validateCommand(state, content, autonomyCommand(state, level, "WRONG")).ok,
      ).toBe(false);

      const confirmedCommand = autonomyCommand(state, level, phrase);
      expect(validateCommand(state, content, confirmedCommand).ok).toBe(true);
      const applied = applyCommand(state, content, confirmedCommand).state;
      const lab = applied.labs[applied.run.playerLabId];
      const model = lab?.models.currentModelId
        ? applied.models[lab.models.currentModelId]
        : undefined;
      expect(model?.accessLevel).toBe(level);
      expect(autonomyModifier(applied, "lab.research.all.output")?.value).toBeCloseTo(
        multiplier,
      );
    },
  );

  it("does not require a danger confirmation when reducing critical access", () => {
    const state = capableState(5);
    const granted = applyCommand(
      state,
      content,
      autonomyCommand(state, 5, "GRANT ROOT ACCESS"),
    ).state;
    const reduction = autonomyCommand(granted, 4);
    expect(validateCommand(granted, content, reduction).ok).toBe(true);
    const reduced = applyCommand(granted, content, reduction).state;
    const modelId = reduced.labs[reduced.run.playerLabId]?.models.currentModelId;
    expect(modelId === undefined ? undefined : reduced.models[modelId]?.accessLevel).toBe(
      4,
    );
    expect(validateCommand(reduced, content, autonomyCommand(reduced, 5)).ok).toBe(false);
  });

  it("removes the acceleration when access is withdrawn", () => {
    const state = capableState(2);
    const granted = applyCommand(state, content, autonomyCommand(state, 2)).state;
    expect(autonomyModifiers(granted)).toHaveLength(2);
    const revoked = applyCommand(granted, content, autonomyCommand(granted, 0)).state;
    expect(autonomyModifiers(revoked)).toHaveLength(0);
  });

  // The listed multiplier is what a capability-100 model delivers. A weaker
  // model handed the same rung does proportionally less science with it, while
  // paying the identical political cost.
  it("scales acceleration with the model, not with the permission", () => {
    const strong = capableState(3);
    const weakened = structuredClone(strong);
    const modelId = weakened.labs[weakened.run.playerLabId]?.models.currentModelId;
    const estimate =
      modelId === undefined ? undefined : weakened.models[modelId]?.measuredCapability;
    if (estimate === undefined) throw new Error("fixture lacks measured capability");
    // Same permissions, but one model has only just crossed the rung's visible
    // capability-45 unlock while the other has reached full acceleration.
    estimate.frontierCapability = rating(45);

    const grant = (state: GameState) =>
      applyCommand(state, content, autonomyCommand(state, 3)).state;
    const strongGrant = grant(strong);
    const weakGrant = grant(weakened);

    expect(autonomyModifier(strongGrant, "lab.research.all.output")?.value).toBeCloseTo(
      1.5,
    );
    // Capability 45 earns only part of the headroom above 1.0.
    expect(autonomyModifier(weakGrant, "lab.research.all.output")?.value).toBeCloseTo(
      1.23,
    );
    // The cost does not scale down with it, and it is quoted from the politics
    // formula rather than restated, so the two cannot drift apart.
    expect(autonomyCostLabel(CANDIDATE_ACCESS_RULES[5])).toBe(
      `+${String(Math.round(accessLevelAttention(5)))} government attention`,
    );
    expect(accessLevelAttention(5)).toBeGreaterThan(accessLevelAttention(2));
    expect(accessLevelAttention(0)).toBe(0);
  });

  it("keeps increasing the root-access payoff after its capability-75 unlock", () => {
    const state = capableState(5);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const estimate =
      modelId === undefined ? undefined : state.models[modelId]?.measuredCapability;
    if (estimate === undefined) throw new Error("fixture lacks measured capability");
    estimate.frontierCapability = rating(75);

    const atUnlock = applyCommand(
      state,
      content,
      autonomyCommand(state, 5, "GRANT ROOT ACCESS"),
    ).state;
    expect(autonomyModifier(atUnlock, "lab.research.all.output")?.value).toBeCloseTo(
      4.75,
    );

    const fullyCapable = capableState(5);
    const atMaximum = applyCommand(
      fullyCapable,
      content,
      autonomyCommand(fullyCapable, 5, "GRANT ROOT ACCESS"),
    ).state;
    expect(autonomyModifier(atMaximum, "lab.research.all.output")?.value).toBeCloseTo(6);
  });

  it("drifts hidden situational awareness and compounds deception when misaligned", () => {
    const state = capableState(3);
    const lab = state.labs[state.run.playerLabId];
    const model = lab?.models.currentModelId
      ? state.models[lab.models.currentModelId]
      : undefined;
    if (model === undefined) throw new Error("fixture missing");
    model.hiddenSafety.situationalAwareness = rating(55);
    model.hiddenSafety.trueAlignment = rating(30);
    const deceptionBefore = model.hiddenSafety.deceptiveIntent;
    const granted = applyCommand(state, content, autonomyCommand(state, 3)).state;
    let current = granted;
    for (let index = 0; index < 8; index += 1) {
      current = advanceOneTick(current, content).state;
    }
    const after = current.labs[current.run.playerLabId]?.models.currentModelId;
    const drifted = after === undefined ? undefined : current.models[after];
    if (drifted === undefined) throw new Error("model missing after advance");
    expect(drifted.hiddenSafety.situationalAwareness).toBeGreaterThan(55);
    expect(drifted.hiddenSafety.deceptiveIntent).toBeGreaterThan(deceptionBefore);
  });

  it("refuses standing changes while the Deployment Crisis is live", () => {
    const state = capableState(2);
    (state.endgame as { stage: string }).stage = "confirmation";
    const quote = quoteStandingAutonomy(state, state.run.playerLabId, 2);
    expect(quote.canApply).toBe(false);
    expect(quote.blockers.join(" ")).toContain("crisis console");
  });
});
