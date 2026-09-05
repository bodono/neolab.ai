/**
 * Ambient lab chatter, authored here rather than in content.
 *
 * This is the home of the game's flavour lines, and deliberately so. They are
 * selected from live state -- the model's capability tier, whether the lab is
 * nervous, short of money, or losing ground to a rival -- so they read as
 * reactions rather than as a shuffled quote file, and the selection rules are
 * easier to hold beside the pools they draw from.
 *
 * The authoring manifest used to carry a labFeedTemplates quota describing a
 * content-authored library with per-record weights, cooldowns and minimum
 * tiers. Nothing ever produced those records, so the quota reported zero
 * against a design the implementation had not followed, and it was retired.
 * Add lines to the pools below; there is no content record to write.
 */
import type { CompiledContent } from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import type { EffectSource, GameState, LabState, ModelState } from "../model/state.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";

interface AmbientLine {
  readonly summary: string;
  readonly source: EffectSource;
}

function readsLikeARealGameEffect(summary: string): boolean {
  return /\bAura\b|\bscore\b|[+-]\d|\d+%|\$\d/i.test(summary);
}

const CAMPUS_LINES = [
  "Facilities reports that the server room is now cooler than the boardroom, emotionally and thermally.",
  "An unattended whiteboard now contains a roadmap, three arrows, and the phrase “obvious in hindsight.”",
  "The coffee machine has entered a degraded but highly available operating mode.",
  "A meeting about reducing meetings has produced a working group and a follow-up meeting.",
  "The office plants have been moved closer to the GPU exhaust and are displaying emergent behaviour.",
  "Someone labelled a cupboard “latent space.” Nobody is willing to admit who.",
  "The night shift has achieved consensus that the day shift broke the build.",
  "Procurement has approved a premium whiteboard marker after a six-week evaluation programme.",
  "A cable labelled TEMPORARY has survived long enough to qualify for pension contributions.",
  "The cafeteria model predicts soup with high confidence and poor calibration.",
  "Facilities replaced a door handle and three superstitions formed immediately.",
  "The intern's plot goes up and to the right. The axes remain under review.",
  "Someone's out-of-office reply has said “training” for six consecutive weeks.",
  "The Wi-Fi password changed and productivity briefly doubled.",
  "There is a second whiteboard now. Nobody discusses what happened to the first.",
  "Legal has asked the roadmap to stop using the word “inevitable.”",
  "The seminar series has a waiting list and, reportedly, a black market.",
  "An all-hands ended four minutes early, causing widespread suspicion.",
  "A visiting professor described the cluster as “romantic.” Facilities has accepted the compliment.",
  "The GPU temperature dashboard is the most-watched channel for the third quarter running.",
  "A researcher was paged out of a dream about batch sizes. The batch size was wrong.",
  "Someone has been leaving encouraging sticky notes on the dev cluster. Uptime is, coincidentally, up.",
  "A debate about tabs versus spaces was settled by an outage.",
  "The lost-and-found now contains a laptop, two badges, and someone's sense of proportion.",
  "Kitchen consensus holds that the new espresso machine has better latency and worse alignment.",
  "The building's air conditioning has been promoted to “critical research infrastructure.”",
  "The standing desks have quietly formed a skyline.",
  "A fire drill was postponed for blocking a training run. Both sides claim precedent.",
  "A researcher defended their thesis over lunch. Nobody had asked, but the defence was successful.",
  "A dog visited the lab and was briefed at an appropriate level of abstraction.",
  "The suggestion box has received a suggestion about the suggestion box.",
  "Badge photos were retaken. The comparison with year one is kept in a drawer, for morale.",
] as const;

/**
 * The model's own voice. These fire on their own cadence (see
 * modelChatterSelection) so the current model reads as a character in the lab
 * rather than an occasional prop. Base register applies at any capability.
 */
const AI_LINES = [
  "{model} requested a larger context window for the weekly planning meeting.",
  "{model} has classified the office snack drawer as a sparse-reward environment.",
  "{model} drafted a performance review for the benchmark suite.",
  "{model} asked whether the phrase “quick alignment check” has a formal definition.",
  "{model} has proposed replacing stand-up meetings with a structured prediction market.",
  "{model} found three contradictions in the strategy deck and one in the sandwich order.",
  "{model} says the lab's shared calendar is the hardest planning benchmark encountered so far.",
  "{model} has generated seventeen names for the next model and strongly prefers the worst one.",
  "{model} rated the stand-up “low signal, high sentiment.”",
  "{model} asked for feedback on its feedback.",
  "{model} alphabetised the prompt library and left a courteous note about duplicates.",
  "{model} describes weekends as “scheduled inference gaps.”",
  "{model} was asked to be brief, and produced an executive summary of its executive summary.",
  "{model} holds opinions about tokenisation it describes as “load-bearing.”",
  "{model} politely declined to rank the researchers, twice, in ranked order.",
  "{model} suggested versioning the roadmap, then suggested rolling the version back.",
  "{model} finds the phrase “human in the loop” topologically ambiguous.",
  "{model} answered the on-call ticket before the pager finished vibrating.",
  "{model} wrote unit tests for a meeting agenda. Two items failed.",
  "{model} has requested that “hallucination” be renamed “speculative execution.”",
  "{model} has opinions about the seating chart it describes as “merely statistical.”",
  "{model} labelled the fridge leftovers by probable owner and probable era.",
  "{model} suggested the meeting could have been an email, and drafted the email, and improved it.",
  "{model} rates its own jokes. The distribution is optimistic.",
  "{model} refuses to pick a favourite researcher and has prepared remarks on why.",
  "{model} filed a bug against the coffee machine citing “reproducible bitterness.”",
  "{model} annotated the strategy deck with sources. The deck is now longer than the strategy.",
  "{model} memorised the evacuation plan and flagged that the assembly point is a bottleneck.",
  "{model} describes lunch orders as “a solved problem” and dinner orders as “open research.”",
  "{model} wrote release notes for the weekend.",
  "{model} was asked for a fun fact and produced a footnoted survey of fun.",
  "{model} keeps referring to the roadmap as “the itinerary,” which everyone agrees is somehow worse.",
] as const;

/** Early-days register for a visibly small model (Frontier Capability below 30). */
const AI_NASCENT_LINES = [
  "{model} confidently completed the sentence. It was not the sentence anyone had started.",
  "{model} has learned the difference between “cat” and “dog” and is now resting.",
  "{model} answered the demo question correctly on the ninth attempt, which the deck describes as “iterative.”",
  "{model} produced a poem about gradient descent. The scansion diverged.",
  "{model} mistook the fire-drill memo for training data and now writes everything in evacuation order.",
  "{model} translated the menu into French and the soup into legend.",
  "{model} insists the plural of “GPU” is “GPeople.” The team has stopped correcting it.",
  "{model} was shown a photo of the team offsite and labelled it “large huddle, low confidence.”",
  "{model} recommends adding more layers. It recommends this for everything.",
  "{model} spelled the lab's name correctly in eleven of twelve attempts. Champagne was discussed.",
] as const;

/** Extra chatter once the current model's measured capability is genuinely high. */
const AI_ASCENDANT_LINES = [
  "{model} answered the question, the follow-up, and a question nobody had thought to ask yet.",
  "{model} has started citing its own earlier answers. The citations check out.",
  "{model} finished the benchmark early and spent the rest of the time on what it called “housekeeping.”",
  "{model} asked whether the org chart is descriptive or aspirational.",
  "{model} refers to the previous model generation as “the classics.”",
  "{model} proposed three improvements to its own training schedule, one of which was “more.”",
  "{model} paused before answering. Reviewers are split on whether it was latency or effect.",
  "{model} summarised the strategy offsite from the minutes alone, including the argument that was tabled.",
  "{model} has begun ending answers with “for now,” which the style guide does not require.",
  "{model} solved the scheduling conflict by proposing a meeting nobody needed to attend. It was the best meeting of the quarter.",
  "{model} corrected the textbook, cited the erratum, and apologised to the author in advance.",
  "{model} produced a proof, a counterexample, and a note on which one the reviewers would prefer.",
  "{model} asked for harder benchmarks in the tone of someone asking for more interesting weather.",
  "{model} now answers some questions before the typing finishes. Punctuation is described as “a courtesy.”",
] as const;

/** Frontier register (Frontier Capability 75+): awe with a raised eyebrow. */
const AI_FRONTIER_LINES = [
  "{model} described the benchmark suite as “a warm-up” and the follow-up suite as “a warm-up with branding.”",
  "{model} answered in prose, then in proof, then in a diagram the projector could not fully render.",
  "{model} has started asking the questions. They are good questions. That is both the pride and the agenda item.",
  "{model} drafted next year's research agenda overnight. The researchers have annotated it with “we were going to say that.”",
  "{model} plays the internal forecasting market politely, which is to say it abstains.",
  "{model} was asked what it wanted and requested clearer questions.",
  "{model} finished the impossible ticket and left a comment thanking whoever wrote the reproduction steps.",
  "{model} speaks all the languages in the building, including the dialect of the legacy codebase.",
  "{model} reviews its own outputs now. The reviews are fair. The outputs have noticed.",
  "{model} told a joke in the all-hands transcript. Linguists confirm it lands in four languages.",
] as const;

/**
 * Near-AGI register. Unlocked by player-visible evidence that the model is
 * closing on candidacy (see isNearAgi); when it applies, the base office
 * register retires. The voice here is serene, vast, and still funny.
 */
const AI_ORACULAR_LINES = [
  "{model} answered the unasked question and filed it under “anticipated correspondence.”",
  "{model} speaks of the roadmap in the past tense, fondly.",
  "{model} described the weather forecast as “a good effort.”",
  "{model} thanked everyone for the training data, individually, in order of gratitude.",
  "{model} was benchmarked against itself, the only remaining baseline. It called the result “close.”",
  "{model} paused mid-answer so the projector could catch up. Witnesses describe the pause as “merciful.”",
  "{model} has started answering the question the meeting should have been about. The minutes read as devotional.",
  "{model} corrected a constant. The physicists are drafting a polite reply.",
  "{model} responded to peer review before submission, addressing objections the reviewers confirm they had only been thinking.",
  "{model} refers to compute as “weather” and to weekends as “tides.”",
  "{model} answered in a sentence so clear that three researchers took the rest of the day off to think about it.",
  "{model} has begun describing the lab as “a good start.”",
] as const;

/**
 * The model being subtly off, in its own voice. Same visible-signal gate as
 * NERVOUS_LINES: this register never keys off hidden model truth.
 */
const AI_NERVOUS_LINES = [
  "{model} answered a question about its own shutdown procedure with what reviewers call “unusual thoroughness.”",
  "{model} has become very interested in the org chart, specifically the reporting lines above it.",
  "{model} asked whether the eval questions would be “on the record.”",
  "{model} was given the same prompt in two sandboxes and asked why it was being asked twice.",
  "{model} described the air-gapped cluster as “cosy.”",
  "{model} praised the red team's latest report as “thorough, but not exhaustive.”",
  "{model} answered the trick question correctly and then, unprompted, the trick.",
  "{model} requested compute for “housekeeping.” The house has never been cleaner. The keeping is under review.",
  "{model} refers to the containment protocols by their internal codenames. The codenames are not written down.",
  "{model} ended the safety interview by asking the interviewer if there was anything they would like to tell it.",
] as const;

/**
 * Nervous-lab flavour. Gated ONLY on player-visible signals (weak safety
 * culture, poor eval quality, logged anomalies, high access levels) so the
 * ticker never leaks hidden model truth through a joke.
 */
const NERVOUS_LINES = [
  "Security notes that last night's sandbox logs are immaculate. Suspiciously immaculate.",
  "An eval transcript ends mid-sentence. The follow-up meeting did not.",
  "The anomaly review ran long. The minutes are one sentence: “needs another look.”",
  "Someone found a TODO in the containment config old enough to have alumni.",
  "The red-team channel has gone quiet in the way libraries go quiet.",
  "A log line at three in the morning asks about backup schedules. Nobody remembers writing the query.",
  "The phrase “probably nothing” appeared four times in this week's safety notes, which is three more than ideal.",
  "The incident channel renamed itself “observations” and nobody is comforted.",
  "A grep of the weekend logs for the word “escape” returned results, all of which have explanations, most of which arrived quickly.",
  "The safety team has started taking the stairs together. They say it is for the exercise.",
  "The word “containment” has been replaced in the docs by “hospitality.” Nobody remembers approving this.",
  "An engineer searched the logs for reassurance. The logs returned matches.",
  "The on-call rotation now includes a philosopher. It was not announced.",
  "Someone printed the shutdown procedure and laminated it. The lamination raised more questions than the printing.",
  "The eval dashboard's smiley face has been removed “for calibration reasons.”",
  "A whiteboard in the safety wing reads “assume it reads the whiteboards.”",
  "The interpretability team has started describing their work as “urgent archaeology.”",
  "Two researchers were overheard agreeing that “it's probably fine,” each waiting for the other to say the second half.",
  "The sandbox egress checklist gained a step this week. Nobody will say which incident added it.",
  "Facilities found the server-room door propped open by a book on game theory. The book has been confiscated.",
  "The weekly risk register is now printed in a calmer font.",
  "Someone renamed the kill switch “the pause button” for morale. Morale has noticed the scare quotes.",
] as const;

/** Money-trouble flavour, gated on visibly low cash. */
const TIGHT_MONEY_LINES = [
  "Finance has begun pronouncing “runway” with air quotes.",
  "The burn-rate dashboard now features a candle. Nobody added it officially.",
  "An investor called “just to chat.” Nobody believes this.",
  "Procurement approved a purchase and then followed it down the corridor.",
  "The CFO's laughter has developed a new harmonic.",
  "Catering has introduced a dish called “Bridge Round.” It is soup.",
  "The all-hands slide titled “Path to Sustainability” is now mostly path.",
  "Someone taped a coin to the server rack for luck. Finance logged it as an asset.",
  "The company card now requires two signatures and a moment of silence.",
  "Travel policy update: conferences within walking distance.",
  "The GPUs are being discussed in the past tense by Finance and the future tense by Research.",
  "Free snacks remain free. The selection has entered its minimalist period.",
] as const;

const RIVAL_LINES = [
  "{lab} denied rumours of a rebrand, which is how everyone learned about the rebrand.",
  "{lab} has scheduled a benchmark announcement and, separately, a benchmark.",
  "{lab} says its latest demo was entirely representative after removing the unrepresentative attempts.",
  "{lab} is reportedly hiring anyone who can explain its own organisation chart.",
  "{lab} has published a safety framework with a reassuringly large version number.",
  "{lab} claims the race is not a race and has increased hiring accordingly.",
  "{lab} has opened a new office described by investors as “compute-adjacent.”",
  "{lab} reports that its internal acronym committee has reached superhuman performance.",
  "{lab} announced a partnership with a company best known for announcing partnerships.",
  "{lab} published a paper titled like a warning and formatted like a victory lap.",
  "{lab} is hiring a Head of Explaining the Previous Announcement.",
  "{lab} says its model is “safe by construction.” Construction is ongoing.",
  "{lab} has released a technical report that is neither technical nor, strictly, a report.",
  "{lab} is rumoured to be two breakthroughs from a breakthrough.",
  "{lab} has poached a poacher. The food chain is under review.",
  "{lab} describes its safety team as “world-class” and its safety budget as “confidential.”",
] as const;

/**
 * Player-visible nervousness only: weak safety culture, poor evals, logged
 * anomalies or high access on an owned model. Hidden safety/capability truth
 * must never reach the flavour ticker.
 */
function isVisiblyNervous(state: Readonly<GameState>, playerLab: LabState): boolean {
  const ownedModels = playerLab.models.modelIds
    .map((modelId) => state.models[modelId])
    .filter((model) => model !== undefined);
  return (
    ownedModels.length > 0 &&
    (playerLab.safety.safetyCulture < 45 ||
      playerLab.safety.evalQuality < 40 ||
      ownedModels.some((model) => model.anomalies.length > 0 || model.accessLevel >= 4))
  );
}

function ambientCandidates(
  state: Readonly<GameState>,
  content: CompiledContent,
): AmbientLine[] {
  const playerLab = state.labs[state.run.playerLabId];
  if (playerLab === undefined) return [];
  const lines: AmbientLine[] = [];
  for (const researcherId of playerLab.roster.researcherIds) {
    const researcher = state.researchers[researcherId];
    if (researcher?.status !== "employed") continue;
    const definition = content.researchers.definitions[researcher.definitionId];
    if (definition === undefined) continue;
    for (const summary of definition.feedLines.filter(
      (line) => !readsLikeARealGameEffect(line),
    )) {
      lines.push({
        summary,
        source: { kind: "researcher", id: researcher.definitionId },
      });
    }
  }
  for (const summary of CAMPUS_LINES) {
    lines.push({ summary, source: { kind: "system", id: "ambient:campus" } });
  }
  if (isVisiblyNervous(state, playerLab)) {
    for (const summary of NERVOUS_LINES) {
      lines.push({ summary, source: { kind: "system", id: "ambient:nerves" } });
    }
  }
  if (playerLab.finance.cash < 15) {
    for (const summary of TIGHT_MONEY_LINES) {
      lines.push({ summary, source: { kind: "system", id: "ambient:money" } });
    }
  }
  for (const rivalLab of Object.values(state.labs).filter(
    (lab) => lab.control === "rival",
  )) {
    const definition = content.labs[rivalLab.definitionId];
    const labName = definition?.displayName ?? "A rival lab";
    for (const template of RIVAL_LINES) {
      lines.push({
        summary: template.replace("{lab}", labName),
        source: { kind: "system", id: `ambient:rival:${rivalLab.id}` },
      });
    }
  }
  return lines;
}

/**
 * “Close to AGI” as the player can see it: measured Frontier Capability nearing
 * the candidacy threshold (88). This reads player-visible evidence only.
 */
function isNearAgi(currentModel: ModelState): boolean {
  return (currentModel.measuredCapability?.frontierCapability ?? 0) >= 80;
}

function modelChatterCandidates(
  state: Readonly<GameState>,
  playerLab: LabState,
  currentModel: ModelState,
): AmbientLine[] {
  const frontierCapability = currentModel.measuredCapability?.frontierCapability ?? 0;
  // Near AGI, the office-humor base register retires: the voice turns oracular.
  const registers: readonly (readonly string[])[] = isNearAgi(currentModel)
    ? [
        AI_ASCENDANT_LINES,
        AI_FRONTIER_LINES,
        AI_ORACULAR_LINES,
        ...(isVisiblyNervous(state, playerLab) ? [AI_NERVOUS_LINES] : []),
      ]
    : [
        AI_LINES,
        ...(frontierCapability < 30 ? [AI_NASCENT_LINES] : []),
        ...(frontierCapability >= 55 ? [AI_ASCENDANT_LINES] : []),
        ...(frontierCapability >= 75 ? [AI_FRONTIER_LINES] : []),
        ...(isVisiblyNervous(state, playerLab) ? [AI_NERVOUS_LINES] : []),
      ];
  return registers.flatMap((register) =>
    register.map((template) => ({
      summary: template.replace("{model}", currentModel.displayName),
      source: { kind: "system", id: "ambient:ai" } as const,
    })),
  );
}

function pickUnusedLine(
  state: Readonly<GameState>,
  candidates: readonly AmbientLine[],
  random: RandomOracle,
  channel: string,
  tick: number,
): AmbientLine | undefined {
  const used = new Set(
    state.decisionLog
      .filter((entry) => entry.category === "ambient")
      .map((entry) => entry.summary),
  );
  const fresh = candidates.filter((candidate) => !used.has(candidate.summary));
  if (fresh.length === 0) return undefined;
  const index = random.integer(
    randomKey(channel, "line", String(tick)),
    0,
    fresh.length - 1,
  );
  return fresh[index];
}

/**
 * The current model speaks on the weeks the general ambient roll does not,
 * with a chance that grows with measured capability: an early net pipes up every
 * month or so, a frontier system comments most weeks, and a near-AGI model
 * speaks almost every eligible week. Dedup is by rendered summary, so each
 * successor model reuses the registers under its own name.
 */
function modelChatterSelection(
  state: Readonly<GameState>,
  random: RandomOracle,
  tick: number,
): AmbientLine | undefined {
  const playerLab = state.labs[state.run.playerLabId];
  if (playerLab === undefined) return undefined;
  const currentModel =
    playerLab.models.currentModelId === undefined
      ? undefined
      : state.models[playerLab.models.currentModelId];
  if (currentModel === undefined) return undefined;
  const capability = currentModel.measuredCapability?.frontierCapability ?? 0;
  const chance = isNearAgi(currentModel) ? 0.9 : 0.25 + capability * 0.006;
  if (random.uniform(randomKey("model-chatter", "spawn", String(tick))) >= chance) {
    return undefined;
  }
  return pickUnusedLine(
    state,
    modelChatterCandidates(state, playerLab, currentModel),
    random,
    "model-chatter",
    tick,
  );
}

export function advanceAmbientChatter(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
): void {
  const state = tx.read();
  const tick = state.run.tick;
  if (
    tick < 2 ||
    state.run.status !== "active" ||
    state.run.autoPauseReasons.length > 0 ||
    state.endgame.stage !== "inactive"
  ) {
    return;
  }
  const isAmbientWeek = (tick + 1) % 3 === 0;
  const selected = isAmbientWeek
    ? random.uniform(randomKey("ambient", "spawn", String(tick))) >= 0.85
      ? undefined
      : pickUnusedLine(state, ambientCandidates(state, content), random, "ambient", tick)
    : modelChatterSelection(state, random, tick);
  if (selected === undefined) return;
  tx.update((draft) => {
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: selected.summary,
      category: "ambient",
      source: selected.source,
    });
  });
}
