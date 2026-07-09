/**
 * Invoice & Price Control (관리자 전용) 스크린샷 캡처
 * 사용법: node docs/manual/retake-invoice-price-control.js <email> <password>
 *
 * 캡처 목록 (public/manual/screenshots/ 아래 저장):
 *   ipc-01-invoice-list.png           Invoice 검수 탭 — 좌측 카드형 목록 + 우측 상세
 *   ipc-02-invoice-toolbar.png        상세 화면 상단 툴바 (수정/삭제/상태변경/파일 관리/이력 보기)
 *   ipc-03-sku-grid.png               SKU별 가격 검수 그리드 + 요약 카드
 *   ipc-04-bulk-export.png            차이 SKU 체크박스 선택 + "선택 항목 내보내기" 툴바
 *   ipc-05-audit-history.png          변경 이력 모달
 *   ipc-06-price-history-grid.png     Price History 탭 — 가격 입력 폼 + 그리드
 *   ipc-07-upload-history.png         업로드 파일 관리 목록
 *
 * 이 페이지는 admin 권한 계정으로만 정상적으로 캡처됩니다.
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000/forecast";
const OUT = path.join(__dirname, "../../public/manual/screenshots");

(async () => {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node retake-invoice-price-control.js <email> <password>");
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

  await page.goto(`${BASE}/production/invoice-price-control`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  // ── 1. Invoice 검수 탭 전체
  console.log("📸 [1/7] Invoice 검수 탭 (목록 + 상세)...");
  await page.screenshot({ path: path.join(OUT, "ipc-01-invoice-list.png"), fullPage: false });

  // ── 2. 상세 툴바 (첫 번째 Invoice 클릭)
  console.log("📸 [2/7] Invoice 상세 툴바...");
  try {
    await page.click('.cursor-pointer >> nth=0', { timeout: 5000 });
    await page.waitForTimeout(1000);
  } catch (_) {
    // 목록이 비어있으면 스킵
  }
  await page.screenshot({ path: path.join(OUT, "ipc-02-invoice-toolbar.png"), fullPage: false });

  // ── 3. SKU별 가격 검수 그리드 + 요약 카드
  console.log("📸 [3/7] SKU별 가격 검수 그리드...");
  await page.screenshot({ path: path.join(OUT, "ipc-03-sku-grid.png"), fullPage: false });

  // ── 4. 체크박스 선택 + 선택 항목 내보내기 툴바
  console.log("📸 [4/7] 차이 SKU 선택 + 내보내기 툴바...");
  try {
    await page.click('input[type="checkbox"][aria-label="차이가 있는 SKU 전체 선택"]', { timeout: 5000 });
    await page.waitForTimeout(500);
  } catch (_) {
    // 차이 SKU가 없는 Invoice면 스킵
  }
  await page.screenshot({ path: path.join(OUT, "ipc-04-bulk-export.png"), fullPage: false });

  // ── 5. 변경 이력 모달
  console.log("📸 [5/7] 변경 이력 모달...");
  try {
    await page.click('button:has-text("이력 보기")', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.click('text=변경 이력', { timeout: 5000 });
    await page.waitForTimeout(1000);
  } catch (_) {
    // 드롭다운 구조가 다르면 스킵
  }
  await page.screenshot({ path: path.join(OUT, "ipc-05-audit-history.png"), fullPage: false });
  try {
    await page.click('button:has-text("닫기")', { timeout: 3000 });
  } catch (_) {}

  // ── 6. Price History 탭
  console.log("📸 [6/7] Price History 탭...");
  await page.click('text=Price History', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "ipc-06-price-history-grid.png"), fullPage: false });

  // ── 7. 업로드 파일 관리 목록 (모달)
  console.log("📸 [7/7] 업로드 파일 관리...");
  try {
    await page.click('button:has-text("업로드 이력")', { timeout: 5000 });
    await page.waitForTimeout(1000);
  } catch (_) {
    // 버튼을 못 찾으면 스킵
  }
  await page.screenshot({ path: path.join(OUT, "ipc-07-upload-history.png"), fullPage: false });

  await browser.close();
  console.log("\n✅ 완료! public/manual/admin_help.html 을 브라우저로 열어보세요.");
})();
