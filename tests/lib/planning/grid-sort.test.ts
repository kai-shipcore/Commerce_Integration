import { describe, expect, it } from "vitest";
import { normalizeGridSort } from "@/lib/planning/grid-sort";

describe("normalizeGridSort", () => {
  it("reads back each kind of sort", () => {
    expect(normalizeGridSort({ key: "tot30", kind: "value", dir: "desc" }))
      .toEqual({ key: "tot30", kind: "value", dir: "desc" });
    expect(normalizeGridSort({ key: "sku", kind: "color", colorType: "text", color: "#fff" }))
      .toEqual({ key: "sku", kind: "color", colorType: "text", color: "#fff" });
    expect(normalizeGridSort({
      key: "tot30",
      kind: "sales-group",
      order: { first: "Custom", originalDir: "asc", customDir: "desc" },
    })).toEqual({
      key: "tot30",
      kind: "sales-group",
      order: { first: "Custom", originalDir: "asc", customDir: "desc" },
    });
  });

  it("survives a JSON round trip, which is how it is stored", () => {
    const sort = { key: "CONT-2411::inb_qty", kind: "value", dir: "asc" } as const;
    expect(normalizeGridSort(JSON.parse(JSON.stringify(sort)))).toEqual(sort);
  });

  it("refuses a sort it cannot trust rather than half-applying one", () => {
    for (const value of [
      null,
      undefined,
      "tot30",
      [],
      { kind: "value", dir: "asc" },                                  // no column
      { key: "", kind: "value", dir: "asc" },                         // empty column
      { key: "tot30", kind: "value", dir: "sideways" },               // not a direction
      { key: "tot30", kind: "colour", colorType: "fill", color: "#f" }, // unknown kind
      { key: "tot30", kind: "color", colorType: "glow", color: "#f" },  // unknown target
      { key: "tot30", kind: "sales-group" },                          // no order
      { key: "tot30", kind: "sales-group", order: { first: "Part", originalDir: "asc", customDir: "asc" } },
      { key: "tot30", kind: "sales-group", order: { first: "Custom", originalDir: "asc" } },
    ]) {
      expect(normalizeGridSort(value)).toBeNull();
    }
  });
});
