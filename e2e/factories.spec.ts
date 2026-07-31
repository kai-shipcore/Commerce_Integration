import { test, expect } from "@playwright/test";
import { loginAsTestUser } from "./support/login";

test.describe("Factories page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test("can create a new factory and see it in the list", async ({ page }) => {
    const factoryName = `E2E Test Factory ${Date.now()}`;

    await page.goto("planning/factories");
    // Scoped to the header — while the list is still loading (nothing
    // selected yet), the empty-state right pane renders its own second
    // "+ Add Factory" button, so an unscoped locator is ambiguous.
    await page.locator("header").getByRole("button", { name: "+ Add Factory" }).click();

    await page.getByPlaceholder("e.g. Guangzhou Textiles Co.").fill(factoryName);
    await page.getByRole("button", { name: "Save" }).click();

    // Saving refetches the list — the new factory should now be selectable there.
    await expect(page.getByRole("button", { name: factoryName })).toBeVisible();
    // The detail pane's header repeats the name once it's the selected factory.
    await expect(page.getByText(`🏭 ${factoryName}`)).toBeVisible();
  });
});
