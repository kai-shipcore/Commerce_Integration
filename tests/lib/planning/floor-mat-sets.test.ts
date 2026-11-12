import { describe, it, expect } from "vitest";
import {
  coerceFloorMatSet,
  describeFloorMatSet,
  emptyFloorMatSet,
  isEmptyFloorMatSet,
  mergeFloorMatSetImport,
  parseOverrideSalesStatus,
  parsePreOrder,
  parseSkuList,
  splitMultiValue,
  validateFloorMatSet,
  type FloorMatSet,
} from "@/lib/planning/floor-mat-sets";

const set = (patch: Partial<FloorMatSet>): FloorMatSet => ({ ...emptyFloorMatSet(), ...patch });

describe("parseOverrideSalesStatus", () => {
  it("matches regardless of case and spacing", () => {
    expect(parseOverrideSalesStatus("hold")).toBe("Hold");
    expect(parseOverrideSalesStatus("1+2set")).toBe("1+2 Set");
    expect(parseOverrideSalesStatus(" 1ST ROW ")).toBe("1st Row");
  });

  it("reads the sheet's '1+2+3 Set (-C)' spelling", () => {
    expect(parseOverrideSalesStatus("1+2+3 Set (-C)")).toBe("1+2+3 Set");
  });

  it("returns undefined for anything else, including derived statuses", () => {
    expect(parseOverrideSalesStatus("Original")).toBeUndefined();
    expect(parseOverrideSalesStatus("")).toBeUndefined();
  });
});

describe("multi-value cells", () => {
  it("splits on line breaks and pipes, keeping blanks in the middle", () => {
    expect(splitMultiValue("Yes\nNone")).toEqual(["Yes", "None"]);
    expect(splitMultiValue("Yes|No")).toEqual(["Yes", "No"]);
    // A leading blank keeps the later values lined up with their SKUs.
    expect(splitMultiValue("\nYes\nYes")).toEqual(["", "Yes", "Yes"]);
    expect(splitMultiValue("Yes\n\nNo")).toEqual(["Yes", "", "No"]);
  });

  it("drops trailing blanks", () => {
    expect(splitMultiValue("Yes\n")).toEqual(["Yes"]);
    expect(splitMultiValue("")).toEqual([]);
  });

  it("parses SKU lists upper-cased, without blanks or repeats", () => {
    expect(parseSkuList("ca-fm-a\n\nCA-FM-B|ca-fm-a")).toEqual(["CA-FM-A", "CA-FM-B"]);
  });
});

describe("parsePreOrder", () => {
  it("reads Yes/No, treating the sheet's None as No", () => {
    expect(parsePreOrder("Yes")).toBe(true);
    expect(parsePreOrder("no")).toBe(false);
    expect(parsePreOrder("None")).toBe(false);
  });

  it("returns null for blank and undefined for unrecognised text", () => {
    expect(parsePreOrder("")).toBeNull();
    expect(parsePreOrder(null)).toBeNull();
    expect(parsePreOrder("maybe")).toBeUndefined();
  });
});

describe("coerceFloorMatSet", () => {
  it("normalizes SKUs and drops blank 3rd Row lines", () => {
    expect(
      coerceFloorMatSet({
        frontSku: " ca-fm-f ",
        rearSku: "",
        preOrder12: "Yes",
        thirdRows: [{ sku: "ca-fm-3a", preOrder: false }, { sku: " " }],
        oldSetSkus: ["ca-fm-old", ""],
      })
    ).toEqual({
      frontSku: "CA-FM-F",
      rearSku: null,
      preOrder12: true,
      preOrder3: null,
      thirdRows: [{ sku: "CA-FM-3A", preOrder: false }],
      oldSetSkus: ["CA-FM-OLD"],
    });
  });

  it("throws on an unreadable Pre-Order value", () => {
    expect(() => coerceFloorMatSet({ preOrder12: "maybe" })).toThrow("Invalid 1~2 Row Pre-Order");
  });
});

describe("validateFloorMatSet", () => {
  it("accepts a front-only master, a full set, and a standalone 3rd Row flag", () => {
    expect(validateFloorMatSet("CA-FM-80-FM1", set({ frontSku: "CA-FM-F" }))).toBeNull();
    expect(
      validateFloorMatSet("CA-FM-80-FM1", set({ frontSku: "CA-FM-F", rearSku: "CA-FM-R", thirdRows: [{ sku: "CA-FM-3", preOrder: null }] }))
    ).toBeNull();
    expect(validateFloorMatSet("CA-FM-TX-80-S3-A", set({ preOrder3: true }))).toBeNull();
  });

  it("accepts an old set SKU equal to the master (the sheet lists them that way)", () => {
    expect(validateFloorMatSet("CA-FM-80-FM1", set({ frontSku: "CA-FM-F", oldSetSkus: ["CA-FM-80-FM1"] }))).toBeNull();
  });

  it("allows clearing a set on any SKU", () => {
    expect(validateFloorMatSet("CA-SC-1", emptyFloorMatSet())).toBeNull();
  });

  it("rejects impossible links", () => {
    expect(validateFloorMatSet("CA-SC-1", set({ frontSku: "CA-FM-F" }))).toContain("not a floor mat SKU");
    expect(validateFloorMatSet("CA-FM-80-FM1", set({ rearSku: "CA-FM-R" }))).toContain("needs a 1st Row SKU");
    expect(validateFloorMatSet("CA-FM-80-FM1", set({ frontSku: "CA-FM-F", rearSku: "CA-FM-F" }))).toContain("cannot be the same");
    expect(validateFloorMatSet("CA-FM-80-FM1", set({ frontSku: "CA-FM-80-FM1" }))).toContain("linked to itself");
    expect(
      validateFloorMatSet("CA-FM-80-FM1", set({ frontSku: "CA-FM-F", thirdRows: [{ sku: "CA-FM-3", preOrder: null }, { sku: "CA-FM-3", preOrder: true }] }))
    ).toContain("listed twice");
    expect(
      validateFloorMatSet("CA-FM-80-FM1", set({ frontSku: "CA-FM-F", thirdRows: [{ sku: "CA-FM-F", preOrder: null }] }))
    ).toContain("cannot also be the 1st or 2nd Row SKU");
  });
});

describe("mergeFloorMatSetImport", () => {
  const stored = set({
    frontSku: "CA-FM-F",
    rearSku: "CA-FM-R",
    preOrder12: true,
    thirdRows: [{ sku: "CA-FM-3A", preOrder: true }, { sku: "CA-FM-3B", preOrder: false }],
    oldSetSkus: ["CA-FM-OLD"],
  });

  it("changes only the columns present in the file", () => {
    expect(mergeFloorMatSetImport("M", stored, { rearSku: "CA-FM-R2" })).toEqual({ ...stored, rearSku: "CA-FM-R2" });
  });

  it("pairs 3rd Row Pre-Order values with the 3rd Row SKUs by position", () => {
    const next = mergeFloorMatSetImport("M", null, { thirdRowSkus: ["CA-FM-3A", "CA-FM-3B"], preOrder3Values: [null, true] });
    expect(next.thirdRows).toEqual([{ sku: "CA-FM-3A", preOrder: null }, { sku: "CA-FM-3B", preOrder: true }]);
  });

  it("keeps a 3rd Row SKU's stored Pre-Order when the file reorders the SKUs without values", () => {
    const next = mergeFloorMatSetImport("M", stored, { thirdRowSkus: ["CA-FM-3B", "CA-FM-3C"] });
    expect(next.thirdRows).toEqual([{ sku: "CA-FM-3B", preOrder: false }, { sku: "CA-FM-3C", preOrder: null }]);
  });

  it("applies Pre-Order values alone to the stored 3rd Row SKUs", () => {
    const next = mergeFloorMatSetImport("M", stored, { preOrder3Values: [false, null] });
    // null means "no value in the file", so the stored value stays.
    expect(next.thirdRows).toEqual([{ sku: "CA-FM-3A", preOrder: false }, { sku: "CA-FM-3B", preOrder: false }]);
  });

  it("treats a single value on a SKU with no 3rd Row links as that SKU's own flag", () => {
    expect(mergeFloorMatSetImport("CA-FM-TX-80-S3-A", null, { preOrder3Values: [true] }).preOrder3).toBe(true);
  });

  it("throws when the values cannot be matched to SKUs", () => {
    expect(() => mergeFloorMatSetImport("M", null, { thirdRowSkus: ["CA-FM-3A"], preOrder3Values: [true, false] })).toThrow(
      "2 3rd Row Pre-Order values for 1 3rd Row SKU(s)"
    );
    expect(() => mergeFloorMatSetImport("M", stored, { preOrder3Values: [true] })).toThrow("2 3rd Row SKU(s) are linked");
    expect(() => mergeFloorMatSetImport("M", null, { preOrder3Values: [true, false] })).toThrow("no 3rd Row SKUs");
  });
});

describe("describeFloorMatSet / isEmptyFloorMatSet", () => {
  it("summarises a set on one line and returns null for an empty one", () => {
    expect(
      describeFloorMatSet(set({ frontSku: "F", rearSku: "R", preOrder12: true, thirdRows: [{ sku: "T1", preOrder: true }, { sku: "T2", preOrder: null }] }))
    ).toBe("1st: F / 2nd: R / 3rd: T1 (Yes), T2 / 1~2 Pre-Order: Yes");
    expect(describeFloorMatSet(emptyFloorMatSet())).toBeNull();
    expect(isEmptyFloorMatSet(set({ preOrder3: false }))).toBe(false);
  });
});
