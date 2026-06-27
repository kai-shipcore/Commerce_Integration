/**
 * Container Planning 메인 목록 + 175-CA-SEAT 선택 화면 스크린샷 캡처
 * 사용법: node docs/manual/retake-container-planning.js <email> <password>
 *
 * 캡처 목록:
 *   public/manual/screenshots/03-container-planning.png       (한글, 175-CA-SEAT 선택)
 *   public/manual/screenshots/03-container-planning-en.png   (영문, 175-CA-SEAT selected)
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000/forecast";
const OUT = path.join(__dirname, "..", "..", "public", "manual", "screenshots");
const TARGET = "175-CA-SEAT";

async function setLocale(page, locale) {
  await page.evaluate((l) => {
    localStorage.setItem("app.locale", l);
    localStorage.setItem("demandpilot-locale", l);
    localStorage.setItem("sku-forecasts-language", l);
  }, locale);
}

async function clickLocale(page, locale) {
  const label = locale === "ko" ? "KO" : "EN";
  try {
    await page.getByRole("button", { name: label, exact: true }).click({ timeout: 8000 });
    await page.waitForTimeout(800);
  } catch {}
}

async function loadAndSelect(page, locale) {
  await setLocale(page, locale);
  await page.goto(`${BASE}/planning/container-planning`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await clickLocale(page, locale);
  await page.waitForTimeout(800);

  // Seat Cover 필터 클릭
  try {
    await page.getByRole("button", { name: /Seat Cover/i }).click({ timeout: 6000 });
    await page.waitForTimeout(1500);
  } catch {}

  // 175-CA-SEAT 컨테이너가 보일 때까지 대기 후 클릭
  const target = page.getByText(TARGET, { exact: true }).first();
  await target.waitFor({ state: "visible", timeout: 15000 });
  await target.click();
  await page.waitForTimeout(1500);
}

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node docs/manual/retake-container-planning.js <email> <password>");
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

  // 한글
  console.log(`\n📸 한글 — ${TARGET} 선택 화면...`);
  await loadAndSelect(page, "ko");
  await page.screenshot({ path: path.join(OUT, "03-container-planning.png") });
  console.log("   → public/manual/screenshots/03-container-planning.png");

  // 영문
  console.log(`\n📸 영문 — ${TARGET} selected...`);
  await loadAndSelect(page, "en");
  await page.screenshot({ path: path.join(OUT, "03-container-planning-en.png") });
  console.log("   → public/manual/screenshots/03-container-planning-en.png");

  await browser.close();
  console.log("\n✅ 완료");
})();
