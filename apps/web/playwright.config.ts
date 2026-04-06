import { defineConfig, devices } from "@playwright/test";

/**
 * GridSense E2E test configuration.
 *
 * Runs against a live `next dev` server. Before running tests, ensure
 * the backend stack is up:
 *
 *   docker compose up timescaledb redis collector api
 *   cd apps/web && npm run dev &
 *   npx playwright test
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

  use: {
    baseURL: process.env["BASE_URL"] ?? "http://localhost:3002",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    colorScheme: "dark",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 15"] },
    },
  ],

  // Start Next.js dev server automatically if not already running
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3002",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
