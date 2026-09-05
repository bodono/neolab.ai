import type { AssetDefinition, CompiledContent } from "@neolab/content/browser";

const productionAssetUrls = import.meta.glob<string>(
  "../../../../design/production/**/*.{gif,png,svg,webp}",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

export interface ResolvedAsset {
  readonly definition: AssetDefinition;
  /** Vite-emitted URL with a content hash in production builds. */
  readonly url: string;
}

export function assetModuleKey(sourcePath: string): string {
  return `../../../../${sourcePath}`;
}

/**
 * Resolve a stable asset ID at the browser boundary. Simulation/content views
 * never receive a URL, and missing draft art remains an explicit fallback.
 */
export function resolveAsset(
  content: CompiledContent,
  assetId: string,
  modules: Readonly<Record<string, string>> = productionAssetUrls,
): ResolvedAsset | undefined {
  const definition = content.assets.definitions[assetId];
  if (definition === undefined) return undefined;
  const url = modules[assetModuleKey(definition.sourcePath)];
  return url === undefined || url.length === 0 ? undefined : { definition, url };
}
