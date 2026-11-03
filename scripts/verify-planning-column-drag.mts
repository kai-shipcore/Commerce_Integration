/** Full dashboard regression, synthetic data only. No requests reach a real API. */
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ALL_COLS, COLUMN_ORDER_STORAGE_KEY } = require("../src/components/planning/dashboard/columns") as typeof import("../src/components/planning/dashboard/columns");
const { normalizeFormulaConfig, FORMULAS_STORAGE_KEY } = require("../src/lib/planning/custom-formulas") as typeof import("../src/lib/planning/custom-formulas");

const visible = ["row_num", "cbm", "back", "status", "sku", "fullerton", "canary", "ttm", "ttm_jeff", "west", "east", "total", "transit", "wfbm30", "efbm30", "fba30", "tot30", "tavg_p", "tavg_r", "tavg_c", "inb_qty", "inb_lst", "next_eta", "sod"];
let preferences: Record<string, unknown> = {
  [FORMULAS_STORAGE_KEY]: normalizeFormulaConfig(null).map((column) => ({ ...column, enabled: true })),
  "planning-dashboard-column-settings": {
    columnVis: Object.fromEntries(ALL_COLS.map((column) => [column.id, visible.includes(column.id)])),
    freezeUntil: "sod", compactMode: false, showZeroSales: true,
  },
};
const mockModules: Record<string, string> = {
  "next/navigation": `const router={push(){},replace(){},refresh(){}}; const params=new URLSearchParams('product=sc'); export const useRouter=()=>router; export const useSearchParams=()=>params;`,
  "next/dynamic": `import {lazy,createElement,Suspense} from 'react'; export default function dynamic(load){ const Component=lazy(()=>load().then(defaultExport=>({default:defaultExport}))); return props=>createElement(Suspense,{fallback:null},createElement(Component,props)); }`,
  "@/lib/hooks/use-permissions": `const can=()=>true; export const usePermissions=()=>({can,ready:true});`,
};
const server = await createServer({
  configFile: false,
  resolve: { alias: [
    ...Object.keys(mockModules).map((find) => ({ find, replacement: `/@fixture/${find}` })),
    { find: "@", replacement: resolve("src") },
  ] },
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""', "process.env.NODE_ENV": '"development"' },
  server: { host: "127.0.0.1", port: 4180, strictPort: true },
  plugins: [{ name: "dashboard-fixture", resolveId(id) { if (id.startsWith("/@fixture/")) return id; }, load(id) { return mockModules[id.replace("/@fixture/", "")]; }, configureServer(app) {
    app.middlewares.use("/dashboard-fixture", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await app.transformIndexHtml("/dashboard-fixture", '<!doctype html><html><body><div id="root"></div><script type="module" src="/e2e/fixtures/planning-dashboard.tsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 2600, height: 1200 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.log("PAGE ERROR", error.message); });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path.endsWith("/user/preferences")) {
      if (route.request().method() === "PUT") preferences = { ...preferences, ...route.request().postDataJSON().preferences };
      data = preferences;
    } else if (path.endsWith("/planning/scenarios")) data = [];
    else if (path.endsWith("/planning/dashboard")) data = {
      containers: [], last_sync: null,
      rows: ["CA-SC-10-F-10-BK-1TO", "CA-SC-10-F-10-GR-1TO"].map((sku, i) => ({ sku, category_code: "SC", sales_status: "Original", back: 0, cbm: 0.1, total_stock: 100, total_avg_curr: i ? 30 : 10, total_avg_real: 10, total_avg_prev: 12, total_30d: 300, containers: {}, container_info: "", containers_list: "", total_inbound_qty: 0, next_eta: null, sod: null })),
    };
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto("http://127.0.0.1:4180/dashboard-fixture?product=sc");
  const toggle = page.getByRole("button", { name: "Formula columns", exact: true });
  await toggle.click();
  const headerOrder = () => page.locator('.ag-header-cell[col-id]').evaluateAll((nodes) => nodes
    .map((node) => ({ id: node.getAttribute("col-id")!, x: node.getBoundingClientRect().left }))
    .sort((a,b) => a.x-b.x).map(({id})=>id));
  await expect.poll(async () => (await headerOrder()).indexOf("custom_formula_1")).toBe(24);
  const from = await page.locator('.ag-header-cell[col-id="custom_formula_1"]').boundingBox();
  const to = await page.locator('.ag-header-cell[col-id="transit"]').boundingBox();
  if (!from || !to) throw new Error("Missing Y/M headers");
  await page.mouse.move(from.x+from.width/2, from.y+from.height/2);
  await page.mouse.down();
  await page.mouse.move(to.x+5, to.y+to.height/2, {steps:40});
  await page.mouse.up();
  await expect.poll(async () => (await headerOrder()).indexOf("custom_formula_1")).toBe(12);
  await expect.poll(() => (preferences[COLUMN_ORDER_STORAGE_KEY] as string[] | undefined)?.indexOf("custom_formula_1")).toBe(12);
  await page.reload();
  await toggle.click();
  await expect.poll(async () => (await headerOrder()).indexOf("custom_formula_1")).toBe(12);
  await expect(page.locator('.ag-pinned-left-header .ag-header-cell[col-id="custom_formula_1"]')).toHaveCount(1);
  // Collapsing/reopening formulas must not change the saved position or pin.
  await toggle.click();
  await toggle.click();
  await expect.poll(async () => (await headerOrder()).indexOf("custom_formula_1")).toBe(12);
  // Alphabet-header dragging must also work back across the frozen boundary.
  const letterFrom = await page.locator('.ag-header-cell[col-id="custom_formula_1"] button[aria-label^="Select entire"]').boundingBox();
  const letterTo = await page.locator('.ag-header-cell[col-id="custom_formula_2"] button[aria-label^="Select entire"]').boundingBox();
  if (!letterFrom || !letterTo) throw new Error("Missing letter headers");
  await page.mouse.move(letterFrom.x+letterFrom.width/2, letterFrom.y+letterFrom.height/2);
  await page.mouse.down();
  await page.mouse.move(letterTo.x+5, letterTo.y+letterTo.height/2, {steps:40});
  await page.mouse.up();
  await expect.poll(async () => (await headerOrder()).indexOf("custom_formula_1")).toBe(24);
  await expect.poll(() => (preferences[COLUMN_ORDER_STORAGE_KEY] as string[] | undefined)?.indexOf("custom_formula_1")).toBe(24);
  await page.reload();
  await toggle.click();
  await expect.poll(async () => (await headerOrder()).indexOf("custom_formula_1")).toBe(24);
  expect(errors).toEqual([]);
  const firstFormula = page.locator('[row-id="CA-SC-10-F-10-BK-1TO"] [col-id="custom_formula_1"]').first();
  const secondFormula = page.locator('[row-id="CA-SC-10-F-10-GR-1TO"] [col-id="custom_formula_1"]').first();
  await firstFormula.click();
  await page.getByRole("textbox", { name: "Formula", exact: true }).fill("=[tavg_c]*2");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(firstFormula).toHaveText("20");
  await firstFormula.click();
  await secondFormula.click({ modifiers: ["Shift"] });
  await expect(firstFormula).toHaveCSS("background-color", "rgb(219, 234, 254)");
  await expect(secondFormula).toHaveCSS("background-color", "rgb(219, 234, 254)");
  await page.keyboard.press("Control+d");
  await expect(secondFormula).toHaveText("60");
  await expect.poll(() => normalizeFormulaConfig(preferences[FORMULAS_STORAGE_KEY])[0].overrides["CA-SC-10-F-10-GR-1TO"]).toBe("=[tavg_c]*2");
  await page.keyboard.press("Control+z");
  await expect(secondFormula).toHaveText("");
  await expect(firstFormula).toHaveText("20");
  await page.keyboard.press("Control+y");
  await expect(secondFormula).toHaveText("60");
  expect(errors).toEqual([]);
  console.log("PASS: full dashboard formula fill-down, preference save, undo and redo.");
  console.log("PASS: real dashboard, blank formula Y -> M across frozen SOD boundary, collapse/reopen, letter drag back out, preference API save and reload.");
} finally { await browser.close(); await server.close(); }
