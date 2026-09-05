import { describe, expect, it } from "vitest";

import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import {
  buildResearcherPaperLinkIndex,
  personAttributionKey,
} from "../researcher-paper-links.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

describe("real researcher-paper attribution", () => {
  it("normalises diacritics and curated name variants without fuzzy matching", () => {
    expect(personAttributionKey("Karén Simonyan")).toBe(
      personAttributionKey("Karen Simonyan"),
    );
    expect(personAttributionKey("Aidan Gomez")).toBe(
      personAttributionKey("Aidan N. Gomez"),
    );
    expect(personAttributionKey("Christopher Manning")).toBe(
      personAttributionKey("Christopher D. Manning"),
    );
    expect(personAttributionKey("Alec Radford")).not.toBe(
      personAttributionKey("Alex Krizhevsky"),
    );
    expect(personAttributionKey("Noam Brown")).not.toBe(
      personAttributionKey("Noah Brown"),
    );
    expect(personAttributionKey("Elizabeth Barnes")).toBe(
      personAttributionKey("Beth Barnes"),
    );
    expect(personAttributionKey("Elizabeth (Beth) Barnes")).toBe(
      personAttributionKey("Beth Barnes"),
    );
    expect(personAttributionKey("Ada Augusta Byron")).not.toBe(
      personAttributionKey("Ada King Byron"),
    );
    expect(personAttributionKey("Michael I. Jordan")).not.toBe(
      personAttributionKey("Michael B. Jordan"),
    );
  });

  it("derives cited real papers in both directions from authored names", () => {
    const index = buildResearcherPaperLinkIndex(content);
    const alec = index.papersByResearcherDefinitionId["base:researcher.alec-broadford"];
    expect(alec).toHaveLength(8);
    expect(alec?.every((paper) => paper.primarySourceUrl.startsWith("http"))).toBe(true);

    const clipCredits =
      index.researchersByPaperId["base:paper.clip-language-supervised-vision"];
    expect(clipCredits).toContainEqual({
      definitionId: "base:researcher.alec-broadford",
      displayName: "Alec Broadford",
      inspirationName: "Alec Radford",
    });
  });

  it("handles documented author-name variants and leaves non-matches absent", () => {
    const index = buildResearcherPaperLinkIndex(content);
    expect(
      index.papersByResearcherDefinitionId["base:researcher.aidan-gomes"],
    ).toHaveLength(1);
    expect(
      index.papersByResearcherDefinitionId["base:researcher.christopher-mannering"],
    ).toHaveLength(2);
    expect(
      index.papersByResearcherDefinitionId["base:researcher.katie-bowmann"],
    ).toBeUndefined();
    expect(
      index.papersByResearcherDefinitionId["base:researcher.christopher-olin"],
    ).toHaveLength(8);
    expect(
      index.papersByResearcherDefinitionId["base:researcher.geoff-deen"],
    ).toHaveLength(4);
    expect(
      index.papersByResearcherDefinitionId["base:researcher.faye-faye-lee"],
    ).toHaveLength(1);
    expect(
      index.papersByResearcherDefinitionId["base:researcher.bess-barnes"],
    ).toHaveLength(1);
  });

  it("matches the current authored catalogue without ambiguous duplicate credits", () => {
    const index = buildResearcherPaperLinkIndex(content);
    expect(Object.keys(index.papersByResearcherDefinitionId)).toHaveLength(73);
    expect(
      Object.values(index.papersByResearcherDefinitionId).reduce(
        (total, papers) => total + papers.length,
        0,
      ),
    ).toBe(221);
  });
});
