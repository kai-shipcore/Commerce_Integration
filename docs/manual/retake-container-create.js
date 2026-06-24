/**
 * Container Planning 신규 컨테이너 등록 화면 스크린샷 캡처
 * 사용법: node docs/manual/retake-container-create.js <email> <password>
 *
 * 캡처 목록:
 *   public/manual/screenshots/03-container-planning.png
 *   public/manual/screenshots/03-container-planning-en.png
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

async function openNewContainerForm(page, locale) {
  await setLocale(page, locale);
  await page.goto(`${BASE}/planning/container-planning`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const localeButtonName = locale === "ko" ? "KO" : "EN";
  await page.getByRole("button", { name: localeButtonName, exact: true }).click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  const addButtonName = locale === "ko" ? "+ 컨테이너 추가" : "+ Add Container";
  await page.getByRole("button", { name: addButtonName }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1200);

  const expectedField = locale === "ko" ? "예상 선적일" : "Est. Loading";
  await page.getByText(expectedField).first().waitFor({ state: "visible", timeout: 10000 });
}

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node docs/manual/retake-container-create.js <email> <password>");
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

  console.log("📸 한글 신규 컨테이너 등록 화면...");
  await openNewContainerForm(page, "ko");
  await page.screenshot({
    path: path.join(OUT, "03-container-planning.png"),
    fullPage: true,
  });
  console.log("   → public/manual/screenshots/03-container-planning.png");

  console.log("📸 영문 신규 컨테이너 등록 화면...");
  await openNewContainerForm(page, "en");
  await page.screenshot({
    path: path.join(OUT, "03-container-planning-en.png"),
    fullPage: true,
  });
  console.log("   → public/manual/screenshots/03-container-planning-en.png");

  await browser.close();
  console.log("\n✅ 완료");
})();
