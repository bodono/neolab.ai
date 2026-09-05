import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GameView } from "@neolab/sim/public";

import type { MarketAllocationPreview } from "../compute/market-allocation-preview.ts";
import { MarketPanel } from "./market-panel.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const view = {
  market: {
    marketSharePercentage: 32.44,
    servingCapacityTeraflops: 0,
    requestedTeraflops: 35_900,
    deliveredTeraflops: 0,
    projectedRevenueMillionsPerCycle: 0,
    projectedServingAuraPerCycle: 0,
    projectedServingFulfilment: 0,
    segments: [
      {
        segmentId: "segment.consumers",
        displayName: "Consumers",
        unlocked: true,
        headlineWeightPercentage: 45,
        satisfaction: 21,
        marketSharePercentage: 33.6,
        requestedTeraflops: 22_000,
        deliveredTeraflops: 0,
        valuePerDeliveredFlopMultiplier: 1.01,
        projectedRevenueMillionsPerCycle: 0,
        appeal: {
          capability: 5,
          productQuality: 29,
          reliability: 37,
          governmentTrust: 0,
          weights: {
            capability: 0.65,
            productQuality: 0.2,
            reliability: 0.15,
            governmentTrust: 0,
          },
          accessPenalty: 0,
          incidentPenalty: 0,
          final: 31,
        },
      },
      {
        segmentId: "base:segment.government",
        displayName: "Government",
        unlocked: true,
        headlineWeightPercentage: 15,
        satisfaction: 60,
        marketSharePercentage: 12,
        requestedTeraflops: 0,
        deliveredTeraflops: 0,
        valuePerDeliveredFlopMultiplier: 1,
        projectedRevenueMillionsPerCycle: 0,
        appeal: {
          capability: 5,
          productQuality: 29,
          reliability: 37,
          governmentTrust: 62,
          weights: {
            capability: 0.35,
            productQuality: 0.05,
            reliability: 0.1,
            governmentTrust: 0.5,
          },
          accessPenalty: 0,
          incidentPenalty: 0,
          final: 38,
        },
      },
    ],
  },
} as unknown as GameView;

function preview(
  deliveredTeraflops: number,
  projectedRevenueMillionsPerCycle: number,
): MarketAllocationPreview {
  return {
    netMillionsPerCycle: -3,
    servingCapacityTeraflops: deliveredTeraflops,
    requestedTeraflops: 35_900,
    deliveredTeraflops,
    unmetTeraflops: 35_900 - deliveredTeraflops,
    projectedRevenueMillionsPerCycle,
    projectedServingAuraPerCycle:
      deliveredTeraflops >= 0.9 * 35_900 ? 2 : deliveredTeraflops >= 0.5 * 35_900 ? 1 : 0,
    projectedServingFulfilment: deliveredTeraflops / 35_900,
    segments: [
      {
        segmentId: "segment.consumers",
        requestedTeraflops: 22_000,
        deliveredTeraflops,
        projectedRevenueMillionsPerCycle,
      },
    ],
  };
}

describe("live market allocation preview", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("shows sub-million revenue and refreshes with the proposed allocation", () => {
    act(() =>
      root.render(<MarketPanel view={view} allocationPreview={preview(4_000, 0.42)} />),
    );

    expect(mount.textContent).toContain("$420k");
    expect(mount.textContent).toContain("4.00 PFLOP/s");
    expect(mount.textContent).toContain("18% served · 4.00 PFLOP/s of 22.0 PFLOP/s");
    expect(mount.textContent).not.toContain("appeal 50 = capability");
    expect(mount.textContent).toContain("Projected cycle fulfilment11% → 0 Aura");
    expect(mount.textContent).toContain("Serving now: 11%");

    act(() =>
      root.render(<MarketPanel view={view} allocationPreview={preview(8_000, 0.84)} />),
    );

    expect(mount.textContent).toContain("$840k");
    expect(mount.textContent).toContain("8.00 PFLOP/s");
    expect(mount.textContent).toContain("Projected cycle fulfilment22% → 0 Aura");
    expect(mount.textContent).toContain("Serving now: 22%");
  });

  it("distinguishes current serving from projected cycle fulfilment", () => {
    const allocation = {
      ...preview(35_900, 1.2),
      projectedServingAuraPerCycle: 1,
      projectedServingFulfilment: 0.88,
    };

    act(() => root.render(<MarketPanel view={view} allocationPreview={allocation} />));

    expect(mount.textContent).toContain("Serving now: 100%");
    expect(mount.textContent).toContain("Projected cycle fulfilment88% → +1 Aura");
  });

  it("keeps segment formulas in a compact market-share disclosure", () => {
    act(() => root.render(<MarketPanel view={view} />));

    const help = mount.querySelector<HTMLDetailsElement>(".mechanic-help");
    expect(help?.querySelector("summary")?.getAttribute("aria-label")).toBe(
      "Explain Market share breakdown",
    );
    expect(help?.textContent).toContain(
      "Consumers: Capability 65% · Product quality 20% · Reliability 15%.",
    );
    expect(help?.textContent).toContain(
      "Government: Government Trust 50% · Capability 35% · Reliability 10% · Product quality 5%.",
    );
    expect(help?.textContent).toContain(
      "Government Trust also unlocks Government demand at 45.",
    );
  });
});
