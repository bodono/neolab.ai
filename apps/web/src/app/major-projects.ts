import type { GameView } from "@neolab/sim/public";

export function majorProjectWillQueue(view: GameView, requiredSlots = 1): boolean {
  return view.facilities.capacity.availableMajorProjectSlots < requiredSlots;
}

export function majorProjectActionLabel(
  view: GameView,
  immediateLabel: string,
  queuedLabel: string,
  requiredSlots = 1,
): string {
  return majorProjectWillQueue(view, requiredSlots) ? queuedLabel : immediateLabel;
}
