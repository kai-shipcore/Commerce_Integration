import { describe, expect, it } from "vitest";
import {
  conditionalCellText,
  conditionalFormatForCell,
  matchesConditionalFormatRule,
  normalizeConditionalFormatRules,
  type ConditionalFormatRule,
} from "@/lib/planning/conditional-formatting";

const rule = (operator: ConditionalFormatRule["operator"], value?: string): ConditionalFormatRule => ({
  id: "rule-1",
  range: { kind: "columns", columnIds: ["sales"] },
  operator,
  value,
  enabled: true,
  style: { fillColor: "#FF0000" },
});

describe("conditional formatting rules", () => {
  it("extracts visible text from rendered cell HTML", () => {
    expect(conditionalCellText({ html: "<strong>1,200</strong>&nbsp;units" })).toBe("1,200 units");
  });

  it("supports numeric and text conditions", () => {
    expect(matchesConditionalFormatRule(rule("greaterThan", "10"), "11")).toBe(true);
    expect(matchesConditionalFormatRule(rule("between", "10"), "15")).toBe(false);
    const between = { ...rule("between", "10"), value2: "20" };
    expect(matchesConditionalFormatRule(between, "15")).toBe(true);
    expect(matchesConditionalFormatRule(rule("textContains", "seat"), "CAR-SEAT-1")).toBe(true);
    expect(matchesConditionalFormatRule(rule("isEmpty"), null)).toBe(true);
  });

  it("compares ISO and displayed dates", () => {
    expect(matchesConditionalFormatRule(rule("dateBefore", "2026-09-15"), "09/14/2026")).toBe(true);
    expect(matchesConditionalFormatRule(rule("dateIs", "2026-09-14"), "09/14/2026")).toBe(true);
  });

  it("supports the Sheets-style TRIM/LOWER/UPPER custom formula subset", () => {
    expect(matchesConditionalFormatRule(rule("customFormula", '=TRIM(LOWER(AZ4))="n"'), " N ")).toBe(true);
    expect(matchesConditionalFormatRule(rule("customFormula", '=UPPER(AZ4)="YES"'), "yes")).toBe(true);
    expect(matchesConditionalFormatRule(rule("customFormula", "=ISBLANK(AZ4)"), "")).toBe(true);
  });

  it("applies cell and column ranges and lets later matching rules override style fields", () => {
    const rules: ConditionalFormatRule[] = [
      { ...rule("greaterThan", "5"), style: { fillColor: "#FF0000", bold: true } },
      { ...rule("greaterThan", "10"), id: "rule-2", style: { fillColor: "#00FF00", textColor: "#0000FF" } },
    ];
    expect(conditionalFormatForCell(rules, "SKU-1::sales", "sales", 12)).toEqual({
      fillColor: "#00FF00", bold: true, textColor: "#0000FF",
    });
    expect(conditionalFormatForCell(rules, "SKU-1::stock", "stock", 12)).toBeNull();
  });

  it("normalizes persisted rules and rejects malformed values", () => {
    const normalized = normalizeConditionalFormatRules([{ ...rule("equal", "x"), style: { fillColor: "#aabbcc", fontSize: 99 } }, null, { id: 1 }]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].style).toEqual({ fillColor: "#AABBCC", fontSize: 48 });
  });
});
