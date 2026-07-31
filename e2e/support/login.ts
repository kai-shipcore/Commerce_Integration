import type { Page } from "@playwright/test";

/**
 * Logs in as a test user before a spec runs. Credentials come from env vars
 * rather than being hard-coded — set E2E_TEST_EMAIL / E2E_TEST_PASSWORD to a
 * real account before running the e2e suite.
 */
export async function loginAsTestUser(page: Page) {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars to run e2e tests (see e2e/support/login.ts)."
    );
  }

  await page.goto("auth/signin");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/auth/signin"));

  // The nav's language toggle is the actual source of truth for locale (it
  // persists server-side per user), so click it rather than fighting that
  // with localStorage — this way spec text assertions don't depend on
  // whichever locale this account last saved.
  // exact: true — Playwright's default substring match would otherwise also
  // match "Open Next.js Dev Tools" (its name contains "en" via "Op-en").
  await page.getByRole("button", { name: "EN", exact: true }).click();
}
