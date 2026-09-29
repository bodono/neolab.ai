import type { ResearchProgramView } from "@neolab/sim/public";

export interface ResearchLevelProgressPresentation {
  readonly estimateRange: readonly [minimum: number, maximum: number];
  readonly label: string;
  readonly compactLabel: string;
  readonly ariaValueText: string;
  readonly complete: boolean;
}

/**
 * Describes the coarse, player-facing band of real progress toward the next
 * level. Exact within-level research points remain canonical and never enter
 * GameView.
 */
export function researchLevelProgressPresentation(
  level: number,
  progressBand: ResearchProgramView["levelProgressBand"],
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

  const nextLevel = Math.min(100, Math.floor(safeLevel) + 1);
  const [minimum, maximum] = progressBand;
  const label = `${String(minimum)}–${String(maximum)}% of the way to Level ${String(nextLevel)}`;

  return {
    estimateRange: progressBand,
    label,
    compactLabel: `${String(minimum)}–${String(maximum)}% → L${String(nextLevel)}`,
    ariaValueText: `Level ${String(Math.floor(safeLevel))}; ${String(minimum)} to ${String(maximum)} percent of the way to Level ${String(nextLevel)}`,
    complete: false,
  };
}
