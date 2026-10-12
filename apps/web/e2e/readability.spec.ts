import { appendFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { loadCompiledContent } from "@neolab/content";
import {
  advanceOneTick,
  createNewGame,
  createSaveEnvelope,
  seed128,
  type NewGameConfig,
} from "@neolab/sim/public";

import {
  auditContrast,
  formatContrastFailures,
  type ContrastFailure,
} from "./helpers/contrast-audit.ts";

/**
 * Every screen a player can reach must keep its text readable in both themes:
 * WCAG AA (4.5:1, or 3:1 for large text) for live text and 3:1 for disabled
 * controls. Colour is measured as rendered, so a light-only colour that leaks
 * into dark mode, an accent used as body text, or a faded locked card all fail
 * here with the stylesheet rule that caused them.
 *
 * Set CONTRAST_REPORT=<file> to collect every failure as JSON lines instead of
 * stopping at the first screen.
 */

const COMMAND_DIALOGS = [
  "How to play",
  "Sound settings",
  "Fundraise",
  "Buy",
  "Details",
  "Breakdown",
  "Recruit",
] as const;

const reportPath = process.env["CONTRAST_REPORT"];
const content = loadCompiledContent();

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Contrast is a property of the stylesheet; one engine measures it.",
);

async function record(page: Page, screen: string): Promise<void> {
  const failures = await auditContrast(page);
  if (reportPath !== undefined) {
    appendFileSync(`${reportPath}.screens`, `${screen}\t${String(failures.length)}\n`);
    for (const failure of failures) {
      appendFileSync(reportPath, `${JSON.stringify({ screen, ...failure })}\n`);
    }
    return;
  }
  expect(failures, `${screen}\n${formatContrastFailures(failures)}`).toEqual(
    [] as ContrastFailure[],
  );
}

/** Audits the screen as shown, then again with every disclosure and help popover open. */
async function check(page: Page, screen: string): Promise<void> {
  await record(page, screen);
  const opened = await page.evaluate(() => {
    let count = 0;
    for (const details of document.querySelectorAll("details:not([open])")) {
      if (details.getClientRects().length === 0) continue;
      details.setAttribute("open", "");
      details.setAttribute("data-contrast-opened", "");
      count += 1;
    }
    return count;
  });
  if (opened === 0) return;
  await record(page, `${screen} (disclosures open)`);
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("[data-contrast-opened]")) {
      details.removeAttribute("open");
      details.removeAttribute("data-contrast-opened");
    }
  });
}

/** Audits and then dismisses each queued modal by whichever exit it offers. */
async function drainModals(page: Page, prefix: string): Promise<void> {
  const audited = new Set<string>();
  for (let guard = 0; guard < 12; guard += 1) {
    const dialog = page.locator('[role="dialog"]').first();
    if (!(await dialog.isVisible().catch(() => false))) return;
    const name = (
      (await dialog.getAttribute("aria-label")) ??
      (await dialog
        .locator("h2")
        .first()
        .textContent({ timeout: 1_000 })
        .catch(() => null)) ??
      String(guard)
    ).trim();
    if (audited.has(name)) {
      // The exit we found did not close it; Escape is the last resort.
      await page.keyboard.press("Escape");
      if (await dialog.isVisible().catch(() => false)) return;
      continue;
    }
    audited.add(name);
    await check(page, `${prefix} / modal ${name.slice(0, 50)}`);
    const exits = [
      dialog.getByRole("button", { name: /^Decide later/ }).first(),
      dialog.getByRole("button", { name: "Not now" }).first(),
      dialog.getByRole("button", { name: "Continue", exact: true }).first(),
      dialog.getByRole("button", { name: /^Close/ }).first(),
    ];
    let used = false;
    for (const exit of exits) {
      if (!(await exit.isVisible().catch(() => false))) continue;
      await exit.click();
      used = true;
      break;
    }
    if (!used) {
      const choice = dialog.getByRole("button").last();
      if (!(await choice.isVisible().catch(() => false))) return;
      await choice.click();
      const confirm = dialog.getByRole("button", { name: /^Confirm: / });
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
    }
    await page.waitForTimeout(150);
  }
}

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  const dialog = page.getByRole("dialog");
  if ((await dialog.count()) === 0) return;
  for (const name of [/^Close/, /^Cancel/, /^Done/, /^Back/, /^Keep/]) {
    const button = dialog.first().getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }
}

async function auditWorkspaces(page: Page, prefix: string): Promise<void> {
  const navigation = page.locator("nav button:visible");
  const count = await navigation.count();
  for (let sectionIndex = 0; sectionIndex < count; sectionIndex++) {
    const link = navigation.nth(sectionIndex);
    const section = (await link.getAttribute("aria-label")) ?? (await link.textContent());
    await link.click();
    await page.waitForTimeout(150);
    const label = `${prefix} / ${section?.trim() ?? String(sectionIndex)}`;
    await check(page, label);
    const tabs = page.locator("main [role=tab]:visible");
    const tabCount = await tabs.count();
    for (let index = 1; index < tabCount; index++) {
      const tab = tabs.nth(index);
      const name = (await tab.textContent())?.trim() ?? String(index);
      await tab.click();
      await page.waitForTimeout(100);
      await check(page, `${label} / ${name}`);
    }
  }
}

async function importRun(
  page: Page,
  state: ReturnType<typeof createNewGame>,
  name: string,
): Promise<void> {
  const envelope = createSaveEnvelope(state, {
    saveId: `readability-${name}`,
    slotType: "manual",
    displayName: name,
    contentHash: content.manifest.bundleHash,
    nowIso: "2026-10-12T00:00:00.000Z",
  });
  await page.goto("/?campaign=classic");
  await page.locator('input[type="file"]').setInputFiles({
    name: `${name}.neolab-save.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await page.getByRole("button", { name: "Continue" }).click();
}

function classicRun(seed: string): ReturnType<typeof createNewGame> {
  return createNewGame(
    {
      seed: seed128(seed),
      difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
      leaderId: "base:leader.liang-wenfang" as NewGameConfig["leaderId"],
      mandateId: "base:mandate.build-the-business" as NewGameConfig["mandateId"],
    },
    content,
  );
}

function advance(
  state: ReturnType<typeof createNewGame>,
  weeks: number,
): ReturnType<typeof createNewGame> {
  let current = state;
  for (let week = 0; week < weeks && current.run.status === "active"; week++) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

test("title and setup screens are readable in both themes", async ({ page }) => {
  await page.goto("/?campaign=classic");
  await check(page, "title");
  await page.getByRole("button", { name: "Start muted" }).click();
  await check(page, "setup / classic");
  await page
    .getByRole("radio", { name: /Guided/ })
    .first()
    .click();
  await check(page, "setup / guided");
});

test("every classic workspace and command dialog is readable in both themes", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await expect(page.getByRole("heading", { name: "Mario Amodeo" })).toBeVisible();
  await auditWorkspaces(page, "classic");

  await page.locator("nav button:visible").first().click();
  for (const name of COMMAND_DIALOGS) {
    const opener = page.getByRole("button", { name, exact: true }).first();
    if (!(await opener.isVisible().catch(() => false))) continue;
    await opener.click();
    await page.waitForTimeout(150);
    await check(page, `classic / dialog ${name}`);
    await closeDialog(page);
  }
});

test("a classic run two years in, with its event decisions, is readable", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await importRun(
    page,
    advance(classicRun("0123456789abcdef0123456789abcdef"), 120),
    "year-two",
  );
  await expect(page.locator(".game-shell")).toBeVisible();
  await drainModals(page, "year two");
  await auditWorkspaces(page, "year two");
});

test("the guided opening is readable in both themes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Stan Altmann/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  const garage = page.getByRole("dialog", { name: "So, you decided to start a neolab." });
  await expect(garage).toBeVisible();
  await check(page, "guided / garage opening");
  await page.getByRole("button", { name: "Open the garage" }).click();
  await expect(garage).toBeHidden();
  await auditWorkspaces(page, "guided");
});

for (const scenario of [
  "endgame",
  "endgame-prosperity",
  "endgame-false-dawn",
  "endgame-high-control",
  "endgame-low-evidence",
  "endgame-extinction",
  "endgame-rival",
  "endgame-rival-false-dawn",
  "endgame-false-alarm",
  "endgame-disputed-proof",
  "endgame-recovery",
  "endgame-route-twist",
  "endgame-multi-latent",
]) {
  test(`the ${scenario} scenario is readable in both themes`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(`/?scenario=${scenario}`);
    await expect(page.locator(".game-shell")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(300);
    await check(page, `${scenario} / opening`);
    await drainModals(page, scenario);
    if (scenario === "endgame" || scenario === "endgame-rival") {
      await auditWorkspaces(page, scenario);
    }
  });
}

for (const scenario of [
  "endgame",
  "endgame-prosperity",
  "endgame-false-dawn",
  "endgame-extinction",
]) {
  test(`the ${scenario} crisis, deployment, and outcome are readable`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/?scenario=${scenario}`);
    await expect(page.locator(".game-shell")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Step one week" }).click();
    await drainModals(page, `${scenario} crisis`);
    await page.getByRole("button", { name: "Deployment Crisis", exact: true }).click();
    await check(page, `${scenario} / crisis command`);

    await page.getByRole("button", { name: "Nominate this exact artifact" }).click();
    const nomination = page.getByRole("dialog", { name: /Nominate .+\?/ });
    await expect(nomination).toBeVisible();
    await check(page, `${scenario} / nomination dialog`);
    await nomination.getByRole("button", { name: "Nominate exact artifact" }).click();
    const declaration = page.getByRole("dialog", {
      name: /clears the candidate threshold/,
    });
    await expect(declaration).toBeVisible();
    await check(page, `${scenario} / declaration dialog`);
    await declaration.getByRole("button", { name: "Continue internal review" }).click();
    await drainModals(page, `${scenario} review`);
    await check(page, `${scenario} / proof command`);

    const commitProof = page
      .locator(".proof-command-rail")
      .getByRole("button", { name: /COMMIT CAPABILITY PROOF/ });
    if (await commitProof.isVisible().catch(() => false)) {
      await commitProof.click();
      const proof = page.getByRole("dialog", { name: /Authorise .+\?/ });
      if (await proof.isVisible().catch(() => false)) {
        await check(page, `${scenario} / proof dialog`);
        await proof.getByRole("button", { name: "Reconsider proof design" }).click();
      }
    }

    await page
      .getByRole("button", { name: "DEPLOY NOW Zero preparation" })
      .first()
      .click();
    const deploy = page.getByRole("dialog", { name: "Deploy now." });
    await expect(deploy).toBeVisible();
    await check(page, `${scenario} / deploy dialog`);
    const command = (await deploy.locator("label strong").textContent())?.trim() ?? "";
    await deploy.getByLabel(/Type DEPLOY .+ to transmit/).fill(command);
    await deploy.getByRole("button", { name: "Transmit DEPLOY order" }).click();

    // Follow the outcome through each staged beat to whatever it settles on: a
    // returning dialog (the race continues) or a final ending screen.
    const ending = page.getByTestId("ending-screen");
    const raceContinues = page.locator(".endgame-return-dialog");
    for (let beat = 0; beat < 30; beat++) {
      await page.waitForTimeout(1_500);
      await check(page, `${scenario} / outcome beat ${String(beat)}`);
      if (await ending.isVisible().catch(() => false)) break;
      if (await raceContinues.isVisible().catch(() => false)) break;
      const advance = page
        .locator(".victory-deployment-primary, .containment-failure-primary")
        .first();
      const response = page.locator(".containment-response-grid button:enabled").first();
      if (await advance.isVisible().catch(() => false)) {
        await advance.click();
      } else if (await response.isVisible().catch(() => false)) {
        await response.click();
      }
    }
    if (await ending.isVisible().catch(() => false)) {
      for (const view of ["What Actually Happened", "Local high scores"]) {
        await page.getByRole("button", { name: view }).click();
        await page.waitForTimeout(300);
        await check(page, `${scenario} / ending ${view}`);
      }
    }
  });
}

test("a finished run's ending screens are readable in both themes", async ({ page }) => {
  test.setTimeout(240_000);
  const bankrupt = structuredClone(
    classicRun("10550155015501550155015501550155"),
  ) as unknown as {
    labs: Record<string, { finance: { cash: number } }>;
    run: { playerLabId: string };
  };
  const lab = bankrupt.labs[bankrupt.run.playerLabId];
  if (lab === undefined) throw new Error("Ending fixture player lab is missing");
  lab.finance.cash = -500;
  await importRun(
    page,
    advance(bankrupt as unknown as ReturnType<typeof createNewGame>, 400),
    "finished",
  );
  await expect(page.getByTestId("insolvency-ending")).toBeVisible();
  await check(page, "ending / summary");
  for (const view of ["What Actually Happened", "Local high scores", "Roll credits"]) {
    await page.getByRole("button", { name: view }).click();
    await page.waitForTimeout(300);
    await check(page, `ending / ${view}`);
  }
});
