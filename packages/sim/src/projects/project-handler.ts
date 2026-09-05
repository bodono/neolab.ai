import type { CompiledContent } from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import type { GameState, ProjectKind, ProjectState } from "../model/state.ts";

export interface ProjectHandler<K extends ProjectKind = ProjectKind> {
  readonly kind: K;
  /**
   * Some authorised projects have an execution dependency even after they
   * enter the shared queue. Returning false keeps the project queued without
   * consuming a major-project slot until that dependency is satisfied.
   */
  canActivate?(
    state: Readonly<GameState>,
    content: CompiledContent,
    project: ProjectState,
  ): boolean;
  advance(
    tx: SimulationTransaction,
    content: CompiledContent,
    project: ProjectState,
  ): void;
  complete(
    tx: SimulationTransaction,
    content: CompiledContent,
    project: ProjectState,
  ): void;
  cancel(tx: SimulationTransaction, project: ProjectState): void;
}
