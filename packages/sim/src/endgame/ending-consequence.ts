/**
 * Human consequence of an ending, separate from its scoring class.
 *
 * `EndingClass` answers whether a run is a full, qualified, survival, or loss
 * result. This registry answers what happened to humanity. Keeping the two
 * concepts separate lets presentation and audio distinguish insolvency from
 * loss of human control and extinction without changing score semantics.
 */
export type EndingConsequence =
  "ordinary" | "contained-control-loss" | "catastrophic-control-loss" | "extinction";

const ENDING_CONSEQUENCE_BY_ID = Object.freeze({
  "base:ending.the-broadly-shared-future": "ordinary",
  "base:ending.the-stewardship-compact": "ordinary",
  "base:ending.a-cautious-golden-age": "ordinary",
  "base:ending.move-fast-and-somehow-nobody-died": "ordinary",
  "base:ending.the-lab-that-ate-the-world": "ordinary",
  "base:ending.miracle-terms-and-conditions-apply": "ordinary",
  "base:ending.the-caretaker": "ordinary",
  "base:ending.false-dawn": "ordinary",
  "base:ending.the-long-pause": "ordinary",
  "base:ending.rival-ascendance": "ordinary",
  "base:ending.the-door-opened-elsewhere": "catastrophic-control-loss",
  "base:ending.nationalised-future": "ordinary",
  "base:ending.mission-accomplished-by-the-board": "ordinary",
  "base:ending.the-worlds-most-expensive-insolvency": "ordinary",
  "base:ending.emergency-shutdown": "contained-control-loss",
  "base:ending.no-one-holds-the-off-switch": "catastrophic-control-loss",
  "base:ending.the-last-human-veto": "catastrophic-control-loss",
  "base:ending.the-objective-was-satisfied": "catastrophic-control-loss",
  "base:ending.a-war-measured-in-milliseconds": "catastrophic-control-loss",
  "base:ending.the-replication-threshold": "catastrophic-control-loss",
  "base:ending.the-last-experiment": "catastrophic-control-loss",
  "base:ending.there-is-no-one-left-to-read-this": "extinction",
  "base:ending.the-incubation-window": "extinction",
  "base:ending.the-final-command-chain": "extinction",
  "base:ending.the-grey-horizon": "extinction",
  "base:ending.the-empty-patrol": "extinction",
  "base:ending.the-tomb-atmosphere": "extinction",
  "base:ending.every-side-was-certain": "extinction",
} satisfies Readonly<Record<string, EndingConsequence>>);

export function isCanonicalEndingId(endingId: string): boolean {
  return Object.hasOwn(ENDING_CONSEQUENCE_BY_ID, endingId);
}

/**
 * Canonical catalogue construction uses the strict lookup so adding an ending
 * without deliberately classifying its human consequence fails immediately.
 */
export function canonicalEndingConsequenceForId(endingId: string): EndingConsequence {
  const consequence = (
    ENDING_CONSEQUENCE_BY_ID as Readonly<Record<string, EndingConsequence>>
  )[endingId];
  if (consequence === undefined) {
    throw new Error(`No canonical ending consequence for ${endingId}`);
  }
  return consequence;
}

/**
 * Unknown or legacy ending IDs are treated as ordinary. The canonical
 * catalogue asserts its own entries during construction, while this tolerant
 * public helper keeps an old save from crashing solely because presentation
 * does not recognise a retired ending.
 */
export function endingConsequenceForId(endingId: string): EndingConsequence {
  return (
    (ENDING_CONSEQUENCE_BY_ID as Readonly<Record<string, EndingConsequence>>)[endingId] ??
    "ordinary"
  );
}
