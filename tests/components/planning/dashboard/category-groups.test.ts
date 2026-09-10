import { describe, expect, it } from "vitest";
import {
  CATEGORY_GROUP_OPTIONS,
  DEFAULT_CATEGORY_GROUP,
  categoryCodesForGroup,
  parseCategoryGroupParam,
} from "@/components/planning/dashboard/category-groups";

describe("categoryCodesForGroup", () => {
  it("reads Car Cover together with SWC and Accessories, and leaves the rest single", () => {
    expect(categoryCodesForGroup("cc")).toEqual(["cc", "swc", "ac"]);
    expect(categoryCodesForGroup("sc")).toEqual(["sc"]);
    expect(categoryCodesForGroup("fm")).toEqual(["fm"]);
  });

  it("covers every category code exactly once, so no category is unreachable", () => {
    const codes = CATEGORY_GROUP_OPTIONS.flatMap((option) => option.codes);
    expect([...codes].sort()).toEqual(["ac", "cc", "fm", "sc", "swc"]);
  });
});

describe("parseCategoryGroupParam", () => {
  it("reads a group written by the current picker", () => {
    expect(parseCategoryGroupParam("cc")).toBe("cc");
    expect(parseCategoryGroupParam("fm")).toBe("fm");
  });

  it("keeps links from the old multi-select working, on their first value", () => {
    expect(parseCategoryGroupParam("sc,cc")).toBe("sc");
    expect(parseCategoryGroupParam("fm,sc")).toBe("fm");
  });

  it("maps the codes that no longer stand alone onto the group that carries them", () => {
    expect(parseCategoryGroupParam("swc")).toBe("cc");
    expect(parseCategoryGroupParam("ac")).toBe("cc");
    expect(parseCategoryGroupParam("swc,fm")).toBe("cc");
  });

  it("skips values it does not recognise before falling back", () => {
    expect(parseCategoryGroupParam("bogus,fm")).toBe("fm");
    expect(parseCategoryGroupParam(" FM , cc ")).toBe("fm");
  });

  it("falls back to the default for missing or unusable values", () => {
    expect(parseCategoryGroupParam(null)).toBe(DEFAULT_CATEGORY_GROUP);
    expect(parseCategoryGroupParam("")).toBe(DEFAULT_CATEGORY_GROUP);
    expect(parseCategoryGroupParam("nonsense")).toBe(DEFAULT_CATEGORY_GROUP);
  });
});
