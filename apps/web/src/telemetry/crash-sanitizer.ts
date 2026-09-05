import type { RuntimeFault } from "../runtime/browser-game-runtime.ts";
import { weekBucket } from "./analytics-events.ts";

export interface SanitizedRuntimeFault {
  readonly fault_kind: string;
  readonly fault_scope: string;
  readonly fault_code: string;
  readonly error_class: string;
  readonly fault_fingerprint: string;
  readonly top_app_frame: string;
  readonly week_bucket: string;
}

const SAFE_ERROR_CLASSES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
]);

export function sanitizeRuntimeFault(
  fault: RuntimeFault,
  error: unknown,
): SanitizedRuntimeFault {
  const errorClass =
    error instanceof Error && SAFE_ERROR_CLASSES.has(error.name)
      ? error.name
      : "OtherError";
  const frames = error instanceof Error ? safeApplicationFrames(error.stack) : [];
  const topFrame = frames[0] ?? "unknown";
  const fingerprintSource = [
    fault.kind,
    fault.scope,
    fault.code,
    errorClass,
    ...frames.slice(0, 4),
  ].join("|");
  return {
    fault_kind: fault.kind,
    fault_scope: fault.scope,
    fault_code: fault.code,
    error_class: errorClass,
    fault_fingerprint: fnv1a(fingerprintSource),
    top_app_frame: topFrame,
    week_bucket: weekBucket(fault.tick),
  };
}

function safeApplicationFrames(stack: string | undefined): string[] {
  if (stack === undefined) return [];
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const match = line.match(
      /(?:apps\/web\/src|packages\/sim\/src|\/src)\/([a-zA-Z0-9_./-]+)\.[cm]?[jt]sx?(?::\d+){0,2}/,
    );
    if (match?.[1] === undefined) continue;
    frames.push(match[1].replaceAll(/\/+/g, "/").slice(0, 100));
  }
  return [...new Set(frames)];
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
