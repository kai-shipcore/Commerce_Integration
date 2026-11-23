import { describe, it, expect, vi, beforeEach } from "vitest";

const lookupQueryMock = vi.fn();
let lookupPool: { query: typeof lookupQueryMock } | null = { query: lookupQueryMock };

vi.mock("@/lib/db/supabase-lookup", () => ({
  getLookupPool: vi.fn(() => lookupPool),
}));

const { InventoryManagementRepository } = await import("@/lib/inventory-management/repository");

beforeEach(() => {
  vi.clearAllMocks();
  lookupPool = { query: lookupQueryMock };
});

describe("InventoryManagementRepository.getStockBySkuAndWarehouse", () => {
  it("returns null when the lookup DB is not configured", async () => {
    lookupPool = null;
    expect(await InventoryManagementRepository.getStockBySkuAndWarehouse()).toBeNull();
    expect(lookupQueryMock).not.toHaveBeenCalled();
  });

  it("reads stock per SKU and warehouse from the warehouse feed", async () => {
    const rows = [{ master_sku: "SKU-1", warehouse: "Fullerton", on_hand: 5, available: 4 }];
    lookupQueryMock.mockResolvedValue({ rows });

    expect(await InventoryManagementRepository.getStockBySkuAndWarehouse()).toEqual(rows);
    const [sql] = lookupQueryMock.mock.calls[0];
    expect(sql).toContain("FROM ecommerce_data.coverland_inventory_by_warehouse");
    expect(sql).toContain("GROUP BY 1, 2");
  });

  // A product made inactive in ShipHero drops out of the daily update while
  // its units are still on the shelf (CA-NP-01-BK: 196 at Fullerton, last
  // written a month earlier). Filtering those rows out hid real stock, so they
  // are returned and flagged instead.
  it("keeps rows the daily update no longer writes, and flags them", async () => {
    lookupQueryMock.mockResolvedValue({ rows: [] });
    await InventoryManagementRepository.getStockBySkuAndWarehouse();
    const [sql] = lookupQueryMock.mock.calls[0];
    expect(sql).toContain("AS stale");
    expect(sql).toContain("SELECT MAX(created_at) FROM ecommerce_data.coverland_inventory_by_warehouse");
    expect(sql).toContain("- INTERVAL '7 days'");
    expect(sql).toContain("AS last_updated");
    // The flag is a selected column, never a filter.
    const where = sql.slice(sql.indexOf("WHERE master_sku"), sql.indexOf("GROUP BY"));
    expect(where).not.toContain("created_at");
  });

  // The page has to show which SKU stock really sits under, so the merge
  // rules are applied in the service, not in this query.
  it("does not remap the SKU", async () => {
    lookupQueryMock.mockResolvedValue({ rows: [] });
    await InventoryManagementRepository.getStockBySkuAndWarehouse();
    const [sql] = lookupQueryMock.mock.calls[0];
    expect(sql).not.toContain("CASE");
    expect(sql).not.toContain("C-SJ-GR-7");
  });
});
