import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const maximumVisibleLiteralLength = 180;
const maximumEventMessageLength = 180;

function tsxFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

function visibleLiterals(file: string): readonly string[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const literals: string[] = [];
  const visit = (node: ts.Node): void => {
    const text = ts.isStringLiteralLike(node)
      ? node.text
      : ts.isJsxText(node)
        ? node.getText(sourceFile).replaceAll(/\s+/g, " ").trim()
        : undefined;
    // Ignore identifiers, class lists, and other machine strings. Player copy
    // contains words separated by spaces and at least one lower-case letter.
    if (text !== undefined && /[a-z].*\s|\s.*[a-z]/.test(text)) literals.push(text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

describe("player-facing copy density", () => {
  it("keeps main UI and popup literals compact", () => {
    const roots = [
      `${repositoryRoot}/apps/web/src/features`,
      `${repositoryRoot}/apps/web/src/screens`,
    ];
    const exemptFiles = new Set([
      // These are deliberately opened reference/legal documents, not the live game UI.
      `${repositoryRoot}/apps/web/src/features/help/how-to-play-dialog.tsx`,
      `${repositoryRoot}/apps/web/src/screens/title-screen.tsx`,
      `${repositoryRoot}/apps/web/src/features/developer/development-inspector.tsx`,
    ]);
    const violations = roots
      .flatMap(tsxFiles)
      .filter((file) => !exemptFiles.has(file))
      .flatMap((file) =>
        visibleLiterals(file)
          .filter((text) => text.length > maximumVisibleLiteralLength)
          .map(
            (text) =>
              `${file.replace(`${repositoryRoot}/`, "")}: ${String(text.length)} characters — ${text}`,
          ),
      );

    expect(violations).toEqual([]);
  });

  it("keeps authored event messages compact", () => {
    const bundle = JSON.parse(
      readFileSync(
        `${repositoryRoot}/packages/content/generated/content.bundle.json`,
        "utf8",
      ),
    ) as { readonly copy: { readonly messages: Record<string, string> } };
    const violations = Object.entries(bundle.copy.messages)
      .filter(([, message]) => message.length > maximumEventMessageLength)
      .map(([key, message]) => `${key}: ${String(message.length)} characters`);

    expect(violations).toEqual([]);
  });
});
