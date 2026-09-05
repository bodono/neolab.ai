import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";

import { FacilityPixelIcon } from "./facility-pixel-icon.tsx";

const content = loadBrowserCompiledContent();
const facilities = Object.values(content.facilities);

function visualSignature(facility: (typeof facilities)[number]): string {
  const markup = renderToStaticMarkup(
    createElement(FacilityPixelIcon, {
      family: facility.family,
      displayName: facility.displayName,
      tier: facility.tier,
      variantId: facility.id,
    }),
  );
  const glyph = /<g class="facility-glyph"[^>]*>(.*)<\/g><rect y="59"/s.exec(markup)?.[1];
  if (glyph === undefined) throw new Error(`Missing glyph for ${facility.id}`);
  // Colours are not enough to make two pictures distinct. This signature
  // deliberately compares their geometry and element structure instead.
  return glyph
    .replaceAll(/#[0-9a-f]{6}/gi, "#colour")
    .replaceAll(/fill="[^"#][^"]*"/g, 'fill="colour"')
    .replaceAll(/stroke="[^"#][^"]*"/g, 'stroke="colour"');
}

describe("FacilityPixelIcon", () => {
  it("gives every commissioned facility definition distinct building art", () => {
    const bySignature = new Map<string, string[]>();
    for (const facility of facilities) {
      const signature = visualSignature(facility);
      const ids = bySignature.get(signature) ?? [];
      ids.push(facility.id);
      bySignature.set(signature, ids);
    }

    expect([...bySignature.values()].filter((ids) => ids.length > 1)).toEqual([]);
  });

  it("makes the Basilica more architecturally elaborate than the Gigawatt Complex", () => {
    const gigawatt = content.facilities["base:facility.data-centre-4"];
    const basilica = content.facilities["base:facility.data-centre-5"];
    if (gigawatt === undefined || basilica === undefined) {
      throw new Error("Late datacentre definitions missing");
    }

    expect(visualSignature(basilica).length).toBeGreaterThan(
      visualSignature(gigawatt).length,
    );
  });
});
