/**
 * Container Planning 컨테이너 수정 화면 스크린샷 캡처
 * 사용법: node docs/manual/retake-container-edit.js <email> <password>
 *
 * 캡처 목록:
 *   public/manual/screenshots/03b-container-edit.png
 *   public/manual/screenshots/03b-container-edit-en.png
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000/forecast";
const OUT = path.join(__dirname, "..", "..", "public", "manual", "screenshots");

async function setLocale(page, locale) {
  await page.evaluate((nextLocale) => {
    localStorage.setItem("app.locale", nextLocale);
    localStorage.setItem("demandpilot-locale", nextLocale);
    localStorage.setItem("sku-forecasts-language", nextLocale);
  }, locale);
}

async function clickLocale(page, locale) {
  const label = locale === "ko" ? "KO" : "EN";
  await page.getByRole("button", { name: label, exact: true }).click({ timeout: 10000 });
  await page.waitForTimeout(1000);
}

async function openEditableContainer(page, locale) {
  await setLocale(page, locale);
  await page.goto(`${BASE}/planning/container-planning`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await clickLocale(page, locale);

  await page.getByRole("button", { name: /Seat Cover/i }).click({ timeout: 10000 });
  await page.waitForTimeout(1200);

  const finalSeatCover = page.getByText("187-CA-SEAT", { exact: true });
  const draftSeatCover = page.getByText("213-CA-SEAT", { exact: true });
  if (await finalSeatCover.count()) {
    await finalSeatCover.click({ timeout: 10000 });
  } else {
    await draftSeatCover.click({ timeout: 10000 });
  }
  await page.waitForTimeout(1200);

  const editButtonName = locale === "ko" ? "수정" : "Edit";
  await page.getByRole("button", { name: editButtonName, exact: true }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1200);

  const expectedField = locale === "ko" ? "예상 선적일" : "Est. Loading";
  await page.getByText(expectedField).first().waitFor({ state: "visible", timeout: 10000 });
}

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node docs/manual/retake-container-edit.js <email> <password>");
    process.exit(1);
  }

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("🔐 로그인 중...");
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.href.includes("/auth/"), { timeout: 15000 });
  console.log("✅ 로그인 성공");

  console.log("📸 한글 컨테이너 수정 화면...");
  await openEditableContainer(page, "ko");
  await page.screenshot({
    path: path.join(OUT, "03b-container-edit.png"),
    fullPage: false,
  });
  console.log("   → public/manual/screenshots/03b-container-edit.png");

  console.log("📸 영문 컨테이너 수정 화면...");
  await openEditableContainer(page, "en");
  await page.screenshot({
    path: path.join(OUT, "03b-container-edit-en.png"),
    fullPage: false,
  });
  console.log("   → public/manual/screenshots/03b-container-edit-en.png");

  await browser.close();
  console.log("\n✅ 완료");
})();
