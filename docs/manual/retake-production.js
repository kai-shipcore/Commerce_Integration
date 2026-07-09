/**
 * 생산(Production) 그룹 스크린샷 캡처
 * 사용법: node docs/manual/retake-production.js <email> <password>
 *
 * 캡처 목록 (public/manual/screenshots/ 아래 저장):
 *   prod-01-seat-cover-parts.png   시트 커버 부품 그리드
 *   prod-02-vehicles.png           Vehicles 그리드
 *   prod-03-parts-codes.png        Parts & Codes (Part 탭)
 *   prod-04-part-sku-generator.png Part SKU Generator
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000/forecast";
const OUT = path.join(__dirname, "../../public/manual/screenshots");

(async () => {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node retake-production.js <email> <password>");
    process.exit(1);
  }

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  console.log("🔐 로그인 중...");
  await page.goto(`${BASE}/auth/signin`);
  await page.waitForLoadState("networkidle");
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.href.includes("/auth/"), { timeout: 30000 });
  console.log("✅ 로그인 성공");

  // ── 1. 시트 커버 부품
  console.log("📸 [1/4] 시트 커버 부품...");
  await page.goto(`${BASE}/production/seat-cover-parts`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "prod-01-seat-cover-parts.png"), fullPage: false });

  // ── 2. Vehicles
  console.log("📸 [2/4] Vehicles...");
  await page.goto(`${BASE}/production/vehicles`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "prod-02-vehicles.png"), fullPage: false });

  // ── 3. Parts & Codes
  console.log("📸 [3/4] Parts & Codes...");
  await page.goto(`${BASE}/production/parts-codes`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, "prod-03-parts-codes.png"), fullPage: false });

  // ── 4. Part SKU Generator
  console.log("📸 [4/4] Part SKU Generator...");
  await page.goto(`${BASE}/production/part-sku-generator`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, "prod-04-part-sku-generator.png"), fullPage: false });

  await browser.close();
  console.log("\n✅ 완료! public/manual/production_help.html 을 브라우저로 열어보세요.");
})();
