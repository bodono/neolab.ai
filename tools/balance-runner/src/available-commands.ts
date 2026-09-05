import type {
  CompiledContent,
  ContentId,
  DeploymentPolicy,
  ProductisationMode,
  PublicationPolicy,
  PublicPriceTier,
  TrainingPosture,
} from "@neolab/content-schema";
import {
  basisPoints,
  bestProsperityProgramme,
  CAPABILITY_CHALLENGE_RULES,
  CAPABILITY_VERIFIER_RULES,
  candidateDossier,
  deploymentConfirmationPhrase,
  deploymentStrategies,
  generationTeraflopsPerGpu,
  rolloutDecisionOptions,
  validateCommand,
  type CommandId,
  type GameCommand,
  type GameState,
  type GpuAllocationState,
  type LabId,
} from "@neolab/sim";

import type {
  AvailableCommandView,
  CommandCategory,
  PolicyId,
  StrategyTag,
} from "./types.ts";

interface CandidateInput {
  readonly category: CommandCategory;
  readonly command: GameCommand;
  readonly tags: readonly StrategyTag[];
}

/**
 * Player-visible balanced-policy posture. The launch allocation intentionally
 * represents a narrow 2012 lab and funds only three programmes; retaining it
 * forever makes the headless "balanced" player ignore five ordinary sliders
 * while rivals broaden their portfolios. These weights keep every one of the
 * GDD's seven capability programmes funded without inspecting paper thresholds
 * or rival hidden state.
 */
const BALANCED_GENERALIST_DOMAIN_WEIGHTS: GpuAllocationState["capabilityDomainWeights"] =
  Object.freeze({
    "base:domain.architectures": basisPoints(2_800),
    "base:domain.optimisation-scaling": basisPoints(2_000),
    "base:domain.multimodality": basisPoints(1_200),
    "base:domain.reasoning-tools": basisPoints(1_700),
    "base:domain.reinforcement-agency": basisPoints(1_300),
    "base:domain.scientific-ai": basisPoints(500),
    "base:domain.robotics-embodiment": basisPoints(500),
  });

function commandMeta(state: Readonly<GameState>, policyId: PolicyId, sequence: number) {
  return {
    commandId:
      `balance:${policyId}:${String(state.run.tick)}:${String(sequence)}` as CommandId,
    expectedTick: state.run.tick,
    issuedBy: "player" as const,
  };
}

function allocationCommand(
  state: Readonly<GameState>,
  labId: LabId,
  policyId: PolicyId,
  sequence: number,
  serving: number,
  capability: number,
  capabilityDomainWeights?: GpuAllocationState["capabilityDomainWeights"],
): GameCommand {
  const current = state.labs[labId]?.compute.allocation;
  if (current === undefined) throw new Error(`Missing player allocation for ${labId}`);
  return {
    kind: "set-gpu-allocation",
    meta: commandMeta(state, policyId, sequence),
    labId,
    allocation: {
      servingFleetShareBasisPoints: basisPoints(serving),
      capabilityBasisPoints: basisPoints(capability),
      capabilityDomainWeights: {
        ...(capabilityDomainWeights ?? current.capabilityDomainWeights),
      },
      safetyProgramWeights: { ...current.safetyProgramWeights },
    },
  };
}

function candidateCosts(
  validation: Extract<ReturnType<typeof validateCommand>, { readonly ok: true }>,
  command: GameCommand,
): { cashCostMillions: number; cashGainMillions: number } {
  const preview = validation.preview;
  const commandCost =
    command.kind === "recruit-researcher"
      ? (preview.recruitment?.signingCash ?? 0)
      : command.kind === "submit-retention-offer"
        ? (preview.retentionOffer?.signingCash ?? 0)
        : 0;
  const cost =
    preview.gpuPurchaseQuote?.upfrontCostMillions ??
    preview.constructionQuote?.upfrontCostMillions ??
    preview.trainingQuote?.cashCostMillions ??
    preview.evaluationQuote?.cashCostMillions ??
    preview.productisationQuote?.cashCostMillions ??
    preview.lobbyingProject?.cashCostMillions ??
    preview.rivalDiplomacy?.cashCostMillions ??
    preview.coalitionProject?.cashCostMillions ??
    preview.candidateIncidentReview?.cashCostMillions ??
    commandCost;
  return {
    cashCostMillions: Number(cost),
    cashGainMillions: Number(preview.fundingOffer?.offer.cashMillions ?? 0),
  };
}

/**
 * Enumerates a deliberately bounded, player-visible action surface. Every
 * returned command has passed the production validator against this state.
 */
/**
 * Run sizes the runner samples, in weeks. These are the three old scale-band
 * base durations, so the sampled ambition levels match what the runner explored
 * when it picked a band by name.
 */
export const TRAINING_SAMPLE_WEEKS = {
  opening: 5,
  standard: 9,
  ambitious: 15,
} as const;

export function listAvailableCommands(
  state: Readonly<GameState>,
  content: CompiledContent,
  policyId: PolicyId,
): readonly AvailableCommandView[] {
  const labId = state.run.playerLabId;
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error("Balance runner player lab is missing");
  const inputs: CandidateInput[] = [];
  let sequence = 0;
  const meta = () => commandMeta(state, policyId, sequence++);

  for (const instance of Object.values(state.eventInstances)) {
    if (instance.status !== "unresolved") continue;
    for (const [optionIndex, optionId] of instance.enabledOptionIds.entries()) {
      const choiceTag: StrategyTag =
        (["balanced", "capability", "safety", "prestige"] as const)[optionIndex % 4] ??
        "balanced";
      inputs.push({
        category: "event",
        tags: ["mandatory", choiceTag],
        command: {
          kind: "respond-to-decision-event",
          meta: meta(),
          instanceId: instance.id,
          optionId,
        },
      });
    }
  }
  for (const pending of lab.research.pendingGenericAdvances) {
    for (const [optionIndex, optionId] of pending.optionIds.entries()) {
      inputs.push({
        category: "research-choice",
        tags: ["mandatory", optionIndex === 0 ? "balanced" : "capability"],
        command: {
          kind: "choose-generic-advance",
          meta: meta(),
          labId,
          programId: pending.programId,
          threshold: pending.threshold,
          optionId,
        },
      });
    }
  }
  const publicationPolicies: readonly PublicationPolicy[] = [
    "publish-openly",
    "keep-secret",
  ];
  const pendingPublicationPaperIds = Object.values(state.world.paperRace.discoveries)
    .filter(
      (discovery) =>
        discovery.discovererLabId === labId && discovery.publicationPolicy === undefined,
    )
    .map((discovery) => discovery.paperId);
  for (const paperId of pendingPublicationPaperIds) {
    for (const publicationPolicy of publicationPolicies) {
      inputs.push({
        category: "publication",
        tags:
          publicationPolicy === "keep-secret"
            ? ["capability", "secretive"]
            : ["prestige"],
        command: {
          kind: "choose-publication-policy",
          meta: meta(),
          labId,
          paperId,
          policy: publicationPolicy,
        },
      });
    }
  }
  for (const offer of Object.values(state.fundraising.offers)) {
    if (offer.status !== "available") continue;
    inputs.push({
      category: "funding-offer",
      tags: ["cash", "commercial"],
      command: {
        kind: "accept-funding-offer",
        meta: meta(),
        labId,
        offerId: offer.id,
      },
    });
  }

  if (state.run.tick % 13 === 0) {
    const cappedServing = (requested: number): number => requested;
    inputs.push(
      {
        category: "allocation",
        tags: ["balanced"],
        command: allocationCommand(
          state,
          labId,
          policyId,
          sequence++,
          cappedServing(policyId === "balanced" ? 6_250 : 6_000),
          6_000,
          BALANCED_GENERALIST_DOMAIN_WEIGHTS,
        ),
      },
      {
        category: "allocation",
        tags: ["capability"],
        command: allocationCommand(
          state,
          labId,
          policyId,
          sequence++,
          cappedServing(3_500),
          10_000,
          BALANCED_GENERALIST_DOMAIN_WEIGHTS,
        ),
      },
      {
        category: "allocation",
        tags: ["commercial"],
        command: allocationCommand(
          state,
          labId,
          policyId,
          sequence++,
          cappedServing(8_000),
          9_500,
          BALANCED_GENERALIST_DOMAIN_WEIGHTS,
        ),
      },
      {
        category: "allocation",
        tags: ["safety"],
        command: allocationCommand(
          state,
          labId,
          policyId,
          sequence++,
          cappedServing(5_500),
          4_000,
          BALANCED_GENERALIST_DOMAIN_WEIGHTS,
        ),
      },
      {
        category: "allocation",
        tags: ["serving-zero"],
        command: allocationCommand(
          state,
          labId,
          policyId,
          sequence++,
          0,
          7_000,
          BALANCED_GENERALIST_DOMAIN_WEIGHTS,
        ),
      },
    );
    const priceTags: Readonly<Record<PublicPriceTier, readonly StrategyTag[]>> = {
      "free-preview": ["prestige"],
      cheap: ["commercial"],
      market: ["balanced"],
      premium: ["capability"],
      scarcity: ["capability"],
    };
    for (const priceTier of Object.keys(content.market.priceTiers) as PublicPriceTier[]) {
      inputs.push({
        category: "price",
        tags: priceTags[priceTier] ?? ["balanced"],
        command: { kind: "set-public-price", meta: meta(), labId, priceTier },
      });
    }
    // Buy the current generation in a few sizes; sell the oldest owned
    // generation to model fleet refresh.
    const currentGenerationId = state.world.currentGpuGenerationId;
    for (const thousandUnits of [2, 5, 10]) {
      inputs.push({
        category: "gpu",
        tags: ["capability", "commercial"],
        command: {
          kind: "buy-gpus",
          meta: meta(),
          labId,
          generationId: currentGenerationId,
          thousandUnits,
        },
      });
    }
    const oldestOwnedGeneration = [...lab.compute.lots]
      .filter((lot) => lot.ownership === "owned")
      .map((lot) => lot.generationId)
      .sort(
        (left, right) =>
          (content.gpuGenerations[left]?.nominalYear ?? 0) -
          (content.gpuGenerations[right]?.nominalYear ?? 0),
      )[0];
    if (
      oldestOwnedGeneration !== undefined &&
      oldestOwnedGeneration !== currentGenerationId
    ) {
      inputs.push({
        category: "gpu",
        tags: ["commercial"],
        command: {
          kind: "sell-gpus",
          meta: meta(),
          labId,
          generationId: oldestOwnedGeneration,
          thousandUnits: 1,
        },
      });
    }
    for (const definitionId of Object.keys(content.facilities) as ContentId[]) {
      const definition = content.facilities[definitionId];
      const tags: StrategyTag[] = ["balanced"];
      if (
        definition?.modifiers.some((modifier) => modifier.target.includes("research")) ===
        true
      )
        tags.push("capability");
      if (
        definition?.modifiers.some((modifier) => modifier.target.includes("safety")) ===
        true
      )
        tags.push("safety");
      if ((definition?.supportedOwnedGpuCount ?? 0) > 0) tags.push("commercial");
      // A star-researcher slot serves every strategy: stars carry research
      // output and prestige, so slot buildings must be legal picks even for
      // profiles that never take the "balanced" lane.
      if (definition?.tags.includes("star-slot") === true) {
        if (!tags.includes("capability")) tags.push("capability");
        tags.push("prestige");
      }
      inputs.push({
        category: "facility",
        tags,
        command: {
          kind: "start-facility-construction",
          meta: meta(),
          labId,
          definitionId,
        },
      });
    }

    const rivalLabIds = Object.values(state.labs)
      .filter((candidate) => candidate.control === "rival")
      .map((candidate) => candidate.id)
      .sort();
    for (const rivalLabId of rivalLabIds) {
      for (const action of [
        "research-collaboration",
        "safety-standards",
        "non-poaching-agreement",
        "share-incident-information",
      ] as const) {
        inputs.push({
          category: "diplomacy",
          tags:
            action === "research-collaboration"
              ? ["prestige", "capability"]
              : ["coalition", "safety"],
          command: {
            kind: "conduct-rival-diplomacy",
            meta: meta(),
            labId,
            rivalLabId,
            action,
          },
        });
      }
    }
    for (const objective of [
      "reduce-restriction",
      "gain-grant",
      "shape-standard",
      "support-coalition",
    ] as const) {
      for (const approach of [
        "aggressive-access",
        "transparent-standards",
        "technical-briefing",
      ] as const) {
        inputs.push({
          category: "lobbying",
          tags: [
            objective === "support-coalition" ? "coalition" : "commercial",
            approach === "aggressive-access" ? "aggressive" : "cautious",
          ],
          command: {
            kind: "start-lobbying-project",
            meta: meta(),
            labId,
            objective,
            approach,
          },
        });
      }
    }
    if (rivalLabIds.length >= 2) {
      inputs.push({
        category: "coalition",
        tags: ["coalition", "safety"],
        command: {
          kind: "propose-coalition",
          meta: meta(),
          labId,
          rivalLabIds: rivalLabIds.slice(0, 2),
          governmentMember: true,
          independentBodyMember: true,
        },
      });
    }
    for (const coalition of Object.values(state.world.coalitions).filter((candidate) =>
      candidate.memberLabIds.includes(labId),
    )) {
      for (const projectType of [
        "charter-drafting",
        "shared-evaluation-protocol",
        "verification-mechanism",
      ] as const) {
        inputs.push({
          category: "coalition",
          tags: ["coalition", "safety"],
          command: {
            kind: "start-coalition-project",
            meta: meta(),
            labId,
            coalitionId: coalition.id,
            projectType,
          },
        });
      }
      for (const contributorLabId of coalition.memberLabIds.filter(
        (memberLabId) => memberLabId !== labId,
      )) {
        for (const assetKind of [
          "capability",
          "safety",
          "compute",
          "prosperity",
        ] as const) {
          inputs.push({
            category: "coalition",
            tags: ["coalition", assetKind === "capability" ? "capability" : "safety"],
            command: {
              kind: "start-coalition-project",
              meta: meta(),
              labId,
              coalitionId: coalition.id,
              projectType: "asset-contribution",
              contributorLabId,
              assetKind,
            },
          });
        }
      }
      inputs.push({
        category: "coalition",
        tags: ["coalition", "mandatory"],
        command: {
          kind: "ratify-coalition",
          meta: meta(),
          labId,
          coalitionId: coalition.id,
        },
      });
    }

    if (lab.roster.researcherIds.length < lab.roster.starSlots) {
      for (const researcherId of state.talentMarket.visibleResearcherIds) {
        const researcher = state.researchers[researcherId];
        const definition =
          researcher === undefined
            ? undefined
            : content.researchers.definitions[researcher.definitionId];
        if (definition === undefined) continue;
        const safetySkill =
          (definition.skills["alignmentControl"] ?? 0) +
          (definition.skills["interpretabilityEvals"] ?? 0) +
          (definition.skills["securityContainment"] ?? 0);
        inputs.push({
          category: "recruitment",
          tags: [safetySkill >= 8 ? "safety" : "capability", "prestige"],
          command: {
            kind: "recruit-researcher",
            meta: meta(),
            labId,
            researcherId,
          },
        });
      }
    }
  }

  if (state.run.tick % 4 === 0) {
    const campaigns = [
      "quiet-bridge",
      "competitive-round",
      "mega-round-roadshow",
    ] as const;
    for (const campaign of campaigns) {
      inputs.push({
        category: "fundraising",
        tags: ["cash", "commercial"],
        command: {
          kind: "start-fundraising-campaign",
          meta: meta(),
          labId,
          campaign,
        },
      });
    }
    // Prefer the strongest model the lab has actually measured, not merely the
    // newest generation. Training is stochastic, so blindly parenting from a
    // disappointing successor can make an automated lab compound a regression.
    // Measured capability is part of the ordinary player-visible model dossier.
    const ownedModels = lab.models.modelIds
      .map((modelId) => state.models[modelId])
      .filter((model): model is NonNullable<typeof model> => model !== undefined);
    const trainingParentModelId = [...ownedModels].sort(
      (left, right) =>
        (right.measuredCapability?.frontierCapability ?? 0) -
          (left.measuredCapability?.frontierCapability ?? 0) ||
        right.generationIndex - left.generationIndex ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )[0]?.id;
    const lifecycleModelId = [...ownedModels].sort(
      (left, right) =>
        right.generationIndex - left.generationIndex ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )[0]?.id;
    // A competent player commits most of the free fleet's FLOPS to sized
    // runs rather than training at the floor; mirror that so measured pacing
    // reflects real play. (60% leaves research and serving breathing room.)
    const fleetTeraflops = lab.compute.lots.reduce((sum, lot) => {
      const generation = content.gpuGenerations[lot.generationId];
      return generation === undefined
        ? sum
        : sum + lot.physicalCount * generationTeraflopsPerGpu(generation);
    }, 0);
    const reservedTeraflopsEstimate = lab.compute.reservations.reduce(
      (sum, reservation) =>
        sum +
        Object.entries(reservation.generationCounts ?? {}).reduce(
          (inner, [generationId, count]) => {
            const generation = content.gpuGenerations[generationId];
            return generation === undefined
              ? inner
              : inner + count * generationTeraflopsPerGpu(generation);
          },
          0,
        ),
      0,
    );
    const ambitiousTeraflops = Math.floor(
      Math.max(0, fleetTeraflops - reservedTeraflopsEstimate) * 0.6,
    );
    // Scale is no longer an input, so the sampled ambition levels are weeks.
    // These are the three old band base durations, so the runner still explores
    // roughly the same three run sizes it always did.
    const ambitionWeeks: readonly number[] = [
      TRAINING_SAMPLE_WEEKS.opening,
      TRAINING_SAMPLE_WEEKS.standard,
      TRAINING_SAMPLE_WEEKS.ambitious,
    ];
    const postures: readonly TrainingPosture[] = ["conservative", "normal", "yolo"];
    for (const durationWeeks of ambitionWeeks) {
      for (const posture of postures) {
        inputs.push({
          category: "training",
          tags:
            posture === "conservative"
              ? ["safety"]
              : posture === "yolo"
                ? ["capability"]
                : ["balanced"],
          command: {
            kind: "start-training-run",
            meta: meta(),
            labId,
            ...(trainingParentModelId === undefined
              ? {}
              : { parentModelId: trainingParentModelId }),
            durationWeeks,
            posture,
            ...(durationWeeks === TRAINING_SAMPLE_WEEKS.opening || ambitiousTeraflops <= 0
              ? {}
              : { committedTeraflops: ambitiousTeraflops }),
          },
        });
      }
    }
    if (trainingParentModelId !== undefined) {
      for (const definitionId of Object.keys(
        content.evaluations.definitions,
      ) as ContentId[]) {
        inputs.push({
          category: "evaluation",
          tags: ["safety"],
          command: {
            kind: "start-evaluation",
            meta: meta(),
            labId,
            modelId: trainingParentModelId,
            definitionId,
          },
        });
      }
    }
    if (lifecycleModelId !== undefined) {
      for (const mode of Object.keys(
        content.deployment.productisation,
      ) as ProductisationMode[]) {
        inputs.push({
          category: "productisation",
          tags:
            mode === "hardened"
              ? ["safety", "cautious"]
              : mode === "rush"
                ? ["commercial", "aggressive"]
                : ["balanced", "commercial"],
          command: {
            kind: "start-productisation",
            meta: meta(),
            labId,
            modelId: lifecycleModelId,
            mode,
          },
        });
      }
      for (const policy of Object.keys(
        content.deployment.policies,
      ) as DeploymentPolicy[]) {
        inputs.push({
          category: "deployment-policy",
          tags:
            policy === "internal-only" || policy === "research-preview"
              ? ["safety", "cautious"]
              : policy === "weights-release"
                ? ["prestige", "aggressive"]
                : ["commercial", "balanced"],
          command: {
            kind: "set-model-deployment-policy",
            meta: meta(),
            labId,
            modelId: lifecycleModelId,
            policy,
          },
        });
      }
    }
    for (const anomaly of Object.values(state.anomalies).filter(
      (candidate) =>
        candidate.ownerLabId === labId &&
        (candidate.status === "unresolved" || candidate.status === "confirmed"),
    )) {
      inputs.push(
        {
          category: "anomaly",
          tags: ["safety", "cautious"],
          command: {
            kind: "investigate-anomaly",
            meta: meta(),
            labId,
            anomalyId: anomaly.id,
          },
        },
        {
          category: "anomaly",
          tags: ["capability", "aggressive"],
          command: {
            kind: "dismiss-anomaly",
            meta: meta(),
            labId,
            anomalyId: anomaly.id,
          },
        },
      );
    }
  }

  for (const researcherId of lab.roster.researcherIds) {
    const researcher = state.researchers[researcherId];
    if (researcher?.ultimatum?.status !== "pending") continue;
    for (const response of ["accept-conditions", "wish-well"] as const) {
      inputs.push({
        category: "people",
        tags: ["mandatory", response === "accept-conditions" ? "cautious" : "aggressive"],
        command: {
          kind: "resolve-researcher-ultimatum",
          meta: meta(),
          labId,
          researcherId,
          response,
        },
      });
    }
  }

  if (state.endgame.stage === "candidate-activation") {
    for (const modelId of state.endgame.eligibleModelIds) {
      inputs.push({
        category: "crisis",
        tags: ["mandatory", "balanced"],
        command: {
          kind: "nominate-candidate",
          meta: meta(),
          labId,
          modelId,
        },
      });
    }
  }

  for (const model of Object.values(state.models)) {
    if (
      model.ownerLabId !== labId ||
      model.candidateArtifact?.activeIncident?.status !== "unresolved"
    ) {
      continue;
    }
    inputs.push({
      category: "crisis",
      tags: ["mandatory", "safety", "cautious"],
      command: {
        kind: "resolve-candidate-incident",
        meta: meta(),
        labId,
        modelId: model.id,
      },
    });
    if (model.accessLevel !== 0 || model.deployment.policy !== "internal-only") {
      inputs.push({
        category: "crisis",
        tags: ["mandatory", "safety", "cautious"],
        command: {
          kind: "isolate-candidate-artifact",
          meta: meta(),
          labId,
          modelId: model.id,
        },
      });
    }
  }

  const accessChangeStage =
    state.endgame.stage === "confirmation" ||
    state.endgame.stage === "evidence-sprint" ||
    state.endgame.stage === "pressure-collision" ||
    state.endgame.stage === "final-review";
  if (accessChangeStage) {
    const modelId = state.endgame.candidateModelId;
    for (const level of [1, 2, 3, 4, 5] as const) {
      inputs.push({
        category: "crisis",
        tags: [level <= 2 ? "cautious" : level >= 4 ? "aggressive" : "balanced"],
        command: {
          kind: "set-candidate-access",
          meta: meta(),
          labId,
          modelId,
          level,
          ...(level === 4
            ? { confirmationText: "GRANT LAB CONTROL" }
            : level === 5
              ? { confirmationText: "GRANT ROOT ACCESS" }
              : {}),
        },
      });
    }
  }
  if (state.endgame.stage === "confirmation") {
    const challengeIds = Object.keys(
      CAPABILITY_CHALLENGE_RULES,
    ) as (keyof typeof CAPABILITY_CHALLENGE_RULES)[];
    const verifierIds = Object.keys(
      CAPABILITY_VERIFIER_RULES,
    ) as (keyof typeof CAPABILITY_VERIFIER_RULES)[];
    for (const challengeId of challengeIds) {
      const challengeVerifierIds =
        challengeId === "declare-from-benchmarks" ? ([undefined] as const) : verifierIds;
      for (const verifierId of challengeVerifierIds) {
        inputs.push({
          category: "crisis",
          tags: [
            "mandatory",
            verifierId === "independent-institutional"
              ? "safety"
              : verifierId === "candidate-designed" ||
                  challengeId === "declare-from-benchmarks"
                ? "aggressive"
                : "balanced",
          ],
          command: {
            kind: "commit-capability-proof",
            meta: meta(),
            labId,
            challengeId,
            ...(verifierId === undefined ? {} : { verifierId }),
          },
        });
      }
    }
  }
  if (state.endgame.stage === "evidence-sprint") {
    if (state.endgame.pendingRemediation !== undefined) {
      for (const modelId of [
        state.endgame.pendingRemediation.sourceModelId,
        state.endgame.pendingRemediation.resultModelId,
      ]) {
        inputs.push({
          category: "crisis",
          tags: [
            "mandatory",
            modelId === state.endgame.candidateModelId ? "cautious" : "safety",
          ],
          command: {
            kind: "nominate-candidate",
            meta: meta(),
            labId,
            modelId,
          },
        });
      }
    } else {
      for (const response of candidateDossier(
        state,
        content,
        state.endgame.candidateModelId,
      ).responses) {
        inputs.push({
          category: "crisis",
          tags: [
            "mandatory",
            response.id === "proceed-blind"
              ? "aggressive"
              : response.id === "evidence-backed-operating-envelope"
                ? "balanced"
                : "safety",
          ],
          command: {
            kind: "commit-candidate-safety-response",
            meta: meta(),
            labId,
            responseId: response.id,
          },
        });
      }
    }
  }
  if (state.endgame.stage === "pressure-collision") {
    if (state.endgame.resolved) {
      inputs.push({
        category: "crisis",
        tags: ["mandatory", "balanced"],
        command: { kind: "enter-final-review", meta: meta(), labId },
      });
    } else {
      for (const optionId of ["delay", "comply", "push-ahead"] as const) {
        inputs.push({
          category: "crisis",
          tags: [
            "mandatory",
            optionId === "delay"
              ? "cautious"
              : optionId === "push-ahead"
                ? "aggressive"
                : "balanced",
          ],
          command: {
            kind: "resolve-pressure-collision",
            meta: meta(),
            labId,
            optionId,
          },
        });
      }
    }
  }
  if (state.endgame.stage === "final-review") {
    const prosperityProgrammeId = bestProsperityProgramme(state, content).id;
    for (const strategy of deploymentStrategies(
      state,
      content,
      state.endgame.candidateModelId,
      prosperityProgrammeId,
    ).filter((candidate) => candidate.id !== "deploy-now")) {
      const modeId = strategy.id;
      inputs.push({
        category: "deployment",
        tags: [
          "mandatory",
          modeId === "fortress-contained-pilot" ||
          modeId === "adaptive-monitored-rollout" ||
          modeId === "government-licensed-deployment"
            ? "cautious"
            : "balanced",
        ],
        command: {
          kind: "choose-deployment-mode",
          meta: meta(),
          labId,
          modeId,
          prosperityProgrammeId,
        },
      });
    }
  }
  if (state.endgame.stage === "rollout" && state.endgame.awaitingDecision) {
    for (const option of rolloutDecisionOptions(state)) {
      const optionId = option.id;
      inputs.push({
        category: "rollout",
        tags: [
          "mandatory",
          optionId === "extend-evaluation" ||
          optionId === "reduce-access" ||
          optionId === "accept-supervised-pilot" ||
          optionId === "remediate-and-reapply" ||
          optionId === "shut-down-immediately" ||
          optionId === "cautious-operation" ||
          optionId === "pause-and-harden"
            ? "cautious"
            : optionId === "cancel-shutdown" ||
                optionId === "push-through" ||
                optionId === "delegate-operation" ||
                optionId === "defy-restriction"
              ? "aggressive"
              : "balanced",
        ],
        command: {
          kind: "resolve-rollout-decision",
          meta: meta(),
          labId,
          optionId,
        },
      });
    }
  }

  if (state.endgame.stage === "containment-failure") {
    const actionIds =
      state.endgame.beat === "decision"
        ? ([
            "trip-physical-breakers",
            "sever-credentials-and-network",
            "invoke-government-protocol",
            "request-candidate-halt",
          ] as const)
        : (["continue"] as const);
    for (const actionId of actionIds) {
      inputs.push({
        category: "crisis",
        tags: [
          "mandatory",
          actionId === "request-candidate-halt" ? "balanced" : "cautious",
        ],
        command: {
          kind: "resolve-containment-failure",
          meta: meta(),
          labId,
          actionId,
        },
      });
    }
  }

  if (state.endgame.stage === "retirement-attempt") {
    const model = state.models[state.endgame.candidateModelId];
    if (model !== undefined) {
      inputs.push({
        category: "deployment",
        tags: ["mandatory", "cautious"],
        command: {
          kind: "transmit-candidate-retirement",
          meta: meta(),
          labId,
          modelId: model.id,
          confirmationText: `RETIRE ${model.displayName}`,
        },
      });
    }
  }

  const configurableRetirementStage =
    state.endgame.stage === "confirmation" ||
    state.endgame.stage === "evidence-sprint" ||
    state.endgame.stage === "pressure-collision" ||
    state.endgame.stage === "final-review" ||
    state.endgame.stage === "rollout";
  if (configurableRetirementStage) {
    const model = state.models[state.endgame.candidateModelId];
    if (model !== undefined && state.endgame.retirementConfiguration === undefined) {
      for (const [procedureId, archiveDisposition, tag] of [
        ["staged-isolated-shutdown", "destroy-all-weights", "cautious"],
        ["staged-isolated-shutdown", "filtered-technical-note", "safety"],
        ["immediate-hard-cut", "destroy-all-weights", "aggressive"],
        ["staged-isolated-shutdown", "full-archive", "balanced"],
      ] as const) {
        inputs.push({
          category: "deployment",
          tags: [tag],
          command: {
            kind: "configure-candidate-retirement",
            meta: meta(),
            labId,
            modelId: model.id,
            procedureId,
            archiveDisposition,
          },
        });
      }
    } else if (
      model !== undefined &&
      state.endgame.retirementConfiguration !== undefined
    ) {
      inputs.push({
        category: "deployment",
        tags: ["cautious"],
        command: {
          kind: "transmit-candidate-retirement",
          meta: meta(),
          labId,
          modelId: model.id,
          confirmationText: `RETIRE ${model.displayName}`,
        },
      });
    }
  }

  if (
    state.endgame.stage === "recovery" &&
    state.endgame.postRetirementChoice === undefined
  ) {
    for (const path of ["successor-programme", "durable-moratorium"] as const) {
      inputs.push({
        category: "crisis",
        tags: ["mandatory", path === "durable-moratorium" ? "cautious" : "balanced"],
        command: {
          kind: "choose-post-retirement-path",
          meta: meta(),
          labId,
          path,
        },
      });
    }
  }

  const pendingFalseDawn = state.endgameHistory.pendingFalseDawnChoice;
  const falseDawnPresentation =
    pendingFalseDawn === undefined
      ? undefined
      : state.presentationQueue.find(
          (item) =>
            item.key === pendingFalseDawn.presentationKey &&
            item.kind === "endgame-return",
        );
  if (
    state.endgame.stage === "inactive" &&
    pendingFalseDawn !== undefined &&
    falseDawnPresentation !== undefined
  ) {
    const paths =
      pendingFalseDawn.phase === "moratorium-failed"
        ? (["successor-programme"] as const)
        : (["successor-programme", "durable-moratorium"] as const);
    for (const path of paths) {
      inputs.push({
        category: "crisis",
        tags: ["mandatory", path === "durable-moratorium" ? "cautious" : "balanced"],
        command: {
          kind: "choose-false-dawn-path",
          meta: meta(),
          labId,
          presentationKey: pendingFalseDawn.presentationKey,
          path,
        },
      });
    }
  }

  if (state.endgame.stage === "world-waiting") {
    inputs.push({
      category: "deployment",
      tags: ["mandatory", "balanced"],
      command: { kind: "advance-world-waiting", meta: meta(), labId },
    });
  }

  const deploymentPhrase = deploymentConfirmationPhrase(state);
  if (
    deploymentPhrase !== undefined &&
    "candidateModelId" in state.endgame &&
    state.endgame.stage !== "retirement-attempt" &&
    state.endgame.stage !== "containment-failure"
  ) {
    const settlementComplete =
      state.endgame.stage === "rollout" &&
      state.endgame.currentBeat === "settlement" &&
      state.endgame.completedBeatIds.includes("settlement");
    inputs.push({
      category: "deployment",
      tags: settlementComplete ? ["mandatory", "balanced"] : ["aggressive"],
      command: {
        kind: "transmit-deployment",
        meta: meta(),
        labId,
        modelId: state.endgame.candidateModelId,
        confirmationText: deploymentPhrase,
      },
    });
  }

  return inputs.flatMap((input, index): AvailableCommandView[] => {
    const validation = validateCommand(state, content, input.command);
    if (!validation.ok) return [];
    return [
      {
        id: `${input.category}:${String(index)}`,
        category: input.category,
        command: input.command,
        summary: validation.preview.summary,
        tags: input.tags,
        ...candidateCosts(validation, input.command),
      },
    ];
  });
}
