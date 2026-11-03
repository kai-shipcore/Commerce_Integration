import { describe, expect, it } from "vitest";
import { createFormulaEvaluator, fillDownFormulas, materializeDefaultFormulas, normalizeFormulaConfig, formulaForCell, cellReference, validateFormula } from "@/lib/planning/custom-formulas";
import { formulaBaseValue } from "@/lib/planning/custom-formula-fields";
import type { DemandRow } from "@/types/demand-planning";

function evaluate(formula: string) {
  const config = normalizeFormulaConfig(null);
  config[0] = { ...config[0], enabled: true, overrides: { A: formula } };
  return createFormulaEvaluator(config, ["A", "B"], (sku, field) => {
    if (field === "sales") return sku === "A" ? 10 : 30;
    if (field === "stock") return null;
    if (field === "color") return "BK";
    return undefined;
  }).evaluate("A", "custom_formula_1");
}
describe("custom spreadsheet formulas", () => {
  it("fills expressions from the first displayed selected row, preserving relative and fixed SKU references", () => {
    const config = normalizeFormulaConfig(null);
    config[0] = { ...config[0], enabled: true, overrides: { B: '=[sales]*2+SKU("B","sales")' } };
    const result = fillDownFormulas(config, ["B", "A"], [config[0].id], new Set([`A::${config[0].id}`, `B::${config[0].id}`]));
    expect(result.count).toBe(1);
    expect(result.config[0].overrides.A).toBe(config[0].overrides.B);
    expect(config[0].overrides.A).toBeUndefined();
    const evaluator = createFormulaEvaluator(result.config, ["A", "B"], (sku) => sku === "A" ? 10 : 30);
    expect(evaluator.evaluate("A", config[0].id).value).toBe(50);
    expect(evaluator.evaluate("B", config[0].id).value).toBe(90);
  });
  it("fills explicit blanks and leaves unselected rows and disabled columns untouched", () => {
    const config = normalizeFormulaConfig(null);
    config[0] = { ...config[0], enabled: true, overrides: { A: "", B: "=42" } };
    const selected = new Set(["A::custom_formula_1", "C::custom_formula_1", "A::custom_formula_2", "C::custom_formula_2"]);
    const result = fillDownFormulas(config, ["A", "B", "C"], config.map((c) => c.id), selected);
    expect(result.count).toBe(1);
    expect(formulaForCell(result.config[0], "C")).toBe("");
    expect(formulaForCell(result.config[0], "B")).toBe("=42");
    expect(result.config[1]).toBe(config[1]);
    expect(fillDownFormulas(config, ["A"], [config[0].id], selected).config).toBe(config);
  });
  it.each([
    ["=1+2*3", 7], ["=(1+2)*3", 9], ["=2^3^2", 512], ["=-2^2", -4],
    ["=[sales]*30%", 3], ['=SKU("B", "sales") * 30%', 9],
    ['=IF([color]="BK", 100, 200)', 100], ["=IF([sales]>=10, 7, 1/0)", 7],
    ["=IFERROR(1/0, 4)", 4], ["=IFERROR([missing], 4)", 4],
    ["=MIN(10, 3, 20)+MAX(1, 2)", 5], ["=SUM(1, 2, ABS(-3))", 6],
    ["=ROUNDUP(-1.21, 1)", -1.3], ["=ROUNDDOWN(-1.29, 1)", -1.2],
    ["=ROUND(-1.25, 1)", -1.3], ["=ROUNDUP(123, -1)", 130],
    ["=ROUNDUP(1.1, 2)", 1.1], ["=ROUND(1.005, 2)", 1.01], ["=ROUNDDOWN(1.15, 2)", 1.15],
    ["=ROUNDUP(0.1+0.2, 2)", 0.3], ["=ROUND(-1.005, 2)", -1.01], ["=ROUNDUP(1e-7, 8)", 1e-7],
    ["=ROUNDUP(MAX(0,[sales]*60-100),0)", 500], ["=0", 0], ["=FALSE", false], ["", null],
  ])("calculates %s", (formula, value) => expect(evaluate(String(formula))).toEqual({ value }));

  it.each([
    ["=1/0", "#DIV/0!"], ["=[stock]*2", "#N/A"], ["=[missing]", "#REF!"],
    ['=SKU("deleted", "sales")', "#REF!"], ['="hello"*3', "#VALUE!"],
    ["=NOPE(1)", "#NAME?"], ["=ROUND(2,100)", "#NUM!"], ["=1e999", "#NUM!"],
    ["=IF(1,2)", "#ARGS!"], ["=1+", "#SYNTAX!"], ["=globalThis.process.exit()", "#SYNTAX!"],
    ["=constructor(1)", "#NAME?"], ["=SUM(...[sales])", "#SYNTAX!"],
  ])("reports %s", (formula, error) => expect(evaluate(formula).error).toBe(error));

  it("keeps SKU identity through sorting, filtering and independent tab copies", () => {
    const live = normalizeFormulaConfig(null);
    live[0] = { ...live[0], enabled: true, overrides: { A: '=SKU("B", "sales")*30%' } };
    const copy = normalizeFormulaConfig(JSON.parse(JSON.stringify(live)));
    copy[0].overrides.A = "=42";
    const read = (sku: string) => sku === "B" ? 100 : 10;
    expect(createFormulaEvaluator(live, ["B", "A"], read).evaluate("A", "custom_formula_1").value).toBe(30);
    expect(createFormulaEvaluator(copy, ["A", "B"], read).evaluate("A", "custom_formula_1").value).toBe(42);
    expect(formulaForCell(live[0], "A")).toBe(live[0].overrides.A);
    expect(normalizeFormulaConfig(undefined).every((c) => !c.enabled && !c.formula)).toBe(true);
  });
  it("uses cell overrides, including explicit blanks, and recalculates dependent columns", () => {
    const config = normalizeFormulaConfig(null);
    config[0] = { ...config[0], enabled: true, overrides: { A: "=10", B: "=4", C: "" } };
    config[1] = { ...config[1], enabled: true, overrides: { A: "=[custom_formula_1]*2", B: "=[custom_formula_1]*2", C: "=[custom_formula_1]*2" } };
    const calc = createFormulaEvaluator(config, ["A", "B", "C"], () => undefined);
    expect(calc.evaluate("A", "custom_formula_2").value).toBe(20);
    expect(calc.evaluate("B", "custom_formula_2").value).toBe(8);
    expect(calc.evaluate("C", "custom_formula_1").value).toBeNull();
    expect(calc.evaluate("C", "custom_formula_2").error).toBe("#N/A");
  });
  it("detects cross-column and cross-SKU cycles", () => {
    const config = normalizeFormulaConfig(null);
    config[0] = { ...config[0], enabled: true, overrides: { A: '=SKU("B", "custom_formula_2")' } };
    config[1] = { ...config[1], enabled: true, overrides: { B: '=SKU("A", "custom_formula_1")' } };
    expect(createFormulaEvaluator(config, ["A", "B"], () => 0).evaluate("A", "custom_formula_1").error).toBe("#CYCLE!");
  });
  it("enforces expression and dependency limits", () => {
    expect(validateFormula("=" + "(".repeat(60) + "1" + ")".repeat(60))).toBe("#LIMIT!");
    expect(validateFormula("=" + "1+".repeat(1100) + "1")).toBe("#LIMIT!");
    const config = normalizeFormulaConfig(null);
    config[0].enabled = true;
    const skus = Array.from({ length: 80 }, (_, i) => String(i));
    config[0].overrides = Object.fromEntries(skus.map((sku, i) => [sku, i === 79 ? "=1" : `=SKU("${i + 1}", "custom_formula_1")`]));
    expect(createFormulaEvaluator(config, skus, () => 0).evaluate("0", "custom_formula_1").error).toBe("#LIMIT!");
  });
  it("escapes references and preserves precision and unknown historical stock", () => {
    expect(cellReference('A"B', "w30")).toBe('SKU("A\\"B", "w30")');
    const row = { total_avg_curr: 1.234567, west_available_stock: null, back: -1, total_inbound_qty: 0 } as DemandRow;
    expect(formulaBaseValue(row, "tavg_c")).toBe(1.234567);
    expect(formulaBaseValue(row, "west")).toBeNull();
    expect(formulaBaseValue(row, "back")).toBe(-1);
    expect(formulaBaseValue(row, "inb_qty")).toBe(0);
    expect(formulaBaseValue(row, "__proto__")).toBeUndefined();
  });
  it("moves a legacy column default into the rows that have no expression of their own", () => {
    const config = normalizeFormulaConfig(null);
    config[0] = { ...config[0], enabled: true, formula: "=7", overrides: { B: "=1" } };
    const migrated = materializeDefaultFormulas(config, ["A", "B"]);
    expect(migrated[0].formula).toBe("");
    expect(migrated[0].overrides).toEqual({ A: "=7", B: "=1" });
    expect(materializeDefaultFormulas(migrated, ["A", "B"])).toBe(migrated);
    expect(materializeDefaultFormulas(config, ["A"]).length).toBe(config.length);
  });
  it("memoizes repeated references across 11,300 rows", () => {
    const config = normalizeFormulaConfig(null);
    const skus = Array.from({ length: 11300 }, (_, i) => String(i));
    config[0] = { ...config[0], enabled: true, overrides: Object.fromEntries(skus.map((sku) => [sku, '=[sales] + SKU("0", "custom_formula_2")'])) };
    config[1] = { ...config[1], enabled: true, overrides: Object.fromEntries(skus.map((sku) => [sku, "=[sales]*30%"])) };
    let reads = 0;
    const calc = createFormulaEvaluator(config, skus, () => { reads++; return 10; });
    for (const sku of skus) expect(calc.evaluate(sku, "custom_formula_1").value).toBe(13);
    expect(reads).toBe(11301);
  });
});
