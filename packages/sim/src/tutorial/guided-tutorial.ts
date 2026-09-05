import { contentId, type CompiledContent } from "@neolab/content-schema";

import type { DeepMutable } from "../engine/draft.ts";
import { assertInvariants } from "../engine/invariants.ts";
import { createProgressiveNewGame } from "../campaign/lab-maturity.ts";
import { deepFreeze } from "../engine/transaction.ts";
import type { GameState } from "../model/state.ts";
import { cashMillions, tick } from "../model/units.ts";
import { seed128 } from "../random/seed.ts";

export const GUIDED_TUTORIAL_FLAG = "tutorial:guided";

/**
 * The tutorial is a real run with a fixed opening, generous runway, and the
 * ambient simulation held quiet while the player learns the core model loop.
 */
export function createGuidedTutorialGame(content: CompiledContent): GameState {
  const state = structuredClone(
    createProgressiveNewGame(
      {
        seed: seed128("7a701a17a701a17a701a17a701a17a70"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        difficultyId: contentId("base:difficulty.standard"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
  ) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Tutorial player lab is missing");

  lab.flags[GUIDED_TUTORIAL_FLAG] = true;
  // The hidden guided mode owns its own step-by-step sequence. Keep its
  // literal garage setup, but do not stack the campaign's FC 5/10/20 chapter
  // gates on top of the older spotlight tutorial.
  delete lab.flags["campaign:progressive"];
  lab.finance.cash = cashMillions(Math.max(lab.finance.cash, 250));
  lab.aura.spendable = Math.max(lab.aura.spendable, 40);
  lab.aura.lifetime = Math.max(lab.aura.lifetime, lab.aura.spendable);
  // TutorialGuide owns the opening explanation. Avoid stacking the ordinary
  // garage chapter modal beneath it; later chapter unlocks still appear.
  state.presentationQueue = state.presentationQueue.filter(
    (item) => item.key !== "lab-maturity:garage",
  );

  // Both opportunity and mandatory collectors respect group cooldowns. Keep
  // authored events out of this short, controlled lesson.
  for (const definition of Object.values(content.events.definitions)) {
    state.world.eventCooldowns[definition.cooldown.group] = tick(10_000);
  }

  assertInvariants(state);
  return deepFreeze(state);
}

export function isGuidedTutorial(state: Readonly<GameState>): boolean {
  return state.labs[state.run.playerLabId]?.flags[GUIDED_TUTORIAL_FLAG] === true;
}
