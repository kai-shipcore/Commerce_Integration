import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: queryMock })),
}));

const { WorkbenchContainerPushRepository } = await import("@/lib/workbench-container-push/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkbenchContainerPushRepository.listContainers", () => {
  it("reads the requested statuses with each container's items and text dates", async () => {
    const row = {
      id: "1",
      container_number: "137-CA",
      status: "shipped",
      dest_warehouse: "FULLERTON",
      dest_warehouse_name: "Fullerton Primary",
      dest_timezone: "America/Los_Angeles",
      eta_date: "2026-12-01",
      eta_lax_lgb_date: null,
      items: [{ sku: "CA-SC-10-F-10-BK-1TO", qty: 12 }],
    };
    queryMock.mockResolvedValue({ rows: [row] });

    const rows = await WorkbenchContainerPushRepository.listContainers(["packing_received", "shipped"]);

    expect(rows).toEqual([row]);
    const [sql, params] = queryMock.mock.calls[0];
    expect(params).toEqual([["packing_received", "shipped"]]);
    expect(sql).toContain("WHERE c.status::text = ANY($1::text[])");
    expect(sql).toContain("to_char(c.eta_date, 'YYYY-MM-DD')");
    expect(sql).toContain("FROM shipcore.fc_container_items i");
    expect(sql).toContain("LEFT JOIN shipcore.fc_warehouses w");
  });
});
