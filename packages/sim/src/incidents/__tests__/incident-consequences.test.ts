import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createTransaction } from "../../engine/transaction.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { ModelId, ResearcherId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { rating, tick } from "../../model/units.ts";
import {
  DEFENCE_APPLICATIONS_INCIDENT_HAZARD_MULTIPLIER,
  DEFENCE_APPLICATIONS_INCIDENT_SEVERITY_BONUS,
  reconcileGovernmentProgrammeModifiers,
} from "../../politics/politics.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  advanceIncidentChecks,
  calculateIncidentHazard,
  modelHasExternalIncidentExposure,
  ORDINARY_INCIDENT_CADENCE_MAXIMUM_WEEKS,
  ORDINARY_INCIDENT_CADENCE_MINIMUM_WEEKS,
} from "../incidents.ts";
import { incidentFineMillions } from "../incident-kinds.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const alwaysIncidentOracle: RandomOracle = {
  uniform: () => 0,
  integer: (_key, minimum) => minimum,
  triangular: () => 0,
  weighted: (_key, weights) => Object.keys(weights).sort()[0] as never,
  shuffle: (_key, values) => [...values],
};
const cadenceOnlyOracle: RandomOracle = {
  uniform: () => 0.999,
  integer: (_key, minimum) => minimum,
  triangular: () => 0,
  weighted: (_key, weights) => Object.keys(weights).sort()[0] as never,
  shuffle: (_key, values) => [...values],
};

function newState(): GameState {
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

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function forceCriticalIncident(draft: DeepMutable<GameState>): void {
  const lab = draft.labs[draft.run.playerLabId];
  const model = lab?.models.currentModelId
    ? draft.models[lab.models.currentModelId]
    : undefined;
  if (lab === undefined || model === undefined) throw new Error("fixture missing");
  for (const attribute of Object.keys(model.trueCapability) as Array<
    keyof typeof model.trueCapability
  >) {
    model.trueCapability[attribute] = rating(70);
  }
  model.accessLevel = 3;
  model.hiddenSafety.trueAlignment = rating(0);
  lab.safety.practicalControlStrength = rating(0);
}

function employSafetyResearcher(draft: DeepMutable<GameState>): ResearcherId {
  const safetyDefinition = Object.values(content.researchers.definitions).find(
    (definition) => (definition.skills["alignmentControl"] ?? 0) >= 4,
  );
  if (safetyDefinition === undefined) throw new Error("no safety researcher in content");
  const researcher = Object.values(draft.researchers).find(
    (candidate) => candidate.definitionId === safetyDefinition.id,
  );
  const lab = draft.labs[draft.run.playerLabId];
  if (researcher === undefined || lab === undefined) {
    throw new Error("fixture researcher missing");
  }
  researcher.status = "employed";
  researcher.employerLabId = draft.run.playerLabId;
  lab.roster.researcherIds.push(researcher.id);
  return researcher.id;
}

function moderateIncidentState(): DeepMutable<GameState> {
  const draft = mutable(newState());
  const lab = draft.labs[draft.run.playerLabId];
  const model = lab?.models.currentModelId
    ? draft.models[lab.models.currentModelId]
    : undefined;
  if (lab === undefined || model === undefined) throw new Error("fixture missing");
  for (const attribute of Object.keys(model.trueCapability) as Array<
    keyof typeof model.trueCapability
  >) {
    model.trueCapability[attribute] = rating(45);
  }
  model.accessLevel = 2;
  model.hiddenSafety.trueAlignment = rating(50);
  model.hiddenSafety.corrigibility = rating(50);
  model.hiddenSafety.situationalAwareness = rating(50);
  model.hiddenSafety.deceptiveCapability = rating(50);
  return draft;
}

describe("incident consequences", () => {
  it("stops superseded API models from causing new serving incidents", () => {
    const draft = moderateIncidentState();
    const lab = draft.labs[draft.run.playerLabId];
    const oldModelId = lab?.models.currentModelId;
    const oldModel = oldModelId === undefined ? undefined : draft.models[oldModelId];
    if (lab === undefined || oldModel === undefined) throw new Error("fixture missing");
    oldModel.deployment.policy = "open-api";
    oldModel.deployment.exposure = 0.65;
    oldModel.accessLevel = 5;

    const successor = structuredClone(oldModel);
    successor.id = "run:model:player:active-successor" as ModelId;
    successor.displayName = "Active successor";
    successor.generationIndex += 1;
    successor.accessLevel = 1;
    draft.models[successor.id] = successor;
    lab.models.modelIds.push(successor.id);
    lab.models.currentModelId = successor.id;
    lab.models.commercialModelId = successor.id;

    expect(modelHasExternalIncidentExposure(draft, oldModel)).toBe(false);
    expect(modelHasExternalIncidentExposure(draft, successor)).toBe(true);

    const tx = createTransaction(draft);
    advanceIncidentChecks(tx, content, alwaysIncidentOracle);
    const result = tx.commit({ description: "active deployment incidents" }).state;

    expect(result.incidents.some((incident) => incident.modelId === oldModelId)).toBe(
      false,
    );
    expect(result.incidents.some((incident) => incident.modelId === successor.id)).toBe(
      true,
    );
  });

  it("keeps superseded released weights exposed to incidents", () => {
    const draft = moderateIncidentState();
    const lab = draft.labs[draft.run.playerLabId];
    const releasedModelId = lab?.models.currentModelId;
    const releasedModel =
      releasedModelId === undefined ? undefined : draft.models[releasedModelId];
    if (lab === undefined || releasedModel === undefined) {
      throw new Error("fixture missing");
    }
    releasedModel.deployment.policy = "weights-release";
    releasedModel.deployment.irreversible = true;
    releasedModel.accessLevel = 0;
    delete lab.models.commercialModelId;

    const successor = structuredClone(releasedModel);
    successor.id = "run:model:player:post-release-successor" as ModelId;
    successor.displayName = "Post-release successor";
    successor.generationIndex += 1;
    successor.deployment.policy = "internal-only";
    successor.deployment.exposure = 0;
    successor.deployment.irreversible = false;
    draft.models[successor.id] = successor;
    lab.models.modelIds.push(successor.id);
    lab.models.currentModelId = successor.id;

    expect(modelHasExternalIncidentExposure(draft, releasedModel)).toBe(true);
    const tx = createTransaction(draft);
    advanceIncidentChecks(tx, content, alwaysIncidentOracle);
    const result = tx.commit({ description: "released weights incident" }).state;
    expect(
      result.incidents.some((incident) => incident.modelId === releasedModelId),
    ).toBe(true);
  });

  it("turns Defence Applications into direct live incident exposure", () => {
    const baseline = moderateIncidentState();
    const baselineLab = baseline.labs[baseline.run.playerLabId];
    const modelId = baselineLab?.models.currentModelId;
    if (baselineLab === undefined || modelId === undefined) {
      throw new Error("fixture missing");
    }
    const baselineHazard = calculateIncidentHazard(baseline, content, modelId).unclamped;

    const exposedDraft = moderateIncidentState();
    const exposedLab = exposedDraft.labs[exposedDraft.run.playerLabId];
    if (exposedLab === undefined) throw new Error("fixture missing");
    exposedLab.politics.programmes.push("defence-applications");
    const enrolmentTx = createTransaction(exposedDraft);
    reconcileGovernmentProgrammeModifiers(enrolmentTx, exposedDraft.run.playerLabId);
    const exposed = enrolmentTx.commit({ description: "defence exposure" }).state;
    const exposedModelId = exposed.labs[exposed.run.playerLabId]?.models.currentModelId;
    if (exposedModelId === undefined) throw new Error("fixture model missing");
    const exposedHazard = calculateIncidentHazard(
      exposed,
      content,
      exposedModelId,
    ).unclamped;

    expect(exposedHazard).toBeCloseTo(
      baselineHazard * DEFENCE_APPLICATIONS_INCIDENT_HAZARD_MULTIPLIER,
      10,
    );

    const baselineTx = createTransaction(baseline);
    advanceIncidentChecks(baselineTx, content, alwaysIncidentOracle);
    const baselineResult = baselineTx.commit({ description: "baseline incident" }).state;
    const exposedTx = createTransaction(exposed);
    advanceIncidentChecks(exposedTx, content, alwaysIncidentOracle);
    const exposedResult = exposedTx.commit({ description: "defence incident" }).state;
    const baselineSeverity = baselineResult.incidents.find(
      (incident) => incident.modelId === modelId,
    )?.observedSeverity;
    const exposedSeverity = exposedResult.incidents.find(
      (incident) => incident.modelId === exposedModelId,
    )?.observedSeverity;
    if (baselineSeverity === undefined || exposedSeverity === undefined) {
      throw new Error("expected incidents missing");
    }
    expect(exposedSeverity).toBeCloseTo(
      baselineSeverity + DEFENCE_APPLICATIONS_INCIDENT_SEVERITY_BONUS,
      10,
    );
  });

  it("treats the contracted current model as exposed even at autonomy level zero", () => {
    const draft = moderateIncidentState();
    const lab = draft.labs[draft.run.playerLabId];
    const model = lab?.models.currentModelId
      ? draft.models[lab.models.currentModelId]
      : undefined;
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    model.accessLevel = 0;
    lab.politics.programmes.push("defence-applications");
    const enrolmentTx = createTransaction(draft);
    reconcileGovernmentProgrammeModifiers(enrolmentTx, draft.run.playerLabId);
    const exposed = enrolmentTx.commit({ description: "military exposure" }).state;
    const exposedModel = exposed.models[model.id];
    if (exposedModel === undefined) throw new Error("fixture model missing");

    expect(modelHasExternalIncidentExposure(exposed, exposedModel)).toBe(true);
    const incidentTx = createTransaction(exposed);
    advanceIncidentChecks(incidentTx, content, alwaysIncidentOracle);
    const result = incidentTx.commit({ description: "military incident" }).state;
    expect(result.incidents.some((incident) => incident.modelId === model.id)).toBe(true);
  });

  it("narrates a critical incident, fines the lab, and adds permanent compliance drag", () => {
    const draft = mutable(newState());
    forceCriticalIncident(draft);
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    const cashBefore = lab.finance.cash;
    const expectedFine = incidentFineMillions("critical", lab.market.marketShare);

    const tx = createTransaction(draft);
    advanceIncidentChecks(tx, content, alwaysIncidentOracle);
    const result = tx.commit({ description: "forced incident" }).state;

    const incident = result.incidents.at(-1);
    expect(incident?.category).toBe("critical");
    expect(incident?.audit.some((line) => line.startsWith("kind="))).toBe(true);

    const prose = result.decisionLog.find(
      (entry) =>
        entry.source?.id === incident?.key &&
        entry.summary.startsWith("Critical incident:"),
    );
    expect(prose).toBeDefined();

    expect(expectedFine).toBeGreaterThan(0);
    expect(result.labs[result.run.playerLabId]?.finance.cash).toBeCloseTo(
      cashBefore - expectedFine,
      5,
    );
    const fineLine = result.decisionLog.find((entry) =>
      entry.summary.includes("Regulators fined the lab"),
    );
    expect(fineLine).toBeDefined();

    const drag = Object.values(result.modifiers).find(
      (modifier) =>
        modifier.target === "lab.research.all.output" &&
        modifier.tags.includes("incident-compliance-drag"),
    );
    expect(drag).toMatchObject({ operation: "multiply", value: 0.96 });
    expect(drag?.endsAt).toBeUndefined();

    expect(result.run.autoPauseReasons).toContain("critical-event");
  });

  it("drives a principled safety-researcher resignation after a critical incident", () => {
    const draft = mutable(newState());
    forceCriticalIncident(draft);
    const researcherId = employSafetyResearcher(draft);

    const tx = createTransaction(draft);
    advanceIncidentChecks(tx, content, alwaysIncidentOracle);
    const result = tx.commit({ description: "forced incident with resignation" }).state;

    expect(result.researchers[researcherId]?.status).toBe("departed");
    expect(result.labs[result.run.playerLabId]?.roster.researcherIds).not.toContain(
      researcherId,
    );
    const resignation = result.decisionLog.find((entry) =>
      entry.summary.includes("resigned over the critical incident"),
    );
    expect(resignation).toBeDefined();
  });

  it("honours an accepted 52-week settlement during incident resignations", () => {
    const draft = mutable(newState());
    forceCriticalIncident(draft);
    const researcherId = employSafetyResearcher(draft);
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error("fixture researcher missing");
    researcher.ultimatum = {
      id: "ultimatum:incident-protection",
      reason: "quarterly",
      issuedAt: tick(0),
      expiresAt: tick(4),
      status: "accepted",
      response: "accept-conditions",
      resolvedAt: tick(0),
    };

    const tx = createTransaction(draft);
    advanceIncidentChecks(tx, content, alwaysIncidentOracle);
    const result = tx.commit({ description: "protected incident settlement" }).state;

    expect(result.researchers[researcherId]?.status).toBe("employed");
    expect(result.labs[result.run.playerLabId]?.roster.researcherIds).toContain(
      researcherId,
    );
  });

  it("keeps minor incidents free of fines and compliance drag but records reputation loss", () => {
    const draft = mutable(newState());
    const labBefore = draft.labs[draft.run.playerLabId];
    if (labBefore === undefined) throw new Error("fixture missing");
    const auraBefore = labBefore.aura.spendable;
    const trustBefore = labBefore.politics.governmentTrust;
    const attentionBefore = labBefore.politics.governmentAttention;

    const tx = createTransaction(draft);
    advanceIncidentChecks(tx, content, alwaysIncidentOracle);
    const result = tx.commit({ description: "forced minor incident" }).state;

    const incident = result.incidents.at(-1);
    expect(incident?.category).toBe("minor");
    expect(
      result.decisionLog.some((entry) => entry.summary.includes("Regulators fined")),
    ).toBe(false);
    expect(
      Object.values(result.modifiers).some((modifier) =>
        modifier.tags.includes("incident-compliance-drag"),
      ),
    ).toBe(false);
    expect(
      result.decisionLog.some((entry) => entry.summary.startsWith("Minor incident:")),
    ).toBe(true);
    const labAfter = result.labs[result.run.playerLabId];
    expect(labAfter?.aura.spendable).toBe(auraBefore - 1);
    expect(labAfter?.politics.governmentTrust).toBe(trustBefore - 1);
    expect(labAfter?.politics.governmentAttention).toBe(attentionBefore + 2);
    const presentation = result.presentationQueue.at(-1);
    expect(presentation).toMatchObject({
      kind: "model-incident-result",
      attention: "modal",
      category: "minor",
      auraLoss: 1,
      fineMillions: 0,
      governmentTrustLost: 1,
      governmentAttentionAdded: 2,
    });
    expect(
      presentation?.kind === "model-incident-result"
        ? presentation.threatLabel.length
        : 0,
    ).toBeGreaterThan(0);
  });

  it("guarantees a visible operational incident after the maximum exposed dry spell", () => {
    expect(ORDINARY_INCIDENT_CADENCE_MINIMUM_WEEKS).toBe(104);
    expect(ORDINARY_INCIDENT_CADENCE_MAXIMUM_WEEKS).toBe(208);
    let state: GameState = moderateIncidentState();
    for (let week = 1; week < ORDINARY_INCIDENT_CADENCE_MAXIMUM_WEEKS; week += 1) {
      const tx = createTransaction(state);
      advanceIncidentChecks(tx, content, cadenceOnlyOracle);
      state = tx.commit({ description: `dry incident week ${String(week)}` }).state;
    }
    expect(state.incidents).toHaveLength(0);

    const crossing = createTransaction(state);
    advanceIncidentChecks(crossing, content, cadenceOnlyOracle);
    const result = crossing.commit({ description: "cadence crossing" }).state;

    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]?.category).toBe("minor");
    expect(result.incidents[0]?.observedSeverity).toBeLessThan(25);
    expect(result.incidents[0]?.audit).toContain("cadenceForced=true");
    expect(result.presentationQueue.at(-1)?.kind).toBe("model-incident-result");
  });
});
