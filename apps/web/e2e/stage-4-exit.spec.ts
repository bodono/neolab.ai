import { expect, test } from "@playwright/test";

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

function revalidate(state: ReturnType<typeof createNewGame>) {
  return loadSaveEnvelope(
    createSaveEnvelope(state, {
      saveId: "stage-4-exit-fixture",
      slotType: "manual",
      displayName: "Stage 4 Acceptance Lab",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-23T00:00:00.000Z",
    }),
  ).state;
}

function acceptanceState(): ReturnType<typeof createNewGame> {
  let state = createNewGame(
    {
      seed: seed128("fedcba9876543210fedcba9876543210"),
      difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
      leaderId: "base:leader.sam-altmann" as NewGameConfig["leaderId"],
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
  };
  const lab = resources.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Stage 4 fixture player lab is missing");
  lab.finance.cash = 10_000;
  lab.aura.spendable = 5_000;
  lab.aura.lifetime = 5_000;
  state = revalidate(resources as unknown as ReturnType<typeof createNewGame>);

  for (const definitionId of [
    "base:facility.headquarters-1",
    "base:facility.power-and-cooling-1",
    "base:facility.press-office",
  ]) {
    const before = state.labs[state.run.playerLabId]?.facilities.instances.length ?? 0;
    state = applyCommand(state, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: `command:stage-4-exit:${definitionId}`,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      definitionId,
    } as unknown as GameCommand).state;
    for (let week = 0; week < 30; week += 1) {
      if (
        (state.labs[state.run.playerLabId]?.facilities.instances.length ?? 0) > before
      ) {
        break;
      }
      state = advanceOneTick(state, content).state;
    }
    if ((state.labs[state.run.playerLabId]?.facilities.instances.length ?? 0) <= before) {
      throw new Error(`Stage 4 fixture did not complete ${definitionId}`);
    }
  }

  const market = structuredClone(state) as unknown as {
    talentMarket: { visibleResearcherIds: string[] };
  };
  market.talentMarket.visibleResearcherIds = content.researchers.orderedIds.slice(0, 8);
  state = revalidate(market as unknown as ReturnType<typeof createNewGame>);

  for (const researcherDefinitionId of content.researchers.orderedIds) {
    if ((state.labs[state.run.playerLabId]?.roster.researcherIds.length ?? 0) >= 3) {
      break;
    }
    const researcherId = researcherDefinitionId as unknown as ResearcherId;
    if (!state.talentMarket.visibleResearcherIds.includes(researcherId)) continue;
    state = applyCommand(state, content, {
      kind: "recruit-researcher",
      meta: {
        commandId: `command:stage-4-exit:hire:${researcherId}`,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      researcherId,
    } as unknown as GameCommand).state;
  }
  if ((state.labs[state.run.playerLabId]?.roster.researcherIds.length ?? 0) !== 3) {
    throw new Error("Stage 4 fixture could not recruit a full foundation roster");
  }
  if ((state.labs[state.run.playerLabId]?.facilities.instances.length ?? 0) !== 5) {
    throw new Error("Stage 4 fixture does not contain five completed facilities");
  }
  const isolated = structuredClone(state) as unknown as {
    presentationQueue: unknown[];
    run: { autoPauseReasons: unknown[] };
  };
  // Construction advances the real five-lab world and can queue unrelated rival
  // capability notices. This acceptance scenario isolates people and facilities.
  isolated.presentationQueue = [];
  isolated.run.autoPauseReasons = [];
  return revalidate(isolated as unknown as ReturnType<typeof createNewGame>);
}

test("a full roster and facility construction remain operable from the UI", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const state = acceptanceState();
  const envelope = createSaveEnvelope(state, {
    saveId: "stage-4-exit-fixture",
    slotType: "manual",
    displayName: "Stage 4 Acceptance Lab",
    contentHash: content.manifest.bundleHash,
    nowIso: "2026-07-23T00:00:00.000Z",
  });

  await page.goto("/?campaign=classic");
  await page.locator('input[type="file"]').setInputFiles({
    name: "stage-4-acceptance.neolab-save.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await expect(page.getByText("Imported Stage 4 Acceptance Lab.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("3 occupied · 3/8 slots unlocked")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Inspect / })).toHaveCount(3);
  const pendingEvent = page.locator('[data-testid="decision-event-decision"]');
  if (await pendingEvent.isVisible()) {
    await page.getByRole("button", { name: /Decide later/ }).click();
    await expect(pendingEvent).toBeHidden();
  }

  await page.getByRole("button", { name: "People" }).click();
  const capacity = page.locator(".people-capacity-summary");
  await expect(capacity).toContainText("On payroll");
  await expect(capacity).toContainText("3");

  await page
    .getByRole("button", { name: /^(Assign researcher|Inspect \/ reassign)$/ })
    .first()
    .click();
  const assignment = page.getByLabel(/^Assignment for /);
  const secondAssignment = await assignment
    .locator("option")
    .nth(1)
    .getAttribute("value");
  if (secondAssignment === null) throw new Error("No reassignment option is available");
  await assignment.selectOption(secondAssignment);
  await page
    .getByRole("button", { name: /^(Confirm assignment|Apply reassignment)$/ })
    .click();
  await expect(page.locator(".people-notice[role='status']")).toBeVisible();
  await page.getByRole("button", { name: "Close researcher dossier" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Facilities & campus" }).click();
  await expect(page.getByRole("heading", { name: "Completed facilities" })).toHaveCount(
    0,
  );
  await expect(page.locator(".project-list > article")).toHaveCount(0);

  const campusCard = page
    .locator(".facility-catalogue > article")
    .filter({ has: page.getByRole("heading", { name: "Research Campus I" }) });
  const campusDefinition = content.facilities["base:facility.research-campus-1"];
  if (campusDefinition === undefined) {
    throw new Error("Research Campus I is missing from compiled content");
  }
  await campusCard.getByRole("button", { name: "Build" }).click();
  await expect(campusCard.getByRole("button", { name: "Building" })).toBeVisible();
  await expect(page.locator(".project-list > article")).toHaveCount(1);
  for (let week = 0; week <= campusDefinition.durationWeeks; week += 1) {
    // Actionability is proved by the first-class controls elsewhere; dispatching
    // the repeated clock events directly keeps this long simulation fixture from
    // spending its budget waiting for WebKit's post-layout stability heuristic.
    await page.getByRole("button", { name: "Step one week" }).dispatchEvent("click");
    const presentationContinue = page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue" });
    while (await presentationContinue.isVisible()) {
      await presentationContinue.dispatchEvent("click");
    }
  }
  await expect(campusCard).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Completed facilities" })).toHaveCount(
    0,
  );
  await expect(page.locator(".project-list > article")).toHaveCount(0);
});
