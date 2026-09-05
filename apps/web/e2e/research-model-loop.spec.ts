import { expect, test, type Page } from "@playwright/test";

async function launchLab(page: Page): Promise<void> {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await expect(page.getByRole("heading", { name: "Mario Amodeo" })).toBeVisible();
}

test("research, models, training quotes, and score archive are operable", async ({
  page,
}) => {
  await launchLab(page);
  await page.getByRole("button", { name: "Research", exact: true }).click();
  const programmeCard = page.locator(".research-programme-card").first();
  await expect(programmeCard).toBeVisible();
  await expect(programmeCard.locator(".programme-level-badge")).toContainText("LEVEL");
  await expect(programmeCard).toContainText(/NEXT · LEVEL \d+/);
  await expect(programmeCard).toContainText("RESEARCH COMPUTE");
  await expect(programmeCard.locator(".programme-level-progress")).not.toBeEmpty();
  await expect(page.getByLabel("How research levels increase")).toContainText(
    "Allocate R&D FLOP/s",
  );
  await expect(page.getByLabel("How research levels increase")).toContainText(
    "Raise the field level",
  );
  const levelNumberSize = await programmeCard
    .locator(".programme-level-badge b")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  const progressHeight = await programmeCard
    .locator(".programme-level-progress-track")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).height));
  // Compacting the programme grid deliberately took this from 27px to 23px.
  // The guard still exists to keep the level readable as the headline number
  // on the card, so hold the floor at the compact size rather than the old one.
  expect(levelNumberSize).toBeGreaterThanOrEqual(23);
  expect(progressHeight).toBeGreaterThanOrEqual(7);
  await expect(page.locator(".research-workspace [role=progressbar]")).toHaveCount(0);
  await expect(page.getByText("progress estimate intentionally withheld")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Research command centre" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Models & deployment" }).click();
  await expect(page.locator(".model-command-card.training")).toBeVisible();
  await expect(page.locator(".model-command-card.release")).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Model tasks" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No AI trained yet" })).toBeVisible();
  const firstTrainingButton = page.getByRole("button", {
    name: "Configure first training run",
  });
  await expect(firstTrainingButton).toBeVisible();
  await firstTrainingButton.click();
  await expect(
    page.getByRole("heading", { name: "Authorise a new model generation" }),
  ).toBeVisible();
  await expect(page.getByText("Parent model", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Projected capability", { exact: true })).toHaveCount(0);
  await expect(page.getByText("INTRINSIC SAFETY FORECAST")).toBeVisible();
  await expect(
    page.getByText("More training FLOP usually yields a stronger model."),
  ).toBeVisible();

  const postureTop = await page
    .locator(".training-posture-choice")
    .evaluate((element) => element.getBoundingClientRect().top);
  const safetyForecastTop = await page
    .locator(".training-safety-forecast")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(safetyForecastTop).toBeGreaterThan(postureTop);

  const stretchRiskDetail = page.getByText(/A failed checkpoint can add time/);
  await expect(stretchRiskDetail).toBeHidden();
  await page.getByLabel("Explain Checkpoint and stretch risk").click();
  await expect(stretchRiskDetail).toBeVisible();

  await page.getByRole("button", { name: "Start training run" }).click();
  const trainingMonitor = page.getByRole("region", {
    name: "Initial model training: active",
  });
  await expect(trainingMonitor).toBeVisible();
  await expect(
    trainingMonitor.getByText(/0 of \d+ scheduled weeks elapsed/, { exact: true }),
  ).toBeVisible();
  await expect(trainingMonitor.getByText(/2,000/)).toBeVisible();
  await expect(
    trainingMonitor.getByText(/Capability unknown until completion/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  const majorProjects = page.getByRole("region", { name: "Major projects" });
  await expect(majorProjects).toContainText("Prototype training");
  await expect(majorProjects).toContainText(/0 of \d+ scheduled weeks elapsed/);

  await page.getByRole("button", { name: "Breakdown", exact: true }).click();
  await expect(page.getByRole("heading", { name: /points earned/ })).toBeVisible();

  const accessibleText = await page.locator("body").innerText();
  expect(accessibleText).not.toMatch(
    /Hidden Safety|True Alignment|Deceptive Capability|True Severity|True Capability/i,
  );
});
