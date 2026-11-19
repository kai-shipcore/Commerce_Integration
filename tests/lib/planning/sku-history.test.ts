import { describe, it, expect } from "vitest";
import { buildSkuAliasMap, foldRenamedSkuRows, type SkuHistoryRow } from "@/lib/planning/sku-history";

const row = (masterProductId: string, sku: string, validFrom: string, validTo: string | null, currentSku: string | null = null): SkuHistoryRow =>
  ({ masterProductId, sku, validFrom, validTo, currentSku });

describe("buildSkuAliasMap", () => {
  it("maps an old code to the code whose period is still open", () => {
    const aliases = buildSkuAliasMap([
      row("p1", "CC-CN-15-B-BKLG-STR", "2026-01-01", "2026-11-20"),
      row("p1", "CA-CC-15-CN-B-BKLG-STR", "2026-11-20", null),
    ]);
    expect([...aliases]).toEqual([["CC-CN-15-B-BKLG-STR", "CA-CC-15-CN-B-BKLG-STR"]]);
  });

  it("follows a product renamed twice to its current code", () => {
    const aliases = buildSkuAliasMap([
      row("p1", "CA-10-SWC-38-BKBK", "2025-01-01", "2026-07-22"),
      row("p1", "CA-SWC-10-38-BKBK", "2026-07-22", "2026-11-20"),
      row("p1", "CA-SW-13-AG-38-BK-1TO", "2026-11-20", null),
    ]);
    expect(aliases.get("CA-10-SWC-38-BKBK")).toBe("CA-SW-13-AG-38-BK-1TO");
    expect(aliases.get("CA-SWC-10-38-BKBK")).toBe("CA-SW-13-AG-38-BK-1TO");
    expect(aliases.size).toBe(2);
  });

  it("takes the product's own code over the history when it is readable", () => {
    // The history holds closed periods only; the current code is on master_product.
    const aliases = buildSkuAliasMap([row("p1", "CA-TW-01-MIX", "2026-01-01", "2026-11-20", "CA-TW-01-MX-00-MX-1TO")]);
    expect(aliases.get("CA-TW-01-MIX")).toBe("CA-TW-01-MX-00-MX-1TO");
  });

  it("falls back to the latest period when none is open", () => {
    const aliases = buildSkuAliasMap([
      row("p1", "OLD-1", "2026-01-01", "2026-06-01"),
      row("p1", "NEW-1", "2026-06-01", "2026-12-31"),
    ]);
    expect([...aliases]).toEqual([["OLD-1", "NEW-1"]]);
  });

  it("matches the old code whatever its case or padding", () => {
    const aliases = buildSkuAliasMap([row("p1", " ca-tw-01-mix ", "2026-01-01", "2026-11-20", "CA-TW-01-MX-00-MX-1TO")]);
    expect(aliases.get("CA-TW-01-MIX")).toBe("CA-TW-01-MX-00-MX-1TO");
  });

  it("leaves a product that was never renamed out", () => {
    expect(buildSkuAliasMap([row("p1", "CA-SC-10-F-10-BK-1TO", "2026-01-01", null)]).size).toBe(0);
  });

  it("does not fold a code that is another product's current code", () => {
    // p1 gave up CODE-A, which was then handed to p2.
    const aliases = buildSkuAliasMap([
      row("p1", "CODE-A", "2026-01-01", "2026-06-01"),
      row("p1", "CODE-B", "2026-06-01", null),
      row("p2", "CODE-A", "2026-06-01", null),
    ]);
    expect(aliases.has("CODE-A")).toBe(false);
  });

  it("does not fold a code two products have both had", () => {
    const aliases = buildSkuAliasMap([
      row("p1", "SHARED", "2026-01-01", "2026-06-01"),
      row("p1", "CODE-B", "2026-06-01", null),
      row("p2", "SHARED", "2026-06-01", "2026-09-01"),
      row("p2", "CODE-C", "2026-09-01", null),
    ]);
    expect(aliases.has("SHARED")).toBe(false);
  });
});

describe("foldRenamedSkuRows", () => {
  const IDENTITY = ["order_date", "item_category", "channel", "order_type"] as const;
  const sale = (sku: string, qty: number, day = "2026-11-10", extra: Partial<{ channel: string; is_custom: string }> = {}) => ({
    order_date: new Date(`${day}T00:00:00Z`), item_category: "Car Cover", channel: "Coverland B2C", order_type: "sales",
    link_master_sku: sku, link_qty: qty, is_custom: "N", ...extra,
  });
  const aliases = new Map([["OLD", "NEW"]]);

  it("returns the same rows when there are no renames", () => {
    const rows = [sale("OLD", 3)];
    expect(foldRenamedSkuRows(rows, new Map(), "link_master_sku", "link_qty", IDENTITY)).toBe(rows);
  });

  it("returns the same rows when none of them is a renamed SKU", () => {
    const rows = [sale("OTHER", 3)];
    expect(foldRenamedSkuRows(rows, aliases, "link_master_sku", "link_qty", IDENTITY)).toBe(rows);
  });

  it("moves an old code's sales onto the current code", () => {
    const result = foldRenamedSkuRows([sale("OLD", 3)], aliases, "link_master_sku", "link_qty", IDENTITY);
    expect(result).toEqual([sale("NEW", 3)]);
  });

  it("adds old and current code sold on the same day, channel and order type", () => {
    const result = foldRenamedSkuRows(
      [sale("OLD", 3), sale("NEW", 4, "2026-11-10", { is_custom: "Y" }), sale("OTHER", 9)],
      aliases, "link_master_sku", "link_qty", IDENTITY,
    );
    expect(result).toEqual([sale("NEW", 7, "2026-11-10", { is_custom: "Y" }), sale("OTHER", 9)]);
  });

  it("keeps rows apart when the day or the channel differs", () => {
    const result = foldRenamedSkuRows(
      [sale("OLD", 3, "2026-11-09"), sale("NEW", 4, "2026-11-10"), sale("OLD", 2, "2026-11-10", { channel: "Walmart" })],
      aliases, "link_master_sku", "link_qty", IDENTITY,
    );
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.link_master_sku === "NEW")).toBe(true);
    expect(result.reduce((sum, r) => sum + r.link_qty, 0)).toBe(9);
  });

  it("does not change the rows it was given", () => {
    const rows = [sale("OLD", 3), sale("NEW", 4)];
    foldRenamedSkuRows(rows, aliases, "link_master_sku", "link_qty", IDENTITY);
    expect(rows.map((r) => [r.link_master_sku, r.link_qty])).toEqual([["OLD", 3], ["NEW", 4]]);
  });
});
