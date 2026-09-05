import type {
  CompiledContent,
  PaperDefinition,
  ResearcherDefinition,
} from "@neolab/content-schema";

export interface RealPaperCitation {
  readonly paperId: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly publicationYear: number;
  readonly venue?: string;
  readonly primarySourceUrl: string;
}

export interface ResearcherPaperCredit {
  readonly definitionId: string;
  readonly displayName: string;
  readonly inspirationName: string;
}

export interface ResearcherPaperLinkIndex {
  readonly papersByResearcherDefinitionId: Readonly<
    Record<string, readonly RealPaperCitation[]>
  >;
  readonly researchersByPaperId: Readonly<
    Record<string, readonly ResearcherPaperCredit[]>
  >;
}

function nameTokens(name: string): readonly string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
}

/**
 * Explicit identity-equivalent author-name forms found in the cited paper
 * catalogue. Keeping this list narrow avoids turning attribution into fuzzy
 * matching while covering documented short names and bibliography ordering.
 */
const PERSON_ATTRIBUTION_ALIASES: Readonly<Record<string, string>> = {
  "aidan n gomez": "aidan gomez",
  "chris olah": "christopher olah",
  "christopher d manning": "christopher manning",
  "elizabeth barnes": "beth barnes",
  "elizabeth beth barnes": "beth barnes",
  "geoffrey e hinton": "geoffrey hinton",
  "ian j goodfellow": "ian goodfellow",
  "jeffrey dean": "jeff dean",
  "john m jumper": "john jumper",
  "li fei fei": "fei fei li",
  "paul f christiano": "paul christiano",
  "quoc le": "quoc v le",
  "tom b brown": "tom brown",
};

/**
 * Real-paper attribution compares the complete canonical name. A deliberately
 * small set of catalogued author-name variants handles known initials and short
 * names without fuzzy matching, transliteration guesses, inferred name
 * changes, or first/family-name collisions.
 */
export function personAttributionKey(name: string): string | undefined {
  const normalizedName = nameTokens(name).join(" ");
  const canonicalName = PERSON_ATTRIBUTION_ALIASES[normalizedName] ?? normalizedName;
  const tokens = canonicalName.split(" ");
  const first = tokens[0];
  const family = tokens.at(-1);
  if (first === undefined || family === undefined || first === family) return undefined;
  return canonicalName;
}

function realPaperCitation(paper: PaperDefinition): RealPaperCitation | undefined {
  if (
    paper.historicity !== "real" ||
    paper.publicationYear === undefined ||
    paper.primarySourceUrl === undefined
  ) {
    return undefined;
  }
  return {
    paperId: paper.id,
    title: paper.title,
    authors: [...paper.authors],
    publicationYear: paper.publicationYear,
    ...(paper.venue === undefined ? {} : { venue: paper.venue }),
    primarySourceUrl: paper.primarySourceUrl,
  };
}

function researcherCredit(researcher: ResearcherDefinition): ResearcherPaperCredit {
  return {
    definitionId: researcher.id,
    displayName: researcher.displayName,
    inspirationName: researcher.inspirationName,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildResearcherPaperLinkIndex(
  content: CompiledContent,
): ResearcherPaperLinkIndex {
  const researchersByName = new Map<string, ResearcherDefinition[]>();
  for (const researcher of Object.values(content.researchers.definitions)) {
    const key = personAttributionKey(researcher.inspirationName);
    if (key === undefined) continue;
    const matches = researchersByName.get(key) ?? [];
    matches.push(researcher);
    researchersByName.set(key, matches);
  }

  const papersByResearcherDefinitionId: Record<string, RealPaperCitation[]> = {};
  const researchersByPaperId: Record<string, ResearcherPaperCredit[]> = {};
  const papers = Object.values(content.papers.definitions).sort(
    (left, right) => left.gameOrder - right.gameOrder || (left.id < right.id ? -1 : 1),
  );

  for (const paper of papers) {
    const citation = realPaperCitation(paper);
    if (citation === undefined) continue;
    const creditedDefinitionIds = new Set<string>();
    for (const author of paper.authors) {
      const key = personAttributionKey(author);
      if (key === undefined) continue;
      const matches = researchersByName.get(key) ?? [];
      // Duplicate canonical identities are ambiguous. Omitting the credit is
      // safer than publishing an authorship claim about the wrong person.
      if (matches.length !== 1) continue;
      const researcher = matches[0];
      if (researcher === undefined || creditedDefinitionIds.has(researcher.id)) continue;
      creditedDefinitionIds.add(researcher.id);
      (papersByResearcherDefinitionId[researcher.id] ??= []).push(citation);
      (researchersByPaperId[paper.id] ??= []).push(researcherCredit(researcher));
    }
  }

  for (const credits of Object.values(researchersByPaperId)) {
    credits.sort(
      (left, right) =>
        compareText(left.inspirationName, right.inspirationName) ||
        compareText(left.definitionId, right.definitionId),
    );
  }

  return {
    papersByResearcherDefinitionId,
    researchersByPaperId,
  };
}
