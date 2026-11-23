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

  // The refresh never deletes a product removed from ShipHero, so its last row
  // stays with the stock it had (CA-FM-TX-80-FM14242: 16 at Fullerton, last
  // written three months before the team asked where it came from).
  it("leaves out rows the daily refresh no longer writes", async () => {
    lookupQueryMock.mockResolvedValue({ rows: [] });
    await InventoryManagementRepository.getStockBySkuAndWarehouse();
    const [sql] = lookupQueryMock.mock.calls[0];
    expect(sql).toContain("SELECT MAX(created_at) FROM ecommerce_data.coverland_inventory_by_warehouse");
    expect(sql).toContain("- INTERVAL '7 days'");
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
