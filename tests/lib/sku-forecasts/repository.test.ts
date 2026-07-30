import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();

vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));

const { SkuForecastsRepository } = await import("@/lib/sku-forecasts/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuForecastsRepository.getInboundHistory", () => {
  it("maps rows to camelCase and derives stockInCompletedAt only when complete", async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          item_id: 1, container_id: 2, container_number: "C-001", status: "complete",
          eta: "2026-01-01", status_changed_at: "2026-01-05T00:00:00Z", inbound_qty: 10, cbm: 5,
          source_types: ["remaining"], remaining_references: ["REF-1"], remaining_qty: 4,
          mistake_references: null, mistake_qty: 0, item_updated_at: "2026-01-05T00:00:00Z",
        },
        {
          item_id: 2, container_id: 3, container_number: "C-002", status: "shipped",
          eta: null, status_changed_at: "2026-01-02T00:00:00Z", inbound_qty: 5, cbm: 2,
          source_types: null, remaining_references: null, remaining_qty: 0,
          mistake_references: null, mistake_qty: 0, item_updated_at: null,
        },
      ],
    });

    const rows = await SkuForecastsRepository.getInboundHistory("SKU-1");

    expect(rows[0].stockInCompletedAt).toBe("2026-01-05T00:00:00Z");
    expect(rows[1].stockInCompletedAt).toBeNull();
    expect(rows[0].sourceTypes).toEqual(["remaining"]);
    expect(rows[1].sourceTypes).toEqual([]);
    expect(rows[0].changeHistory).toBeNull();
  });
});

describe("SkuForecastsRepository.getInbound", () => {
  it("excludes draft containers from the status filter by default", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await SkuForecastsRepository.getInbound("SKU-1", false);
    const [sql] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("c.status IN ('shipped', 'packing_received')");
  });

  it("includes draft containers when requested", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await SkuForecastsRepository.getInbound("SKU-1", true);
    const [sql] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("('shipped', 'packing_received', 'draft')");
  });

  it("returns rows unmapped (original snake_case inbound_qty field)", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: 1, name: "C-001", eta: null, status: "shipped", inbound_qty: 3, cbm: 1 }] });
    const rows = await SkuForecastsRepository.getInbound("SKU-1", false);
    expect(rows).toEqual([{ id: 1, name: "C-001", eta: null, status: "shipped", inbound_qty: 3, cbm: 1 }]);
  });
});

describe("SkuForecastsRepository.getForecastMinDate", () => {
  it("truncates the timestamp to a date string", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ min_date: "2024-03-15T10:30:00.000Z" }] });
    const minDate = await SkuForecastsRepository.getForecastMinDate();
    expect(minDate).toBe("2024-03-15");
  });

  it("returns null when there are no rows", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    expect(await SkuForecastsRepository.getForecastMinDate()).toBeNull();
  });
});
