import type { GameState } from "../model/state.ts";
import type { LabId, ProjectId } from "../model/ids.ts";

const OPEN_PROJECT_STATUSES = new Set(["queued", "active", "paused"]);

/** Ordinary training already authorised when the player reaches nomination. */
export function inFlightOrdinaryTrainingProjectIds(
  state: Readonly<GameState>,
  labId: LabId,
): readonly ProjectId[] {
  const lab = state.labs[labId];
  if (lab === undefined) return [];
  return lab.projects.projectIds.filter((projectId) => {
    const project = state.projects[projectId];
    return (
      project?.payload.kind === "training" && OPEN_PROJECT_STATUSES.has(project.status)
    );
  });
}

/**
 * Formal nomination commits the lab to one exact artifact. Crisis remediation
 * remains available through its own project type; this gate covers only
 * ordinary successor training.
 */
export function deploymentCrisisBlocksOrdinaryTraining(
  state: Readonly<GameState>,
  labId: LabId,
): boolean {
  return (
    labId === state.run.playerLabId &&
    state.endgame.stage !== "inactive" &&
    state.endgame.stage !== "candidate-activation" &&
    state.endgame.stage !== "recovery"
  );
}
