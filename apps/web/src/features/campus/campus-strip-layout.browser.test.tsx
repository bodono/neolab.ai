/**
 * The campus scene is a positioned box whose children are all absolutely
 * placed, so nothing about its intrinsic size keeps it open: only the CSS
 * height rule does, and only while the scene itself stays in normal flow. A
 * page-level script once text-matched the scene as a "star researcher card"
 * (one building, one star, a short label) and set it position:absolute; the
 * map collapsed to header + cues + legend and the illustration vanished from
 * Chapter 04 onward, exactly when the first star arrives. The earlier CSS-only
 * fix and its profile-fixture e2e never loaded that script, so they passed
 * while the real page broke. These cases mount real projected states under the
 * real stylesheet inside the real container and assert the box stays in flow.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";
import {
  applyCommand,
  createNewGame,
  createProgressiveNewGame,
  projectGameView,
  seed128,
  type CampusView,
  type GameCommand,
  type NewGameConfig,
  type PlayerKnowledgeContext,
} from "@neolab/sim/public";

import "../../styles/game.css";
import { CampusStrip } from "./campus-strip.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The public API names no state type; derive it the way the runtime does. */
type CanonicalGameState = ReturnType<typeof createNewGame>;

const content = loadBrowserCompiledContent();
const config: NewGameConfig = {
  seed: seed128("3a8c17d4ab1950ff3a8c17d4ab1950ff"),
  difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
  leaderId: "base:leader.sam-altmann" as NewGameConfig["leaderId"],
  mandateId: "base:mandate.build-the-science" as NewGameConfig["mandateId"],
};

/** Mirrors the runtime's own context so the projection is the one players get. */
function knowledgeContext(state: CanonicalGameState): PlayerKnowledgeContext {
  const lab = state.labs[state.run.playerLabId];
  const models = (lab?.models.modelIds ?? []).flatMap((modelId) => {
    const model = state.models[modelId];
    return model === undefined ? [] : [model];
  });
  return {
    viewerLabId: state.run.playerLabId,
    intelligenceRatings: {},
    evidenceAccess: {
      evaluationIds: models.flatMap((model) => model.evaluations),
      anomalyIds: models.flatMap((model) => model.anomalies),
    },
  };
}

function campusOf(state: CanonicalGameState): CampusView {
  return projectGameView(state, content, knowledgeContext(state)).campus;
}

/** A campaign state pushed to a later chapter by its maturity flag. */
function progressiveStateAt(stage: string): CanonicalGameState {
  const state = structuredClone(createProgressiveNewGame(config, content));
  // The state type is readonly by design; mutate through a narrow structural view.
  const mutable = state as unknown as {
    run: { playerLabId: string };
    labs: Record<string, { flags: Record<string, unknown> } | undefined>;
  };
  const lab = mutable.labs[mutable.run.playerLabId];
  if (lab === undefined) throw new Error("progressive fixture is missing its lab");
  lab.flags["campaign:lab-maturity-stage"] = stage;
  return state;
}

/** A funded lab that has commissioned the chapter-four and chapter-nine buildings. */
function builtOutState(): CanonicalGameState {
  let state = structuredClone(createNewGame(config, content));
  const mutable = state as unknown as {
    run: { playerLabId: string };
    labs: Record<
      string,
      | { finance: { cash: number }; aura: { spendable: number; lifetime: number } }
      | undefined
    >;
  };
  const lab = mutable.labs[mutable.run.playerLabId];
  if (lab === undefined) throw new Error("built-out fixture is missing its lab");
  lab.finance.cash = 10_000;
  lab.aura.spendable = 5_000;
  lab.aura.lifetime = 5_000;
  for (const definitionId of [
    "base:facility.headquarters-1",
    "base:facility.power-and-cooling-1",
    "base:facility.press-office",
  ]) {
    const command = {
      kind: "start-facility-construction",
      meta: {
        commandId: `command:campus-layout:${definitionId}`,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      definitionId,
    } as unknown as GameCommand;
    state = applyCommand(state, content, command).state;
  }
  return state;
}

/** The exact shape of the reported screenshot: one building, one star, paused. */
const firstStarCampus: CampusView = {
  facilities: [
    {
      facilityId: "run:facility:player:0000",
      definitionId: "base:facility.your-parents-garage",
      displayName: "Your Parents' Garage",
      family: "headquarters",
      tier: 0,
      campusModule: "garage",
      operational: true,
      loadState: "active",
      loadBasisPoints: 5_000,
      loadLabel: "Operational",
      namedResearcherIds: ["base:researcher.jan-liker"],
    },
  ],
  construction: [],
  namedPeople: [
    {
      researcherId: "base:researcher.jan-liker",
      displayName: "Jan Liker",
      portraitAssetId: "portrait.researcher.jan-liker",
      portraitAltText: "Portrait of Jan Liker",
      assignmentLabel: "Lead · Capability programme",
      locationModule: "garage",
    },
  ],
  sceneCues: [],
  decorativeStaffCount: 2,
  overflowFacilityCount: 1,
};

describe("campus strip layout under the real stylesheet", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function expectSceneInFlow(label: string, campus: CampusView, paused: boolean): void {
    act(() =>
      root.render(
        <div className="facilities-workspace">
          <CampusStrip campus={campus} dateLabel="2013 · WEEK 5" paused={paused} />
        </div>,
      ),
    );
    const scene = mount.querySelector<HTMLElement>(".campus-map-scene");
    const map = mount.querySelector<HTMLElement>(".campus-map");
    expect(scene, `${label}: scene must be rendered`).not.toBeNull();
    expect(map, `${label}: map must be rendered`).not.toBeNull();
    const sceneHeight = scene!.getBoundingClientRect().height;
    expect(
      getComputedStyle(scene!).position,
      `${label}: scene must stay in flow`,
    ).not.toBe("absolute");
    expect(sceneHeight, `${label}: scene must keep its box`).toBeGreaterThanOrEqual(520);
    expect(
      map!.getBoundingClientRect().height,
      `${label}: map must contain the scene`,
    ).toBeGreaterThan(sceneHeight);
  }

  it("keeps the scene box for the first-star campus while paused", () => {
    expectSceneInFlow("first star, paused", firstStarCampus, true);
  });

  it("keeps the scene box for the first-star campus while live", () => {
    expectSceneInFlow("first star, live", firstStarCampus, false);
  });

  it("keeps the scene box for a fresh progressive campaign", () => {
    expectSceneInFlow("garage", campusOf(progressiveStateAt("garage")), true);
  });

  it("keeps the scene box for a campaign pushed to Chapter 09", () => {
    expectSceneInFlow("institution", campusOf(progressiveStateAt("institution")), true);
  });

  it("keeps the scene box for a built-out lab", () => {
    expectSceneInFlow("built out", campusOf(builtOutState()), true);
  });
});
