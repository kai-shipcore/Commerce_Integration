import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResolvedInventoryQuery } from "@/lib/inventory/repository";

const queryMock = vi.fn();
const poolMock = { query: queryMock };

vi.mock("@/lib/db/supabase-lookup", () => ({ getLookupPool: vi.fn(() => poolMock) }));

const { InventoryRepository } = await import("@/lib/inventory/repository");

const RESOLVED: ResolvedInventoryQuery = {
  page: 1,
  limit: 20,
  offset: 0,
  exportAll: false,
  search: "",
  warehouse: "",
  groupBy: "warehouse",
  sortBy: "masterSku",
  sortOrder: "asc",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InventoryRepository.queryCoverlandInventory", () => {
  it("throws when the lookup pool is unavailable", async () => {
    const { getLookupPool } = await import("@/lib/db/supabase-lookup");
    vi.mocked(getLookupPool).mockReturnValueOnce(null);

    await expect(InventoryRepository.queryCoverlandInventory(RESOLVED)).rejects.toThrow(
      "No lookup database connection configured"
    );
  });

  it("maps the resolved sortBy/sortOrder to the correct SQL column and direction", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total_rows: "0", total_products: "0", total_warehouses: "0", total_on_hand: "0", total_allocated: "0", total_available: "0", total_backorder: "0" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await InventoryRepository.queryCoverlandInventory({ ...RESOLVED, sortBy: "onHand", sortOrder: "desc" });

    const [thirdCallSql] = queryMock.mock.calls[2];
    expect(thirdCallSql).toContain("ORDER BY on_hand DESC");
  });

  it("shapes warehouse-grouped rows and totals from the query results", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            total_rows: "2",
            total_products: "1",
            total_warehouses: "2",
            total_on_hand: "10",
            total_allocated: "1",
            total_available: "9",
            total_backorder: "0",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ warehouse: "WH1" }, { warehouse: "WH2" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            master_sku: "SKU-1",
            on_hand: 5,
            allocated: 1,
            available: 4,
            backorder: 0,
            warehouse: "WH1",
            created_at: null,
          },
        ],
      });

    const result = await InventoryRepository.queryCoverlandInventory(RESOLVED);

    expect(result.rows).toEqual([
      { masterSku: "SKU-1", onHand: 5, allocated: 1, available: 4, backorder: 0, warehouse: "WH1", warehouseCount: undefined, createdAt: null },
    ]);
    expect(result.totalRows).toBe(2);
    expect(result.warehouses).toEqual(["WH1", "WH2"]);
    expect(result.totals).toEqual({ onHand: 10, allocated: 1, available: 9, backorder: 0 });
  });
});
