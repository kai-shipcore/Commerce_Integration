import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn(() => Promise.resolve({ query: clientQueryMock, release: clientReleaseMock }));

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock, connect: connectMock })),
}));

const { PlanningDashboardRepository, withTransaction } = await import("@/lib/planning-dashboard/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withTransaction", () => {
  it("commits on success and rolls back on failure", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });
    await expect(withTransaction(async () => "ok")).resolves.toBe("ok");
    expect(clientQueryMock).toHaveBeenCalledWith("COMMIT");

    clientQueryMock.mockClear();
    await expect(withTransaction(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(clientQueryMock).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("PlanningDashboardRepository.listSkuNotes", () => {
  it("maps rows to masterSku/note", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1", note: "hello" }] });
    const rows = await PlanningDashboardRepository.listSkuNotes();
    expect(rows).toEqual([{ masterSku: "SKU-1", note: "hello" }]);
    expect(poolQueryMock.mock.calls[0][0]).toContain("fc_planning_sku_notes");
  });
});

describe("PlanningDashboardRepository SKU work notes", () => {
  it("reads shared workflow labels from their separate table", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1", note: "Checked" }] });
    await expect(PlanningDashboardRepository.listSkuWorkNotes())
      .resolves.toEqual([{ masterSku: "SKU-1", note: "Checked" }]);
    expect(poolQueryMock.mock.calls[0][0]).toContain("fc_planning_sku_work_notes");
  });

  it("upserts and deletes a work note by SKU", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await PlanningDashboardRepository.upsertSkuWorkNote("SKU-1", "Hold", "u1");
    expect(poolQueryMock.mock.calls[0][0]).toContain("ON CONFLICT (master_sku)");
    await PlanningDashboardRepository.deleteSkuWorkNote("SKU-1");
    expect(poolQueryMock.mock.calls[1][0]).toContain("DELETE FROM shipcore.fc_planning_sku_work_notes");
  });
});

describe("PlanningDashboardRepository.getProductCbmForUpdate", () => {
  it("returns null when the product has no cbm on file", async () => {
    clientQueryMock.mockResolvedValue({ rows: [{ cbm_per_unit: null }] });
    const cbm = await PlanningDashboardRepository.getProductCbmForUpdate("SKU-1", { query: clientQueryMock } as never);
    expect(cbm).toBeNull();
  });

  it("returns the existing cbm", async () => {
    clientQueryMock.mockResolvedValue({ rows: [{ cbm_per_unit: 1.5 }] });
    const cbm = await PlanningDashboardRepository.getProductCbmForUpdate("SKU-1", { query: clientQueryMock } as never);
    expect(cbm).toBe(1.5);
  });
});

describe("PlanningDashboardRepository.cascadeContainerItemsCbm", () => {
  it("returns rows with the original snake_case field names", async () => {
    clientQueryMock.mockResolvedValue({
      rows: [{ item_id: 1, container_name: "C-001", cbm_unit: 2, total_cbm: 20 }],
    });
    const rows = await PlanningDashboardRepository.cascadeContainerItemsCbm("SKU-1", 2, { query: clientQueryMock } as never);
    expect(rows).toEqual([{ item_id: 1, container_name: "C-001", cbm_unit: 2, total_cbm: 20 }]);
  });
});

describe("PlanningDashboardRepository.getOosLostDemandChannelTotals", () => {
  it("groups by category and returns per-channel 90d totals", async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ category_code: "SC", shopify_90d: "100", amazon_90d: "10", ebay_90d: "5", walmart_90d: "2" }],
    });
    const rows = await PlanningDashboardRepository.getOosLostDemandChannelTotals();
    expect(rows[0].category_code).toBe("SC");
    expect(poolQueryMock.mock.calls[0][0]).toContain("fc_velocity_link_snapshot");
  });
});
