/**
 * SKU Planning 탭별 스크린샷 캡처 (한국어 모드)
 * 사용법: node docs/manual/retake-sku.js <email> <password>
 *
 * 캡처 목록:
 *   02-sku-planning.png   전체 화면 (SKU 선택 전)
 *   02a-sku-sales.png     판매 분석 탭
 *   02b-sku-inventory.png 재고 및 입고 탭
 *   02c-sku-recommend.png 컨테이너 추천 탭
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000/forecast";
const OUT  = path.join(__dirname, "screenshots");

async function setKorean(page) {
  await page.evaluate(() => {
    localStorage.setItem("sku-forecasts-language", "ko");
  });
}

async function clickFirstSku(page) {
  // SKU 행은 grid-cols 클래스를 가진 button — 탭 버튼(rounded-full/rounded-lg)과 구분
  const selectors = [
    'button[class*="grid-cols-"][class*="w-full"]',
    'button[class*="grid w-full"]',
    // 가상 스크롤러 내부: 첫 번째 button 중 SKU명처럼 보이는 텍스트
    '.overflow-y-auto button',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: "visible", timeout: 5000 });
      await loc.click();
      console.log(`   ✅ SKU 클릭 (${sel})`);
      return true;
    } catch (_) { /* 다음 셀렉터 시도 */ }
  }
  console.warn("   ⚠️  SKU 자동 클릭 실패");
  return false;
}

async function clickTab(page, koName, enName) {
  for (const name of [koName, enName]) {
    try {
      await page.getByRole("tab", { name }).click({ timeout: 5000 });
      await page.waitForTimeout(1800);
      return true;
    } catch (_) { /* 다음 시도 */ }
  }
  console.warn(`   ⚠️  탭 클릭 실패: ${koName}`);
  return false;
}

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node retake-sku.js <email> <password>");
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
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.href.includes("/auth/"), { timeout: 15000 });
  console.log("✅ 로그인 성공");

  // ── 1. 전체 화면 — 한국어 설정 후 리로드
  console.log("📸 [1/4] SKU Planning 전체 화면 (한국어)...");
  await page.goto(`${BASE}/planning/sku-forecasts`);
  await page.waitForLoadState("networkidle");
  await setKorean(page);          // localStorage 설정
  await page.reload();            // 리로드해야 언어 반영
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, "02-sku-planning.png"), fullPage: true });
  console.log("   → 02-sku-planning.png");

  // ── 첫 번째 SKU 선택
  console.log("   첫 번째 SKU 클릭 중...");
  await clickFirstSku(page);
  await page.waitForTimeout(2000);

  // ── 2. 판매 분석 탭
  console.log("📸 [2/4] 판매 분석 탭...");
  await clickTab(page, "판매 분석", "Sales Analysis");
  await page.screenshot({ path: path.join(OUT, "02a-sku-sales.png"), fullPage: false });
  console.log("   → 02a-sku-sales.png");

  // ── 3. 재고 및 입고 탭
  console.log("📸 [3/4] 재고 및 입고 탭...");
  const ok3 = await clickTab(page, "재고 및 입고", "Inventory & Inbound");
  if (ok3) {
    await page.screenshot({ path: path.join(OUT, "02b-sku-inventory.png"), fullPage: false });
    console.log("   → 02b-sku-inventory.png");
  }

  // ── 4. 컨테이너 추천 탭
  console.log("📸 [4/4] 컨테이너 추천 탭...");
  const ok4 = await clickTab(page, "컨테이너 추천", "Container Recommendation");
  if (ok4) {
    await page.screenshot({ path: path.join(OUT, "02c-sku-recommend.png"), fullPage: false });
    console.log("   → 02c-sku-recommend.png");
  }

  await browser.close();
  console.log("\n✅ 완료! docs/manual/index.html 을 브라우저로 열어보세요.");
})();
