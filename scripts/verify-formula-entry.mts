import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";

const server = await createServer({
  configFile: false, resolve: { alias: { "@": resolve("src") } },
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": '""', "process.env.NODE_ENV": '"development"' },
  server: { host: "127.0.0.1", port: 4181, strictPort: true },
  plugins: [{ name: "formula-entry", configureServer(app) {
    app.middlewares.use("/fixture", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await app.transformIndexHtml("/fixture", '<div id="root"></div><script type="module" src="/e2e/fixtures/custom-formulas.tsx"></script>'));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ json: { success: true, data: {} } }));
  await page.goto("http://127.0.0.1:4181/fixture");
  await page.getByRole("button", { name: "Formula columns", exact: true }).click();
  await page.getByRole("button", { name: "+ Add formula column", exact: true }).click();
  const target = page.locator('[row-id="CA-SC-10-F-10-BK-1TO"] [col-id="custom_formula_1"]').first();
  const source = page.locator('[row-id="CA-SC-10-F-10-GR-1TO"] [col-id="tavg_c"]').first();
  const bar = page.locator('section input[aria-label="Formula"]');
  await target.click();
  await bar.fill("=");
  await expect(bar).toHaveValue("=");
  await expect(page.getByRole("button", { name: "Picking references", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Picking references", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pick cell", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Pick cell", exact: true }).click();
  await expect(page.getByRole("button", { name: "Picking references", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(bar).toHaveAttribute("aria-invalid", "false");
  await bar.press("Enter");
  await expect(page.getByRole("alert")).toContainText("#SYNTAX!");
  await bar.pressSequentially("(");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await bar.press("Backspace");
  await source.click();
  await expect(bar).toHaveValue(/^=[A-Z]+2$/);
  await expect(source).toHaveClass(/planning-reference-highlight/);
  await expect(source).toHaveCSS("background-color", "rgb(220, 233, 252)");
  await page.keyboard.type("*60");
  await expect(bar).toHaveValue(/^=[A-Z]+2\*60$/);
  await page.keyboard.press("Enter");
  await expect(target).toHaveText("1800");
  await expect(page.locator(".planning-reference-highlight")).toHaveCount(0);
  await page.getByRole("button", { name: "Reverse rows", exact: true }).click();
  await expect(target).toHaveText("1800");
  await target.click();
  await bar.fill("=");
  await source.click();
  await bar.press("End");
  await bar.pressSequentially("*2");
  await bar.press("Enter");
  await expect(target).toHaveText("60");
  await bar.fill("=123+");
  await bar.press("Escape");
  await expect(bar).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pick cell", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(target).toHaveText("60");
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Reverse rows", exact: true }).click();
  const lower = page.locator('[row-id="CA-SC-10-F-10-GR-1TO"] [col-id="custom_formula_1"]').first();
  const ownSource = page.locator('[row-id="CA-SC-10-F-10-BK-1TO"] [col-id="tavg_c"]').first();
  await target.click();
  await bar.fill("=");
  await ownSource.click();
  await bar.pressSequentially("*60");
  await bar.press("Enter");
  await expect(target).toHaveText("600");
  await target.click();
  await lower.click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Fill down", exact: false }).click();
  await expect(lower).toHaveText("1800");
  await lower.click();
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await bar.fill("=0");
  await bar.press("Enter");
  await expect(target).toHaveText("600");
  await target.click();
  await lower.click({ modifiers: ["Shift"] });
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await lower.focus();
  await page.keyboard.press("Control+d");
  await expect(lower).toHaveText("1800");
  await target.click();
  await bar.fill("=");
  await page.getByRole("button", { name: "Insert same-row column reference", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search columns" });
  await search.fill("no-such-column");
  await expect(page.getByText("No columns found.", { exact: true })).toBeVisible();
  await search.fill("TAVG_C");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(bar).toHaveValue("=[tavg_c]");
  await expect(bar).toBeFocused();
  console.log("PASS: formula entry, fill down, reference highlight, searchable field picker");
} finally { await browser.close(); await server.close(); }
