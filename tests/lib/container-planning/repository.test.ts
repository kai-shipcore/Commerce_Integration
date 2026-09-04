import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn(() => Promise.resolve({ query: clientQueryMock, release: clientReleaseMock }));

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: connectMock })),
}));

const { ContainerPlanningRepository, withTransaction } = await import("@/lib/container-planning/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withTransaction", () => {
  it("commits on success and rolls back + rethrows on failure", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });
    await expect(withTransaction(async () => "ok")).resolves.toBe("ok");
    expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");

    clientQueryMock.mockClear();
    await expect(withTransaction(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(clientQueryMock).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("ContainerPlanningRepository.listContainers", () => {
  it("excludes received containers by default and adds no category join", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await ContainerPlanningRepository.listContainers({
      warehouseCode: "", warehouseName: "", city: "", includeReceived: false, includeDetails: false, timelineView: false, categoryCode: null,
    });
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("c.status <> 'received'");
    expect(sql).not.toContain("p_filter.category_code");
    expect(params).toEqual([]);
  });

  it("builds an OR'd ILIKE filter across warehouseCode/warehouseName/city", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await ContainerPlanningRepository.listContainers({
      warehouseCode: "FUL", warehouseName: "", city: "LA", includeReceived: true, includeDetails: false, timelineView: false, categoryCode: null,
    });
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("COALESCE(c.dest_warehouse, '') ILIKE $1 OR COALESCE(c.dest_warehouse, '') ILIKE $2");
    expect(params).toEqual(["%FUL%", "%LA%"]);
  });

  it("adds the category-code join and filter when categoryCode is set", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await ContainerPlanningRepository.listContainers({
      warehouseCode: "", warehouseName: "", city: "", includeReceived: true, includeDetails: false, timelineView: false, categoryCode: "FM",
    });
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("p_filter.category_code = $1");
    expect(sql).toContain("p_item.category_code = $1");
    expect(params).toEqual(["FM"]);
  });

  it("selects categoryCode instead of allocations when timelineView is true", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await ContainerPlanningRepository.listContainers({
      warehouseCode: "", warehouseName: "", city: "", includeReceived: true, includeDetails: false, timelineView: true, categoryCode: null,
    });
    const [sql] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("'categoryCode', p_item.category_code");
    expect(sql).not.toContain("'allocations', COALESCE");
  });

  it("maps rows to camelCase and includes items only when includeDetails is true", async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{
        id: "1", container_number: "C-1", eta_date: "2026-01-01", actual_arrival_date: null,
        status: "draft", cbm_capacity: "80", factory_name: "F1", origin: null, dest_warehouse: "W1", note: null, calendar_color: "#4285F4",
        est_loading_date: null, etd_ngb_date: null, eta_lax_lgb_date: null, confirmed_date: null, confirmed_time: null,
        item_count: 1, total_qty: 10, total_cbm: "5", items: [{ id: "1", sku: "SKU-1", qty: 10, cbm: 0.5, sku_memo: null, remaining_stock_qty: 2, allocations: [] }],
      }],
    });

    const withoutDetails = await ContainerPlanningRepository.listContainers({
      warehouseCode: "", warehouseName: "", city: "", includeReceived: true, includeDetails: false, timelineView: false, categoryCode: null,
    });
    expect(withoutDetails[0].items).toBeUndefined();
    expect(withoutDetails[0].containerNumber).toBe("C-1");
    expect(withoutDetails[0].cbmCapacity).toBe(80);
    expect(withoutDetails[0].calendarColor).toBe("#4285F4");

    const withDetails = await ContainerPlanningRepository.listContainers({
      warehouseCode: "", warehouseName: "", city: "", includeReceived: true, includeDetails: true, timelineView: false, categoryCode: null,
    });
    expect(withDetails[0].items).toEqual([
      { id: "1", sku: "SKU-1", qty: 10, cbm: 0.5, skuMemo: null, remainingStockQty: 2, allocations: [] },
    ]);
  });
});

describe("ContainerPlanningRepository.findMissingSkus", () => {
  it("returns only the skus not found in fc_products", async () => {
    clientQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1" }] });
    const missing = await ContainerPlanningRepository.findMissingSkus(["SKU-1", "SKU-2"], { query: clientQueryMock } as never);
    expect(missing).toEqual(["SKU-2"]);
  });
});

describe("ContainerPlanningRepository status/details updates", () => {
  it("updateStatus returns true when a row was updated, false otherwise", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 1 });
    expect(await ContainerPlanningRepository.updateStatus("1", "complete")).toBe(true);

    poolQueryMock.mockResolvedValue({ rowCount: 0 });
    expect(await ContainerPlanningRepository.updateStatus("1", "complete")).toBe(false);
  });

  it("updates a custom calendar color or clears it to restore the status default", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 1 });
    expect(await ContainerPlanningRepository.updateCalendarColor("1", "#4285F4")).toBe(true);
    expect(poolQueryMock).toHaveBeenLastCalledWith(expect.stringContaining("calendar_color = $2"), ["1", "#4285F4"]);

    expect(await ContainerPlanningRepository.updateCalendarColor("1", null)).toBe(true);
    expect(poolQueryMock).toHaveBeenLastCalledWith(expect.stringContaining("calendar_color = $2"), ["1", null]);
  });

  it("getContainer returns null when not found, mapped row otherwise", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    expect(await ContainerPlanningRepository.getContainer("1")).toBeNull();

    poolQueryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{
        status: "draft", container_number: "C-1", eta: "2026-01-01", cbm_capacity: 80,
        factory_name: null, dest_warehouse: null, note: null, calendar_color: null, est_loading: null, etd_ngb: null, eta_lax_lgb: null,
        confirmed_date: null, confirmed_time: null,
      }],
    });
    const row = await ContainerPlanningRepository.getContainer("1");
    expect(row?.containerNumber).toBe("C-1");
  });
});

describe("ContainerPlanningRepository.replaceContainerFull", () => {
  it("deletes and reinserts items only when items are provided, always clears po links", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });
    await ContainerPlanningRepository.replaceContainerFull(
      "1",
      { number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [] },
      { query: clientQueryMock } as never,
    );
    const calls = clientQueryMock.mock.calls.map((c) => c[0]);
    expect(calls.some((sql: string) => sql.includes("DELETE FROM shipcore.fc_container_items"))).toBe(false);
    expect(calls.some((sql: string) => sql.includes("DELETE FROM shipcore.fc_container_po_links"))).toBe(true);
  });

  it("deletes then reinserts items when items are provided", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });
    await ContainerPlanningRepository.replaceContainerFull(
      "1",
      { number: "C-1", eta: "2026-01-01", cbmCapacity: 80, items: [{ sku: "sku-1", qty: 2, cbm: 1 }] },
      { query: clientQueryMock } as never,
    );
    const calls = clientQueryMock.mock.calls.map((c) => c[0]);
    expect(calls.some((sql: string) => sql.includes("DELETE FROM shipcore.fc_container_items"))).toBe(true);
    expect(calls.some((sql: string) => sql.includes("INSERT INTO shipcore.fc_container_items"))).toBe(true);
  });
});

describe("ContainerPlanningRepository.syncRemainingAllocationForContainerItem", () => {
  it("returns 0 immediately when no remaining/mistake stock exists", async () => {
    clientQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const allocated = await ContainerPlanningRepository.syncRemainingAllocationForContainerItem(
      { query: clientQueryMock } as never,
      { containerId: 1, masterSku: "sku-1", targetQty: 10 },
    );
    expect(allocated).toBe(0);
    expect(clientQueryMock).toHaveBeenCalledTimes(1);
  });

  it("allocates up to the available qty per stock row, spilling into the next row", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: "1" }, { id: "2" }] }) // lock stocks
      .mockResolvedValueOnce({
        rows: [
          { id: "1", total_qty: 5, allocated_total: 0, allocated_here: 0 },
          { id: "2", total_qty: 20, allocated_total: 0, allocated_here: 0 },
        ],
      }) // stock totals
      .mockResolvedValueOnce({ rows: [] }) // lock existing allocations
      .mockResolvedValueOnce({ rows: [] }) // insert allocation for stock 1
      .mockResolvedValueOnce({ rows: [] }); // insert allocation for stock 2

    const allocated = await ContainerPlanningRepository.syncRemainingAllocationForContainerItem(
      { query: clientQueryMock } as never,
      { containerId: 1, masterSku: "SKU-1", targetQty: 10 },
    );

    expect(allocated).toBe(10);
    const insertCalls = clientQueryMock.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO shipcore.fc_container_item_allocations"));
    expect(insertCalls[0][1]).toEqual([1, "1", 5]);
    expect(insertCalls[1][1]).toEqual([1, "2", 5]);
  });

  it("deletes the allocation row when target qty drops to 0 for an already-allocated stock", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "1", total_qty: 5, allocated_total: 5, allocated_here: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }); // delete

    const allocated = await ContainerPlanningRepository.syncRemainingAllocationForContainerItem(
      { query: clientQueryMock } as never,
      { containerId: 1, masterSku: "SKU-1", targetQty: 0 },
    );

    expect(allocated).toBe(0);
    const deleteCall = clientQueryMock.mock.calls.find((c) => String(c[0]).includes("DELETE FROM shipcore.fc_container_item_allocations"));
    expect(deleteCall).toBeTruthy();
  });
});

describe("ContainerPlanningRepository allocate/deallocate helpers", () => {
  it("lockContainerStatus returns null when the container doesn't exist", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });
    expect(await ContainerPlanningRepository.lockContainerStatus("1", { query: clientQueryMock } as never)).toBeNull();
  });

  it("lockAvailableStockForAllocate maps rows to camelCase", async () => {
    clientQueryMock.mockResolvedValue({ rows: [{ id: "1", master_sku: "SKU-1", cbm: 1.5, available_qty: 3 }] });
    const rows = await ContainerPlanningRepository.lockAvailableStockForAllocate(["1"], { query: clientQueryMock } as never);
    expect(rows).toEqual([{ id: "1", masterSku: "SKU-1", cbm: 1.5, availableQty: 3 }]);
  });

  it("lockAllocationsForDeallocate maps rows to camelCase", async () => {
    clientQueryMock.mockResolvedValue({ rows: [{ id: "1", container_id: "2", master_sku: "SKU-1", qty: 3, status: "draft" }] });
    const rows = await ContainerPlanningRepository.lockAllocationsForDeallocate(["1"], { query: clientQueryMock } as never);
    expect(rows).toEqual([{ id: "1", containerId: "2", masterSku: "SKU-1", qty: 3, status: "draft" }]);
  });
});
