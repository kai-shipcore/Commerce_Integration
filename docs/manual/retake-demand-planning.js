/**
 * Demand Planning help screenshots.
 *
 * Uses E2E_TEST_EMAIL / E2E_TEST_PASSWORD from .env.e2e.local by default,
 * or accepts email and password as command-line arguments.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000/forecast";
const OUT = path.join(__dirname, "..", "..", "public", "manual", "screenshots");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

async function selectLocale(page, locale) {
  const label = locale === "ko" ? "KO" : "EN";
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(500);
}

async function prepareDashboard(page, locale) {
  await page.goto(`${BASE}/planning/dashboard-ag-grid`, { waitUntil: "networkidle" });
  await selectLocale(page, locale);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: locale === "ko" ? /컬럼/ : /Columns/ }).first().waitFor({ state: "visible" });
}

async function captureLocale(page, locale) {
  const suffix = locale === "ko" ? "" : "-en";
  const mainName = locale === "ko" ? "01-demand-planning.png" : "01-demand-planning_en.png";

  await prepareDashboard(page, locale);
  await page.screenshot({
    path: path.join(OUT, mainName),
    clip: { x: 0, y: 0, width: 1680, height: 1000 },
  });

  const columnsButton = page.getByRole("button", { name: locale === "ko" ? /컬럼/ : /Columns/ }).first();
  await columnsButton.click();
  const columnsPanel = page.locator(".dashboard-columns-popover");
  await columnsPanel.waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await columnsPanel.screenshot({ path: path.join(OUT, `dp-columns-panel${suffix}.png`) });
  await page.keyboard.press("Escape");
  await columnsPanel.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Seasonal factor settings", exact: true }).click();
  const planningPanel = page.locator('[data-slot="popover-content"]')
    .filter({ hasText: locale === "ko" ? "시즌지수 설정" : "Planning Settings" })
    .first();
  await planningPanel.waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await planningPanel.screenshot({ path: path.join(OUT, `dp-seasonal-factors${suffix}.png`) });
  await page.keyboard.press("Escape");
}

(async () => {
  const fileEnv = readEnvFile(path.join(__dirname, "..", "..", ".env.e2e.local"));
  const [, , emailArg, passwordArg] = process.argv;
  const email = emailArg || process.env.E2E_TEST_EMAIL || fileEnv.E2E_TEST_EMAIL;
  const password = passwordArg || process.env.E2E_TEST_PASSWORD || fileEnv.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("Provide credentials as arguments or configure E2E_TEST_EMAIL and E2E_TEST_PASSWORD.");
  }

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1680, height: 1200 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"], input[type="email"]', email);
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.href.includes("/auth/"), { timeout: 15000 });

    await captureLocale(page, "ko");
    await captureLocale(page, "en");
  } finally {
    await browser.close();
  }

  console.log("Demand Planning help screenshots updated.");
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
