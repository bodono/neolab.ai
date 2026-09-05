import { expect, test, type Page } from "@playwright/test";

import { loadCompiledContent } from "@neolab/content";
import {
  advanceOneTick,
  applyCommand,
  createNewGame,
  createSaveEnvelope,
  loadSaveEnvelope,
  seed128,
  type GameCommand,
  type NewGameConfig,
  type ResearcherId,
} from "@neolab/sim/public";

const content = loadCompiledContent();

function retentionState(): ReturnType<typeof createNewGame> {
  let state = createNewGame(
    {
      seed: seed128("abcdef0123456789abcdef0123456789"),
      difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
      leaderId: "base:leader.thomas-hassabi" as NewGameConfig["leaderId"],
      mandateId: "base:mandate.build-the-science" as NewGameConfig["mandateId"],
    },
    content,
  );
  const resources = structuredClone(state) as unknown as {
    labs: Record<
      string,
      {
        finance: { cash: number };
        aura: { spendable: number; lifetime: number };
      }
    >;
    talentMarket: { visibleResearcherIds: string[] };
  };
  const playerLab = resources.labs[state.run.playerLabId];
  if (playerLab === undefined) throw new Error("Retention fixture lab missing");
  playerLab.finance.cash = 1_000;
  playerLab.aura.spendable = 100;
  playerLab.aura.lifetime = 100;
  resources.talentMarket.visibleResearcherIds = content.researchers.orderedIds.slice(
    0,
    5,
  );
  state = revalidate(resources as unknown as ReturnType<typeof createNewGame>);

  const researcherDefinitionId = content.researchers.orderedIds[0];
  if (researcherDefinitionId === undefined)
    throw new Error("Retention fixture researcher missing");
  const researcherId = researcherDefinitionId as unknown as ResearcherId;
  state = applyCommand(state, content, {
    kind: "recruit-researcher",
    meta: {
      commandId: "command:retention-e2e:hire",
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    researcherId,
  } as unknown as GameCommand).state;
  state = advanceOneTick(state, content).state;

  const fixture = structuredClone(state) as unknown as {
    labs: Record<string, { control: "player" | "rival"; definitionId: string }>;
    researchers: Record<
      string,
      {
        poaching?: {
          id: string;
          rivalLabId: string;
          stage: "counteroffer";
          signalledAt: number;
          counterofferAt: number;
          resolvesAt: number;
          rivalOfferStrength: number;
          playerRetentionStrength: number;
        };
      }
    >;
    run: { tick: number; autoPauseReasons: string[] };
    presentationQueue: unknown[];
  };
  const rival = Object.entries(fixture.labs).find(([, lab]) => lab.control === "rival");
  const researcher = fixture.researchers[researcherId];
  if (rival === undefined || researcher === undefined) {
    throw new Error("Retention fixture world missing");
  }
  researcher.poaching = {
    id: "run:people:e2e-retention",
    rivalLabId: rival[0],
    stage: "counteroffer",
    signalledAt: fixture.run.tick - 1,
    counterofferAt: fixture.run.tick,
    resolvesAt: fixture.run.tick + 3,
    rivalOfferStrength: 60,
    playerRetentionStrength: 0,
  };
  fixture.run.autoPauseReasons = ["resignation-ultimatum"];
  fixture.presentationQueue = [];
  return revalidate(fixture as unknown as ReturnType<typeof createNewGame>);
}

function revalidate(state: ReturnType<typeof createNewGame>) {
  return loadSaveEnvelope(
    createSaveEnvelope(state, {
      saveId: "people-retention-fixture",
      slotType: "manual",
      displayName: "Retention Fixture",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-24T00:00:00.000Z",
    }),
  ).state;
}

async function importState(
  page: Page,
  state: ReturnType<typeof createNewGame>,
): Promise<void> {
  const envelope = createSaveEnvelope(state, {
    saveId: "people-retention-fixture",
    slotType: "manual",
    displayName: "Retention Fixture",
    contentHash: content.manifest.bundleHash,
    nowIso: "2026-07-24T00:00:00.000Z",
  });
  await page.goto("/?campaign=classic");
  await page.locator('input[type="file"]').setInputFiles({
    name: "people-retention.neolab-save.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await page.getByRole("button", { name: "Continue" }).click();
}

test("the Lab feed preserves a rival approach and opens its retention response", async ({
  page,
}) => {
  // Importing a full save envelope through the file input is slow enough on
  // WebKit under Linux to exhaust the thirty-second default, which made this
  // test flaky on the weekly three-engine run.
  test.slow();
  await importState(page, retentionState());

  const feed = page.getByLabel("Recent lab activity");
  await expect(feed).toContainText("COUNTER-OFFER");
  await expect(feed).toContainText(/is recruiting .+/i);
  await expect(feed).toContainText("No retention offer submitted");
  await expect(feed).toContainText("3 weeks remaining");
  await feed.getByRole("button", { name: "Review counter-offer" }).click();

  const dossier = page.getByRole("dialog");
  await expect(dossier).toContainText("FORMAL OFFER REPORTED");
  await expect(dossier).toContainText(/is recruiting .+/i);
  await expect(dossier).toContainText("resolves in 3 weeks");
  await expect(dossier).toContainText("a researcher can be steady");
  await expect(dossier).toContainText("No retention offer submitted");
  await expect(dossier).toContainText(/Annual market review [+-]\d+%/);
  await dossier
    .getByRole("button", { name: /^Offer \$[\d.]+M$/ })
    .first()
    .click();
  await expect(dossier).toContainText("Immediate reassurance recorded");
});
