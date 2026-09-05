import type { LabId } from "../model/ids.ts";
import type {
  GameState,
  RivalDiplomacyAction,
  RivalRelationshipState,
} from "../model/state.ts";
import { fraction, rating, tick } from "../model/units.ts";
import { applyEffects } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1 } from "../random/oracle.ts";

/**
 * TODO(diplomacy-redesign): rival diplomacy is disabled, not deleted.
 *
 * Why it is off: like coalitions, it plays as thin paperwork — four proposal
 * cards whose outcome lands as a small status line, with acceptance driven by
 * opaque relationship bands the player has few levers over. Its headline
 * action (research-collaboration) mostly existed to feed the coalition
 * victory, which is itself disabled.
 *
 * What a redesign should deliver: legible relationships the player can move,
 * proposals that read as consequential events rather than a status line, and
 * agreements with visible, meaningful stakes. Rival relationship state stays
 * visible (it is passive colour); only the interactive proposal machinery is
 * switched off, at the command validator and in the UI. Search
 * `diplomacy-redesign` for every seam; flip one constant to restore.
 */
export const RIVAL_DIPLOMACY_ENABLED = false;

/** Player-facing reason used wherever a diplomacy action is refused. */
export const RIVAL_DIPLOMACY_DISABLED_REASON =
  "Rival diplomacy is disabled in this build while the mechanic is redesigned.";

interface DiplomacyRule {
  readonly displayName: string;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly durationWeeks: number;
  readonly cooldownWeeks: number;
  readonly baseAcceptance: number;
  readonly benefits: readonly string[];
  readonly strategicUse: string;
  readonly limitation: string;
}

export const RIVAL_DIPLOMACY_RULES: Readonly<
  Record<RivalDiplomacyAction, DiplomacyRule>
> = {
  "research-collaboration": {
    displayName: "Research collaboration",
    cashCostMillions: 4,
    auraCost: 4,
    durationWeeks: 13,
    cooldownWeeks: 13,
    baseAcceptance: 0.5,
    benefits: [
      "Raises this lab's Trust and Dependence, improving the odds of future agreements.",
      "Helps meet the Trust requirement for a coalition victory.",
    ],
    strategicUse: "Best for coalition-building and a longer diplomatic campaign.",
    limitation: "Does not directly increase your weekly research output.",
  },
  "safety-standards": {
    displayName: "Shared safety standard",
    cashCostMillions: 2,
    auraCost: 3,
    durationWeeks: 26,
    cooldownWeeks: 13,
    baseAcceptance: 0.48,
    benefits: [
      "Permanently improves your Safety Culture and Evaluation Quality by 2.",
      "If active when this rival starts an AGI candidate, adds 4 weeks to its deployment process.",
    ],
    strategicUse:
      "Best for improving safety evidence and buying late-game response time.",
    limitation: "Does not stop the rival from continuing capability research.",
  },
  "non-poaching-agreement": {
    displayName: "Non-poaching agreement",
    cashCostMillions: 1,
    auraCost: 2,
    durationWeeks: 26,
    cooldownWeeks: 13,
    baseAcceptance: 0.45,
    benefits: [
      "Stops this rival from starting new poaching attempts against your researchers for 26 weeks.",
      "Improves Trust and reduces Strategic Fear.",
    ],
    strategicUse: "Best for protecting an expensive star-researcher roster.",
    limitation:
      "Does not cancel an approach already underway and applies only to this rival.",
  },
  "share-incident-information": {
    displayName: "Incident-information exchange",
    cashCostMillions: 0.5,
    auraCost: 1,
    durationWeeks: 13,
    cooldownWeeks: 13,
    baseAcceptance: 0.62,
    benefits: [
      "Permanently improves your Evaluation Quality by 3.",
      "Provides the largest Trust and Perceived Honesty gain of these agreements.",
    ],
    strategicUse: "Best for stronger model evidence and future cooperation.",
    limitation: "Does not prevent incidents or reveal the rival's hidden model state.",
  },
};

export interface RivalDiplomacyQuote {
  readonly rivalLabId: LabId;
  readonly action: RivalDiplomacyAction;
  readonly displayName: string;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly durationWeeks: number;
  readonly chanceLabel: "unlikely" | "uncertain" | "promising";
  /** Player-safe band; the canonical exact probability is not exposed. */
  readonly estimatedAcceptanceRange: readonly [number, number];
  readonly benefits: readonly string[];
  readonly strategicUse: string;
  readonly limitation: string;
  readonly blockers: readonly string[];
}

export type RivalRelationshipBand = "very-low" | "low" | "neutral" | "high" | "very-high";

export interface RivalRelationshipView {
  readonly labId: LabId;
  readonly trust: RivalRelationshipBand;
  readonly strategicFear: RivalRelationshipBand;
  readonly dependence: RivalRelationshipBand;
  readonly perceivedHonesty: RivalRelationshipBand;
  readonly activeAgreements: readonly {
    readonly action: RivalDiplomacyAction;
    readonly expiresAt: number;
  }[];
  readonly lastOutcome?: {
    readonly action: RivalDiplomacyAction;
    readonly accepted: boolean;
    readonly initiatedAt: number;
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function relationshipBand(value: number): RivalRelationshipBand {
  if (value <= -55) return "very-low";
  if (value <= -15) return "low";
  if (value < 15) return "neutral";
  if (value < 55) return "high";
  return "very-high";
}

function ruleFor(action: RivalDiplomacyAction): DiplomacyRule {
  const rule: DiplomacyRule | undefined = RIVAL_DIPLOMACY_RULES[action];
  if (rule === undefined) throw new Error(`Unknown rival diplomacy action ${action}`);
  return rule;
}

function exactAcceptanceProbability(
  state: Readonly<GameState>,
  rivalLabId: LabId,
  action: RivalDiplomacyAction,
): number {
  const strategy = state.world.rivals[rivalLabId];
  if (strategy === undefined) throw new Error(`Unknown rival lab ${rivalLabId}`);
  const relationship = strategy.relationship;
  const personality = strategy.personality;
  let chance =
    ruleFor(action).baseAcceptance +
    relationship.trust * 0.0022 +
    relationship.dependence * 0.0012 +
    relationship.perceivedHonesty * 0.0014 -
    Math.max(0, relationship.strategicFear) * 0.001;
  switch (action) {
    case "research-collaboration":
      chance += (personality.sciencePrestige - 50) * 0.002;
      break;
    case "safety-standards":
    case "share-incident-information":
      chance +=
        (personality.politicalCooperation - 50) * 0.0025 +
        (personality.safetyCommitment - 50) * 0.0015;
      break;
    case "non-poaching-agreement":
      chance +=
        (personality.politicalCooperation - 50) * 0.002 -
        (personality.talentAggression - 50) * 0.0025;
      break;
  }
  if (strategy.currentPlanId === "coalition-outreach") chance += 0.12;
  if (strategy.currentPlanId === "talent-raid") chance -= 0.08;
  return clamp(chance, 0.08, 0.92);
}

export function quoteRivalDiplomacy(
  state: Readonly<GameState>,
  playerLabId: LabId,
  rivalLabId: LabId,
  action: RivalDiplomacyAction,
): RivalDiplomacyQuote {
  const rule = ruleFor(action);
  const player = state.labs[playerLabId];
  const rival = state.labs[rivalLabId];
  const strategy = state.world.rivals[rivalLabId];
  if (player === undefined || player.control !== "player") {
    throw new Error(`Diplomacy requires a player-controlled lab, got ${playerLabId}`);
  }
  if (rival === undefined || rival.control !== "rival" || strategy === undefined) {
    throw new Error(`Diplomacy requires a canonical rival lab, got ${rivalLabId}`);
  }
  const blockers: string[] = [];
  if (player.finance.cash < rule.cashCostMillions) blockers.push("Insufficient cash");
  if (player.aura.spendable < rule.auraCost) blockers.push("Insufficient Aura");
  if (
    strategy.agreements.some(
      (agreement) => agreement.action === action && agreement.expiresAt > state.run.tick,
    )
  ) {
    blockers.push("That agreement is already active");
  }
  const lastAttempt = [...strategy.diplomacyHistory]
    .reverse()
    .find((attempt) => attempt.action === action);
  if (
    lastAttempt !== undefined &&
    lastAttempt.initiatedAt + rule.cooldownWeeks > state.run.tick
  ) {
    blockers.push(
      `Diplomatic channel available in ${String(lastAttempt.initiatedAt + rule.cooldownWeeks - state.run.tick)} weeks`,
    );
  }
  const probability = exactAcceptanceProbability(state, rivalLabId, action);
  const uncertainty = 0.12;
  return {
    rivalLabId,
    action,
    displayName: rule.displayName,
    cashCostMillions: rule.cashCostMillions,
    auraCost: rule.auraCost,
    durationWeeks: rule.durationWeeks,
    chanceLabel:
      probability < 0.38 ? "unlikely" : probability < 0.64 ? "uncertain" : "promising",
    estimatedAcceptanceRange: [
      Math.round(clamp(probability - uncertainty, 0, 1) * 100) / 100,
      Math.round(clamp(probability + uncertainty, 0, 1) * 100) / 100,
    ],
    benefits: [...rule.benefits],
    strategicUse: rule.strategicUse,
    limitation: rule.limitation,
    blockers,
  };
}

const ACCEPTED_DELTAS: Readonly<Record<RivalDiplomacyAction, RivalRelationshipState>> = {
  "research-collaboration": {
    trust: 10,
    strategicFear: -3,
    dependence: 10,
    perceivedHonesty: 4,
  },
  "safety-standards": {
    trust: 9,
    strategicFear: -4,
    dependence: 4,
    perceivedHonesty: 9,
  },
  "non-poaching-agreement": {
    trust: 7,
    strategicFear: -6,
    dependence: 2,
    perceivedHonesty: 6,
  },
  "share-incident-information": {
    trust: 13,
    strategicFear: -5,
    dependence: 5,
    perceivedHonesty: 15,
  },
};

export function resolveRivalDiplomacy(
  tx: SimulationTransaction,
  playerLabId: LabId,
  rivalLabId: LabId,
  action: RivalDiplomacyAction,
  commandId: string,
): RivalDiplomacyQuote & { readonly accepted: boolean } {
  const state = tx.read();
  const quote = quoteRivalDiplomacy(state, playerLabId, rivalLabId, action);
  if (quote.blockers.length > 0) {
    throw new Error(`Diplomacy blocked: ${quote.blockers.join("; ")}`);
  }
  const probability = exactAcceptanceProbability(state, rivalLabId, action);
  const draw = new RandomOracleV1(state.run.seed).uniform(
    randomKey("rival-diplomacy", playerLabId, rivalLabId, action, commandId),
  );
  const accepted = draw < probability;
  applyEffects(
    tx,
    [
      {
        kind: "add-resource",
        subject: { type: "lab", labId: playerLabId },
        resource: "cash",
        amount: 0 - quote.cashCostMillions,
        financeCategory: "project-cost",
      },
      {
        kind: "add-resource",
        subject: { type: "lab", labId: playerLabId },
        resource: "aura-spendable",
        amount: 0 - quote.auraCost,
        auraChangeKind: "spend",
        auraCategory: "politics",
      },
    ],
    { kind: "system", id: commandId },
  );
  tx.update((draft) => {
    const strategy = draft.world.rivals[rivalLabId];
    if (strategy === undefined) throw new Error(`Missing rival strategy ${rivalLabId}`);
    strategy.diplomacyHistory.push({
      id: commandId,
      action,
      initiatedAt: draft.run.tick,
      accepted,
      acceptanceProbability: fraction(probability),
      draw: fraction(draw),
      cashCostMillions: quote.cashCostMillions,
      auraCost: quote.auraCost,
    });
    const delta = accepted
      ? ACCEPTED_DELTAS[action]
      : { trust: -3, strategicFear: 2, dependence: 0, perceivedHonesty: -1 };
    strategy.relationship.trust = clamp(
      strategy.relationship.trust + delta.trust,
      -100,
      100,
    );
    strategy.relationship.strategicFear = clamp(
      strategy.relationship.strategicFear + delta.strategicFear,
      -100,
      100,
    );
    strategy.relationship.dependence = clamp(
      strategy.relationship.dependence + delta.dependence,
      -100,
      100,
    );
    strategy.relationship.perceivedHonesty = clamp(
      strategy.relationship.perceivedHonesty + delta.perceivedHonesty,
      -100,
      100,
    );
    if (accepted) {
      strategy.agreements.push({
        action,
        establishedAt: draft.run.tick,
        expiresAt: tick(draft.run.tick + quote.durationWeeks),
        sourceCommandId: commandId,
      });
      if (action === "safety-standards") {
        for (const labId of [playerLabId, rivalLabId]) {
          const lab = draft.labs[labId];
          if (lab === undefined) continue;
          lab.safety.safetyCulture = rating(Math.min(100, lab.safety.safetyCulture + 2));
          lab.safety.evalQuality = rating(Math.min(100, lab.safety.evalQuality + 2));
        }
      }
      if (action === "share-incident-information") {
        for (const labId of [playerLabId, rivalLabId]) {
          const lab = draft.labs[labId];
          if (lab !== undefined) {
            lab.safety.evalQuality = rating(Math.min(100, lab.safety.evalQuality + 3));
          }
        }
      }
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${quote.displayName} proposed to ${rivalLabId}: ${accepted ? "accepted" : "declined"}.`,
      category: "narrative",
      source: { kind: "system", id: commandId },
      relatedIds: [playerLabId, rivalLabId],
    });
  });
  tx.emit({
    kind: "rival-diplomacy-resolved",
    playerLabId,
    rivalLabId,
    action,
    accepted,
    probability,
    draw,
  });
  return { ...quote, accepted };
}

export function projectRivalRelationships(
  state: Readonly<GameState>,
): readonly RivalRelationshipView[] {
  return (Object.keys(state.world.rivals).sort() as LabId[]).map((labId) => {
    const strategy = state.world.rivals[labId];
    if (strategy === undefined) throw new Error(`Missing rival strategy ${labId}`);
    const lastOutcome = strategy.diplomacyHistory.at(-1);
    return {
      labId,
      trust: relationshipBand(strategy.relationship.trust),
      strategicFear: relationshipBand(strategy.relationship.strategicFear),
      dependence: relationshipBand(strategy.relationship.dependence),
      perceivedHonesty: relationshipBand(strategy.relationship.perceivedHonesty),
      activeAgreements: strategy.agreements
        .filter((agreement) => agreement.expiresAt > state.run.tick)
        .map((agreement) => ({
          action: agreement.action,
          expiresAt: agreement.expiresAt,
        })),
      ...(lastOutcome === undefined
        ? {}
        : {
            lastOutcome: {
              action: lastOutcome.action,
              accepted: lastOutcome.accepted,
              initiatedAt: lastOutcome.initiatedAt,
            },
          }),
    };
  });
}
