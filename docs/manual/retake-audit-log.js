/**
 * Audit Log 스크린샷 재캡처 (한국어 + 영어)
 * 사용법: node docs/manual/retake-audit-log.js <email> <password>
 *
 * 캡처 목록:
 *   07-audit-log.png     한국어 화면
 *   07-audit-log-en.png  영어 화면
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000/forecast";
const OUT  = path.join(__dirname, "../../public/manual/screenshots");

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node retake-audit-log.js <email> <password>");
    process.exit(1);
  }

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await context.newPage();

  // ── 로그인
  console.log("🔐 로그인 중...");
  await page.goto(`${BASE}/auth/signin`);
  await page.waitForLoadState("networkidle");
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.href.includes("/auth/"), { timeout: 30000 });
  console.log("✅ 로그인 성공");

  // ── 1. 한국어 화면
  console.log("📸 [1/2] 감사 로그 (한국어)...");
  await page.goto(`${BASE}/admin/audit-log`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    localStorage.setItem("demandpilot-locale", "ko");
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "07-audit-log.png"), fullPage: false });
  console.log("   → screenshots/07-audit-log.png");

  // ── 2. 영어 화면 — EN 버튼 클릭
  console.log("📸 [2/2] Audit Log (English)...");
  // EN 버튼 클릭 (상단 우측 KO/EN 토글)
  try {
    await page.click('button:has-text("EN")', { timeout: 5000 });
    await page.waitForTimeout(800);
  } catch (_) {
    // 버튼 못 찾으면 localStorage 방식으로 폴백
    await page.evaluate(() => {
      localStorage.setItem("demandpilot-locale", "en");
      localStorage.setItem("sku-forecasts-language", "en");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: path.join(OUT, "07-audit-log-en.png"), fullPage: false });
  console.log("   → screenshots/07-audit-log-en.png");

  await browser.close();
  console.log("\n✅ 완료! public/manual/index.html 을 브라우저로 열어보세요.");
})();
