import { describe, expect, it } from "vitest";

import {
  imminentResearcherPromiseWarnings,
  liveAmbientNotice,
  newestAmbientBurst,
} from "./activity-notice-policy.ts";

describe("activity notice policy", () => {
  it("selects the complete newest ambient burst", () => {
    expect(
      newestAmbientBurst([
        { tick: 3, summary: "Older colour", category: "ambient" },
        { tick: 5, summary: "Fresh colour one", category: "ambient" },
        { tick: 5, summary: "A real decision", category: "event-resolved" },
        { tick: 5, summary: "Fresh colour two", category: "ambient" },
      ]),
    ).toEqual({
      tick: 5,
      items: [
        {
          entry: { tick: 5, summary: "Fresh colour one", category: "ambient" },
          key: "5:Fresh colour one",
        },
        {
          entry: { tick: 5, summary: "Fresh colour two", category: "ambient" },
          key: "5:Fresh colour two",
        },
      ],
    });
  });

  it("does not turn non-ambient log entries into colour notices", () => {
    expect(
      newestAmbientBurst([
        { tick: 4, summary: "A real decision", category: "event-resolved" },
      ]),
    ).toBeUndefined();
  });

  it("surfaces researcher reactions beside ambient colour in the same burst", () => {
    // A reaction responds to the week's real events, so it must reach the
    // side lane exactly like ambient colour does, not only the lab feed.
    expect(
      newestAmbientBurst([
        { tick: 3, summary: "Older colour", category: "ambient" },
        { tick: 6, summary: "Kingman: “The loss is noisy.”", category: "reaction" },
        { tick: 6, summary: "Fresh colour", category: "ambient" },
      ]),
    ).toEqual({
      tick: 6,
      items: [
        {
          entry: {
            tick: 6,
            summary: "Kingman: “The loss is noisy.”",
            category: "reaction",
          },
          key: "6:Kingman: “The loss is noisy.”",
        },
        {
          entry: { tick: 6, summary: "Fresh colour", category: "ambient" },
          key: "6:Fresh colour",
        },
      ],
    });
    expect(
      liveAmbientNotice(
        [{ tick: 6, summary: "Kingman: “The loss is noisy.”", category: "reaction" }],
        new Set(),
        6,
        8,
      )?.entry.category,
    ).toBe("reaction");
  });

  it("advances within a same-week burst without falling back to an older week", () => {
    const entries = [
      { tick: 3, summary: "Older colour", category: "ambient" },
      { tick: 5, summary: "Fresh colour one", category: "ambient" },
      { tick: 5, summary: "Fresh colour two", category: "ambient" },
    ];

    expect(
      liveAmbientNotice(entries, new Set(["5:Fresh colour one"]), 5, 8),
    ).toMatchObject({ key: "5:Fresh colour two" });
    expect(
      liveAmbientNotice(
        entries,
        new Set(["5:Fresh colour one", "5:Fresh colour two"]),
        5,
        8,
      ),
    ).toBeUndefined();
  });

  it("does not replay a burst after its freshness window", () => {
    expect(
      liveAmbientNotice(
        [{ tick: 5, summary: "Old colour", category: "ambient" }],
        new Set(),
        14,
        8,
      ),
    ).toBeUndefined();
  });

  it("lets an already-started burst finish at high simulation speed", () => {
    expect(
      liveAmbientNotice(
        [
          { tick: 5, summary: "Fresh colour one", category: "ambient" },
          { tick: 5, summary: "Fresh colour two", category: "ambient" },
        ],
        new Set(["5:Fresh colour one"]),
        20,
        8,
        5,
      ),
    ).toMatchObject({ key: "5:Fresh colour two" });
  });

  it("warns once a pending researcher promise is within two weeks", () => {
    expect(
      imminentResearcherPromiseWarnings(
        [
          {
            researcherId: "researcher:one",
            displayName: "Ada Example",
            compact: { label: "Review What Matters" },
            compactStatus: "warning",
            compactReview: { includedInOffer: true, reviewInWeeks: 2 },
            promises: [
              {
                id: "promise:soon",
                label: "Protect the quarterly review",
                status: "pending",
                dueAtTick: 11,
              },
              {
                id: "promise:later",
                label: "This should stay quiet",
                status: "pending",
                dueAtTick: 13,
              },
            ],
          },
        ],
        10,
      ),
    ).toEqual([
      {
        key: "promise:researcher:one:promise:soon:11",
        researcherId: "researcher:one",
        researcherName: "Ada Example",
        promiseLabel: "Protect the quarterly review",
        weeksRemaining: 1,
      },
      {
        key: "compact:researcher:one:12",
        researcherId: "researcher:one",
        researcherName: "Ada Example",
        promiseLabel: "Review What Matters",
        weeksRemaining: 2,
      },
    ]);
  });

  it("does not warn for fulfilled, broken, or more distant promises", () => {
    expect(
      imminentResearcherPromiseWarnings(
        [
          {
            researcherId: "researcher:fulfilled",
            displayName: "Grace Example",
            compact: { label: "Already Met" },
            compactStatus: "fulfilled",
            compactReview: { includedInOffer: true, reviewInWeeks: 1 },
            promises: [
              {
                id: "promise:broken",
                label: "Already broken",
                status: "broken",
                dueAtTick: 11,
              },
              {
                id: "promise:distant",
                label: "Still has time",
                status: "pending",
                dueAtTick: 13,
              },
            ],
          },
        ],
        10,
      ),
    ).toEqual([]);
  });

  it("keeps a compact warning key stable as its deadline approaches", () => {
    const researcher = {
      researcherId: "researcher:stable",
      displayName: "Katherine Example",
      compact: { label: "Stable Deadline" },
      compactStatus: "warning" as const,
      compactReview: { includedInOffer: true, reviewInWeeks: 2 },
      promises: [],
    };
    const first = imminentResearcherPromiseWarnings([researcher], 20);
    const second = imminentResearcherPromiseWarnings(
      [
        {
          ...researcher,
          compactReview: { includedInOffer: true, reviewInWeeks: 1 },
        },
      ],
      21,
    );

    expect(first[0]?.key).toBe("compact:researcher:stable:22");
    expect(second[0]?.key).toBe(first[0]?.key);
  });
});
