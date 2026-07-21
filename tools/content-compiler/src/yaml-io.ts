import { readFileSync } from "node:fs";
import { isAlias, LineCounter, parseDocument } from "yaml";

export class ContentFileError extends Error {
  readonly filePath: string;
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(
    filePath: string,
    line: number | undefined,
    column: number | undefined,
    detail: string,
  ) {
    const location =
      line === undefined
        ? filePath
        : `${filePath}:${String(line)}:${String(column ?? 1)}`;
    super(`${location}: ${detail}`);
    this.name = "ContentFileError";
    this.filePath = filePath;
    this.line = line;
    this.column = column;
  }
}

/**
 * Parse one authored YAML file under the safety rules of TDD section 12.2:
 * YAML 1.2 core schema, unique keys, and no anchors/aliases or custom tags.
 * Returns the plain-data document as `unknown` for Zod validation.
 */
export function parseYamlFile(filePath: string): unknown {
  const source = readFileSync(filePath, "utf8");
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, {
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    lineCounter,
    keepSourceTokens: true,
  });

  const firstError = doc.errors[0];
  if (firstError !== undefined) {
    const pos = firstError.linePos?.[0];
    throw new ContentFileError(filePath, pos?.line, pos?.col, firstError.message);
  }
  const firstWarning = doc.warnings[0];
  if (firstWarning !== undefined) {
    const pos = firstWarning.linePos?.[0];
    throw new ContentFileError(filePath, pos?.line, pos?.col, firstWarning.message);
  }

  let aliasOffset: number | undefined;
  visitNodes(doc.contents, (node) => {
    if (isAlias(node) && aliasOffset === undefined) {
      aliasOffset = node.range?.[0];
    }
  });
  if (aliasOffset !== undefined) {
    const pos = lineCounter.linePos(aliasOffset);
    throw new ContentFileError(
      filePath,
      pos.line,
      pos.col,
      "YAML anchors/aliases are not allowed in content files (TDD 12.2).",
    );
  }

  return doc.toJS();
}

interface VisitableNode {
  readonly items?: readonly unknown[];
  readonly key?: unknown;
  readonly value?: unknown;
}

function visitNodes(root: unknown, visit: (node: unknown) => void): void {
  if (root === null || typeof root !== "object") {
    return;
  }
  visit(root);
  const node = root as VisitableNode;
  if (Array.isArray(node.items)) {
    for (const item of node.items) {
      visitNodes(item, visit);
    }
  }
  if (node.key !== undefined) {
    visitNodes(node.key, visit);
  }
  if (node.value !== undefined) {
    visitNodes(node.value, visit);
  }
}
