/**
 * Demand Pilot 매뉴얼 스크린샷 자동 캡처
 * 사용법: node docs/manual/take-screenshots.js <email> <password>
 * 예시:   node docs/manual/take-screenshots.js kai.c@shipcore.com mypassword
 */

const { chromium } = require("playwright");
const path = require("path");

const BASE = "http://localhost:3000/forecast";
const OUT  = path.join(__dirname, "screenshots");

const PAGES = [
  { id: "01-demand-planning",  url: "/planning/dashboard-ag-grid", wait: 4000, fullPage: true  },
  { id: "01b-demand-filters",  url: "/planning/dashboard-ag-grid", wait: 4000, fullPage: false, clip: { x:0, y:0, width:1400, height:120 } },
  { id: "01c-autofill",        url: "/planning/dashboard-ag-grid", wait: 4000, fullPage: false, clip: { x:0, y:55, width:1400, height:70 } },
  { id: "02-sku-planning",     url: "/planning/sku-forecasts",     wait: 4000, fullPage: true  },
  { id: "02a-sku-sales",       url: "/planning/sku-forecasts",     wait: 4000, fullPage: false },
  { id: "03-container-planning", url: "/planning/container-planning", wait: 3000, fullPage: true },
  { id: "03a-container-detail",  url: "/planning/container-planning", wait: 3000, fullPage: false },
  { id: "04-available-stock",  url: "/planning/available-stock",   wait: 2000, fullPage: true  },
  { id: "05-sku-master",       url: "/planning/sku-master",        wait: 2000, fullPage: true  },
];

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error("사용법: node take-screenshots.js <email> <password>");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await context.newPage();

  // 로그인
  console.log("🔐 로그인 중...");
  await page.goto(`${BASE}/auth/signin`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.href.includes("/auth/"), { timeout: 10000 });
  console.log("✅ 로그인 성공");

  const fs = require("fs");
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  for (const p of PAGES) {
    console.log(`📸 캡처: ${p.id}`);
    await page.goto(`${BASE}${p.url}`);
    await page.waitForTimeout(p.wait);
    const opts = { path: path.join(OUT, `${p.id}.png`), fullPage: !!p.fullPage };
    if (p.clip) opts.clip = p.clip;
    await page.screenshot(opts);
    console.log(`   → screenshots/${p.id}.png`);
  }

  await browser.close();
  console.log("\n✅ 완료! docs/manual/index.html 을 브라우저로 열어보세요.");
})();
