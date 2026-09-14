import { describe, expect, it } from "vitest";
import {
  CATEGORY_CODE_OPTIONS,
  CATEGORY_GROUP_OPTIONS,
  DEFAULT_CATEGORY_CODES,
  categoryCodesForGroup,
  parseCategoryCodesParam,
  serializeCategoryCodes,
} from "@/components/planning/dashboard/category-groups";

describe("categoryCodesForGroup", () => {
  it("reads Car Cover together with SWC and Accessories, and leaves the rest single", () => {
    expect(categoryCodesForGroup("cc")).toEqual(["cc", "swc", "ac"]);
    expect(categoryCodesForGroup("sc")).toEqual(["sc"]);
    expect(categoryCodesForGroup("fm")).toEqual(["fm"]);
  });

  it("covers every category code exactly once, so no preset leaves a category unreachable", () => {
    const codes = CATEGORY_GROUP_OPTIONS.flatMap((option) => option.codes);
    expect([...codes].sort()).toEqual(["ac", "cc", "fm", "sc", "swc"]);
  });

  it("offers every code as its own checkbox", () => {
    expect(CATEGORY_CODE_OPTIONS.map((option) => option.value).sort())
      .toEqual(["ac", "cc", "fm", "sc", "swc"]);
  });
});

describe("parseCategoryCodesParam", () => {
  it("reads a single code as itself", () => {
    expect(parseCategoryCodesParam("cc")).toEqual(["cc"]);
    expect(parseCategoryCodesParam("fm")).toEqual(["fm"]);
    // Codes that used to be reachable only through the Car Cover group.
    expect(parseCategoryCodesParam("swc")).toEqual(["swc"]);
    expect(parseCategoryCodesParam("ac")).toEqual(["ac"]);
  });

  it("keeps every value in a comma list, which is what such a link meant", () => {
    expect(parseCategoryCodesParam("sc,cc")).toEqual(["sc", "cc"]);
    expect(parseCategoryCodesParam("cc,swc,ac")).toEqual(["cc", "swc", "ac"]);
  });

  it("tolerates spacing, case and repeats", () => {
    expect(parseCategoryCodesParam(" FM , cc ")).toEqual(["fm", "cc"]);
    expect(parseCategoryCodesParam("sc,sc,sc")).toEqual(["sc"]);
  });

  it("drops tokens it does not recognise", () => {
    expect(parseCategoryCodesParam("bogus,fm")).toEqual(["fm"]);
  });

  it("falls back to the default rather than to an empty selection", () => {
    // Empty would mean every category, which is not what a broken link
    // should open — and it is the most expensive thing the page can do.
    for (const value of [null, "", "nonsense", ",,,"]) {
      expect(parseCategoryCodesParam(value)).toEqual(DEFAULT_CATEGORY_CODES);
    }
    expect(DEFAULT_CATEGORY_CODES).toEqual(["sc"]);
  });
});

describe("serializeCategoryCodes", () => {
  it("writes the option order, not the order boxes were ticked", () => {
    expect(serializeCategoryCodes(["ac", "cc"])).toBe("cc,ac");
    expect(serializeCategoryCodes(["cc", "ac"])).toBe("cc,ac");
  });

  it("round-trips through the parser", () => {
    for (const codes of [["sc"], ["cc", "swc", "ac"], ["sc", "fm"]] as const) {
      expect(parseCategoryCodesParam(serializeCategoryCodes([...codes])))
        .toEqual(expect.arrayContaining([...codes]));
    }
  });

  it("writes nothing for an empty selection, so the parameter is dropped", () => {
    expect(serializeCategoryCodes([])).toBe("");
  });
});
