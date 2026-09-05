import { expect, test, type Page } from "@playwright/test";

async function clearBlockingModals(page: Page): Promise<void> {
  for (let guard = 0; guard < 12; guard += 1) {
    const dialog = page.locator('[role="dialog"]').first();
    if (!(await dialog.isVisible())) return;
    const exits = [
      dialog.getByRole("button", { name: /^Decide later/ }).first(),
      dialog.getByRole("button", { name: "Not now" }).first(),
      dialog.getByRole("button", { name: "Continue", exact: true }).first(),
      dialog.getByRole("button", { name: /^Close/ }).first(),
    ];
    let used = false;
    for (const exit of exits) {
      if (!(await exit.isVisible())) continue;
      await exit.click();
      used = true;
      break;
    }
    if (!used) {
      // A critical decision has no exit: it has to be answered.
      const choice = dialog.getByRole("button").last();
      if (!(await choice.isVisible())) return;
      await choice.click();
      const confirm = dialog.getByRole("button", { name: /^Confirm: / });
      if (await confirm.isVisible()) await confirm.click();
    }
  }
}

async function openCrisisCommand(page: Page): Promise<void> {
  const crisisNav = page.getByRole("button", {
    name: "Deployment Crisis",
    exact: true,
  });
  await expect(crisisNav).toBeVisible();
  await crisisNav.click();
}

test("the Deployment Crisis tab opens its persistent command workspace", async ({
  page,
}) => {
  await page.goto("/?scenario=endgame");
  await expect(page.getByRole("heading", { name: "Dennis Hassabi" })).toBeVisible();

  await page.getByRole("button", { name: "Step one week" }).click();
  // Entering the crisis can raise ordinary decision or milestone modals, and
  // each swallows clicks meant for the shell behind it.
  // Dismiss whatever is open by whichever exit it offers, rather than naming
  // each dialog, so a new one in the queue does not silently stall the run.
  await clearBlockingModals(page);
  const crisisNav = page.getByRole("button", {
    name: "Deployment Crisis",
    exact: true,
  });
  await expect(crisisNav).toBeVisible();

  await openCrisisCommand(page);

  await expect(crisisNav).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", {
      name: "The Deployment Crisis has its own command room",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose the candidate artifact", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("MAXIMUM SPEED · 4×", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "4x", exact: true })).toBeEnabled();
  await expect(
    page.getByText("CLOCK STOPPED FOR HUMAN DECISION", { exact: true }),
  ).toHaveCount(0);
  const nominationAction = page.getByRole("button", {
    name: "Nominate this exact artifact",
  });
  await expect(nominationAction).toHaveCSS("border-style", "solid");
  const restingShadow = await nominationAction.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  await nominationAction.hover();
  await expect(nominationAction).not.toHaveCSS("transform", "none");
  await expect
    .poll(() =>
      nominationAction.evaluate((element) => getComputedStyle(element).boxShadow),
    )
    .not.toBe(restingShadow);
  await nominationAction.click();
  const nominationDialog = page.getByRole("dialog", { name: /Nominate .+\?/ });
  await expect(nominationDialog).toBeVisible();
  await expect(nominationDialog.getByText("NOMINATION TARGET")).toBeVisible();
  await expect(nominationDialog).not.toContainText("run:model:");
  await expect(nominationDialog).toHaveCSS("background-color", "rgb(17, 28, 27)");
  await expect(nominationDialog.locator("h2")).toHaveCSS("color", "rgb(245, 251, 249)");
  await nominationDialog.getByRole("button", { name: "Nominate exact artifact" }).click();
  const declarationDialog = page.getByRole("dialog", {
    name: /clears the candidate threshold/,
  });
  await expect(declarationDialog).toBeVisible();
  await declarationDialog
    .getByRole("button", { name: "Continue internal review" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prove the capability claim" }).first(),
  ).toBeVisible();
  await clearBlockingModals(page);

  await expect(page.locator(".crisis-board")).toHaveCount(1);
  const proofRail = page.locator(".proof-command-rail");
  await expect(proofRail.getByRole("button")).toHaveCount(3);
  await expect(page.getByText("MINIMUM ACCESS", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(/Durable evidence with the strongest protection/),
  ).toBeVisible();
  await expect(page.getByText("ADDS 4 WEEKS", { exact: true })).toBeVisible();
  await expect(page.getByText(/material exposure/i)).toHaveCount(0);

  const commitProof = proofRail.getByRole("button", {
    name: /COMMIT CAPABILITY PROOF/,
  });
  await expect(commitProof).toHaveCSS("border-style", "solid");
  await commitProof.click();
  const proofDialog = page.getByRole("dialog", { name: /Authorise .+\?/ });
  await expect(proofDialog).toBeVisible();
  await expect(
    proofDialog.getByText("ACCESS IS A PERSISTENT PERMISSION LEVEL"),
  ).toBeVisible();
  await expect(proofDialog).toContainText(/stays raised until you reduce it/i);
  await expect(proofDialog).toContainText("Rival window:");
  await proofDialog.getByRole("button", { name: "Begin capability proof" }).click();
  await expect(proofDialog).toHaveCount(0);
  await expect(page.locator(".proof-in-progress")).toBeVisible();
  await expect(page.locator(".crisis-decision-dialog-actions")).toHaveCount(0);

  await page.getByRole("button", { name: "DEPLOY NOW Zero preparation" }).first().click();
  const deployDialog = page.getByRole("dialog", { name: "Deploy now." });
  await expect(deployDialog).toBeVisible();
  await expect(deployDialog).toHaveCSS("background-color", "rgb(17, 28, 27)");
  await expect(deployDialog.locator("h2")).toHaveCSS("color", "rgb(245, 251, 249)");
  await expect(deployDialog.locator(".eyebrow")).toHaveCSS("color", "rgb(168, 185, 179)");
  await expect(deployDialog.getByRole("button", { name: "Keep preparing" })).toHaveCSS(
    "background-color",
    "rgb(25, 38, 36)",
  );
  await expect(
    deployDialog.getByRole("button", { name: "Transmit DEPLOY order" }),
  ).toHaveCSS("opacity", "0.78");
  await deployDialog.getByRole("button", { name: "Keep preparing" }).click();

  await page.getByRole("button", { name: "Finances & score", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Finances & score", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await openCrisisCommand(page);
  await expect(crisisNav).toHaveAttribute("aria-current", "page");
});

test("a manually transmitted False Dawn returns the lab to the race", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?scenario=endgame-false-dawn");
  await expect(page.getByRole("heading", { name: "Dennis Hassabi" })).toBeVisible();

  await page.getByRole("button", { name: "Step one week" }).click();
  await expect(
    page.getByRole("dialog", {
      name: "Aquarius-7 would like a slightly larger job description",
    }),
  ).toHaveCount(0);
  await clearBlockingModals(page);
  await openCrisisCommand(page);
  await page.getByRole("button", { name: "Nominate this exact artifact" }).click();

  const nominationDialog = page.getByRole("dialog", { name: /Nominate .+\?/ });
  await nominationDialog.getByRole("button", { name: "Nominate exact artifact" }).click();
  const declarationDialog = page.getByRole("dialog", {
    name: /clears the candidate threshold/,
  });
  await declarationDialog
    .getByRole("button", { name: "Continue internal review" })
    .click();
  await clearBlockingModals(page);

  await page.getByRole("button", { name: "DEPLOY NOW Zero preparation" }).first().click();
  const deployDialog = page.getByRole("dialog", { name: "Deploy now." });
  const commandInput = deployDialog.getByLabel(/Type DEPLOY .+ to transmit/);
  const command = (await deployDialog.locator("label strong").textContent())?.trim();
  expect(command).toMatch(/^DEPLOY /);
  await commandInput.fill(command ?? "");
  await deployDialog.getByRole("button", { name: "Transmit DEPLOY order" }).click();

  await expect(
    page.getByRole("heading", { name: "The world is waiting", exact: true }),
  ).toBeVisible();
  const falseDawn = page.getByRole("dialog", {
    name: "Aquarius-7 was not superintelligence",
  });
  await expect(falseDawn).toBeVisible({ timeout: 20_000 });
  await expect(falseDawn).toBeFocused();
  await expect(falseDawn.getByText("FALSE DAWN // NOT GAME OVER")).toBeVisible();
  await expect(falseDawn.getByText("THE RACE CONTINUES")).toBeVisible();
  await expect(falseDawn).toContainText("52-week nomination cooldown");
  await expect(falseDawn).toContainText(
    "remains available for serving, productisation, evaluations, and RSI",
  );
  await expect(
    falseDawn.getByRole("heading", { name: "Begin a successor programme" }),
  ).toBeVisible();
  await expect(
    falseDawn.getByRole("heading", { name: "Seek a durable moratorium" }),
  ).toBeVisible();
  await expect(page.getByTestId("ending-screen")).toHaveCount(0);
  const pauseControl = page.getByRole("button", { name: "Pause game" });
  await expect(pauseControl).toBeDisabled();
  await expect(pauseControl).toHaveAttribute("aria-pressed", "true");
  for (const speed of ["1x", "2x", "4x"]) {
    const speedControl = page.getByRole("button", { name: speed, exact: true });
    await expect(speedControl).toBeDisabled();
    await expect(speedControl).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.getByRole("button", { name: "Step one week" })).toBeDisabled();

  await falseDawn.getByRole("button", { name: "Begin successor programme" }).click();
  await expect(falseDawn).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Models & deployment" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByText(/CANDIDATE DECLARATIONS PAUSED · 52/).first(),
  ).toBeVisible();
  await expect(page.getByText("Aquarius-7", { exact: true }).first()).toBeVisible();
});

test("a rival False Dawn interrupts the race with a distinct setback alert", async ({
  page,
}) => {
  await page.goto("/?scenario=endgame-rival-false-dawn");
  await expect(page.getByRole("heading", { name: "Dennis Hassabi" })).toBeVisible();

  await page.getByRole("button", { name: "Step one week" }).click();

  const setback = page.getByRole("alertdialog", {
    name: /superintelligence claim has collapsed/,
  });
  await expect(setback).toBeVisible();
  await expect(setback).toBeFocused();
  await expect(page.locator(".rival-setback-backdrop")).toBeVisible();
  await expect(setback).toHaveClass(/rival-candidate-setback-dialog/);
  await expect(setback).toHaveClass(/outcome-false-dawn/);
  await expect(setback).not.toHaveClass(/rival-crisis-stage-dialog|purchase-dialog/);
  await expect(setback).toHaveCSS("border-top-width", "10px");
  await expect(setback).not.toHaveCSS("box-shadow", "none");
  await expect(
    setback.getByText(
      /GLOBAL INTELLIGENCE FLASH \/\/ RIVAL CANDIDACY FAILURE \/\/ WEEK \d+/,
    ),
  ).toBeVisible();
  await expect(setback.getByText("RIVAL FALSE DAWN", { exact: true })).toBeVisible();
  await expect(setback.getByText("COUNTDOWN WITHDRAWN", { exact: true })).toBeVisible();
  await expect(setback).toContainText("No rival victory was recorded");
  await expect(setback).toContainText("You have more time. You have not won.");
  await expect(page.getByTestId("ending-screen")).toHaveCount(0);

  const returnToRace = setback.getByRole("button", { name: "Return to the race" });
  await expect(returnToRace).toHaveCSS("border-style", "solid");
  const restingShadow = await returnToRace.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  expect(restingShadow).not.toBe("none");
  await returnToRace.hover();
  await expect(returnToRace).not.toHaveCSS("transform", "none");
  await expect
    .poll(() => returnToRace.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe(restingShadow);

  await returnToRace.click();
  await expect(setback).toHaveCount(0);
  await expect(page.locator(".rival-crisis-stage-dialog")).toHaveCount(0);
  await expect(page.getByTestId("ending-screen")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Step one week" })).toBeEnabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`candidate declaration offers a real rapid-risk posture in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("neolab.ai-colour-theme-v1", selectedTheme);
    }, theme);
    await page.goto("/?scenario=endgame");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { name: "Dennis Hassabi" })).toBeVisible();

    await page.getByRole("button", { name: "Step one week" }).click();
    await clearBlockingModals(page);
    await openCrisisCommand(page);

    await expect(
      page.getByRole("heading", { name: "Choose the candidate artifact", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Nominate this exact artifact" }).click();
    const nominationDialog = page.getByRole("dialog", { name: /Nominate .+\?/ });
    await expect(nominationDialog).toBeVisible();
    await expect(nominationDialog.getByText("NOMINATION TARGET")).toBeVisible();
    await expect(nominationDialog).not.toContainText("run:model:");
    await nominationDialog
      .getByRole("button", { name: "Nominate exact artifact" })
      .click();

    const declarationDialog = page.getByRole("dialog", {
      name: /clears the candidate threshold/,
    });
    await expect(declarationDialog).toBeVisible();
    await expect(
      declarationDialog.getByRole("heading", {
        name: "We have entered the singularity.",
      }),
    ).toBeVisible();

    const optionCards = declarationDialog.locator(".event-option-card");
    await expect(optionCards).toHaveCount(3);
    await expect(optionCards.locator("h3")).toHaveText([
      "Notify regulators immediately",
      "Continue internal review",
      "Press forward at emergency speed",
    ]);
    await expect(declarationDialog).toContainText(
      "Candidate access: raised immediately to Access 3/5",
    );
    await expect(declarationDialog).toContainText(
      "First capability proof: up to 2 weeks faster (never below zero)",
    );

    await declarationDialog
      .getByRole("button", { name: "Press forward at emergency speed" })
      .click();
    await expect(declarationDialog).not.toBeVisible();
    await expect(page.getByText(/Access 3 ·/).first()).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Reaching into the cage is not safe." }),
    ).toHaveCount(0);
  });
}
