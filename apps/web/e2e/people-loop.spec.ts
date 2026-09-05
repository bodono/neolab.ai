import { expect, test } from "@playwright/test";

test("people workspace exposes slots, fixed recruitment terms, and post-hire assignment", async ({
  page,
}) => {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();

  await expect(page.getByRole("heading", { name: "Star researchers" })).toBeVisible();
  await expect(page.getByText("3/8 slots unlocked")).toBeVisible();
  await expect(page.getByText("Vacant slot")).toHaveCount(3);

  await page.getByRole("button", { name: "People" }).click();
  await expect(
    page.getByRole("heading", { name: "People & appointments" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review dossier & terms" })).toHaveCount(
    6,
  );

  await page.getByRole("button", { name: "Review dossier & terms" }).first().click();
  const candidateName = await page
    .getByRole("dialog")
    .getByRole("heading", { level: 2 })
    .innerText();
  await expect(page.getByRole("dialog")).toContainText("RECRUITMENT DOSSIER");
  const dossier = page.getByRole("dialog");
  await expect(dossier).toContainText("Salary");
  await expect(dossier).toContainText("Signing");
  await page.getByRole("button", { name: "Recruit at listed terms" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Star researcher joined the lab")).toBeVisible();
  await expect(page.getByText(/listed recruitment terms were paid/)).toBeVisible();

  const rosterCard = page
    .locator(".roster-impact-card")
    .filter({ has: page.getByRole("heading", { name: candidateName, exact: true }) });
  await rosterCard.getByRole("button", { name: "Assign researcher" }).click();
  await page.getByLabel(`Assignment for ${candidateName}`).selectOption({ index: 0 });
  await page.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(page.getByRole("heading", { name: "Lead · Architectures" })).toBeVisible();

  await page.getByRole("button", { name: "Discuss departure…" }).click();
  await expect(page.getByText(`Confirm dismissal of ${candidateName}?`)).toBeVisible();
  await page.getByRole("button", { name: "Confirm dismissal" }).click();
  await expect(page.getByRole("alert")).toContainText(
    `${candidateName} has already left the lab`,
  );
  await expect(page.locator(".people-notice")).toContainText(
    `${candidateName} has departed from the lab`,
  );
});
