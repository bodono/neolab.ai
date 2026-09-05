import { expect, test } from "@playwright/test";

// Diplomacy channels and the coalition board are gone from this build -- the
// workspace's own help text says so -- and the assertions that drove them went
// with them. What survives is what this test was really about: rival standing
// reads as an estimate rather than a certainty, and regulation is legible.
test("world workspace shows rivals as estimates and exposes regulation", async ({
  page,
}) => {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();

  await page.getByRole("button", { name: "World & rivals" }).click();

  await expect(page.getByRole("heading", { name: "The AGI race" })).toBeVisible();

  // Every lab in the race, the player's among them.
  await expect(page.locator(".rival-score-grid .rival-score-card")).toHaveCount(5);
  const playerCard = page.locator(".player-score-card");
  await expect(playerCard).toContainText("Your lab");
  await expect(playerCard).toContainText("Humanic");
  await expect(playerCard).toContainText("Mario Amodeo");
  await expect(playerCard).toContainText("/ 100");
  await expect(playerCard).toContainText("no evaluated model");
  await expect(page.locator(".rival-score-card .rival-leader-portrait")).toHaveCount(5);
  await expect(
    playerCard.getByRole("img", { name: "Mario Amodeo, leader of Humanic" }),
  ).toBeVisible();
  for (const leaderName of [
    "Dennis Hassabi",
    "Stan Altmann",
    "Elon Tusk",
    "Liang Wenfang",
  ]) {
    await expect(page.locator(".rival-score-grid")).toContainText(leaderName);
  }

  // Rival numbers must read as intelligence, never as revealed truth.
  await expect(
    page.locator('[aria-label="Competitive intelligence scoreboard"]'),
  ).toBeVisible();
  await expect(
    page.locator('[aria-label="Competitive intelligence scoreboard"]'),
  ).toContainText(/estimate|estimated|confidence/i);

  await expect(
    page.getByRole("heading", { name: "Government & regulation" }),
  ).toBeVisible();
  const programmes = page.locator(".programme-grid");
  await expect(programmes).toContainText("$25M each quarter now");
  await expect(programmes).toContainText("$100M each quarter now");
  await expect(programmes).toContainText("$250M each quarter now");
  await expect(programmes).toContainText("GPU orders arrive 20% sooner");
  await expect(programmes).toContainText("Endgame:");
  await expect(
    page.getByText("Payments track current accelerator prices."),
  ).toBeVisible();
  await expect(programmes).not.toContainText("GPU delivery \u00d70.80");
  // TODO(government-lobbying-redesign): the implementation is retained, but
  // its player-facing action stays hidden until the mechanic is redesigned.
  await expect(page.getByText("Lobby the government", { exact: true })).toHaveCount(0);
});
