import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests that run against a deployed build.
 *
 * Defaults to the live site so the suite checks what a judge actually opens. Point
 * BASE_URL at a preview deploy to check a build before it goes live:
 *   BASE_URL=http://localhost:4173 npx playwright test
 */
const baseURL = process.env.BASE_URL ?? "https://lava-project.pages.dev";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
