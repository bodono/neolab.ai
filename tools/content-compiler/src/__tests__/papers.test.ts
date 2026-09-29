import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateCompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../packages/content/generated/content.bundle.json";
import { compileContent } from "../compile.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function invalidPaperRepo(mutate: (source: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), "neolab-paper-content-"));
  temporaryRoots.push(root);
  cpSync(join(process.cwd(), "content"), join(root, "content"), { recursive: true });
  cpSync(join(process.cwd(), "design", "assets"), join(root, "design", "assets"), {
    recursive: true,
  });
  const paperPath = join(root, "content", "research", "papers-a.yaml");
  writeFileSync(paperPath, mutate(readFileSync(paperPath, "utf8")));
  return root;
}

describe("paper compiler rejection paths", () => {
  it("rejects domain weights that do not sum to one", () => {
    const root = invalidPaperRepo((source) =>
      source.replace("domain.architectures: 0.45", "domain.architectures: 0.40"),
    );
    expect(() => compileContent(root)).toThrow(/domain weights sum/);
  });

  it("rejects an unflagged prerequisite cycle", () => {
    // Backpropagation is the root of the graph and LeNet already depends on it,
    // so making backpropagation depend on LeNet closes a loop. The mutation is
    // asserted rather than assumed: this fixture previously targeted a literal
    // that content had since edited away, so the replace silently became a
    // no-op and the test failed for having changed nothing at all.
    const root = invalidPaperRepo((source) => {
      const before =
        "prerequisites:\n      domainLevels:\n        domain.optimisation-scaling: 3";
      expect(source).toContain(before);
      return source.replace(
        before,
        "prerequisites:\n      papers: [paper.lenet-document-recognition]\n      domainLevels:\n        domain.optimisation-scaling: 3",
      );
    });
    expect(() => compileContent(root)).toThrow(/prerequisite cycle/);
  });

  it("rejects real/future factual metadata mismatches", () => {
    const root = invalidPaperRepo((source) =>
      source.replace("historicity: real", "historicity: fictional-future"),
    );
    expect(() => compileContent(root)).toThrow(
      /fictional paper must omit factual-source fields/,
    );
  });
});

describe("paper catalogue accuracy guards", () => {
  // Real people are credited on these cards, so mistakes in who wrote what
  // are the errors most worth preventing mechanically.
  const catalogue = validateCompiledContent(rawBundle).papers.definitions;

  it("lists every author once and never a placeholder", () => {
    const problems: string[] = [];
    for (const paper of Object.values(catalogue)) {
      const seen = new Set<string>();
      for (const author of paper.authors) {
        if (/^(and others|et al\.?|others)$/i.test(author.trim())) {
          problems.push(`${paper.id}: placeholder author "${author}"`);
        }
        if (seen.has(author)) problems.push(`${paper.id}: duplicate author ${author}`);
        seen.add(author);
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps hyphenated words intact across wrapped YAML lines", () => {
    const broken: string[] = [];
    const visit = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        for (const match of value.matchAll(/\b[A-Za-z]+- [a-z][A-Za-z]*/g)) {
          broken.push(`${path}: "${match[0]}"`);
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${String(index)}]`));
      } else if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
      }
    };
    for (const paper of Object.values(catalogue)) visit(paper, paper.id);
    expect(broken).toEqual([]);
  });
});
