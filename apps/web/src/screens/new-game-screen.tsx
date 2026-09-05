import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { formatValuation, seed128, type NewGameConfig } from "@neolab/sim/public";

import type { BrowserContent } from "../app/runtime-provider.tsx";
import { RealWorldProfile } from "../features/people/real-world-profile.tsx";
import { PixelPortrait } from "../features/portraits/pixel-portrait.tsx";

interface NewGameScreenProps {
  readonly content: BrowserContent;
  readonly onBack: () => void;
  readonly onLaunch: (config: NewGameConfig) => void;
}

const LEADER_SELECTION_ORDER = new Map(
  [
    "base:leader.thomas-hassabi",
    "base:leader.dario-amodeo",
    "base:leader.sam-altmann",
    "base:leader.elon-tusk",
    "base:leader.liang-wenfang",
  ].map((id, index) => [id, index]),
);

function generateRunSeed(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Modern browsers provide Web Crypto. This fallback still varies local
    // development runs in older or restricted environments.
    let state = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    for (let index = 0; index < bytes.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      bytes[index] = state & 0xff;
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface LeaderActivation {
  readonly type: "metric-below" | "flag-absent" | "all";
  readonly metric?: string;
  readonly value?: number;
  readonly flag?: string;
  readonly items?: readonly LeaderActivation[];
}

interface LeaderEffect {
  readonly target: string;
  readonly operation: "add" | "multiply" | "min" | "max" | "unlock";
  readonly value?: number | boolean | string;
  readonly activation?: LeaderActivation | undefined;
}

interface LeaderEffectCopy {
  readonly summary: string;
  readonly explanation: string;
  readonly tone: "benefit" | "tradeoff";
}

interface DifficultyCopy {
  readonly tagline: string;
  readonly summary: string;
  readonly scoreMultiplier: number;
  readonly tone: "gentle" | "standard" | "hard" | "extreme";
}

const DIFFICULTY_SELECTION_ORDER = new Map([
  ["base:difficulty.fellowship", 0],
  ["base:difficulty.standard", 1],
  ["base:difficulty.frontier", 2],
  ["base:difficulty.unhinged-scaling", 3],
]);

function difficultyCopy(difficultyId: string): DifficultyCopy {
  if (difficultyId.endsWith("difficulty.fellowship")) {
    return {
      tagline: "Learning mode",
      summary:
        "More forgiving finances, slower rivals, fewer dangerous incidents, and clearer intelligence estimates.",
      scoreMultiplier: 0.75,
      tone: "gentle",
    };
  }
  if (difficultyId.endsWith("difficulty.frontier")) {
    return {
      tagline: "Hard race",
      summary:
        "Rivals advance faster, incidents are more likely, revenue is weaker, and your intelligence estimates are less reliable.",
      scoreMultiplier: 1.25,
      tone: "hard",
    };
  }
  if (difficultyId.endsWith("difficulty.unhinged-scaling")) {
    return {
      tagline: "Maximum chaos",
      summary:
        "The fastest rival race, the highest incident pressure, and the weakest revenue. Intended for experienced operators with poor sleep hygiene.",
      scoreMultiplier: 1.5,
      tone: "extreme",
    };
  }
  return {
    tagline: "Recommended",
    summary:
      "The intended first-play balance. Normal finances, rival progress, incident pressure, and intelligence estimates.",
    scoreMultiplier: 1,
    tone: "standard",
  };
}

function signedPercentage(multiplier: number, inverse = false): string {
  const change = Math.round((multiplier - 1) * 100) * (inverse ? -1 : 1);
  if (change === 0) return "Normal";
  return `${change > 0 ? "+" : "−"}${String(Math.abs(change))}%`;
}

function signedRating(value: number): string {
  if (value === 0) return "Normal";
  return `${value > 0 ? "+" : "−"}${String(Math.abs(value))}`;
}

function genericLeaderEffectLabel(effect: LeaderEffect): string {
  const target = effect.target
    .replace(/^lab\./, "")
    .replaceAll(".", " · ")
    .replaceAll("-", " ")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  if (effect.operation === "unlock") return `Unlocks ${target}`;
  if (typeof effect.value !== "number") return `${target} updated`;
  if (effect.operation === "multiply") {
    const percentage = Math.round(Math.abs(effect.value - 1) * 100);
    return `${target} ${effect.value >= 1 ? "+" : "−"}${String(percentage)}%`;
  }
  if (effect.operation === "add") {
    return `${target} ${effect.value >= 0 ? "+" : "−"}${String(Math.abs(effect.value))}`;
  }
  return `${target} ${effect.operation === "max" ? "at least" : "at most"} ${String(effect.value)}`;
}

function activationExplanation(activation: LeaderActivation | undefined): string {
  if (activation === undefined) return "";
  if (
    activation.type === "flag-absent" &&
    activation.flag === "lab.completedFirstProductisation"
  ) {
    return " Applies only to your first productisation programme.";
  }
  if (
    activation.type === "all" &&
    activation.items?.some(
      (item) =>
        item.type === "flag-absent" && item.flag === "lab.completedWorldFirstDiscovery",
    ) === true &&
    activation.items.some(
      (item) => item.type === "flag-absent" && item.flag === "lab.completedMajorLaunch",
    )
  ) {
    return " Applies until you achieve either a world-first paper or a major model launch.";
  }
  return " Applies only while its listed condition remains true.";
}

function leaderEffectCopy(effect: LeaderEffect): LeaderEffectCopy {
  const value = typeof effect.value === "number" ? effect.value : 0;
  const percentage = Math.round(Math.abs(value - 1) * 100);
  const condition = activationExplanation(effect.activation);
  switch (effect.target) {
    case "lab.research.all.output":
      return {
        summary: `All research output +${String(percentage)}%`,
        explanation: `Every capability and safety research programme produces ${String(percentage)}% more progress from the same people and GPUs.${condition}`,
        tone: "benefit",
      };
    case "lab.research.capability.output":
      return {
        summary: `Capability research output +${String(percentage)}%`,
        explanation: `Every capability research programme — architectures through robotics — produces ${String(percentage)}% more progress from the same people and GPUs.${condition}`,
        tone: "benefit",
      };
    case "lab.research.safety.output":
      return {
        summary: `Safety research output +${String(percentage)}%`,
        explanation: `Alignment, interpretability, and security programmes produce ${String(percentage)}% more progress from the same people and GPUs.${condition}`,
        tone: "benefit",
      };
    case "lab.research.alignment.output":
      return {
        summary: `Alignment research output +${String(percentage)}%`,
        explanation: `Alignment programmes produce ${String(percentage)}% more progress from the same people and GPUs.${condition}`,
        tone: "benefit",
      };
    case "lab.research.interpretability.output":
      return {
        summary: `Interpretability research output +${String(percentage)}%`,
        explanation: `Interpretability programmes produce ${String(percentage)}% more progress from the same people and GPUs.${condition}`,
        tone: "benefit",
      };
    case "lab.research.security.output":
      return {
        summary: `Security research output +${String(percentage)}%`,
        explanation: `Security programmes produce ${String(percentage)}% more progress from the same people and GPUs.${condition}`,
        tone: "benefit",
      };
    case "lab.research.scientific.startingLevel":
      return {
        summary: `Scientific AI begins at level ${String(value)}`,
        explanation:
          "This is opening progress in the Scientific AI research domain, so its early projects and papers become reachable sooner.",
        tone: "benefit",
      };
    case "lab.market.acquisitionRate":
      return {
        summary: `Customer market reach ${value >= 1 ? "+" : "−"}${String(percentage)}%`,
        explanation: `The deployed model can immediately reach ${String(percentage)}% ${value >= 1 ? "more" : "less"} customer demand and revenue. There is no hidden demand ramp or decay.${condition}`,
        tone: value >= 1 ? "benefit" : "tradeoff",
      };
    case "lab.market.publicAcquisitionRate":
      return {
        summary: `Public demand growth speed −${String(percentage)}%`,
        explanation: `Public customer demand moves ${String(percentage)}% more slowly toward its potential level at each market settlement. This affects ramp-up speed, not the eventual demand ceiling.${condition}`,
        tone: "tradeoff",
      };
    case "lab.market.demandCeiling":
      return {
        summary: `Customer demand ceiling +${String(percentage)}%`,
        explanation: `Every unlocked market segment's maximum demand is ${String(percentage)}% higher. The market is simply larger — you still need the serving capacity to capture it.${condition}`,
        tone: "benefit",
      };
    case "lab.model.productQuality.starting":
      return {
        summary: `First model Product Quality capped at ${String(value)}/100`,
        explanation:
          "The first trained model starts with lower product readiness and needs more productisation work before it can attract customers.",
        tone: "tradeoff",
      };
    case "lab.culture.safety.starting":
      return {
        summary: `Safety Culture begins at ${String(value)}/100`,
        explanation:
          "This is the lab's opening safety-culture rating, which supports safer decisions and researcher confidence.",
        tone: "benefit",
      };
    case "lab.evals.quality.starting":
      return {
        summary: `Evaluation Quality begins at ${String(value)}/100`,
        explanation:
          "Stronger opening evaluations provide more reliable evidence about model capabilities and safety.",
        tone: "benefit",
      };
    case "lab.culture.internalCandour.starting":
      return {
        summary: `Internal Candour begins at ${String(value)}/100`,
        explanation:
          "Researchers are more willing to surface bad news, anomalies, and safety concerns.",
        tone: "benefit",
      };
    case "lab.market.guardedEnterpriseSatisfaction":
      return {
        summary: `Guarded-enterprise satisfaction +${String(value)}`,
        explanation:
          "Safety-conscious enterprise customers respond more favourably to controlled deployments.",
        tone: "benefit",
      };
    case "lab.revenue.all":
      return {
        summary: `All revenue +${String(percentage)}%`,
        explanation: `Every revenue stream pays ${String(percentage)}% more each cycle — enterprises pay a premium for the lab that will not embarrass them.${condition}`,
        tone: "benefit",
      };
    case "researcher.moraleTarget":
      return {
        summary: `Researcher morale +${String(value)}`,
        explanation:
          "Researchers settle at higher morale here than anywhere else; the mission is the perk.",
        tone: "benefit",
      };
    case "researcher.loyalty":
      return {
        summary: `Researcher loyalty +${String(value)}`,
        explanation:
          "Researchers commit to the lab more deeply, strengthening retention and poach resistance.",
        tone: "benefit",
      };
    case "researcher.departurePressure":
      return {
        summary: `Researcher departure pressure −${String(percentage)}%`,
        explanation:
          "Researchers feel less pull toward the exit, even when rivals come calling with term sheets.",
        tone: "benefit",
      };
    case "lab.compute.raw.starting":
      return {
        summary: `Opening GPU fleet −${String(100 - value)}%`,
        explanation:
          "You begin with fewer physical GPUs than the standard lab, limiting early training and research capacity.",
        tone: "tradeoff",
      };
    case "lab.fundraising.duration":
      return {
        summary: `Fundraising completes ${String(percentage)}% faster`,
        explanation:
          "Investor processes take fewer weeks, so new capital arrives sooner.",
        tone: "benefit",
      };
    case "lab.fundraising.offerCash":
      return {
        summary: `Fundraising offers +${String(percentage)}% cash`,
        explanation:
          "Each successful fundraising offer contains more money before its other terms are considered.",
        tone: "benefit",
      };
    case "lab.aura.spendable.starting":
      return {
        summary:
          effect.operation === "max"
            ? `Begin with at least ${String(value)} Aura`
            : `Opening Aura capped at ${String(value)}`,
        explanation:
          effect.operation === "max"
            ? "You can spend more prestige immediately on recruitment and fundraising."
            : "You begin with less prestige to spend on recruitment and fundraising.",
        tone: effect.operation === "max" ? "benefit" : "tradeoff",
      };
    case "lab.product.firstProject.durationWeeks":
      return {
        summary: `First productisation takes ${String(Math.abs(value))} fewer weeks`,
        explanation: `Your first model reaches a deployable product state sooner.${condition}`,
        tone: "benefit",
      };
    case "lab.finance.executiveCostPerCycle":
      return {
        summary: `Executive overhead +${formatValuation(value)} per cycle`,
        explanation: `A cycle is four weeks: recurring leadership and operating costs are ${formatValuation(value * 13)} higher per year.`,
        tone: "tradeoff",
      };
    case "lab.construction.duration":
      return {
        summary: `Facility construction ${String(percentage)}% faster`,
        explanation: "New campus facilities take fewer weeks to complete.",
        tone: "benefit",
      };
    case "lab.compute.ownedDeliveryDuration":
      return {
        summary: `Owned GPU delivery ${String(percentage)}% faster`,
        explanation: "Purchased GPU clusters arrive and come online sooner.",
        tone: "benefit",
      };
    case "lab.compute.ownedPurchasePrice":
      return {
        summary: `Owned GPU purchase prices −${String(percentage)}%`,
        explanation: "Buying permanent compute capacity costs less cash.",
        tone: "benefit",
      };
    case "lab.compute.acquisitionCost":
      return {
        summary: `GPU purchase prices ${value >= 1 ? "+" : "−"}${String(percentage)}%`,
        explanation: `Buying permanent GPU capacity costs ${String(percentage)}% ${value >= 1 ? "more" : "less"} cash.`,
        tone: value >= 1 ? "tradeoff" : "benefit",
      };
    case "lab.research.robotics.startingLevel":
      return {
        summary: `Robotics research begins at level ${String(value)}`,
        explanation:
          "This is opening progress in Robotics and Embodiment, bringing its early projects closer.",
        tone: "benefit",
      };
    case "facility.roboticsLabI.cashCost":
      return {
        summary: `Robotics Lab I costs at most ${formatValuation(value)}`,
        explanation:
          "The first dedicated robotics facility receives a lower maximum purchase price.",
        tone: "benefit",
      };
    case "lab.politics.governmentAttention.starting":
      return {
        summary: `Government Attention begins at least ${String(value)}/100`,
        explanation:
          "Regulators and government officials notice the lab earlier, increasing political scrutiny.",
        tone: "tradeoff",
      };
    case "lab.politics.governmentTrust.starting":
      return {
        summary: `Government Trust begins at ${String(value)}/100`,
        explanation:
          "Government demand stops below Trust 45. This lab starts with a cushion.",
        tone: "benefit",
      };
    case "lab.compute.ownedPowerCost":
      return {
        summary: `Owned GPU power costs +${String(percentage)}%`,
        explanation:
          "Running purchased compute creates higher recurring electricity and cooling costs.",
        tone: "tradeoff",
      };
    case "lab.compute.workloadThroughput":
      return {
        summary: `Effective GPU throughput +${String(percentage)}%`,
        explanation: `The same physical fleet behaves like ${String(percentage)}% more GPUs everywhere it works — training runs, customer serving, and research allocations alike.`,
        tone: "benefit",
      };
    case "lab.training.frontier.cashCost":
      return {
        summary: `Frontier training cash costs −${String(percentage)}%`,
        explanation: "Large model training runs consume less cash.",
        tone: "benefit",
      };
    case "lab.research.optimisation.startingLevel":
      return {
        summary: `Optimisation research begins at level ${String(value)}`,
        explanation:
          "This is opening progress in Optimisation and Scaling, bringing its projects and papers closer.",
        tone: "benefit",
      };
    case "lab.research.optimisation.recipeChoices":
      return {
        summary: `+${String(value)} optimisation training recipe`,
        explanation:
          "An additional optimisation-focused option is available when configuring training runs.",
        tone: "benefit",
      };
    case "lab.finance.cash.starting":
      return {
        summary:
          effect.operation === "max"
            ? `Founding cheque at least ${formatValuation(value)}`
            : `Opening cash capped at ${formatValuation(value)}`,
        explanation:
          effect.operation === "max"
            ? "The founding cheque cannot fall below this before seed runway funding is added on top, so the lab opens with far more cash than its rivals."
            : "You begin with a smaller cash balance and less time before fundraising becomes necessary.",
        tone: effect.operation === "max" ? "benefit" : "tradeoff",
      };
    case "lab.finance.cash.fullGameGrant":
      return {
        summary: `${formatValuation(value)} industrial backing when the full game opens`,
        explanation:
          "Paid after the opening chapters, so the early lab still has to earn its way out of the garage. Fully unlocked scenarios receive it immediately.",
        tone: "benefit",
      };
    default:
      return {
        summary: genericLeaderEffectLabel(effect),
        explanation: `This modifier changes ${genericLeaderEffectLabel(effect).toLowerCase()} throughout the run.${condition}`,
        tone: "benefit",
      };
  }
}

function mandateEffectCopy(effect: LeaderEffect): LeaderEffectCopy {
  const value = typeof effect.value === "number" ? effect.value : 0;
  const percentage = Math.round(Math.abs(value - 1) * 100);
  switch (effect.target) {
    case "lab.research.capability.output":
      return {
        summary: `Capability research +${String(percentage)}%`,
        explanation:
          "Every capability programme produces more weekly progress from the same researchers and GPUs.",
        tone: "benefit",
      };
    case "lab.market.acquisitionRate":
      return {
        summary: `Customer market reach ${value >= 1 ? "+" : "−"}${String(percentage)}%`,
        explanation: `A deployed model can immediately reach ${String(percentage)}% ${value >= 1 ? "more" : "less"} customer demand and revenue. There is no hidden demand ramp or decay.`,
        tone: value >= 1 ? "benefit" : "tradeoff",
      };
    case "lab.finance.cash.starting":
      return {
        summary: `Opening cash +${formatValuation(value)}`,
        explanation:
          "Extra cash is available immediately for GPUs, salaries, facilities, and training.",
        tone: "benefit",
      };
    case "lab.finance.cash.fullGameGrant":
      return {
        summary: `${formatValuation(value)} expansion capital when the full game opens`,
        explanation:
          "Paid after the opening chapters, when their cash floors no longer protect the lab. Fully unlocked scenarios receive it immediately.",
        tone: "benefit",
      };
    case "lab.culture.safety.starting":
      return {
        summary: `Opening Safety Culture ${value >= 0 ? "+" : "−"}${String(Math.abs(value))}`,
        explanation:
          value >= 0
            ? "The lab begins with stronger safety norms, improving its footing for risky decisions and incidents."
            : "The lab begins with weaker safety norms, making aggressive choices and incidents harder to manage.",
        tone: value >= 0 ? "benefit" : "tradeoff",
      };
    case "lab.evals.quality.starting":
      return {
        summary: `Opening Evaluation Quality +${String(value)}`,
        explanation:
          "Your initial evaluations are better at revealing what trained models can actually do.",
        tone: "benefit",
      };
    case "lab.politics.governmentTrust.starting":
      return {
        summary: `Opening Government Trust +${String(value)}`,
        explanation:
          "Regulators begin more inclined to believe the lab is acting responsibly.",
        tone: "benefit",
      };
    case "lab.compute.workloadThroughput":
      return {
        summary: `Effective GPU throughput −${String(percentage)}%`,
        explanation:
          "Careful procedures reduce effective compute across training, serving, and research.",
        tone: "tradeoff",
      };
    case "lab.market.demandCeiling":
      return {
        summary: `Customer demand ceiling ${value >= 1 ? "+" : "−"}${String(percentage)}%`,
        explanation:
          value >= 1
            ? `Every unlocked market segment's maximum demand is ${String(percentage)}% higher. The market is simply larger — you still need serving capacity to capture it.`
            : `Every market segment's maximum demand is ${String(percentage)}% lower. The market was never the point.`,
        tone: value >= 1 ? "benefit" : "tradeoff",
      };
    case "lab.research.safety.output":
      return {
        summary: `Safety research ${value >= 1 ? "+" : "−"}${String(percentage)}%`,
        explanation: `Alignment, interpretability, and security programmes produce ${String(percentage)}% ${value >= 1 ? "more" : "less"} progress from the same people and GPUs.`,
        tone: value >= 1 ? "benefit" : "tradeoff",
      };
    case "lab.fundraising.offerCash":
      return {
        summary: `Fundraising offers ${value >= 1 ? "+" : "−"}${String(percentage)}% cash`,
        explanation:
          value >= 1
            ? "Investors love a commercial story: every accepted offer contains more money."
            : "Investors respect the science and fund it like a science project: every accepted offer contains less money.",
        tone: value >= 1 ? "benefit" : "tradeoff",
      };
    default:
      return {
        summary: genericLeaderEffectLabel(effect),
        explanation: "This modifier remains active throughout the run.",
        tone: "benefit",
      };
  }
}

export function NewGameScreen({
  content,
  onBack,
  onLaunch,
}: NewGameScreenProps): ReactElement {
  const leaders = useMemo(
    () =>
      Object.values(content.leaders).sort(
        (left, right) =>
          (LEADER_SELECTION_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (LEADER_SELECTION_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      ),
    [content],
  );
  const difficulties = useMemo(
    () =>
      Object.values(content.difficulties).sort(
        (left, right) =>
          (DIFFICULTY_SELECTION_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (DIFFICULTY_SELECTION_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      ),
    [content],
  );
  const mandates = useMemo(() => Object.values(content.mandates), [content]);
  const [leaderId, setLeaderId] = useState(leaders[0]?.id ?? "");
  const [difficultyId, setDifficultyId] = useState(
    content.difficulties["base:difficulty.standard"]?.id ?? difficulties[0]?.id ?? "",
  );
  const [mandateId, setMandateId] = useState(
    content.mandates["base:mandate.build-the-science"]?.id ?? mandates[0]?.id ?? "",
  );
  const [seed, setSeed] = useState(generateRunSeed);
  const [error, setError] = useState<string>();
  const leaderButtons = useRef(new Map<string, HTMLButtonElement>());
  const selectedLeader = leaders.find((leader) => leader.id === leaderId) ?? leaders[0];
  const selectedLab =
    selectedLeader === undefined ? undefined : content.labs[selectedLeader.labId];

  function moveLeaderSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % leaders.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + leaders.length) % leaders.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = leaders.length - 1;
    }
    if (nextIndex === undefined) return;
    const nextLeader = leaders[nextIndex];
    if (nextLeader === undefined) return;
    event.preventDefault();
    setLeaderId(nextLeader.id);
    leaderButtons.current.get(nextLeader.id)?.focus();
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    try {
      onLaunch({
        seed: seed128(seed),
        leaderId: leaderId as NewGameConfig["leaderId"],
        difficultyId: difficultyId as NewGameConfig["difficultyId"],
        mandateId: mandateId as NewGameConfig["mandateId"],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <main className="setup-screen">
      <header className="setup-header">
        <button className="text-button" type="button" onClick={onBack}>
          ← TITLE
        </button>
        <div>
          <p className="eyebrow">FOUNDING COMMITTEE</p>
          <h1>Choose your lab leader</h1>
        </div>
        <p className="step-label">2012 · WEEK 1</p>
      </header>
      <aside className="setup-independence-notice" aria-label="Independence notice">
        <strong>FICTIONALISED ALTERNATE HISTORY</strong>
        <span>
          Fictional satire based on public sources. Neolab.ai is independent and is not
          affiliated with or endorsed by anyone depicted.
        </span>
        <a
          href={`${import.meta.env.BASE_URL}DISCLAIMER.md`}
          target="_blank"
          rel="noreferrer"
        >
          Full notice ↗
        </a>
        <a href={`${import.meta.env.BASE_URL}LICENSE`} target="_blank" rel="noreferrer">
          Licence ↗
        </a>
      </aside>
      <form onSubmit={submit}>
        <div className="leader-grid" role="radiogroup" aria-label="Lab leaders">
          {leaders.map((leader, index) => {
            const lab = content.labs[leader.labId];
            const selected = leader.id === leaderId;
            return (
              <button
                className={`leader-card${selected ? " selected" : ""}`}
                key={leader.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-describedby={`leader-summary-${leader.id}`}
                tabIndex={selected ? 0 : -1}
                ref={(element) => {
                  if (element === null) leaderButtons.current.delete(leader.id);
                  else leaderButtons.current.set(leader.id, element);
                }}
                onKeyDown={(event) => moveLeaderSelection(event, index)}
                onClick={() => setLeaderId(leader.id)}
              >
                <PixelPortrait
                  className="pixel-avatar"
                  subjectId={leader.id}
                  name={leader.displayName}
                />
                <span className="leader-name-line">
                  <span className="leader-title">{leader.displayName}</span>
                  <RealWorldProfile
                    inspirationName={leader.inspirationName}
                    inspirationSummary={leader.inspirationSummary}
                    compact
                  />
                </span>
                <span className="leader-epithet">{leader.epithet}</span>
                <span className="leader-company">
                  {lab?.displayName ?? "Unknown laboratory"} · {leader.aiFamily}
                </span>
                <span className="leader-headline-bonus">
                  <b>{leader.headlineBonus.label}</b>
                  {leader.headlineBonus.effects.map((effect) => {
                    const copy = leaderEffectCopy(effect);
                    return (
                      <small key={`${effect.target}:${effect.operation}`}>
                        {copy.summary}
                      </small>
                    );
                  })}
                </span>
                <span
                  id={`leader-summary-${leader.id}`}
                  className="leader-characteristic"
                >
                  {leader.characteristic}
                </span>
              </button>
            );
          })}
        </div>
        {selectedLeader === undefined ? null : (
          <section className="leader-detail">
            <header>
              <PixelPortrait
                className="leader-detail-portrait"
                subjectId={selectedLeader.id}
                name={selectedLeader.displayName}
              />
              <div className="leader-detail-copy">
                <p className="eyebrow">SELECTED FOUNDER // FULL DOSSIER</p>
                <div className="leader-name-line">
                  <h2>{selectedLeader.displayName}</h2>
                  <RealWorldProfile
                    inspirationName={selectedLeader.inspirationName}
                    inspirationSummary={selectedLeader.inspirationSummary}
                    compact
                  />
                </div>
                <p>
                  {selectedLeader.epithet} ·{" "}
                  {selectedLab?.displayName ?? "Unknown laboratory"} ·{" "}
                  {selectedLeader.aiFamily}
                </p>
              </div>
              <strong>{selectedLeader.headlineBonus.label}</strong>
            </header>
            <RealWorldProfile
              inspirationName={selectedLeader.inspirationName}
              inspirationSummary={selectedLeader.inspirationSummary}
              biography={selectedLeader.biography}
              sourceUrls={selectedLeader.sourceNotes}
              showAttribution={false}
            />
            <div className="leader-traits">
              <article>
                <span>Headline bonus</span>
                {selectedLeader.headlineBonus.effects.map((effect) => {
                  const copy = leaderEffectCopy(effect);
                  return (
                    <div
                      className={`leader-effect-row ${copy.tone}`}
                      key={`${effect.target}:${effect.operation}`}
                    >
                      <strong>{copy.summary}</strong>
                      <small>{copy.explanation}</small>
                    </div>
                  );
                })}
              </article>
              {selectedLeader.labModifiers.map((modifier) => {
                return (
                  <article key={modifier.id}>
                    <span>{modifier.label}</span>
                    {modifier.effects.map((effect) => {
                      const copy = leaderEffectCopy(effect);
                      return (
                        <div
                          className={`leader-effect-row ${copy.tone}`}
                          key={`${effect.target}:${effect.operation}`}
                        >
                          <strong>{copy.summary}</strong>
                          <small>{copy.explanation}</small>
                        </div>
                      );
                    })}
                  </article>
                );
              })}
            </div>
          </section>
        )}
        <section className="mandate-picker" aria-labelledby="mandate-picker-title">
          <header>
            <div>
              <p className="eyebrow">FOUNDING MANDATE // PERMANENT FOR THIS RUN</p>
              <h2 id="mandate-picker-title">Choose your permanent mandate</h2>
            </div>
            <p>
              This permanent choice sets the lab&apos;s starting strengths and trade-offs.
            </p>
          </header>
          <div className="mandate-grid" aria-label="Opening mandates">
            {mandates.map((mandate) => {
              const selected = mandate.id === mandateId;
              return (
                <button
                  className={`mandate-card${selected ? " selected" : ""}`}
                  key={mandate.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMandateId(mandate.id)}
                >
                  <span className="mandate-tagline">{mandate.tagline}</span>
                  <strong className="mandate-name">{mandate.displayName}</strong>
                  <span className="mandate-summary">{mandate.summary}</span>
                  <span className="mandate-effects">
                    {mandate.effects.map((effect) => {
                      const copy = mandateEffectCopy(effect);
                      return (
                        <span
                          className={`mandate-effect ${copy.tone}`}
                          key={`${effect.target}:${effect.operation}`}
                        >
                          <b>{copy.summary}</b>
                          <small>{copy.explanation}</small>
                        </span>
                      );
                    })}
                  </span>
                  <span className="mandate-selection">
                    {selected
                      ? "Selected · locked for this run"
                      : "Choose as permanent mandate"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <section className="difficulty-picker" aria-labelledby="difficulty-picker-title">
          <header>
            <div>
              <p className="eyebrow">SIMULATION PRESSURE // SCORE-AFFECTING</p>
              <h2 id="difficulty-picker-title">Choose the intensity of the race</h2>
            </div>
            <p>
              Difficulty changes the economy, rivals, incidents, and estimate clarity.
              Harder settings multiply score.
            </p>
          </header>
          <div className="difficulty-grid" role="radiogroup" aria-label="Difficulty">
            {difficulties.map((difficulty) => {
              const selected = difficulty.id === difficultyId;
              const copy = difficultyCopy(difficulty.id);
              return (
                <button
                  className={`difficulty-card ${copy.tone}${selected ? " selected" : ""}`}
                  key={difficulty.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDifficultyId(difficulty.id)}
                >
                  <span className="difficulty-tagline">{copy.tagline}</span>
                  <strong className="difficulty-name">{difficulty.displayName}</strong>
                  <span className="difficulty-summary">{copy.summary}</span>
                  <span className="difficulty-metrics">
                    <span>
                      <small>Your revenue</small>
                      <b>{signedPercentage(difficulty.revenueMultiplier)}</b>
                    </span>
                    <span>
                      <small>Your fixed costs</small>
                      <b>{signedPercentage(difficulty.fixedCostMultiplier)}</b>
                    </span>
                    <span>
                      <small>Rival progress</small>
                      <b>{signedPercentage(difficulty.rivalProgressMultiplier)}</b>
                    </span>
                    <span>
                      <small>Incident pressure</small>
                      <b>{signedPercentage(difficulty.incidentPressureMultiplier)}</b>
                    </span>
                    <span>
                      <small>Estimate clarity</small>
                      <b>{signedRating(difficulty.displayedEstimateQualityBonus)}</b>
                    </span>
                    <span>
                      <small>Final score</small>
                      <b>×{copy.scoreMultiplier.toFixed(2)}</b>
                    </span>
                  </span>
                  <span className="difficulty-selection">
                    {selected ? "Selected" : "Choose difficulty"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <section className="setup-options">
          <label>
            <span>Run seed</span>
            <input
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="launch-cell">
            <button className="primary" type="submit">
              Enter the lab →
            </button>
            {error === undefined ? null : (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      </form>
    </main>
  );
}
