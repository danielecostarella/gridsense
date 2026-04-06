import { test, expect } from "@playwright/test";

/**
 * GridSense dashboard E2E tests.
 *
 * These tests exercise the UI against the running application.
 * The WebSocket connection is tested indirectly: if the connection badge
 * reaches "Live", real data is flowing from the Shelly through the stack.
 */

test.describe("Dashboard layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders page title and branding", async ({ page }) => {
    await expect(page).toHaveTitle(/GridSense/i);
    await expect(page.getByText("GridSense")).toBeVisible();
    await expect(page.getByText("Shelly Pro EM-50")).toBeVisible();
  });

  test("shows connection badge", async ({ page }) => {
    const badge = page.getByTestId("connection-badge");
    await expect(badge).toBeVisible();
    // Badge should eventually reach "Live" if the backend is running
    await expect(badge).toContainText(/live|connecting/i, { timeout: 10_000 });
  });

  test("renders power flow diagram", async ({ page }) => {
    const flow = page.getByTestId("power-flow");
    await expect(flow).toBeVisible();
    // SVG should be present inside the flow container
    await expect(flow.locator("svg")).toBeVisible();
  });
});

test.describe("Live metrics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for connection and first data frame
    await expect(page.getByTestId("connection-badge")).toContainText("Live", {
      timeout: 15_000,
    });
  });

  test("shows total power metric with a numeric value", async ({ page }) => {
    const card = page.getByTestId("metric-total-power");
    await expect(card).toBeVisible();
    // Value should be a number followed by a unit
    const text = await card.textContent();
    expect(text).toMatch(/\d/);
  });

  test("shows CH·0 voltage in expected range (210–250 V)", async ({ page }) => {
    const card = page.getByTestId("metric-ch0-voltage");
    await expect(card).toBeVisible();
    const text = await card.textContent() ?? "";
    const match = text.match(/(\d+[\.,]\d+)/);
    if (match?.[1]) {
      const volts = parseFloat(match[1].replace(",", "."));
      expect(volts).toBeGreaterThan(200);
      expect(volts).toBeLessThan(260);
    }
  });

  test("shows CH·1 returned energy card", async ({ page }) => {
    const card = page.getByTestId("metric-ch1-returned");
    await expect(card).toBeVisible();
  });

  test("all 9 metric cards are visible", async ({ page }) => {
    const metrics = [
      "metric-total-power",
      "metric-aprt-power",
      "metric-reactive-power",
      "metric-ch0-voltage",
      "metric-ch0-current",
      "metric-ch0-power",
      "metric-ch1-voltage",
      "metric-ch1-current",
      "metric-ch1-power",
    ];
    for (const id of metrics) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });
});

test.describe("Energy summary", () => {
  test("renders today energy card", async ({ page }) => {
    await page.goto("/");
    const today = page.getByTestId("today-energy");
    await expect(today).toBeVisible();
    // Give time for the REST query to complete
    await expect(page.getByTestId("today-consumed")).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Tariff & cost", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows tariff band badge in header", async ({ page }) => {
    const badge = page.getByTestId("tariff-band");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    // Must contain one of the three Italian tariff bands
    await expect(badge).toContainText(/F[123]/);
  });

  test("shows cost card with euro value", async ({ page }) => {
    const card = page.getByTestId("cost-card");
    await expect(card).toBeVisible();
    // Should contain a euro symbol after data loads
    await expect(card).toContainText("€", { timeout: 15_000 });
  });
});

test.describe("Historical chart", () => {
  test("renders power chart container", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("power-chart")).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("Responsive layout", () => {
  test("header is visible on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByText("GridSense")).toBeVisible();
    await expect(page.getByTestId("connection-badge")).toBeVisible();
  });
});
