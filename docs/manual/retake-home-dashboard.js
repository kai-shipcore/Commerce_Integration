/**
 * 커맨드 센터(홈 대시보드) 스크린샷 캡처
 * 사용법: node docs/manual/retake-home-dashboard.js <email> <password>
 */

const { chromium } = require("playwright");
const path = require("path");

const BASE = "http://localhost:3000/forecast";
const OUT  = path.join(__dirname, "..", "..", "public", "manual", "screenshots");

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node retake-home-dashboard.js <email> <password>");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
  const page    = await context.newPage();

  console.log("🔐 로그인 중...");
  await page.goto(`${BASE}/auth/signin`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.href.includes("/auth/"), { timeout: 10000 });
  console.log("✅ 로그인 성공");

  // ── 한글 화면 캡처 — KO 버튼 명시적 클릭 ───────────────────────────
  console.log("📸 한글 화면 준비 중...");
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(4000);
  await page.click('button:has-text("KO")');
  await page.waitForTimeout(2500); // 도넛 차트 애니메이션 완료 대기

  const contentHeight = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) return Math.ceil(main.getBoundingClientRect().bottom + 16);
    return Math.ceil(document.body.getBoundingClientRect().height);
  });
  console.log(`   콘텐츠 높이(KO): ${contentHeight}px`);

  console.log("📸 커맨드 센터 전체 화면 캡처...");
  await page.screenshot({ path: path.join(OUT, "00-command-center.png"), fullPage: false, clip: { x: 0, y: 0, width: 1440, height: contentHeight } });
  console.log("   → 00-command-center.png");

  console.log("📸 KPI 카드 영역 캡처...");
  await page.screenshot({ path: path.join(OUT, "00a-command-center-kpi.png"), fullPage: false, clip: { x: 0, y: 58, width: 1440, height: 300 } });
  console.log("   → 00a-command-center-kpi.png");

  console.log("📸 3패널 그리드 캡처...");
  await page.screenshot({ path: path.join(OUT, "00b-command-center-panels.png"), fullPage: false, clip: { x: 0, y: 335, width: 1440, height: 430 } });
  console.log("   → 00b-command-center-panels.png");

  console.log("📸 판매 추세 섹션 캡처...");
  await page.screenshot({ path: path.join(OUT, "00c-command-center-sales.png"), fullPage: false, clip: { x: 0, y: 740, width: 1440, height: 400 } });
  console.log("   → 00c-command-center-sales.png");

  // ── 영문 화면 전체 캡처 ──────────────────────────────────────────────
  console.log("📸 영문 화면 준비 중...");
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(4000);
  await page.click('button:has-text("EN")');
  await page.waitForTimeout(2500); // 도넛 차트 애니메이션 완료 대기

  const contentHeightEn = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) return Math.ceil(main.getBoundingClientRect().bottom + 16);
    return Math.ceil(document.body.getBoundingClientRect().height);
  });
  console.log(`   콘텐츠 높이(EN): ${contentHeightEn}px`);

  console.log("📸 커맨드 센터 영문 전체 화면 캡처...");
  await page.screenshot({ path: path.join(OUT, "00-command-center-en.png"), fullPage: false, clip: { x: 0, y: 0, width: 1440, height: contentHeightEn } });
  console.log("   → 00-command-center-en.png");

  console.log("📸 KPI 카드 영역 영문 캡처...");
  await page.screenshot({ path: path.join(OUT, "00a-command-center-kpi-en.png"), fullPage: false, clip: { x: 0, y: 58, width: 1440, height: 300 } });
  console.log("   → 00a-command-center-kpi-en.png");

  console.log("📸 3패널 그리드 영문 캡처...");
  await page.screenshot({ path: path.join(OUT, "00b-command-center-panels-en.png"), fullPage: false, clip: { x: 0, y: 335, width: 1440, height: 430 } });
  console.log("   → 00b-command-center-panels-en.png");

  console.log("📸 판매 추세 영문 캡처...");
  await page.screenshot({ path: path.join(OUT, "00c-command-center-sales-en.png"), fullPage: false, clip: { x: 0, y: 740, width: 1440, height: 400 } });
  console.log("   → 00c-command-center-sales-en.png");

  await browser.close();
  console.log("\n✅ 완료! public/manual/screenshots/ 폴더를 확인하세요.");
})();
