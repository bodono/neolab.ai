import type { ResearchProgramView } from "@neolab/sim/public";

export const RESEARCH_PROGRESS_ESTIMATE_RANGES: Readonly<
  Record<ResearchProgramView["momentumLabel"], readonly [number, number]>
> = {
  Unfunded: [0, 8],
  Speculative: [12, 36],
  Promising: [34, 62],
  "Hot trail": [58, 86],
  "Breakthrough imminent": [82, 98],
};

export interface ResearchLevelProgressPresentation {
  readonly estimateRange: readonly [minimum: number, maximum: number];
  readonly label: string;
  readonly compactLabel: string;
  readonly ariaValueText: string;
  readonly complete: boolean;
}

/**
 * Describes only the intentionally uncertain, player-facing estimate. Exact
 * within-level research points remain canonical and never enter GameView.
 */
export function researchLevelProgressPresentation(
  level: number,
  momentumLabel: ResearchProgramView["momentumLabel"],
): ResearchLevelProgressPresentation {
  const safeLevel = Math.min(100, Math.max(0, level));
  if (safeLevel >= 100) {
    return {
      estimateRange: [0, 100],
      label: "Maximum level",
      compactLabel: "Maximum level",
      ariaValueText: "Level 100; maximum programme level",
      complete: true,
    };
  }

  const estimateRange = RESEARCH_PROGRESS_ESTIMATE_RANGES[momentumLabel];
  const nextLevel = Math.min(100, Math.floor(safeLevel) + 1);
  const [minimum, maximum] = estimateRange;
  const label = `${String(minimum)}–${String(maximum)}% estimated toward Level ${String(nextLevel)}`;

  return {
    estimateRange,
    label,
    compactLabel: `Est. ${String(minimum)}–${String(maximum)}% → L${String(nextLevel)}`,
    ariaValueText: `Level ${String(Math.floor(safeLevel))}; estimated ${String(minimum)} to ${String(maximum)} percent toward Level ${String(nextLevel)}`,
    complete: false,
  };
}
