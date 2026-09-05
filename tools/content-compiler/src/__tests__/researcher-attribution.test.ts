import { describe, expect, it } from "vitest";

import { validateCompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../packages/content/generated/content.bundle.json";

function words(value: string): readonly string[] {
  return value.trim().split(/\s+/u).filter(Boolean);
}

function normalise(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const upper = sorted[midpoint];
  if (upper === undefined) throw new Error("Cannot take the median of an empty list");
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[midpoint - 1];
  if (lower === undefined) throw new Error("Missing lower median value");
  return (lower + upper) / 2;
}

function expectFactualBiography({
  biography,
  displayName,
  inspirationName,
}: {
  readonly biography: string;
  readonly displayName: string;
  readonly inspirationName: string;
}): void {
  const normalisedBiography = normalise(biography);
  const realName = normalise(inspirationName);
  expect(normalisedBiography, displayName).toContain(realName);

  const realNameTokens = new Set(realName.split(" "));
  for (const fictionalToken of normalise(displayName)
    .split(" ")
    .filter((token) => token.length > 1 && !realNameTokens.has(token))) {
    expect(
      ` ${normalisedBiography} `,
      `${displayName}'s factual biography contains fictional name token "${fictionalToken}"`,
    ).not.toContain(` ${fictionalToken} `);
  }

  expect(biography, displayName).not.toMatch(
    /\b(?:in Neolab|in-game|the (?:game|profile) (?:turns|translates|borrows)|fictional (?:profile|counterpart|specialist|builder|generalist|cartographer))\b/iu,
  );
}

describe("real-world researcher attribution", () => {
  const content = validateCompiledContent(rawBundle);
  const researchers = Object.values(content.researchers.definitions);
  const leaders = Object.values(content.leaders);

  it("requires a sourced, substantive inspiration summary for every profile", () => {
    expect(researchers).toHaveLength(119);
    expect(leaders).toHaveLength(5);

    for (const profile of [...leaders, ...researchers]) {
      expect(profile.inspirationName.trim(), profile.displayName).not.toHaveLength(0);
      expect(profile.inspirationSummary.trim(), profile.displayName).not.toHaveLength(0);
      expect(
        words(profile.inspirationSummary).length,
        profile.displayName,
      ).toBeGreaterThanOrEqual(10);
      expect(
        words(profile.inspirationSummary).length,
        profile.displayName,
      ).toBeLessThanOrEqual(45);
      const sources = "sources" in profile ? profile.sources : profile.sourceNotes;
      expect(sources.length, profile.displayName).toBeGreaterThan(0);
    }
  });

  it("keeps every factual biography on the real person and out of the game world", () => {
    for (const profile of [...leaders, ...researchers]) {
      expectFactualBiography(profile);
    }
  });

  it("keeps compact roster copy free of clunky fictional-profile framing", () => {
    for (const researcher of researchers) {
      expect(
        [researcher.epithet, researcher.role, researcher.rosterCardSummary].join(" "),
        researcher.displayName,
      ).not.toMatch(/\b(?:in-game|fictional (?:profile|counterpart))\b/iu);
    }
  });

  it("preserves the agreed researcher biography reading budget", () => {
    const biographyLengths = researchers.map(
      (researcher) => words(researcher.biography).length,
    );
    expect(Math.max(...biographyLengths)).toBeLessThanOrEqual(215);
    expect(median(biographyLengths)).toBeGreaterThanOrEqual(150);
    expect(median(biographyLengths)).toBeLessThanOrEqual(157);
  });

  it("keeps each launch leader's profile substantial but scannable", () => {
    for (const leader of leaders) {
      const biographyLength = words(leader.biography).length;
      const paragraphCount = leader.biography
        .split(/\n+/u)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean).length;
      expect(biographyLength, leader.displayName).toBeGreaterThanOrEqual(275);
      expect(biographyLength, leader.displayName).toBeLessThanOrEqual(400);
      expect(paragraphCount, leader.displayName).toBeLessThanOrEqual(2);
    }

    const demis = leaders.find((leader) => leader.inspirationName === "Demis Hassabis");
    expect(demis).toBeDefined();
    expect(demis?.biography.split(/\n+/u)[0]).toContain("2024 Nobel Prize in Chemistry");
  });
});
