import type { CommandPreview } from "@neolab/sim/public";

export type MarketAllocationPreview = NonNullable<
  CommandPreview["gpuAllocationConsequences"]
>;
