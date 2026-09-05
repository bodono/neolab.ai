import type { CompiledContent } from "@neolab/content-schema";

import type { GameState, ProsperityProgrammeId } from "../model/state.ts";
import { deriveProsperityProgrammes } from "../prosperity/prosperity.ts";

export interface ProsperityProgrammeView {
  readonly id: ProsperityProgrammeId;
  readonly displayName: string;
  readonly shortName: string;
  readonly description: string;
  readonly unlocked: boolean;
  readonly readiness: number;
  readonly readinessLabel: string;
  readonly status:
    | "locked"
    | "early-preparation"
    | "pilot-prepared"
    | "demonstration-ready"
    | "strong-outcome-ready";
  readonly statusLabel: string;
  readonly contributions: readonly {
    readonly id: "research" | "facilities" | "experts" | "discoveries" | "validation";
    readonly label: string;
    readonly amount: number;
    readonly sources: readonly string[];
  }[];
}

export interface ProsperityView {
  readonly programmes: readonly ProsperityProgrammeView[];
  readonly bestProgrammeId: ProsperityProgrammeId;
  readonly bestReadiness: number;
}

function statusFor(
  readiness: number,
  unlocked: boolean,
): {
  readonly status: ProsperityProgrammeView["status"];
  readonly label: string;
} {
  if (!unlocked) return { status: "locked", label: "Opens in the scaling phase" };
  if (readiness < 45) return { status: "early-preparation", label: "Early preparation" };
  if (readiness < 60) return { status: "pilot-prepared", label: "Pilot prepared" };
  if (readiness < 80)
    return { status: "demonstration-ready", label: "Demonstration ready" };
  return { status: "strong-outcome-ready", label: "Strong outcome ready" };
}

export function projectProsperityView(
  state: Readonly<GameState>,
  content: CompiledContent,
): ProsperityView {
  const crisisValidation =
    state.endgame.stage === "inactive" || state.endgame.stage === "candidate-activation"
      ? 0
      : state.endgame.evidence.prosperityReadinessBonus;
  const programmes = deriveProsperityProgrammes(state, content, crisisValidation).map(
    (programme): ProsperityProgrammeView => {
      const status = statusFor(programme.readiness, programme.unlocked);
      return {
        id: programme.id,
        displayName: programme.displayName,
        shortName: programme.shortName,
        description: programme.description,
        unlocked: programme.unlocked,
        readiness: programme.readiness,
        readinessLabel: `${String(programme.readiness)} / 100`,
        status: status.status,
        statusLabel: status.label,
        contributions: [
          {
            id: "research",
            label: "Research",
            amount: programme.research,
            sources: [],
          },
          {
            id: "facilities",
            label: "Facilities",
            amount: programme.facilities,
            sources: programme.facilitySources.map((source) => source.label),
          },
          {
            id: "experts",
            label: "Domain experts",
            amount: programme.experts,
            sources: programme.expertSources.map((source) => source.label),
          },
          {
            id: "discoveries",
            label: "Discoveries",
            amount: programme.discoveries,
            sources: programme.discoverySources.map((source) => source.label),
          },
          ...(programme.crisisValidation <= 0
            ? []
            : [
                {
                  id: "validation" as const,
                  label: "Crisis validation",
                  amount: programme.crisisValidation,
                  sources: ["Prosperity simulation evidence"],
                },
              ]),
        ],
      };
    },
  );
  const best =
    [...programmes]
      .filter((programme) => programme.unlocked)
      .sort((left, right) => right.readiness - left.readiness)[0] ?? programmes[0];
  if (best === undefined) throw new Error("Prosperity programme registry is empty");
  return {
    programmes,
    bestProgrammeId: best.id,
    bestReadiness: best.readiness,
  };
}
