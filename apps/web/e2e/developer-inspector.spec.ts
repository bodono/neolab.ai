import { expect, test } from "@playwright/test";

test("development inspector exposes diagnostics and refreshes after a tick", async ({
  page,
}) => {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();

  await page.getByRole("button", { name: "Dev inspector" }).click();
  const panel = page.getByRole("complementary", {
    name: "Privileged simulation inspector",
  });
  await expect(
    panel.getByRole("heading", { name: "Simulation inspector" }),
  ).toBeVisible();
  await expect(panel).toContainText("Tick 0 · active · foundation");
  await expect(panel).toContainText("Current phase: idle");

  await panel.getByRole("button", { name: "Run invariant pack" }).click();
  await expect(panel.getByRole("status")).toHaveText("All invariants pass at tick 0.");

  await panel.getByText("Random key lookup", { exact: true }).click();
  await panel
    .getByLabel("Semantic key segments, separated by /")
    .fill("developer/e2e/golden");
  await panel.getByRole("button", { name: "Calculate golden values" }).click();
  await expect(panel).toContainText('"key": "developer/e2e/golden"');

  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Export test fixture" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("neolab-scenario-tick-0000.json");

  await panel.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("button", { name: "Step one week" }).click();
  const eventDialog = page.getByRole("dialog").first();
  if (await eventDialog.isVisible()) {
    const defer = eventDialog.getByRole("button", { name: /^Decide later/ }).first();
    if (await defer.isVisible()) await defer.click();
  }
  await page.getByRole("button", { name: "Dev inspector" }).click();
  await expect(panel).toContainText("Tick 1 · active · foundation");
  await expect(panel).toContainText("orders.apply-queued");

  await panel
    .getByText("Hidden model safety and evaluation error", { exact: true })
    .click();
  const modelDiagnostics = panel
    .locator("details")
    .filter({ hasText: /^Hidden model safety and evaluation error/ })
    .locator("pre");
  await expect(modelDiagnostics).toHaveText("[]");
});
