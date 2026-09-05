import { defineConfig, devices } from "@playwright/test";

const deploymentUrl = process.env["NEOLAB_DEPLOYMENT_URL"];
if (deploymentUrl === undefined || !/^https?:\/\//.test(deploymentUrl)) {
  throw new Error("NEOLAB_DEPLOYMENT_URL must be the absolute deployed site URL");
}

export default defineConfig({
  testDir: "./e2e/deployment",
  fullyParallel: false,
  forbidOnly: true,
  retries: 2,
  reporter: process.env["CI"] === undefined ? "list" : "github",
  use: {
    baseURL: deploymentUrl,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
});
