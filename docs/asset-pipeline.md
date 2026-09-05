# Visual asset pipeline

This is the implementation contract for TDD §22.3. It exists independently of the final art-direction choice: the manifest and resolver are ready, while the production catalogue remains deliberately empty and `draft`.

## Source layout

- Manifest: `design/assets/manifest.yaml`
- Production source files: `design/production/`
- Compiled definitions: `CompiledContent.assets`
- Browser resolver: `apps/web/src/assets/asset-registry.ts`

The source path in every manifest entry is repository-relative and uses `/`. Absolute paths, `..`, missing files, unsupported extensions, duplicate IDs, and unknown manifest fields fail compilation. Supported visual formats are PNG, WebP, SVG, and GIF.

## Required metadata

Every entry declares:

- a stable asset ID;
- kind (`portrait`, `facility`, `icon`, `event-card`, `campus`, or `ui`);
- source path and intended pixel dimensions;
- scale policy (`integer-pixel`, `contain`, `cover`, or `native`);
- either meaningful alt text or an exact decorative declaration;
- copyright holder, licence, source notes, and optional source URL.

Portraits additionally require the stable subject ID and whether the image is a fictionalized real person, fictional person, or institutional composite. Release validation checks researcher portrait references, rejects decorative portraits, and rejects subject or alt-text disagreement.

The compiler records a SHA-256 of every source file in the compiled bundle. An invalid entry always fails, even while the manifest is a draft.

## Draft and final behaviour

During art production, `status: draft` permits content to refer to not-yet-produced assets. The deterministic content report lists all missing and unreferenced IDs under `assetAnalysis`; it does not silently invent an image or URL.

Before art completion, change the asset manifest to `status: final`. At that point every referenced researcher portrait must resolve. A final content catalogue also requires a final asset manifest. Missing or contradictory art becomes release-blocking.

The current empty draft is intentional. Do not mark S9.1 complete until the user has selected an art treatment and the reviewed production batch is present.

## Browser build boundary

Simulation and content projections carry stable asset IDs only. The browser registry resolves an ID through the compiled definition and a Vite `import.meta.glob` rooted at `design/production/`.

Vite therefore imports source files into the module graph and emits content-hashed filenames for production builds. Content never stores those generated URLs. Unknown IDs and files absent from a draft return `undefined`, allowing the existing text/pixel fallback to remain visible during production.

## Adding an asset

1. Put the reviewed source file under `design/production/`.
2. Add one strict entry to `design/assets/manifest.yaml`.
3. Use the existing stable content asset ID; never paste a source path into gameplay code.
4. Run `pnpm content:build`, `pnpm content:check`, `pnpm test`, and `pnpm --filter @neolab/web build`.
5. Inspect `packages/content/generated/content-report.json` and reduce `assetAnalysis.missingReferences`.
6. Confirm attribution/licence and portrayal review before changing the manifest to `final`.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
