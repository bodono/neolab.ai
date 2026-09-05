import type { AudioCueId, MusicTrackId } from "./audio-types.ts";

import helloWorldOpusUrl from "../../../../soundtrack/prototypes/01-hello-world-model.opus?url";
import helloWorldUrl from "../../../../soundtrack/prototypes/01-hello-world-model.m4a?url";
import gradientsOpusUrl from "../../../../soundtrack/prototypes/02-gradients-flowing.opus?url";
import gradientsUrl from "../../../../soundtrack/prototypes/02-gradients-flowing.m4a?url";
import safetyCaseOpusUrl from "../../../../soundtrack/prototypes/03-safety-case-draft-47.opus?url";
import safetyCaseUrl from "../../../../soundtrack/prototypes/03-safety-case-draft-47.m4a?url";
import redTeamOpusUrl from "../../../../soundtrack/prototypes/04-red-team-found-something.opus?url";
import redTeamUrl from "../../../../soundtrack/prototypes/04-red-team-found-something.m4a?url";
import sharedFutureOpusUrl from "../../../../soundtrack/prototypes/06-broadly-shared-future.opus?url";
import sharedFutureUrl from "../../../../soundtrack/prototypes/06-broadly-shared-future.m4a?url";
import cashflowOpusUrl from "../../../../soundtrack/prototypes/07-cashflow-positive.opus?url";
import cashflowUrl from "../../../../soundtrack/prototypes/07-cashflow-positive.m4a?url";
import peerReviewerOpusUrl from "../../../../soundtrack/prototypes/08-peer-reviewer-two.opus?url";
import peerReviewerUrl from "../../../../soundtrack/prototypes/08-peer-reviewer-two.m4a?url";
import extinctionOpusUrl from "../../../../soundtrack/prototypes/09-nothing-left-to-read.opus?url";
import extinctionUrl from "../../../../soundtrack/prototypes/09-nothing-left-to-read.m4a?url";
import overnightRunOpusUrl from "../../../../soundtrack/prototypes/10-overnight-run.opus?url";
import overnightRunUrl from "../../../../soundtrack/prototypes/10-overnight-run.m4a?url";
import gpusTuesdayOpusUrl from "../../../../soundtrack/prototypes/11-gpus-arrive-tuesday.opus?url";
import gpusTuesdayUrl from "../../../../soundtrack/prototypes/11-gpus-arrive-tuesday.m4a?url";
import testsPassOpusUrl from "../../../../soundtrack/prototypes/12-tests-pass-first-try.opus?url";
import testsPassUrl from "../../../../soundtrack/prototypes/12-tests-pass-first-try.m4a?url";
import orientationOpusUrl from "../../../../soundtrack/prototypes/13-new-hire-orientation.opus?url";
import orientationUrl from "../../../../soundtrack/prototypes/13-new-hire-orientation.m4a?url";
import demoTwiceOpusUrl from "../../../../soundtrack/prototypes/14-demo-worked-twice.opus?url";
import demoTwiceUrl from "../../../../soundtrack/prototypes/14-demo-worked-twice.m4a?url";
import budgetOpusUrl from "../../../../soundtrack/prototypes/15-budget-approved.opus?url";
import budgetUrl from "../../../../soundtrack/prototypes/15-budget-approved.m4a?url";
import convergedOpusUrl from "../../../../soundtrack/prototypes/16-converged-before-lunch.opus?url";
import convergedUrl from "../../../../soundtrack/prototypes/16-converged-before-lunch.m4a?url";
import qualifiedSuccessOpusUrl from "../../../../soundtrack/prototypes/23-a-qualified-success.opus?url";
import qualifiedSuccessUrl from "../../../../soundtrack/prototypes/23-a-qualified-success.m4a?url";
import exitInterviewOpusUrl from "../../../../soundtrack/prototypes/24-exit-interview.opus?url";
import exitInterviewUrl from "../../../../soundtrack/prototypes/24-exit-interview.m4a?url";
import lossOfSignalOpusUrl from "../../../../soundtrack/prototypes/25-loss-of-signal.opus?url";
import lossOfSignalUrl from "../../../../soundtrack/prototypes/25-loss-of-signal.m4a?url";
import graphVerticalOpusUrl from "../../../../soundtrack/prototypes/26-the-graph-goes-vertical.opus?url";
import graphVerticalUrl from "../../../../soundtrack/prototypes/26-the-graph-goes-vertical.m4a?url";
import handsOffWeightsOpusUrl from "../../../../soundtrack/prototypes/27-hands-off-the-weights.opus?url";
import handsOffWeightsUrl from "../../../../soundtrack/prototypes/27-hands-off-the-weights.m4a?url";
import everyPhoneOpusUrl from "../../../../soundtrack/prototypes/28-every-phone-at-once.opus?url";
import everyPhoneUrl from "../../../../soundtrack/prototypes/28-every-phone-at-once.m4a?url";
import goNoGoOpusUrl from "../../../../soundtrack/prototypes/29-go-no-go.opus?url";
import goNoGoUrl from "../../../../soundtrack/prototypes/29-go-no-go.m4a?url";
import shipItOpusUrl from "../../../../soundtrack/prototypes/30-ship-it.opus?url";
import shipItUrl from "../../../../soundtrack/prototypes/30-ship-it.m4a?url";
import adrenalineOpusUrl from "../../../../soundtrack/prototypes/31-adrenaline-half-life.opus?url";
import adrenalineUrl from "../../../../soundtrack/prototypes/31-adrenaline-half-life.m4a?url";
import ghostClusterOpusUrl from "../../../../soundtrack/prototypes/32-ghost-in-the-cluster.opus?url";
import ghostClusterUrl from "../../../../soundtrack/prototypes/32-ghost-in-the-cluster.m4a?url";
import machineFirstOpusUrl from "../../../../soundtrack/prototypes/33-the-machine-moves-first.opus?url";
import machineFirstUrl from "../../../../soundtrack/prototypes/33-the-machine-moves-first.m4a?url";
import windowClosingOpusUrl from "../../../../soundtrack/prototypes/34-the-window-is-closing.opus?url";
import windowClosingUrl from "../../../../soundtrack/prototypes/34-the-window-is-closing.m4a?url";
import paperCueOpusUrl from "../../../../soundtrack/events/event-01-paper-discovered.opus?url";
import paperCueUrl from "../../../../soundtrack/events/event-01-paper-discovered.m4a?url";
import breakthroughCueOpusUrl from "../../../../soundtrack/events/event-02-major-breakthrough.opus?url";
import breakthroughCueUrl from "../../../../soundtrack/events/event-02-major-breakthrough.m4a?url";
import capabilityCueOpusUrl from "../../../../soundtrack/events/event-03-capability-tier.opus?url";
import capabilityCueUrl from "../../../../soundtrack/events/event-03-capability-tier.m4a?url";
import safetyCueOpusUrl from "../../../../soundtrack/events/event-04-safety-win.opus?url";
import safetyCueUrl from "../../../../soundtrack/events/event-04-safety-win.m4a?url";
import fundraisingCueOpusUrl from "../../../../soundtrack/events/event-05-fundraising-complete.opus?url";
import fundraisingCueUrl from "../../../../soundtrack/events/event-05-fundraising-complete.m4a?url";
import researcherJoinsCueOpusUrl from "../../../../soundtrack/events/event-06-researcher-joins.opus?url";
import researcherJoinsCueUrl from "../../../../soundtrack/events/event-06-researcher-joins.m4a?url";
import researcherDepartsCueOpusUrl from "../../../../soundtrack/events/event-07-researcher-departs.opus?url";
import researcherDepartsCueUrl from "../../../../soundtrack/events/event-07-researcher-departs.m4a?url";
import rivalCueOpusUrl from "../../../../soundtrack/events/event-08-rival-breakthrough.opus?url";
import rivalCueUrl from "../../../../soundtrack/events/event-08-rival-breakthrough.m4a?url";
import regulationCueOpusUrl from "../../../../soundtrack/events/event-09-regulatory-attention.opus?url";
import regulationCueUrl from "../../../../soundtrack/events/event-09-regulatory-attention.m4a?url";
import crisisCueOpusUrl from "../../../../soundtrack/events/event-10-crisis-opened.opus?url";
import crisisCueUrl from "../../../../soundtrack/events/event-10-crisis-opened.m4a?url";
import containmentWarningCueOpusUrl from "../../../../soundtrack/events/event-11-containment-warning.opus?url";
import containmentWarningCueUrl from "../../../../soundtrack/events/event-11-containment-warning.m4a?url";
import coalitionProposedCueOpusUrl from "../../../../soundtrack/events/event-12-coalition-proposed.opus?url";
import coalitionProposedCueUrl from "../../../../soundtrack/events/event-12-coalition-proposed.m4a?url";
import coalitionFormedCueOpusUrl from "../../../../soundtrack/events/event-13-coalition-formed.opus?url";
import coalitionFormedCueUrl from "../../../../soundtrack/events/event-13-coalition-formed.m4a?url";
import endgameCueOpusUrl from "../../../../soundtrack/events/event-14-endgame-begins.opus?url";
import endgameCueUrl from "../../../../soundtrack/events/event-14-endgame-begins.m4a?url";
import raceWonCueOpusUrl from "../../../../soundtrack/events/event-15-race-won.opus?url";
import raceWonCueUrl from "../../../../soundtrack/events/event-15-race-won.m4a?url";
import raceLostCueOpusUrl from "../../../../soundtrack/events/event-16-race-lost.opus?url";
import raceLostCueUrl from "../../../../soundtrack/events/event-16-race-lost.m4a?url";
import nationalisedCueOpusUrl from "../../../../soundtrack/events/event-17-nationalised.opus?url";
import nationalisedCueUrl from "../../../../soundtrack/events/event-17-nationalised.m4a?url";
import bankruptcyCueOpusUrl from "../../../../soundtrack/events/event-18-bankruptcy.opus?url";
import bankruptcyCueUrl from "../../../../soundtrack/events/event-18-bankruptcy.m4a?url";
import containmentFailureCueOpusUrl from "../../../../soundtrack/events/event-19-containment-failure.opus?url";
import containmentFailureCueUrl from "../../../../soundtrack/events/event-19-containment-failure.m4a?url";
import scoreCueOpusUrl from "../../../../soundtrack/events/event-20-score-milestone.opus?url";
import scoreCueUrl from "../../../../soundtrack/events/event-20-score-milestone.m4a?url";

export interface AudioEncodingUrls {
  readonly opus: string;
  readonly aac: string;
}

export function preferredAudioUrl(
  urls: AudioEncodingUrls,
  canPlayType: (mime: string) => string = (mime) =>
    typeof document === "undefined"
      ? ""
      : document.createElement("audio").canPlayType(mime),
): string {
  return canPlayType('audio/ogg; codecs="opus"') === "" ? urls.aac : urls.opus;
}

function encoded(opus: string, aac: string): string {
  return preferredAudioUrl({ opus, aac });
}

export interface MusicAssetDefinition {
  readonly id: MusicTrackId;
  readonly title: string;
  readonly url: string;
  readonly durationSeconds: number;
  readonly loop: boolean;
}

export interface CueAssetDefinition {
  readonly id: AudioCueId;
  readonly title: string;
  readonly url: string;
  readonly priority: 15 | 35 | 55 | 75 | 90 | 100;
  readonly cooldownSeconds: number;
  readonly terminal: boolean;
}

export const MUSIC_ASSETS: Readonly<Record<MusicTrackId, MusicAssetDefinition>> = {
  "hello-world-model": {
    id: "hello-world-model",
    title: "Hello, World Model",
    url: encoded(helloWorldOpusUrl, helloWorldUrl),
    durationSeconds: 160,
    loop: true,
  },
  "gradients-flowing": {
    id: "gradients-flowing",
    title: "The Gradients Are Flowing",
    url: encoded(gradientsOpusUrl, gradientsUrl),
    durationSeconds: 152.4,
    loop: true,
  },
  "safety-case-draft-47": {
    id: "safety-case-draft-47",
    title: "Safety Case (Draft 47)",
    url: encoded(safetyCaseOpusUrl, safetyCaseUrl),
    durationSeconds: 187.8,
    loop: true,
  },
  "red-team-found-something": {
    id: "red-team-found-something",
    title: "Red Team Found Something",
    url: encoded(redTeamOpusUrl, redTeamUrl),
    durationSeconds: 139.1,
    loop: true,
  },
  "broadly-shared-future": {
    id: "broadly-shared-future",
    title: "A Broadly Shared Future",
    url: encoded(sharedFutureOpusUrl, sharedFutureUrl),
    durationSeconds: 165.5,
    loop: true,
  },
  "cashflow-positive": {
    id: "cashflow-positive",
    title: "Cashflow Positive*",
    url: encoded(cashflowOpusUrl, cashflowUrl),
    durationSeconds: 141.6,
    loop: true,
  },
  "peer-reviewer-two": {
    id: "peer-reviewer-two",
    title: "Reviewer Two Requires AGI",
    url: encoded(peerReviewerOpusUrl, peerReviewerUrl),
    durationSeconds: 151.6,
    loop: true,
  },
  "nothing-left-to-read": {
    id: "nothing-left-to-read",
    title: "There Is No One Left to Read This",
    url: encoded(extinctionOpusUrl, extinctionUrl),
    durationSeconds: 128,
    loop: false,
  },
  "overnight-run": {
    id: "overnight-run",
    title: "The Overnight Run",
    url: encoded(overnightRunOpusUrl, overnightRunUrl),
    durationSeconds: 172.8,
    loop: true,
  },
  "gpus-arrive-tuesday": {
    id: "gpus-arrive-tuesday",
    title: "The GPUs Arrive on a Tuesday",
    url: encoded(gpusTuesdayOpusUrl, gpusTuesdayUrl),
    durationSeconds: 145.5,
    loop: true,
  },
  "tests-pass-first-try": {
    id: "tests-pass-first-try",
    title: "All Tests Pass on the First Try",
    url: encoded(testsPassOpusUrl, testsPassUrl),
    durationSeconds: 150,
    loop: true,
  },
  "new-hire-orientation": {
    id: "new-hire-orientation",
    title: "New Hire Orientation",
    url: encoded(orientationOpusUrl, orientationUrl),
    durationSeconds: 154.8,
    loop: true,
  },
  "demo-worked-twice": {
    id: "demo-worked-twice",
    title: "The Demo Worked Twice",
    url: encoded(demoTwiceOpusUrl, demoTwiceUrl),
    durationSeconds: 143.3,
    loop: true,
  },
  "budget-approved": {
    id: "budget-approved",
    title: "Compute Budget Approved",
    url: encoded(budgetOpusUrl, budgetUrl),
    durationSeconds: 144,
    loop: true,
  },
  "converged-before-lunch": {
    id: "converged-before-lunch",
    title: "Converged Before Lunch",
    url: encoded(convergedOpusUrl, convergedUrl),
    durationSeconds: 140.3,
    loop: true,
  },
  "a-qualified-success": {
    id: "a-qualified-success",
    title: "A Qualified Success",
    url: encoded(qualifiedSuccessOpusUrl, qualifiedSuccessUrl),
    durationSeconds: 147.7,
    loop: true,
  },
  "exit-interview": {
    id: "exit-interview",
    title: "Exit Interview",
    url: encoded(exitInterviewOpusUrl, exitInterviewUrl),
    durationSeconds: 171.4,
    loop: true,
  },
  "loss-of-signal": {
    id: "loss-of-signal",
    title: "Loss of Signal",
    url: encoded(lossOfSignalOpusUrl, lossOfSignalUrl),
    durationSeconds: 174.5,
    loop: true,
  },
  "the-graph-goes-vertical": {
    id: "the-graph-goes-vertical",
    title: "The Graph Goes Vertical",
    url: encoded(graphVerticalOpusUrl, graphVerticalUrl),
    durationSeconds: 164.6,
    loop: true,
  },
  "hands-off-the-weights": {
    id: "hands-off-the-weights",
    title: "Hands Off The Weights",
    url: encoded(handsOffWeightsOpusUrl, handsOffWeightsUrl),
    durationSeconds: 178.2,
    loop: true,
  },
  "every-phone-at-once": {
    id: "every-phone-at-once",
    title: "Every Phone At Once",
    url: encoded(everyPhoneOpusUrl, everyPhoneUrl),
    durationSeconds: 160,
    loop: true,
  },
  "go-no-go": {
    id: "go-no-go",
    title: "Go / No-Go",
    url: encoded(goNoGoOpusUrl, goNoGoUrl),
    durationSeconds: 151.6,
    loop: true,
  },
  "ship-it": {
    id: "ship-it",
    title: "Ship It",
    url: encoded(shipItOpusUrl, shipItUrl),
    durationSeconds: 168.6,
    loop: true,
  },
  "adrenaline-half-life": {
    id: "adrenaline-half-life",
    title: "Adrenaline Half-Life",
    url: encoded(adrenalineOpusUrl, adrenalineUrl),
    durationSeconds: 152.4,
    loop: true,
  },
  "ghost-in-the-cluster": {
    id: "ghost-in-the-cluster",
    title: "Ghost in the Cluster",
    url: encoded(ghostClusterOpusUrl, ghostClusterUrl),
    durationSeconds: 169.4,
    loop: true,
  },
  "the-machine-moves-first": {
    id: "the-machine-moves-first",
    title: "The Machine Moves First",
    url: encoded(machineFirstOpusUrl, machineFirstUrl),
    durationSeconds: 157.8,
    loop: true,
  },
  "the-window-is-closing": {
    id: "the-window-is-closing",
    title: "The Window Is Closing",
    url: encoded(windowClosingOpusUrl, windowClosingUrl),
    durationSeconds: 161.1,
    loop: true,
  },
};

function cue(
  id: AudioCueId,
  title: string,
  url: string,
  priority: CueAssetDefinition["priority"],
  cooldownSeconds: number,
  terminal = false,
): CueAssetDefinition {
  return { id, title, url, priority, cooldownSeconds, terminal };
}

export const CUE_ASSETS: Readonly<Record<AudioCueId, CueAssetDefinition>> = {
  "paper-discovered": cue(
    "paper-discovered",
    "Paper Discovered",
    encoded(paperCueOpusUrl, paperCueUrl),
    35,
    0,
  ),
  "major-breakthrough": cue(
    "major-breakthrough",
    "Major Breakthrough",
    encoded(breakthroughCueOpusUrl, breakthroughCueUrl),
    35,
    15,
  ),
  "capability-tier": cue(
    "capability-tier",
    "Capability Tier Increased",
    encoded(capabilityCueOpusUrl, capabilityCueUrl),
    35,
    0,
  ),
  "safety-win": cue(
    "safety-win",
    "Safety Evidence Improved",
    encoded(safetyCueOpusUrl, safetyCueUrl),
    35,
    0,
  ),
  "fundraising-complete": cue(
    "fundraising-complete",
    "Fundraising Complete",
    encoded(fundraisingCueOpusUrl, fundraisingCueUrl),
    35,
    0,
  ),
  "researcher-joins": cue(
    "researcher-joins",
    "Researcher Joined",
    encoded(researcherJoinsCueOpusUrl, researcherJoinsCueUrl),
    35,
    5,
  ),
  "researcher-departs": cue(
    "researcher-departs",
    "Researcher Departed",
    encoded(researcherDepartsCueOpusUrl, researcherDepartsCueUrl),
    35,
    0,
  ),
  "rival-breakthrough": cue(
    "rival-breakthrough",
    "Rival Breakthrough",
    encoded(rivalCueOpusUrl, rivalCueUrl),
    55,
    60,
  ),
  "regulatory-attention": cue(
    "regulatory-attention",
    "Regulatory Attention",
    encoded(regulationCueOpusUrl, regulationCueUrl),
    55,
    60,
  ),
  "crisis-opened": cue(
    "crisis-opened",
    "Crisis Opened",
    encoded(crisisCueOpusUrl, crisisCueUrl),
    75,
    0,
  ),
  "containment-warning": cue(
    "containment-warning",
    "Containment Warning",
    encoded(containmentWarningCueOpusUrl, containmentWarningCueUrl),
    75,
    0,
  ),
  "coalition-proposed": cue(
    "coalition-proposed",
    "Coalition Proposed",
    encoded(coalitionProposedCueOpusUrl, coalitionProposedCueUrl),
    55,
    0,
  ),
  "coalition-formed": cue(
    "coalition-formed",
    "Coalition Formed",
    encoded(coalitionFormedCueOpusUrl, coalitionFormedCueUrl),
    90,
    0,
    true,
  ),
  "endgame-begins": cue(
    "endgame-begins",
    "Endgame Begins",
    encoded(endgameCueOpusUrl, endgameCueUrl),
    75,
    0,
  ),
  "race-won": cue(
    "race-won",
    "Race Won",
    encoded(raceWonCueOpusUrl, raceWonCueUrl),
    90,
    0,
    true,
  ),
  "race-lost": cue(
    "race-lost",
    "Race Lost",
    encoded(raceLostCueOpusUrl, raceLostCueUrl),
    90,
    0,
    true,
  ),
  nationalised: cue(
    "nationalised",
    "Lab Nationalised",
    encoded(nationalisedCueOpusUrl, nationalisedCueUrl),
    90,
    0,
    true,
  ),
  bankruptcy: cue(
    "bankruptcy",
    "Bankruptcy",
    encoded(bankruptcyCueOpusUrl, bankruptcyCueUrl),
    90,
    0,
    true,
  ),
  "containment-failure": cue(
    "containment-failure",
    "Containment Failure",
    encoded(containmentFailureCueOpusUrl, containmentFailureCueUrl),
    100,
    0,
    true,
  ),
  "score-milestone": cue(
    "score-milestone",
    "Score Milestone",
    encoded(scoreCueOpusUrl, scoreCueUrl),
    15,
    30,
  ),
};

export const ALL_AUDIO_ASSETS = [
  ...Object.values(MUSIC_ASSETS),
  ...Object.values(CUE_ASSETS),
] as const;

// Development-only browser decode fixture. This exposes URLs, never simulation state.
if (import.meta.env.DEV && typeof window !== "undefined") {
  Object.defineProperty(window, "__NEOLAB_AUDIO_TEST_ASSETS__", {
    configurable: true,
    value: ALL_AUDIO_ASSETS.map(({ id, url }) => ({ id, url })),
  });
}
