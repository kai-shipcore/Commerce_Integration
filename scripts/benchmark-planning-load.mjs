// Read-only browser benchmark. Prevent dashboard autosaves during measurement.
import { chromium } from 'playwright';
import { config } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
config({ path: '.env.e2e.local', quiet: true });
const label = process.argv[2] ?? 'baseline';
const browser = await chromium.launch({ headless: true });
try {
  const auth = await browser.newContext();
  const page = await auth.newPage();
  await page.goto('http://localhost:3000/forecast/auth/signin');
  await page.locator('#email').fill(process.env.E2E_TEST_EMAIL ?? '');
  await page.locator('#password').fill(process.env.E2E_TEST_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(url => !url.pathname.includes('/auth/signin'), { timeout: 30000 });
  const storageState = await auth.storageState();
  await auth.close();
  const results = [];
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
    await context.route('**/api/**', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        return route.fulfill({ json: { success: true } });
      }
      return route.continue();
    });
    const tab = await context.newPage();
    for (const visit of ['first', 'repeat']) {
      const requests = [];
      const bodies = [];
      const started = Date.now();
      let summary;
      let detailDone;
      const detailsReceived = new Promise(resolve => { detailDone = resolve; });
      const responseHandler = response => {
        if (!response.url().includes('/api/planning/dashboard')) return;
        bodies.push((async () => {
          const body = await response.body();
          const json = JSON.parse(body.toString());
          if (!response.url().includes('includeContainers') && !response.url().includes('container-details')) summary = json;
          else detailDone();
          requests.push({ path: new URL(response.url()).pathname, query: new URL(response.url()).search,
            status: response.status(), cache: response.headers()['x-planning-dashboard-cache'], bytes: body.length, finishedMs: Date.now() - started });
        })().catch(() => {}));
      };
      tab.on('response', responseHandler);
      await tab.goto('http://localhost:3000/forecast/planning/dashboard-ag-grid?product=sc');
      await tab.locator('.ag-center-cols-container .ag-row').first().waitFor({ timeout: 120000 });
      const firstRowsMs = Date.now() - started;
      await detailsReceived;
      // A response may finish before React commits it. Let its update reach
      // the browser before checking the calculation/loading overlay.
      await tab.waitForTimeout(250);
      await tab.waitForFunction(() => [...document.querySelectorAll('.ag-header-cell')].some(el => el.getAttribute('col-id')?.includes('::inb_qty')), { timeout: 120000 });
      await tab.waitForFunction(() => !/컨테이너 데이터 로딩 중|Loading container data/.test(document.body.innerText), { timeout: 120000 });
      await Promise.all(bodies);
      const completeMs = Date.now() - started;
      tab.off('response', responseHandler);
      results.push({ run: i + 1, visit, firstRowsMs, completeMs, requests, rows: summary?.data?.rows?.length });
      console.log(JSON.stringify(results.at(-1)));
    }
    await context.close();
  }
  await mkdir('tmp/planning-performance', { recursive: true });
  await writeFile(`tmp/planning-performance/planning-load-${label}.json`, JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
