import type { BrowserPostRunAudit } from "../../runtime/index.ts";

export type EndingAftermathTimeline = BrowserPostRunAudit["ending"]["aftermathTimeline"];

/**
 * Endings created by the current simulation always include a timeline. During
 * development, however, an already-running browser can briefly retain an audit
 * projected by the pre-timeline module after Fast Refresh. Keep the completed
 * run readable in that transitional state instead of crashing the whole shell.
 */
export function safeEndingAftermathTimeline(
  timeline: EndingAftermathTimeline | undefined,
): EndingAftermathTimeline {
  return timeline ?? [];
}
