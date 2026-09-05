import type { Brand } from "./brand.ts";

/**
 * Namespaced, immutable content identifier (TDD section 5.3), for example
 * `base:leader.thomas_hassabi` or `base:event.ai.root_access_request`.
 *
 * IDs are never reused and renaming display copy never changes an ID.
 */
export type ContentId = Brand<string, "ContentId">;

const CONTENT_ID_PATTERN = /^[a-z0-9-]+:[a-z0-9._-]+$/;

export function isContentId(value: string): value is ContentId {
  return CONTENT_ID_PATTERN.test(value);
}

export function contentId(value: string): ContentId {
  if (!isContentId(value)) {
    throw new RangeError(
      `Invalid content ID "${value}": expected "<namespace>:<dotted.name>" ` +
        `using lower-case letters, digits, ".", "_", and "-".`,
    );
  }
  return value;
}
