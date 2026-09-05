import type { EventTokenValue } from "../model/state.ts";

export type EventMessageTokens = Readonly<Record<string, EventTokenValue>>;

function matchingBrace(source: string, openAt: number): number {
  let depth = 0;
  for (let index = openAt; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Event message contains an unmatched opening brace");
}

function splitTopLevel(source: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    else if (source[index] === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function requireToken(tokens: EventMessageTokens, key: string): EventTokenValue {
  const value = tokens[key];
  if (value === undefined) throw new Error(`Event message is missing token ${key}`);
  return value;
}

function pluralCases(source: string): Readonly<Record<string, string>> {
  const cases: Record<string, string> = {};
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    const keyStart = cursor;
    while (cursor < source.length && !/\s|\{/.test(source[cursor] ?? "")) {
      cursor += 1;
    }
    const key = source.slice(keyStart, cursor);
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (key.length === 0 || source[cursor] !== "{") {
      throw new Error("Malformed ICU plural case");
    }
    const closeAt = matchingBrace(source, cursor);
    cases[key] = source.slice(cursor + 1, closeAt);
    cursor = closeAt + 1;
  }
  if (cases["other"] === undefined) {
    throw new Error("ICU plural expressions require an other case");
  }
  return cases;
}

function formatExpression(
  expression: string,
  tokens: EventMessageTokens,
  locale: string,
): string {
  const parts = splitTopLevel(expression);
  const key = parts[0] ?? "";
  if (key.length === 0) throw new Error("Event message contains an empty token");
  const value = requireToken(tokens, key);
  if (parts.length === 1) return String(value);
  const kind = parts[1];
  if (kind === "number") {
    if (typeof value !== "number") {
      throw new Error(`Event message token ${key} must be numeric`);
    }
    return new Intl.NumberFormat(locale).format(value);
  }
  if (kind === "plural") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Event message plural token ${key} must be numeric`);
    }
    const cases = pluralCases(parts.slice(2).join(","));
    const exact = cases[`=${String(value)}`];
    const category = new Intl.PluralRules(locale).select(value);
    const selected = exact ?? cases[category] ?? cases["other"];
    if (selected === undefined) throw new Error("ICU plural selection failed");
    const count = new Intl.NumberFormat(locale).format(value);
    return formatSegment(selected, tokens, locale).replaceAll("#", count);
  }
  throw new Error(`Unsupported event message formatter ${String(kind)}`);
}

function formatSegment(
  template: string,
  tokens: EventMessageTokens,
  locale: string,
): string {
  let output = "";
  let cursor = 0;
  while (cursor < template.length) {
    const openAt = template.indexOf("{", cursor);
    const strayCloseAt = template.indexOf("}", cursor);
    if (strayCloseAt !== -1 && (openAt === -1 || strayCloseAt < openAt)) {
      throw new Error("Event message contains an unmatched closing brace");
    }
    if (openAt === -1) {
      output += template.slice(cursor);
      break;
    }
    output += template.slice(cursor, openAt);
    const closeAt = matchingBrace(template, openAt);
    output += formatExpression(template.slice(openAt + 1, closeAt), tokens, locale);
    cursor = closeAt + 1;
  }
  return output;
}

/**
 * Deliberately small ICU-style formatter for plain event copy.
 *
 * Supported forms are `{TOKEN}`, `{COUNT, number}`, and ICU plural blocks.
 * HTML is not a message feature; presentation applies its own closed semantic
 * marks later, so authored tags are rejected instead of injected into the DOM.
 */
export function formatEventMessage(
  template: string,
  tokens: EventMessageTokens,
  locale = "en-GB",
): string {
  if (/<\/?[A-Za-z][^>]*>/.test(template)) {
    throw new Error("Event messages cannot contain raw HTML");
  }
  return formatSegment(template, tokens, locale);
}
