/**
 * Container Timeline 상세 드로어 + 변경 이력 탭 스크린샷 캡처
 * 사용법: node docs/manual/retake-container-timeline-detail.js <email> <password>
 *
 * 캡처 목록:
 *   public/manual/screenshots/03d-container-timeline-detail.png       (SKU 목록 탭, 한글)
 *   public/manual/screenshots/03d-container-timeline-detail-en.png    (SKU List tab, 영문)
 *   public/manual/screenshots/03e-container-timeline-history.png      (변경 이력 탭, 한글)
 *   public/manual/screenshots/03e-container-timeline-history-en.png   (Change History tab, 영문)
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000/forecast";
const OUT = path.join(__dirname, "..", "..", "public", "manual", "screenshots");
const TARGET_CONTAINER = "175-CA-SEAT";

async function setLocale(page, locale) {
  await page.evaluate((nextLocale) => {
    localStorage.setItem("app.locale", nextLocale);
    localStorage.setItem("demandpilot-locale", nextLocale);
  }, locale);
}

async function clickLocale(page, locale) {
  const label = locale === "ko" ? "KO" : "EN";
  try {
    await page.getByRole("button", { name: label, exact: true }).click({ timeout: 8000 });
    await page.waitForTimeout(800);
  } catch {}
}

async function openTimelineAndSelectContainer(page, locale) {
  await setLocale(page, locale);
  await page.goto(`${BASE}/planning/container-timeline`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await clickLocale(page, locale);
  await page.waitForTimeout(800);

  // Seat Cover 필터 버튼 클릭 (있으면)
  try {
    await page.getByRole("button", { name: /Seat Cover/i }).click({ timeout: 5000 });
    await page.waitForTimeout(1200);
  } catch {}

  // 175-CA-SEAT 컨테이너 클릭
  const target = page.getByText(TARGET_CONTAINER, { exact: true }).first();
  await target.waitFor({ state: "visible", timeout: 15000 });
  await target.click();
  await page.waitForTimeout(1500);
}

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node docs/manual/retake-container-timeline-detail.js <email> <password>");
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

  // ── 한글 ────────────────────────────────────────────────────────────
  console.log(`\n📸 한글 — ${TARGET_CONTAINER} 선택 후 SKU 목록 탭...`);
  await openTimelineAndSelectContainer(page, "ko");
  await page.screenshot({ path: path.join(OUT, "03d-container-timeline-detail.png") });
  console.log("   → 03d-container-timeline-detail.png");

  console.log("📸 한글 — 변경 이력 탭 클릭...");
  const histTabKo = page.getByRole("button", { name: /변경 이력/i }).first();
  await histTabKo.click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "03e-container-timeline-history.png") });
  console.log("   → 03e-container-timeline-history.png");

  // ── 영문 ────────────────────────────────────────────────────────────
  console.log(`\n📸 영문 — ${TARGET_CONTAINER} 선택 후 SKU List 탭...`);
  await openTimelineAndSelectContainer(page, "en");
  await page.screenshot({ path: path.join(OUT, "03d-container-timeline-detail-en.png") });
  console.log("   → 03d-container-timeline-detail-en.png");

  console.log("📸 영문 — Change History 탭 클릭...");
  const histTabEn = page.getByRole("button", { name: /Change History/i }).first();
  await histTabEn.click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "03e-container-timeline-history-en.png") });
  console.log("   → 03e-container-timeline-history-en.png");

  await browser.close();
  console.log("\n✅ 완료! 이제 매뉴얼을 열어 확인하세요.");
})();
