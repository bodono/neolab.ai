import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";

import {
  facilitiesUnlockedByHardware,
  GpuGenerationDialog,
} from "./gpu-generation-dialog.tsx";

const content = loadBrowserCompiledContent();

describe("GpuGenerationDialog", () => {
  it("announces the facility tier unlocked by Rubin hardware", () => {
    const facilities = facilitiesUnlockedByHardware(content, "base:gpu.rubin");
    expect(facilities.length).toBeGreaterThan(0);
    const markup = renderToStaticMarkup(
      createElement(GpuGenerationDialog, {
        generationId: "base:gpu.rubin",
        content,
        onContinue: vi.fn(),
        onOpenProcurement: vi.fn(),
        onOpenFacilities: vi.fn(),
      }),
    );
    expect(markup).toContain("FACILITIES // NEW TIER UNLOCKED");
    expect(markup).toContain("Open facilities");
    for (const facility of facilities) expect(markup).toContain(facility);
  });

  it("announces the facility tier unlocked by Markov hardware", () => {
    expect(
      facilitiesUnlockedByHardware(content, "base:gpu.markov").length,
    ).toBeGreaterThan(0);
  });
});
