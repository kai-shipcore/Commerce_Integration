import { describe, expect, it } from "vitest";
import {
  newConditionalFormatRule,
  patchConditionalFormatStyle,
} from "@/components/planning/dashboard/conditional-formatting-panel";
import { conditionalFormatForCell, normalizeConditionalFormatRules } from "@/lib/planning/conditional-formatting";

describe("conditional formatting panel rules", () => {
  it("starts a new rule with no style, so it pins nothing over column colours", () => {
    const rule = newConditionalFormatRule({ kind: "columns", columnIds: ["fm_full_d"] });

    expect(rule.style).toEqual({});
    // The cell matches (15 > 0) but the rule contributes no fill, so the grid
    // falls through to the cell / column colour.
    expect(conditionalFormatForCell([rule], "SKU::fm_full_d", "fm_full_d", 15)?.fillColor).toBeUndefined();
  });

  it("removes a style property on reset instead of storing a colour", () => {
    const style = patchConditionalFormatStyle({ fillColor: "#F4FBF4", textColor: "#FF0000", bold: true }, { fillColor: undefined });

    expect(style).toEqual({ textColor: "#FF0000", bold: true });
    expect("fillColor" in style).toBe(false);
  });

  it("does not let a reset rule erase an earlier rule's fill for the same cell", () => {
    const first = { ...newConditionalFormatRule({ kind: "columns", columnIds: ["gap"] }), style: { fillColor: "#FFE599" } };
    const second = {
      ...newConditionalFormatRule({ kind: "columns", columnIds: ["gap"] }),
      style: patchConditionalFormatStyle({ fillColor: "#000000", bold: true }, { fillColor: undefined }),
    };

    expect(conditionalFormatForCell([first, second], "SKU::gap", "gap", 3)).toEqual({ fillColor: "#FFE599", bold: true });
  });

  it("migrates untouched legacy default tint rules without removing custom fills", () => {
    const rules = normalizeConditionalFormatRules([
      { id: "legacy", range: { kind: "columns", columnIds: ["fm02_2nd"] }, operator: "greaterThan", value: "0", enabled: true, style: { fillColor: "#F4FBF4", textColor: "#000000", bold: false, fontSize: 11 } },
      { id: "custom", range: { kind: "columns", columnIds: ["fm_full_d"] }, operator: "greaterThan", value: "0", enabled: true, style: { fillColor: "#FFE599", textColor: "#000000", bold: false, fontSize: 11 } },
    ]);

    expect(rules[0].style).toEqual({});
    expect(rules[1].style.fillColor).toBe("#FFE599");
  });
});
