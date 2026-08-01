import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
const prismaMock = { sKU: { findMany: vi.fn(), createManyAndReturn: vi.fn() } };

vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

const { SalesRepository } = await import("@/lib/sales/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SalesRepository filter building", () => {
  it("always requires is_counted_in_demand and adds masterSkuCode/platform/date filters when present", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await SalesRepository.listGrouped(
      { masterSkuCode: "SKU-1", platform: "shopify", startDate: "2026-01-01", endDate: "2026-01-31" },
      "day",
    );
    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("i.is_counted_in_demand = true");
    expect(sql).toContain("i.product_id = (SELECT id FROM shipcore.sc_products WHERE master_sku = $1)");
    expect(sql).toContain("o.platform_source::text = $2");
    expect(params).toEqual(["SKU-1", "shopify", new Date("2026-01-01"), new Date("2026-01-31")]);
  });

  it("omits optional filters when absent", async () => {
    poolQueryMock.mockResolvedValue({ rows: [] });
    await SalesRepository.listGrouped({ masterSkuCode: null, platform: null, startDate: null, endDate: null }, "month");
    const [, params] = poolQueryMock.mock.calls[0];
    expect(params).toEqual([]);
  });
});

describe("SalesRepository.listPaged", () => {
  it("appends limit/offset params after any filter params", async () => {
    poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    poolQueryMock.mockImplementation((sql: string) =>
      sql.includes("COUNT(*)") ? Promise.resolve({ rows: [{ total: 5 }] }) : Promise.resolve({ rows: [] }),
    );
    const result = await SalesRepository.listPaged({ masterSkuCode: "SKU-1", platform: null, startDate: null, endDate: null }, 50, 10);
    const dataCall = poolQueryMock.mock.calls.find((c) => !String(c[0]).includes("COUNT(*)"));
    expect(dataCall![1]).toEqual(["SKU-1", 50, 10]);
    expect(result.total).toBe(5);
  });
});
