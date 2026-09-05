import { expect, test } from "@playwright/test";

test("autosaves survive reload and corrupt loads stay safely on the title screen", async ({
  page,
}) => {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Stan Altmann/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  const deferBlockingEvent = async (): Promise<void> => {
    const dialog = page.getByRole("dialog").first();
    if (!(await dialog.isVisible())) return;
    const exit = dialog
      .getByRole("button", { name: /^(Decide later|Not now|Continue|Close)/ })
      .first();
    if (await exit.isVisible()) await exit.click();
  };
  for (let week = 0; week < 4; week += 1) {
    await page.getByRole("button", { name: "Step one week" }).click();
    await deferBlockingEvent();
  }

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("neolab.ai-saves", 1);
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () =>
            reject(request.error ?? new Error("Could not open save database")),
          );
        });
        const transaction = database.transaction("save-slots", "readonly");
        const count = await new Promise<number>((resolve, reject) => {
          const request = transaction.objectStore("save-slots").count();
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () =>
            reject(request.error ?? new Error("Could not count save slots")),
          );
        });
        database.close();
        return count;
      }),
    )
    .toBe(1);

  await page.reload();
  await expect(page.getByRole("heading", { name: /neolab\.ai/i })).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeVisible();

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("neolab.ai-saves", 1);
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("Could not open save database")),
      );
    });
    const transaction = database.transaction(["save-slots", "save-records"], "readwrite");
    const slots = transaction.objectStore("save-slots");
    const records = transaction.objectStore("save-records");
    const pointer = await new Promise<{ saveId: string; recordId: string }>(
      (resolve, reject) => {
        const request = slots.get("autosave");
        request.addEventListener("success", () =>
          resolve(request.result as unknown as { saveId: string; recordId: string }),
        );
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("Could not read save pointer")),
        );
      },
    );
    const record = await new Promise<{
      recordId: string;
      envelope: { state: { run: { tick: number } } };
    }>((resolve, reject) => {
      const request = records.get(pointer.recordId);
      request.addEventListener("success", () =>
        resolve(
          request.result as unknown as {
            recordId: string;
            envelope: { state: { run: { tick: number } } };
          },
        ),
      );
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("Could not read save record")),
      );
    });
    record.envelope.state.run.tick += 1;
    await new Promise<void>((resolve, reject) => {
      const request = records.put(record);
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("Could not corrupt save fixture")),
      );
    });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () =>
        reject(transaction.error ?? new Error("Corrupt fixture transaction aborted")),
      );
    });
    database.close();
  });

  await continueButton.click();
  await expect(page.getByRole("heading", { name: /neolab\.ai/i })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(/checksum mismatch/i);
});
