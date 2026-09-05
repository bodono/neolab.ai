import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../generated/content.bundle.json";

export type { AssetDefinition, CompiledContent } from "@neolab/content-schema";

let cached: CompiledContent | undefined;

/** Statically bundled, browser-safe content loader (no filesystem APIs). */
export function loadBrowserCompiledContent(): CompiledContent {
  cached ??= validateCompiledContent(rawBundle);
  return cached;
}
