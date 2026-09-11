import { test, expect, type Page } from "@playwright/test";
import type { DemandPlanningData, DemandPlanningContainerDetails } from "../src/types/demand-planning";
import type { ScenarioDetail, ScenarioOverlay } from "../src/features/planning/scenarios";
import { ALL_COLS, CON_SUBCOLS } from "../src/components/planning/dashboard/columns";
import ExcelJS from "exceljs";
import { DEFAULT_SALES_WINDOW_WEIGHTS, SALES_WINDOW_WEIGHTS_STORAGE_KEY } from "../src/lib/planning/sales-window-weights";

async function signIn(page: Page) {
  await page.goto("auth/signin");
  await page.locator("#email").fill(process.env.E2E_TEST_EMAIL ?? "");
  await page.locator("#password").fill(process.env.E2E_TEST_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(url => !url.pathname.includes("/auth/signin"));
}

for (const changed of [false, true]) {
  test(`delayed saved settings: ${changed ? "different values trigger a current read" : "equal values do not refetch"}`, async ({ page }) => {
    await signIn(page);
    const seedResponse = await page.request.get("api/planning/dashboard?mode=custom&product=sc");
    const seed = (await seedResponse.json()).data as DemandPlanningData;
    const template = seed.rows.find(row => row.sales_status === "Original")!;
    const containers = [seed.containers[0], {
      col: 1, container_id: 900001, name: "TEST-A", eta: "2026-12-01", cbm_cap: 60, status: "draft", categories: ["SC"],
    }];
    const columnVis = Object.fromEntries([
      ...ALL_COLS.map(c => [c.id, c.id === "sku"]),
      ...CON_SUBCOLS.map(c => ["con:" + c.id, c.id === "inb_qty"]),
    ]);
    const saved = changed
      ? { ...DEFAULT_SALES_WINDOW_WEIGHTS, d30: 0.4, d90: 0.05 }
      : { ...DEFAULT_SALES_WINDOW_WEIGHTS };
    const weights: unknown[] = [];
    const detailWeights: unknown[] = [];
    let releasePreferences!: () => void;
    const preferenceWait = new Promise<void>(resolve => { releasePreferences = resolve; });
    await page.route("**/api/**", async route => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname.replace("/forecast", "");
      const ok = (data: unknown) => route.fulfill({ json: { success: true, data } });
      if (req.method() !== "GET") return ok({});
      if (path === "/api/user/preferences") {
        await preferenceWait;
        return ok({ "app.locale": "en", [SALES_WINDOW_WEIGHTS_STORAGE_KEY]: saved,
          "planning-dashboard-column-settings": { columnVis, showZeroSales: true },
        });
      }
      if (path === "/api/planning/scenarios") return ok([]);
      if (path.startsWith("/api/planning/sku-")) return ok({});
      if (path.startsWith("/api/planning/dashboard")) {
        const requested = JSON.parse(url.searchParams.get("salesWeights")!);
        if (path.endsWith("/container-details")) {
          detailWeights.push(requested);
          return ok({ containers, rows: [] });
        }
        weights.push(requested);
        return ok({ ...seed, containers, rows: [{
          ...template, sku: requested.d30 === 0.4 ? "CA-SC-10-F-10-LATEST-1TO" : "CA-SC-10-F-10-DEFAULT-1TO", containers: {},
        }] });
      }
      return route.continue();
    });
    await page.goto("planning/dashboard-ag-grid?product=sc");
    await expect(page.locator('.ag-center-cols-container .ag-row[row-id="CA-SC-10-F-10-DEFAULT-1TO"]')).toBeAttached();
    releasePreferences();
    // Wait for saved settings to actually hydrate, including the equal case.
    await page.waitForFunction(key => window.localStorage.getItem(key) !== null, SALES_WINDOW_WEIGHTS_STORAGE_KEY);
    if (changed) await expect(page.locator('.ag-center-cols-container .ag-row[row-id="CA-SC-10-F-10-LATEST-1TO"]')).toBeAttached();
    await expect.poll(() => detailWeights.at(-1)).toEqual(saved);
    expect(weights).toEqual(changed ? [DEFAULT_SALES_WINDOW_WEIGHTS, saved] : [saved]);
  });
}

test("live read-only API comparison: old and lightweight details match", async ({ page }) => {
  test.setTimeout(180000);
  await signIn(page);
  const results = [];
  for (const query of [
    "mode=custom&product=sc",
    "mode=link&product=cc,swc,ac",
    "mode=custom&product=fm&includeDrafts=1",
    "mode=link&product=sc&asOf=2026-08-01",
  ]) {
    const oldResponse = await page.request.get("api/planning/dashboard?" + query + "&includeContainers=1&rawContainers=1");
    expect(oldResponse.ok()).toBeTruthy();
    const oldBody = await oldResponse.body();
    const old = JSON.parse(oldBody.toString()).data as DemandPlanningData;
    const nextResponse = await page.request.get("api/planning/dashboard/container-details?" + query);
    expect(nextResponse.ok()).toBeTruthy();
    const nextBody = await nextResponse.body();
    const next = JSON.parse(nextBody.toString()).data as DemandPlanningContainerDetails;
    expect(next.containers).toEqual(old.containers);
    const bySku = new Map(next.rows.map(row => [row.sku, row.containers]));
    for (const row of old.rows) expect(bySku.get(row.sku) ?? {}).toEqual(row.containers);
    results.push({ query, rows: old.rows.length, oldBytes: oldBody.length, newBytes: nextBody.length });
  }
  await test.info().attach("payload-comparison", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  console.log(JSON.stringify(results));
});

test("isolated grid workflow: filtering, copy, edits, tabs, duplicate and apply", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page);
  const seedResponse = await page.request.get("api/planning/dashboard?mode=custom&product=sc");
  const seed = (await seedResponse.json()).data as DemandPlanningData;
  const template = seed.rows.find(row => row.sales_status === "Original")!;
  expect(template).toBeTruthy();
  const rows = [1, 2, 3].map((n) => ({
    ...template, sku: `CA-SC-10-F-10-TEST${n}-1TO`, cbm_per_unit: 0.1,
    west_available_stock: 0, east_available_stock: 0, transit_stock: 0, back: 0,
    total_avg_curr: 2, total_30d: 60,
    case_qty: 1, moq: 1, order_multiple: 1, containers: {},
  }));
  const base = seed.containers[0];
  const header = { col: 1, container_id: 900001, name: "TEST-A", eta: "2026-12-01", cbm_cap: 60, status: "draft", categories: ["SC"] };
  const live: DemandPlanningData = { ...seed, containers: [base, header], rows };
  const detail: DemandPlanningContainerDetails = { containers: live.containers, rows: rows.map((row, i) => ({
    sku: row.sku, containers: { "TEST-A": {
      item_id: 910001 + i, cbm_unit: 0.1, inbound_qty: (i + 1) * 10, allocated_remaining_qty: 0,
      avail_qty: (i + 1) * 10, cbm: i + 1, eta: header.eta,
      open_orders: null, est_sales: null, backorder: null, inv_life: null, est_sod: null, plan_sod: null,
    } },
  })) };
  const columnVis = Object.fromEntries([
    ...ALL_COLS.map(c => [c.id, ["sku", "cbm"].includes(c.id)]),
    ...CON_SUBCOLS.map(c => ["con:" + c.id, ["inb_qty", "avail", "carry"].includes(c.id)]),
  ]);
  const preferences: Record<string, unknown> = {
    "app.locale": "en",
    "planning-dashboard-column-settings": { columnVis, freezeUntil: "sku", showZeroSales: true },
  };
  const scenarios: ScenarioDetail[] = [];
  const overlays = new Map<string, ScenarioOverlay>();
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let dashboardReads = 0;
  let detailReads = 0;
  // All writes below are fulfilled in memory, never sent to the real server.
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/forecast", "");
    const body = req.method() === "GET" ? {} : req.postDataJSON() ?? {};
    const ok = (data: unknown = {}) => route.fulfill({ json: { success: true, data } });
    if (req.method() !== "GET") writes.push({ path, body });
    if (path === "/api/user/preferences") return ok(preferences);
    if (path === "/api/planning/dashboard") { dashboardReads++; return ok(live); }
    if (path === "/api/planning/dashboard/container-details") { detailReads++; return ok(detail); }
    if (path.startsWith("/api/planning/sku-")) return ok({});
    if (path === "/api/planning/stats/refresh") return ok({ jobId: "test", status: "succeeded" });
    if (path === "/api/planning/scenarios" && req.method() === "GET") return ok(scenarios);
    if (path === "/api/planning/scenarios" && req.method() === "POST") {
      const s: ScenarioDetail = {
        id: String(scenarios.length + 1), name: String(body.name), owner_user_id: "test",
        is_owner: true, visibility: "private", locked_by: null, locked_at: null,
        can_edit: true, sort_order: scenarios.length, color: null, view_state: body.view_state,
      };
      scenarios.push(s);
      overlays.set(s.id, { items: detail.rows.map(r => ({
        container_id: String(header.container_id), master_sku: r.sku, qty: r.containers["TEST-A"].inbound_qty!,
      })), containers: [] });
      return ok(s);
    }
    const match = path.match(/^\/api\/planning\/scenarios\/(\d+)(?:\/(.*))?$/);
    if (match) {
      const [, id, action] = match;
      const s = scenarios.find(s => s.id === id)!;
      const overlay = overlays.get(id)!;
      if (action === "items") {
        if (req.method() === "PUT") {
          for (const item of body.items ?? []) {
            const existing = overlay.items.find(i => i.master_sku === item.master_sku && i.container_id === String(item.container_id));
            if (existing) existing.qty = item.qty;
            else overlay.items.push({ ...item, container_id: String(item.container_id) });
          }
          for (const c of body.containers ?? []) overlay.containers = [{ ...c, container_id: String(c.container_id) }];
        }
        return ok(overlay);
      }
      if (action === "duplicate") {
        const duplicate = { ...s, id: String(scenarios.length + 1), name: String(body.name) };
        scenarios.push(duplicate);
        overlays.set(duplicate.id, structuredClone(overlay));
        return ok(duplicate);
      }
      if (action === "apply") {
        const changed = overlay.items.filter(i => i.qty !== detail.rows.find(r => r.sku === i.master_sku)!.containers["TEST-A"].inbound_qty)
          .map(i => ({ container_id: header.container_id, master_sku: i.master_sku, from: 10, to: i.qty }));
        if (body.confirm) for (const item of overlay.items) {
          detail.rows.find(r => r.sku === item.master_sku)!.containers["TEST-A"].inbound_qty = item.qty;
        }
        return ok({ added: [], changed, removed: [], eta_changes: [], applied: body.confirm ? changed.length : 0, preview: !body.confirm });
      }
      if (req.method() === "PATCH") Object.assign(s, body);
      return ok(s);
    }
    if (req.method() !== "GET") return ok();
    return route.continue();
  });
  await page.goto("planning/dashboard-ag-grid?product=sc");
  const cell = (sku: string) => page.locator(`.ag-row[row-id="${sku}"] [col-id="TEST-A::inb_qty"]`);
  await expect(cell(rows[0].sku)).toHaveText("10");
  await expect.poll(() => detailReads).toBe(1);
  await expect.poll(() => dashboardReads).toBe(1);
  await page.locator('.ag-header-cell[col-id="sku"]').click({ button: "right" });
  await page.getByText("Sort Z → A", { exact: true }).click();
  await expect(page.locator('.ag-row[row-index="0"] [col-id="sku"]')).toContainText("TEST3");
  const search = page.getByPlaceholder("Search SKU / container...");
  await search.fill("TEST2");
  await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel", exact: true }).click();
  const download = await downloading;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  const exported = JSON.stringify(workbook.worksheets[0].getSheetValues());
  expect(exported).toContain(rows[1].sku);
  expect(exported).not.toContain(rows[0].sku);
  await search.fill("");
  await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(3);
  await page.getByRole("button", { name: "Copy Live", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy of Live", exact: true })).toBeVisible();
  await expect(cell(rows[0].sku)).toHaveText("10");
  await cell(rows[0].sku).dblclick();
  await cell(rows[0].sku).locator("input").fill("17");
  await cell(rows[0].sku).locator("input").press("Enter");
  await expect.poll(() => overlays.get("1")?.items[0].qty).toBe(17);
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(cell(rows[0].sku)).toHaveText("10");
  await page.getByRole("button", { name: "Copy of Live", exact: true }).click();
  await expect(cell(rows[0].sku)).toHaveText("17");
  await page.getByRole("button", { name: "Tab menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect.poll(() => scenarios.length).toBe(2);
  await expect(cell(rows[0].sku)).toHaveText("17");
  await page.getByRole("button", { name: "Tab menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Apply to Live", exact: false }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Apply 1 change", exact: true }).click();
  await expect.poll(() => detail.rows[0].containers["TEST-A"].inbound_qty).toBe(17);
  expect(writes.some(w => w.path.endsWith("/2/apply") && w.body.confirm === true)).toBe(true);
  await page.locator('.ag-header-group-cell input[type="date"]').first().click();
  await page.getByLabel("Edit TEST-A ETA").fill("2026-12-15");
  await expect.poll(() => overlays.get("2")?.containers[0]?.eta_date).toBe("2026-12-15");
  await page.getByRole("button", { name: /Calculate automatic order for a fixed/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Fixed-target automatic order calculation");
  const priorWrites = writes.filter(w => w.path.endsWith("/2/items")).length;
  await page.getByRole("dialog").getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cell(rows[0].sku)).not.toHaveText("17");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "💾", exact: true }).click();
  await expect.poll(() => writes.filter(w => w.path.endsWith("/2/items")).length).toBeGreaterThan(priorWrites);
  await page.reload();
  await expect(page.getByRole("button", { name: /Copy of Copy of Live/ })).toBeVisible();
  const storedQty = overlays.get("2")!.items.find(i => i.master_sku === rows[0].sku)!.qty;
  await expect(cell(rows[0].sku)).toHaveText(storedQty ? storedQty.toLocaleString("en-US") : "");
});

test("request races: obsolete detail is ignored and failed detail retries after Sync", async ({ page }) => {
  test.setTimeout(90000);
  await signIn(page);
  const seedResponse = await page.request.get("api/planning/dashboard?mode=custom&product=sc");
  const seed = (await seedResponse.json()).data as DemandPlanningData;
  const template = seed.rows.find(row => row.sales_status === "Original")!;
  const columns = Object.fromEntries([
    ...ALL_COLS.map(c => [c.id, c.id === "sku"]),
    ...CON_SUBCOLS.map(c => ["con:" + c.id, c.id === "inb_qty"]),
  ]);
  const header = { col: 1, container_id: 900001, name: "TEST-A", eta: "2026-12-01", cbm_cap: 60, status: "draft", categories: ["SC", "FM"] };
  let releaseOld!: () => void;
  const oldWait = new Promise<void>(resolve => { releaseOld = resolve; });
  let scDetails = 0;
  let failNext = false;
  let failures = 0;
  let syncs = 0;
  await page.route("**/api/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/forecast", "");
    const ok = (data: unknown) => route.fulfill({ json: { success: true, data } });
    if (path === "/api/user/preferences") return ok({
      "app.locale": "en", "planning-dashboard-column-settings": { columnVis: columns, showZeroSales: true },
    });
    if (path === "/api/planning/scenarios") return ok([]);
    if (path.startsWith("/api/planning/sku-")) return ok({});
    if (path === "/api/planning/stats/refresh") { syncs++; return ok({ jobId: "test", status: "succeeded" }); }
    if (path.startsWith("/api/planning/dashboard")) {
      const fm = url.searchParams.get("product") === "fm";
      const row = { ...template, sku: fm ? "CA-FM-10-F-10-BK" : "CA-SC-10-F-10-TEST-1TO", category_code: fm ? "FM" : "SC", containers: {} };
      if (path === "/api/planning/dashboard") return ok({ ...seed, rows: [row], containers: [seed.containers[0], header] });
      if (!fm) scDetails++;
      const obsolete = !fm && scDetails === 1;
      if (obsolete) {
        await oldWait;
      }
      if (failNext) {
        failNext = false;
        failures++;
        return route.fulfill({ status: 503, json: { success: false, error: "test unavailable" } });
      }
      return ok({ containers: [seed.containers[0], header], rows: [{
        sku: row.sku, containers: { "TEST-A": {
          item_id: 910001, cbm_unit: 0.1, inbound_qty: obsolete ? 11 : fm ? 22 : 77, avail_qty: fm ? 22 : 77,
          cbm: 7.7, allocated_remaining_qty: 0, eta: header.eta,
          open_orders: null, est_sales: null, backorder: null, inv_life: null, est_sod: null, plan_sod: null,
        } },
      }] });
    }
    if (req.method() !== "GET") return ok({});
    return route.continue();
  });
  await page.goto("planning/dashboard-ag-grid?product=sc");
  await expect.poll(() => scDetails).toBe(1);
  // Change scope on the mounted component while the old detail read waits.
  await page.getByRole("combobox", { name: "Product category" }).selectOption("fm");
  await expect(page.locator('.ag-row[row-id="CA-FM-10-F-10-BK"] [col-id="TEST-A::inb_qty"]')).toHaveText("22");
  await page.getByRole("combobox", { name: "Product category" }).selectOption("sc");
  const currentCell = page.locator('.ag-row[row-id="CA-SC-10-F-10-TEST-1TO"] [col-id="TEST-A::inb_qty"]');
  await expect(currentCell).toHaveText("77");
  releaseOld();
  await expect(currentCell).toHaveText("77");
  failNext = true;
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await expect.poll(() => failures).toBe(1);
  await expect(page.getByRole("button", { name: "Sync", exact: true })).toBeEnabled();
  await expect(page.getByText("Container details failed: HTTP 503", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await expect.poll(() => syncs).toBe(2);
  await expect(currentCell).toHaveText("77");
  await expect(page.getByText("Container details failed: HTTP 503", { exact: false })).not.toBeVisible();
});
