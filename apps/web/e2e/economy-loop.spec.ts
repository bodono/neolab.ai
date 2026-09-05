import { expect, test, type Page } from "@playwright/test";

import { loadCompiledContent } from "@neolab/content";
import {
  NEGATIVE_CASH_BANKRUPTCY_WEEKS,
  createNewGame,
  createSaveEnvelope,
  loadSaveEnvelope,
  seed128,
  type NewGameConfig,
} from "@neolab/sim/public";

const content = loadCompiledContent();

async function launchDefaultLab(page: Page): Promise<void> {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await expect(page.getByRole("heading", { name: "Mario Amodeo" })).toBeVisible();
}

async function dismissMilestonePresentations(page: Page): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const dialog = page.getByRole("dialog");
    if (!(await dialog.isVisible())) return;

    const publishOpenly = dialog.getByRole("button", { name: "Publish openly" });
    const acknowledge = dialog.getByRole("button", {
      name: "Acknowledge discovery",
    });
    const continueButton = dialog.getByRole("button", {
      name: "Continue",
      exact: true,
    });
    const decideLater = dialog.getByRole("button", { name: /Decide later/ });
    if (await publishOpenly.isVisible()) {
      await publishOpenly.click();
    } else if (await acknowledge.isVisible()) {
      await acknowledge.click();
    } else if (await continueButton.isVisible()) {
      await continueButton.click();
    } else if (await decideLater.isVisible()) {
      await decideLater.click();
    } else {
      return;
    }
  }
}

async function stepWeeks(page: Page, count: number): Promise<void> {
  const step = page.getByRole("button", { name: "Step one week" });
  for (let week = 0; week < count; week += 1) {
    await dismissMilestonePresentations(page);
    await step.click();
    await dismissMilestonePresentations(page);
  }
}

function noRescueState(): ReturnType<typeof createNewGame> {
  const initial = createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
      leaderId: "base:leader.dario-amodeo" as NewGameConfig["leaderId"],
      mandateId: "base:mandate.build-the-science" as NewGameConfig["mandateId"],
    },
    content,
  );
  const state = structuredClone(initial) as unknown as {
    labs: Record<
      string,
      {
        finance: { cash: number; consecutiveNegativeCashWeeks: number };
        aura: { spendable: number };
      }
    >;
  };
  const lab = state.labs[initial.run.playerLabId];
  if (lab === undefined) throw new Error("Economy fixture player lab is missing");
  lab.finance.cash = -1;
  lab.aura.spendable = 0;
  lab.finance.consecutiveNegativeCashWeeks = NEGATIVE_CASH_BANKRUPTCY_WEEKS - 4;
  return loadSaveEnvelope(
    createSaveEnvelope(state as unknown as ReturnType<typeof createNewGame>, {
      saveId: "economy-no-rescue",
      slotType: "manual",
      displayName: "No Rescue Lab",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-23T00:00:00.000Z",
    }),
  ).state;
}

async function importState(
  page: Page,
  state: ReturnType<typeof createNewGame>,
): Promise<void> {
  const envelope = createSaveEnvelope(state, {
    saveId: "economy-no-rescue",
    slotType: "manual",
    displayName: "No Rescue Lab",
    contentHash: content.manifest.bundleHash,
    nowIso: "2026-07-23T00:00:00.000Z",
  });
  await page.goto("/?campaign=classic");
  await page.locator('input[type="file"]').setInputFiles({
    name: "economy-no-rescue.neolab-save.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await page.getByRole("button", { name: "Continue" }).click();
}

test("fundraising extends runway beyond the unfunded insolvency point", async ({
  page,
}) => {
  // Twenty-eight stepped weeks, each dismissing milestone presentations before
  // and after the click. WebKit on a two-core Linux runner needs more than the
  // tripled default that test.slow() provides, and exceeded it on the first
  // weekly run that ever reached the three-engine suite.
  test.setTimeout(300_000);
  await launchDefaultLab(page);
  const fundraising = page.getByRole("button", { name: "Fundraise" });
  const fundraisingDialog = page.getByRole("dialog", { name: "Fundraising" });
  const openFundraising = async (): Promise<void> => {
    if (await fundraisingDialog.isVisible()) return;
    await fundraising.click();
  };
  await openFundraising();
  await page.getByRole("button", { name: /^Start .*· Competitive round$/ }).click();
  await page.getByRole("button", { name: "Close fundraising" }).click();

  await stepWeeks(page, 6);
  await expect(page.getByRole("alert")).toContainText("FUNDING OFFERS");

  await openFundraising();
  await page.getByTestId("accept-funding-offer").first().click();
  await expect(fundraisingDialog).toBeHidden();
  await openFundraising();
  await page.getByRole("button", { name: /^Start .*· Quiet bridge$/ }).click();
  await page.getByRole("button", { name: "Close fundraising" }).click();

  await stepWeeks(page, 2);
  await openFundraising();
  await page.getByTestId("accept-funding-offer").click();
  await expect(fundraisingDialog).toBeHidden();

  await stepWeeks(page, 20);

  const step = page.getByRole("button", { name: "Step one week" });
  await expect(step).toBeEnabled();
  await expect(page.getByTestId("insolvency-ending")).toHaveCount(0);
});

test("an unfunded lab reaches the insolvency ending", async ({ page }) => {
  await importState(page, noRescueState());
  await stepWeeks(page, 4);

  await expect(page.getByTestId("insolvency-ending")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The World's Most Expensive Insolvency" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /^\d[\d,]* points$/ })).toBeVisible();
  await expect(page.locator(".ending-score-categories article")).toHaveCount(6);
  await expect(page.getByText("Raw score", { exact: true })).toBeVisible();
  const rawScore = await page
    .locator(".score-final-maths div")
    .filter({ hasText: "Raw score" })
    .locator("dd")
    .innerText();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "What Actually Happened" }).click();
  await expect(
    page.getByRole("heading", { name: "What Actually Happened" }),
  ).toBeVisible();
  await page.getByText("Open the forensic data").click();
  await expect(page.getByText(/^SEED [0-9a-f]{32}$/)).toBeVisible();
  await page.getByRole("button", { name: "Local high scores" }).click();
  await page.getByRole("button", { name: /All finished runs/ }).click();
  await expect(
    page.getByText(/Humanic · The World's Most Expensive Insolvency/),
  ).toBeVisible();
  await expect(page.getByText(`raw ${rawScore}`, { exact: true })).toBeVisible();
});
