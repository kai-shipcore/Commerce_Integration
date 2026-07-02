/**
 * 컨테이너 일정 – 월별 보기 & 스케줄 보기 스크린샷 캡처
 * 사용법: node docs/manual/retake-container-timeline-views.js <email> <password>
 *
 * 캡처 목록:
 *   public/manual/screenshots/03c-container-timeline-monthly.png      (월별 달력 보기, 한글)
 *   public/manual/screenshots/03c-container-timeline-monthly-en.png   (Month View, English)
 *   public/manual/screenshots/03c-container-timeline-schedule.png     (스케줄 보기, 한글)
 *   public/manual/screenshots/03c-container-timeline-schedule-en.png  (Schedule View, English)
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000/forecast";
const OUT = path.join(__dirname, "..", "..", "public", "manual", "screenshots");

async function setLocale(page, locale) {
  await page.evaluate((l) => {
    localStorage.setItem("app.locale", l);
    localStorage.setItem("demandpilot-locale", l);
  }, locale);
}

async function clickLocale(page, locale) {
  const label = locale === "ko" ? "KO" : "EN";
  try {
    await page.getByRole("button", { name: label, exact: true }).click({ timeout: 8000 });
    await page.waitForTimeout(800);
  } catch {}
}

async function openTimelineWithView(page, locale, viewValue) {
  await setLocale(page, locale);
  await page.goto(`${BASE}/planning/container-timeline`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500); // wait for DB prefs to load
  await clickLocale(page, locale);
  await page.waitForTimeout(600);

  // Step 1: open the period dropdown (the small trigger button next to "기간" label)
  const dropdownTrigger = page.locator("div.relative > button").filter({ hasText: /3개월|6개월|전체|월별|스케줄|3 Months|6 Months|All|Month|Schedule/i }).first();
  await dropdownTrigger.click({ timeout: 10000 });
  await page.waitForTimeout(400);

  // Step 2: click the option inside the open dropdown via JS (bypasses fixed overlay)
  const optionLabels = {
    monthly:  ["월별 보기", "Month View"],
    schedule: ["스케줄 보기", "Schedule View"],
  }[viewValue];

  const clicked = await page.evaluate((labels) => {
    // Options are inside div.absolute — find button containing one of the labels
    const candidates = Array.from(document.querySelectorAll("div.absolute button"));
    for (const btn of candidates) {
      const text = btn.textContent?.trim() ?? "";
      if (labels.some((l) => text.includes(l))) {
        btn.click();
        return true;
      }
    }
    return false;
  }, optionLabels);

  if (!clicked) throw new Error(`Period option not found: ${optionLabels.join(" / ")}`);
  await page.waitForTimeout(1800);
}

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node docs/manual/retake-container-timeline-views.js <email> <password>");
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

  // ── 한글 월별 보기 ────────────────────────────────────────────────────────
  console.log("\n📸 한글 – 월별 달력 보기...");
  await openTimelineWithView(page, "ko", "monthly");
  await page.screenshot({ path: path.join(OUT, "03c-container-timeline-monthly.png") });
  console.log("   → 03c-container-timeline-monthly.png");

  // ── 영문 월별 보기 ────────────────────────────────────────────────────────
  console.log("📸 영문 – Month View...");
  await openTimelineWithView(page, "en", "monthly");
  await page.screenshot({ path: path.join(OUT, "03c-container-timeline-monthly-en.png") });
  console.log("   → 03c-container-timeline-monthly-en.png");

  // ── 한글 스케줄 보기 ──────────────────────────────────────────────────────
  console.log("📸 한글 – 스케줄 보기...");
  await openTimelineWithView(page, "ko", "schedule");
  await page.screenshot({ path: path.join(OUT, "03c-container-timeline-schedule.png") });
  console.log("   → 03c-container-timeline-schedule.png");

  // ── 영문 스케줄 보기 ──────────────────────────────────────────────────────
  console.log("📸 영문 – Schedule View...");
  await openTimelineWithView(page, "en", "schedule");
  await page.screenshot({ path: path.join(OUT, "03c-container-timeline-schedule-en.png") });
  console.log("   → 03c-container-timeline-schedule-en.png");

  await browser.close();
  console.log("\n✅ 완료! 이제 매뉴얼을 열어 확인하세요.");
  console.log(`   open public/manual/index.html`);
})();
