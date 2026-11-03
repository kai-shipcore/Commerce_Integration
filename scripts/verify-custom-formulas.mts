/** Runs the real AG grid against synthetic data. All API traffic is intercepted.
 * Usage: node --import tsx scripts/verify-custom-formulas.mts */
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const server = await createServer({
  configFile: false, resolve: { alias: { "@": resolve("src") } },
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""', "process.env.NODE_ENV": '"development"' },
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
  plugins: [{ name: "formula-fixture", configureServer(app) {
    app.middlewares.use("/formula-fixture", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await app.transformIndexHtml("/formula-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/custom-formulas.tsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ json: { success: true, data: {} } }));
  await page.goto("http://127.0.0.1:4179/formula-fixture");
  const first = '[row-id="CA-SC-10-F-10-BK-1TO"]';
  const second = '[row-id="CA-SC-10-F-10-GR-1TO"]';
  const cell = (row: string, id: string) => page.locator(`${row} [col-id="${id}"]`).first();
  const toggle = page.getByRole("button", { name: "Formula columns", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "+ Add formula column", exact: true })).toHaveCount(0);
  await toggle.click();
  await page.getByRole("button", { name: "+ Add formula column", exact: true }).click();
  const formula = page.getByRole("textbox", { name: "Formula", exact: true });
  // Apply writes into the selected cells, so select both rows first.
  await cell(first, "custom_formula_1").click();
  await cell(second, "custom_formula_1").click({ modifiers: ["Shift"] });
  await formula.fill("=[tavg_c]*30%");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cell(first, "custom_formula_1")).toHaveText("3");
  await expect(cell(second, "custom_formula_1")).toHaveText("9");
  await cell(first, "custom_formula_1").click();
  await formula.fill("=");
  await cell(second, "tavg_c").click();
  await expect(formula).toHaveValue('=SKU("CA-SC-10-F-10-GR-1TO", "tavg_c")');
  await formula.press("End");
  await formula.pressSequentially("*30%");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cell(first, "custom_formula_1")).toHaveText("9");
  await page.getByRole("button", { name: "Reverse rows", exact: true }).click();
  await expect(cell(first, "custom_formula_1")).toHaveText("9");
  await page.getByRole("button", { name: "Duplicate Live", exact: true }).click();
  await cell(first, "custom_formula_1").click();
  await formula.fill("=42");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cell(first, "custom_formula_1")).toHaveText("42");
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(cell(first, "custom_formula_1")).toHaveText("9");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(cell(first, "custom_formula_1")).toHaveCount(0);
  await toggle.click();
  await expect(cell(first, "custom_formula_1")).toHaveText("9");
  await page.getByRole("button", { name: "+ Add formula column", exact: true }).click();
  await cell(first, "custom_formula_2").click();
  await cell(second, "custom_formula_2").click({ modifiers: ["Shift"] });
  await formula.fill("=ROUNDUP(MAX(0,[custom_formula_1]*60-[total]),0)");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cell(first, "custom_formula_2")).toHaveText("440");
  await expect(cell(second, "custom_formula_2")).toHaveText("390");
  const formulaHeader = page.locator('.ag-header-cell[col-id="custom_formula_2"]');
  const stockHeader = page.locator('.ag-header-cell[col-id="total"]');
  const dragFrom = await formulaHeader.boundingBox();
  const dragTo = await stockHeader.boundingBox();
  if (!dragFrom || !dragTo) throw new Error("Missing drag headers");
  await page.mouse.move(dragFrom.x + dragFrom.width / 2, dragFrom.y + dragFrom.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragFrom.x + dragFrom.width / 2 - 10, dragFrom.y + dragFrom.height / 2, { steps: 3 });
  await page.mouse.move(dragTo.x + 5, dragTo.y + dragTo.height / 2, { steps: 30 });
  await page.mouse.up();
  await expect.poll(async () => {
    const order = JSON.parse(await page.getByTestId("displayed-column-order").textContent() ?? "[]") as string[];
    return order.indexOf("custom_formula_2") >= 0 && order.indexOf("custom_formula_2") < order.indexOf("total");
  }).toBe(true);
  await page.reload();
  await toggle.click();
  await expect.poll(async () => {
    const order = JSON.parse(await page.getByTestId("displayed-column-order").textContent() ?? "[]") as string[];
    return order.indexOf("custom_formula_2") >= 0 && order.indexOf("custom_formula_2") < order.indexOf("total");
  }).toBe(true);
  await page.getByRole("button", { name: "Mixed saved order", exact: true }).click();
  // The visibility popup consumes this order. It must match rendered headers,
  // including pinned SKU and AG's grouped layout, not the mixed saved request.
  await expect.poll(async () => {
    const headers = await page.locator('.ag-header-cell[col-id]').evaluateAll((nodes) => nodes
      .map((node) => ({ id: node.getAttribute("col-id")!, x: node.getBoundingClientRect().left }))
      .filter(({ id }) => ["sku", "total", "tavg_c", "custom_formula_1", "custom_formula_2"].includes(id))
      .sort((a, b) => a.x - b.x).map(({ id }) => id));
    const reported = JSON.parse(await page.getByTestId("displayed-column-order").textContent() ?? "[]") as string[];
    return reported.filter((id) => headers.includes(id)).join(",") === headers.join(",") && headers.length === 5;
  }).toBe(true);
  await expect(page.getByRole("button", { name: "+ Add formula column", exact: true })).toHaveCount(0);
  await toggle.click();
  await expect(cell(first, "custom_formula_1")).toHaveCount(0);
  await expect(cell(first, "custom_formula_2")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Calc 1", exact: true })).toHaveCount(0);
  await expect(formula).toHaveCount(0);
  await toggle.click();
  await expect(cell(first, "custom_formula_1")).toHaveText("9");
  await expect(cell(first, "custom_formula_2")).toHaveText("440");
  await cell(first, "custom_formula_2").click();
  await formula.fill("=1/0");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cell(first, "custom_formula_2")).toHaveText("#DIV/0!");
  await formula.fill("=1+");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await formula.fill("=ROUNDUP(MAX(0,[custom_formula_1]*60-[total]),0)");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(cell(first, "custom_formula_2")).toHaveText("440");
  await expect(page.getByRole("status")).toContainText("Applied");
  await mkdir(".impeccable/review", { recursive: true });
  await page.screenshot({ path: ".impeccable/review/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(formula).toBeDisabled();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  // Reproduce Y -> M with the user's 24 base columns, including a parent
  // rerender during the drag (e.g. row data changing while moving a header).
  await page.evaluate(() => localStorage.removeItem("formula-fixture-order"));
  await page.setViewportSize({ width: 2600, height: 1000 });
  await page.goto("http://127.0.0.1:4179/formula-fixture?layout=wide");
  await toggle.click();
  const visibleHeaderOrder = () => page.locator('.ag-header-cell[col-id]').evaluateAll((nodes) => nodes
    .map((node) => ({ id: node.getAttribute("col-id")!, x: node.getBoundingClientRect().left }))
    .sort((a, b) => a.x - b.x).map(({ id }) => id));
  await expect.poll(async () => (await visibleHeaderOrder()).indexOf("custom_formula_1")).toBe(24);
  const sourceY = await page.locator('.ag-header-cell[col-id="custom_formula_1"]').boundingBox();
  const targetM = await page.locator('.ag-header-cell[col-id="transit"]').boundingBox();
  if (!sourceY || !targetM) throw new Error("Missing Y/M headers");
  await page.mouse.move(sourceY.x + sourceY.width / 2, sourceY.y + sourceY.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetM.x + 5, targetM.y + targetM.height / 2, { steps: 40 });
  await expect.poll(async () => (await visibleHeaderOrder()).indexOf("custom_formula_1")).toBe(12);
  await page.getByRole("button", { name: "Reverse rows", exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.up();
  await expect.poll(async () => (await visibleHeaderOrder()).indexOf("custom_formula_1")).toBe(12);
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("formula-fixture-order") ?? "[]") as string[];
    return saved.indexOf("custom_formula_1");
  })).toBe(12);
  await page.getByRole("button", { name: "Reverse rows", exact: true }).click();
  await expect.poll(async () => (await visibleHeaderOrder()).indexOf("custom_formula_1")).toBe(12);
  await page.reload();
  await toggle.click();
  await expect.poll(async () => (await visibleHeaderOrder()).indexOf("custom_formula_1")).toBe(12);
  expect(errors).toEqual([]);
  const fillPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  fillPage.on("pageerror", (error) => errors.push(error.message));
  await fillPage.route("**/api/**", (route) => route.fulfill({ json: { success: true, data: {} } }));
  await fillPage.goto("http://127.0.0.1:4179/formula-fixture");
  await fillPage.getByRole("button", { name: "Formula columns", exact: true }).click();
  await fillPage.getByRole("button", { name: "+ Add formula column", exact: true }).click();
  const fillInput = fillPage.getByRole("textbox", { name: "Formula", exact: true });
  const apply = fillPage.getByRole("button", { name: "Apply", exact: true });
  const a = fillPage.locator(`${first} [col-id="custom_formula_1"]`).first();
  const b = fillPage.locator(`${second} [col-id="custom_formula_1"]`).first();
  // Each cell holds its own formula. Type one in a cell, then fill it down.
  await a.click();
  await fillInput.fill('=[tavg_c]*2+SKU("CA-SC-10-F-10-GR-1TO","tavg_c")');
  await apply.click();
  await expect(a).toHaveText("50");
  await expect(b).toHaveText("");
  await a.click();
  await b.click({ modifiers: ["Shift"] });
  await expect(a).toHaveCSS("background-color", "rgb(219, 234, 254)");
  await expect(b).toHaveCSS("background-color", "rgb(219, 234, 254)");
  await fillPage.keyboard.press("Control+d");
  await expect(a).toHaveText("50");
  await expect(b).toHaveText("90");
  await a.click();
  await fillInput.fill("=[tavg_c]*3");
  await apply.click();
  await a.click();
  await b.click({ modifiers: ["Shift"] });
  await expect(fillInput).toHaveValue("=[tavg_c]*3");
  await apply.click();
  await expect(a).toHaveText("30");
  await expect(b).toHaveText("90");
  await a.click();
  await fillInput.fill("=[tavg_c]*4");
  await apply.click();
  await a.click();
  await b.click({ modifiers: ["Shift"] });
  await expect(a).toHaveCSS("background-color", "rgb(219, 234, 254)");
  await expect(b).toHaveCSS("background-color", "rgb(219, 234, 254)");
  await fillPage.getByRole("button", { name: /Fill down/ }).click();
  await expect(a).toHaveText("40");
  await expect(b).toHaveText("120");
  await fillPage.keyboard.press("Delete");
  await expect(a).toHaveText("");
  await expect(b).toHaveText("");
  await fillPage.reload();
  await fillPage.getByRole("button", { name: "Formula columns", exact: true }).click();
  await expect(a).toHaveText("");
  await expect(b).toHaveText("");
  // In-cell editing: double-click, typing replaces the text, Enter moves down,
  // Escape cancels, and F2 opens the editor on the selected cell.
  await a.click();
  await a.dblclick();
  await fillPage.keyboard.type("=[tavg_c]*5");
  await fillPage.keyboard.press("Enter");
  await expect(a).toHaveText("50");
  await a.dblclick();
  await fillPage.keyboard.type("=1");
  await fillPage.keyboard.press("Escape");
  await expect(a).toHaveText("50");
  await b.click();
  await expect(b).toHaveCSS("background-color", "rgb(219, 234, 254)");
  // F2 opens the formula bar even when it was closed.
  const closeBar = fillPage.getByRole("button", { name: "Close formula editor", exact: true });
  await closeBar.click();
  await expect(closeBar).toHaveCount(0);
  await fillPage.keyboard.press("F2");
  await expect(closeBar).toBeVisible();
  await fillPage.keyboard.press("Escape");
  await expect(fillPage.locator(":focus")).toHaveValue("");
  await fillPage.keyboard.type("=[tavg_c]*6");
  await fillPage.keyboard.press("Enter");
  await expect(b).toHaveText("180");
  // Arrow keys insert a reference while a formula is typed, then move it in place.
  await b.click();
  await fillPage.keyboard.press("F2");
  await fillPage.keyboard.press("Control+a");
  await fillPage.keyboard.type("=");
  await fillPage.keyboard.press("ArrowUp");
  await expect(fillPage.locator(":focus")).toHaveValue('=SKU("CA-SC-10-F-10-BK-1TO", "custom_formula_1")');
  // The referenced cell is outlined and its address shown above the grid (row 1 here).
  const highlighted = fillPage.locator(".planning-reference-highlight");
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toHaveAttribute("col-id", "custom_formula_1");
  await expect(fillPage.locator('.ag-row[row-id="CA-SC-10-F-10-BK-1TO"] .planning-reference-highlight')).toHaveCount(1);
  await expect(fillPage.getByText(/^[A-Z]+1$/)).toBeVisible();
  await fillPage.keyboard.press("ArrowUp");
  await expect(fillPage.locator(":focus")).toHaveValue('=SKU("CA-SC-10-F-10-BK-1TO", "custom_formula_1")');
  await fillPage.keyboard.press("ArrowDown");
  await expect(fillPage.locator(":focus")).toHaveValue("=[custom_formula_1]");
  await fillPage.keyboard.type("*2");
  await expect(fillPage.locator(":focus")).toHaveValue("=[custom_formula_1]*2");
  await fillPage.keyboard.press("Escape");
  await expect(b).toHaveText("180");
  await fillPage.reload();
  await fillPage.getByRole("button", { name: "Formula columns", exact: true }).click();
  await expect(a).toHaveText("50");
  await expect(b).toHaveText("180");
  await fillPage.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(fillPage.getByRole("button", { name: /Fill down/ })).toBeDisabled();
  expect(errors).toEqual([]);
  console.log("PASS: formula Ctrl+D, fill button, source-preserving selected-row application, keep/replace overrides, persistence and read-only mode.");
  console.log("PASS: default formulas, cross-SKU cell picking, stable references after reorder, tab isolation, reload, formula column drag-and-drop persistence, displayed header order, dependencies, errors, two-column limit, read-only mode. Screenshots captured at 1440 and 390px.");
} finally { await browser.close(); await server.close(); }
