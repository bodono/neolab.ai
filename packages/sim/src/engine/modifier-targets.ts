import { MODIFIER_TARGET_LIST } from "@neolab/content-schema";

/**
 * Closed modifier-target registry (TDD section 11.2). The single source of
 * truth lives in @neolab/content-schema so the content compiler and the
 * runtime can never drift apart.
 */
export const MODIFIER_TARGETS: ReadonlySet<string> = new Set(MODIFIER_TARGET_LIST);

export function isModifierTarget(target: string): boolean {
  return MODIFIER_TARGETS.has(target);
}
