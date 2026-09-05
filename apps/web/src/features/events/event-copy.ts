import { useGameSession } from "../../app/runtime-provider.tsx";

import {
  eventCopyFallback,
  type EventCopyRole,
  type EventCopyTokens,
} from "./decision-event-formatters.ts";

export type { EventCopyRole, EventCopyTokens } from "./decision-event-formatters.ts";

/**
 * Resolve an authored message key against the compiled copy catalogue,
 * interpolating `{TOKEN}` placeholders. Unknown keys fall back to the
 * humanised-key renderer so a missing catalogue entry degrades to a readable
 * label rather than a crash or a raw dotted key.
 */
export function resolveEventCopy(
  messages: Readonly<Record<string, string>>,
  key: string,
  tokens: EventCopyTokens,
  role: EventCopyRole,
): string {
  const template = messages[key];
  if (template === undefined) return eventCopyFallback(key, tokens, role);
  let rendered = template;
  for (const [token, value] of Object.entries(tokens)) {
    rendered = rendered.replaceAll(`{${token}}`, String(value));
  }
  return rendered;
}

export function useEventCopy(): (
  key: string,
  tokens: EventCopyTokens,
  role: EventCopyRole,
) => string {
  const { content } = useGameSession();
  const messages = content.copy?.messages ?? {};
  return (key, tokens, role) => resolveEventCopy(messages, key, tokens, role);
}
