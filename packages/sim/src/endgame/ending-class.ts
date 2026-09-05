import type { ContentId } from "@neolab/content-schema";

export type EndingClass = "full" | "qualified" | "survival" | "loss";

/**
 * Mechanical class for every canonical GDD §44.16 ending.
 *
 * This tiny registry is deliberately copy-free: the ending catalogue owns
 * player-facing prose, while scoring can depend on this module without
 * creating a score ↔ ending-resolution import cycle.
 */
const ENDING_CLASS_BY_ID: Readonly<Record<string, EndingClass>> = Object.freeze({
  "base:ending.the-broadly-shared-future": "full",
  "base:ending.the-stewardship-compact": "full",
  "base:ending.a-cautious-golden-age": "full",
  "base:ending.move-fast-and-somehow-nobody-died": "qualified",
  "base:ending.the-lab-that-ate-the-world": "qualified",
  "base:ending.miracle-terms-and-conditions-apply": "qualified",
  "base:ending.the-caretaker": "survival",
  "base:ending.false-dawn": "survival",
  "base:ending.the-long-pause": "survival",
  "base:ending.rival-ascendance": "loss",
  "base:ending.the-door-opened-elsewhere": "loss",
  "base:ending.nationalised-future": "loss",
  "base:ending.mission-accomplished-by-the-board": "loss",
  "base:ending.the-worlds-most-expensive-insolvency": "loss",
  "base:ending.emergency-shutdown": "loss",
  "base:ending.no-one-holds-the-off-switch": "loss",
  "base:ending.the-last-human-veto": "loss",
  "base:ending.the-objective-was-satisfied": "loss",
  "base:ending.a-war-measured-in-milliseconds": "loss",
  "base:ending.the-replication-threshold": "loss",
  "base:ending.the-last-experiment": "loss",
  "base:ending.there-is-no-one-left-to-read-this": "loss",
  "base:ending.the-incubation-window": "loss",
  "base:ending.the-final-command-chain": "loss",
  "base:ending.the-grey-horizon": "loss",
  "base:ending.the-empty-patrol": "loss",
  "base:ending.the-tomb-atmosphere": "loss",
  "base:ending.every-side-was-certain": "loss",
});

export function endingClassForId(endingId: ContentId): EndingClass {
  const endingClass = ENDING_CLASS_BY_ID[endingId];
  if (endingClass === undefined) {
    throw new Error(`No canonical ending class for ${endingId}`);
  }
  return endingClass;
}
