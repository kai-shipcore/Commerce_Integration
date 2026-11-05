import { describe, expect, it } from "vitest";
import { collectFormulaCellReferences, displayFormulaAddresses, resolveFormulaAddresses, shiftFormulaRows } from "@/lib/planning/formula-addresses";

describe("formula address editing boundary", () => {
  it("fills relative references using actual displayed row distances", () => {
    expect(shiftFormulaRows('=SKU("A", "tavg_c")*60', "A", "C", ["A", "B", "C"]))
      .toBe('=SKU("C", "tavg_c")*60');
    expect(shiftFormulaRows('=SKU("B", "total")+[tavg_c]+"A1"', "A", "B", ["A", "B", "C"]))
      .toBe('=SKU("C", "total")+[tavg_c]+"A1"');
  });
  const resolve = (address: string) => address === "Q1" ? 'SKU("ITEM-A", "tavg_c")' : null;
  it("resolves clicked and typed references without changing quoted text or legacy fields", () => {
    expect(resolveFormulaAddresses('=IF(Q1>0, ROUND(q1*60, 0), "Q1")+[Q1]', resolve))
      .toBe('=IF(SKU("ITEM-A", "tavg_c")>0, ROUND(SKU("ITEM-A", "tavg_c")*60, 0), "Q1")+[Q1]');
  });
  it("displays stored references as current grid addresses and round trips", () => {
    const stored = '=SKU("ITEM-A", "tavg_c")*60';
    const display = displayFormulaAddresses(stored, "ITEM-B", (sku, field) => sku === "ITEM-A" && field === "tavg_c" ? "Q1" : null);
    expect(display).toBe("=Q1*60");
    expect(resolveFormulaAddresses(display, resolve)).toBe(stored);
  });
  it("preserves references that are hidden from the displayed grid", () => {
    expect(displayFormulaAddresses('=[tavg_c]+SKU("Q1", "total")', "ITEM-A", () => null))
      .toBe('=[tavg_c]+SKU("Q1", "total")');
  });
  it("collects unique local and cross-row references in expression order", () => {
    expect(collectFormulaCellReferences(
      '=[tavg_c]+SKU("ITEM-A", "total")+[tavg_c]+"SKU(ignored)"',
      "ITEM-B",
    )).toEqual([
      { sku: "ITEM-B", field: "tavg_c" },
      { sku: "ITEM-A", field: "total" },
    ]);
  });
});
