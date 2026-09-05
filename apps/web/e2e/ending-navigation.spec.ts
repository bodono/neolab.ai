import { expect, test, type Page } from "@playwright/test";

import { loadCompiledContent } from "@neolab/content";
import {
  advanceOneTick,
  createNewGame,
  createSaveEnvelope,
  seed128,
  type NewGameConfig,
} from "@neolab/sim/public";

const content = loadCompiledContent();

const INSOLVENCY_ENDING = "base:ending.the-worlds-most-expensive-insolvency";

/**
 * Play a lab into the scored insolvency ending using the current engine.
 *
 * Generated rather than read from an archived save file: the schema moves fast
 * enough that any committed finished-run fixture stops loading within days, and
 * a run this test builds itself is current by construction.
 */
function scoredInsolvencyState(): ReturnType<typeof createNewGame> {
  const initial = createNewGame(
    {
      seed: seed128("10550155015501550155015501550155"),
      difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
      leaderId: "base:leader.liang-wenfang" as NewGameConfig["leaderId"],
      mandateId: "base:mandate.build-the-business" as NewGameConfig["mandateId"],
    },
    content,
  );
  const bankrupt = structuredClone(initial) as unknown as {
    labs: Record<string, { finance: { cash: number } }>;
  };
  const lab = bankrupt.labs[initial.run.playerLabId];
  if (lab === undefined) throw new Error("Ending fixture player lab is missing");
  lab.finance.cash = -500;

  const MAX_WEEKS = 400;
  let state = bankrupt as unknown as ReturnType<typeof createNewGame>;
  let week = 0;
  while (state.run.status === "active" && week < MAX_WEEKS) {
    state = advanceOneTick(state, content).state;
    week += 1;
  }
  if (state.run.endingId !== INSOLVENCY_ENDING || state.score.final === undefined) {
    throw new Error(
      `Ending fixture settled as ${state.run.endingId ?? "an unfinished run"} after ${String(week)} weeks rather than a scored insolvency`,
    );
  }
  return state;
}

const finishedRun = scoredInsolvencyState();

async function openFinishedRun(page: Page): Promise<void> {
  const envelope = createSaveEnvelope(finishedRun, {
    saveId: "ending-navigation-finished-run",
    slotType: "manual",
    displayName: "Finished run",
    contentHash: content.manifest.bundleHash,
    nowIso: "2026-07-23T00:00:00.000Z",
  });
  await page.goto("/?campaign=classic");
  await page.locator('input[type="file"]').setInputFiles({
    name: "finished-run.neolab-save.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("insolvency-ending")).toBeVisible();
}

test("ending navigation remains available across every reversible view", async ({
  page,
}) => {
  await openFinishedRun(page);

  const navigation = page.getByRole("navigation", { name: "End-of-run views" });
  const summaryButton = page.getByRole("button", { name: "Run summary" });
  const auditButton = page.getByRole("button", {
    name: "What Actually Happened",
  });
  const highScoresButton = page.getByRole("button", {
    name: "Local high scores",
  });

  await expect(navigation).toBeVisible();
  expect(await navigation.evaluate((element) => getComputedStyle(element).position)).toBe(
    "sticky",
  );
  await expect(summaryButton).toHaveAttribute("aria-pressed", "true");

  await auditButton.click();
  await expect(auditButton).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Close What Actually Happened" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "What Actually Happened" }),
  ).toBeVisible();
  await expect(navigation).toBeVisible();

  await highScoresButton.click();
  await expect(highScoresButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "High scores" })).toBeVisible();
  await expect(page.getByRole("button", { name: /All finished runs/ })).toBeVisible();
  await expect(navigation).toBeVisible();

  await page.getByRole("button", { name: "Roll credits" }).click();
  await expect(page.getByTestId("credits-roll")).toBeVisible();
  await expect(navigation).toBeVisible();
  await summaryButton.click();
  await expect(page.getByTestId("credits-roll")).toHaveCount(0);
  await expect(summaryButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: /^\d[\d,]* points$/ })).toBeVisible();
});

test("return to title is isolated behind an explicit confirmation", async ({ page }) => {
  await openFinishedRun(page);

  await page.getByRole("button", { name: "Return to title" }).click();
  await expect(
    page.getByText(
      "This closes the finished run and returns to the title screen. You cannot come back.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes, return to title" })).toBeVisible();
  await expect(page.getByTestId("insolvency-ending")).toBeVisible();

  await page.getByRole("button", { name: "Stay here" }).click();
  await expect(page.getByRole("button", { name: "Yes, return to title" })).toHaveCount(0);
  await expect(page.getByTestId("insolvency-ending")).toBeVisible();
});
