import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { finaliseEndedRun } from "../../engine/score.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState, GovernmentInterventionState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import {
  CHAMPION_REFUSAL_DEPENDENCE_COST,
  PROGRAMME_EXIT_TRUST_COST,
  PROGRAMME_EXIT_UNDER_INTERVENTION_MULTIPLIER,
  championRefusalAvailable,
  detectGovernmentCrisisTriggers,
  leaveGovernmentProgramme,
  programmeExitTrustCost,
  resolveGovernmentIntervention,
} from "../politics.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): DeepMutable<GameState> {
  return structuredClone(
    addBaselineModelsForTest(
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
    ),
  ) as DeepMutable<GameState>;
}

/** A lab at maximum pressure with a live nationalisation crisis pending. */
function crisisState(): {
  readonly state: DeepMutable<GameState>;
  readonly interventionId: string;
} {
  const state = newState();
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("fixture missing");
  lab.politics.governmentAttention = rating(100);
  lab.politics.governmentTrust = rating(0);
  lab.politics.captureConcern = rating(100);
  lab.flags["politics:defied-lawful-order"] = true;
  const intervention: GovernmentInterventionState = {
    id: "intervention:fixture",
    kind: "nationalisation-crisis",
    trigger: "lawful-order-defiance",
    createdAt: tick(state.run.tick),
    quarterIndex: 0,
    pressureAtTrigger: rating(95),
    status: "pending-event",
  };
  lab.politics.interventions.push(intervention);
  return { state, interventionId: intervention.id };
}

describe("programme-aware interventions", () => {
  it("lets a National Champion refuse the state once, at a price", () => {
    const { state, interventionId } = crisisState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.politics.programmes.push("national-champion");
    lab.politics.strategicDependence = rating(80);
    expect(championRefusalAvailable(state, state.run.playerLabId)).toBe(true);

    const tx = createTransaction(state);
    resolveGovernmentIntervention(tx, state.run.playerLabId, interventionId, "refused");
    const after = tx.commit({ description: "champion refuses" }).state;

    expect(after.run.status).toBe("active");
    const afterLab = after.labs[after.run.playerLabId];
    expect(afterLab?.politics.strategicDependence).toBe(
      80 - CHAMPION_REFUSAL_DEPENDENCE_COST,
    );
    expect(championRefusalAvailable(after, after.run.playerLabId)).toBe(false);
  });

  it("does not shield the second refusal", () => {
    const { state, interventionId } = crisisState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.politics.programmes.push("national-champion");
    lab.flags["politics:champion-refusal-spent"] = true;

    const tx = createTransaction(state);
    resolveGovernmentIntervention(tx, state.run.playerLabId, interventionId, "refused");
    finaliseEndedRun(tx, content);
    const after = tx.commit({ description: "second refusal" }).state;
    expect(after.run.status).toBe("lost");
    expect(after.run.endingId).toBe(contentId("base:ending.nationalised-future"));
  });

  it("nationalises a lab with no champion standing at all", () => {
    const { state, interventionId } = crisisState();
    const tx = createTransaction(state);
    resolveGovernmentIntervention(tx, state.run.playerLabId, interventionId, "refused");
    finaliseEndedRun(tx, content);
    const after = tx.commit({ description: "plain refusal" }).state;
    expect(after.run.status).toBe("lost");
  });

  it("prices walking out mid-inquiry at three times an orderly exit", () => {
    const quiet = newState();
    expect(programmeExitTrustCost(quiet, quiet.run.playerLabId)).toBe(
      PROGRAMME_EXIT_TRUST_COST,
    );

    const { state } = crisisState();
    expect(programmeExitTrustCost(state, state.run.playerLabId)).toBe(
      PROGRAMME_EXIT_TRUST_COST * PROGRAMME_EXIT_UNDER_INTERVENTION_MULTIPLIER,
    );

    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.politics.programmes.push("public-sector-contract");
    lab.politics.governmentTrust = rating(90);
    const tx = createTransaction(state);
    leaveGovernmentProgramme(tx, state.run.playerLabId, "public-sector-contract");
    const after = tx.commit({ description: "flee the inquiry" }).state;
    expect(after.labs[after.run.playerLabId]?.politics.governmentTrust).toBe(60);
  });

  it("surrenders the refusal privilege when the champion programme is left", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.politics.programmes.push("national-champion");
    lab.flags["politics:champion-refusal-spent"] = true;
    const tx = createTransaction(state);
    leaveGovernmentProgramme(tx, state.run.playerLabId, "national-champion");
    const after = tx.commit({ description: "leave champion" }).state;
    const afterLab = after.labs[after.run.playerLabId];
    expect(afterLab?.flags["politics:champion-refusal-spent"]).toBeUndefined();
    // Rejoining later restores a privilege that must be re-earned, not banked.
    expect(afterLab?.politics.programmes).not.toContain("national-champion");
  });

  it("spares a standards partner the redundant paperwork request", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.politics.governmentAttention = rating(60);
    lab.politics.governmentTrust = rating(50);
    lab.politics.captureConcern = rating(50);
    const before = detectGovernmentCrisisTriggers(state, state.run.playerLabId);
    expect(before[0]?.kind).toBe("reporting-request");

    lab.politics.programmes.push("safety-standards-partnership");
    expect(detectGovernmentCrisisTriggers(state, state.run.playerLabId)).toHaveLength(0);
  });

  it("escalates a defence partner's restriction into a nationalisation crisis", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) throw new Error("fixture missing");
    lab.politics.governmentAttention = rating(100);
    lab.politics.governmentTrust = rating(0);
    lab.politics.captureConcern = rating(100);
    lab.politics.strategicDependence = rating(0);
    lab.flags["politics:defied-lawful-order"] = true;
    lab.politics.programmes.push("defence-applications");
    state.incidents.push({
      key: "defence-nationalisation-fixture",
      modelId,
      occurredAt: state.run.tick,
      observedSeverity: rating(100),
      category: "major",
      contained: true,
      catastropheLegal: false,
      audit: ["fixture"],
    });
    const candidates = detectGovernmentCrisisTriggers(state, state.run.playerLabId);
    expect(candidates[0]?.pressure.final).toBeGreaterThanOrEqual(80);
    expect(candidates[0]?.kind).toBe("nationalisation-crisis");
  });
});
