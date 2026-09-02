import { describe, it, expect, vi, beforeEach } from "vitest";

const lookupQueryMock = vi.fn();
let lookupPoolValue: { query: typeof lookupQueryMock } | null = { query: lookupQueryMock };

const primaryQueryMock = vi.fn();
const primaryPoolMock = { query: primaryQueryMock };

vi.mock("@/lib/db/supabase-lookup", () => ({ getLookupPool: vi.fn(() => lookupPoolValue) }));
vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => primaryPoolMock) }));
vi.mock("@/lib/redis", () => ({ CacheManager: { get: vi.fn().mockResolvedValue(null), set: vi.fn() } }));

const { VelocityRepository } = await import("@/lib/velocity/repository");

beforeEach(() => {
  vi.clearAllMocks();
  lookupPoolValue = { query: lookupQueryMock };
});

describe("VelocityRepository.getLinkSalesVelocity", () => {
  it("returns empty result when the lookup pool is unavailable", async () => {
    lookupPoolValue = null;
    const result = await VelocityRepository.getLinkSalesVelocity({});
    expect(result).toEqual({ rows: [], totals: null });
  });

  it("returns rows and totals from the two parallel queries", async () => {
    lookupQueryMock
      .mockResolvedValueOnce({ rows: [{ master_sku: "SKU-1", qty_90d: 5, qty_60d: 4, qty_30d: 3, qty_15d: 2, qty_7d: 1, total_count: "1" }] })
      .mockResolvedValueOnce({ rows: [{ total_90d: "5", total_60d: "4", total_30d: "3", total_15d: "2", total_7d: "1", sku_count: "1" }] });

    const result = await VelocityRepository.getLinkSalesVelocity({ search: "sku" });

    expect(result.rows).toHaveLength(1);
    expect(result.totals?.sku_count).toBe("1");
  });

  it("returns empty result and logs on query failure", async () => {
    lookupQueryMock.mockRejectedValue(new Error("db down"));
    const result = await VelocityRepository.getLinkSalesVelocity({});
    expect(result).toEqual({ rows: [], totals: null });
  });
});

describe("VelocityRepository.getCustomSalesForSkus", () => {
  it("short-circuits to an empty map for an empty sku list", async () => {
    const result = await VelocityRepository.getCustomSalesForSkus([]);
    expect(result.size).toBe(0);
    expect(lookupQueryMock).not.toHaveBeenCalled();
  });

  it("builds a link_master_sku -> custom stats map", async () => {
    lookupQueryMock.mockResolvedValue({
      rows: [{ link_master_sku: "SKU-1", custom_master_sku: "CUSTOM-1", qty_90d: 5, qty_60d: 4, qty_30d: 3, qty_15d: 2, qty_7d: 1 }],
    });

    const result = await VelocityRepository.getCustomSalesForSkus(["SKU-1"]);

    expect(result.get("SKU-1")).toMatchObject({ custom_master_sku: "CUSTOM-1", qty_90d: 5 });
  });
});

describe("VelocityRepository.getPreOrderTotals", () => {
  it("returns null when the lookup pool is unavailable", async () => {
    lookupPoolValue = null;
    expect(await VelocityRepository.getPreOrderTotals()).toBeNull();
  });

  it("combines custom and ttm totals", async () => {
    lookupQueryMock
      .mockResolvedValueOnce({ rows: [{ total: "3" }] })
      .mockResolvedValueOnce({ rows: [{ total: "7" }] });

    const result = await VelocityRepository.getPreOrderTotals();

    expect(result).toEqual({ custom_total: "3", ttm_total: "7" });
  });
});

describe("VelocityRepository.queryChannelVelocity", () => {
  it("throws when the lookup pool is unavailable", async () => {
    lookupPoolValue = null;
    await expect(
      VelocityRepository.queryChannelVelocity({
        platformSource: "", fulfillmentChannel: "", search: "", sortCol: "qty_90d", sortOrder: "DESC", limit: 100, offset: 0,
      })
    ).rejects.toThrow("No lookup database connection configured");
  });

  it("applies platformSource/fulfillmentChannel/search filters", async () => {
    lookupQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_90d: "0", total_60d: "0", total_30d: "0", total_15d: "0", total_7d: "0", sku_count: "0" }] });

    await VelocityRepository.queryChannelVelocity({
      platformSource: "AMAZON", fulfillmentChannel: "FBA", search: "sku", sortCol: "qty_90d", sortOrder: "DESC", limit: 100, offset: 0,
    });

    const [dataSql, dataParams] = lookupQueryMock.mock.calls[0];
    expect(dataSql).toContain("platform_source::text = $1");
    expect(dataSql).toContain("fulfillment_channel::text = $2");
    expect(dataSql).toContain("master_sku ILIKE $3");
    expect(dataParams).toEqual(["AMAZON", "FBA", "%sku%", 100, 0]);
  });
});

describe("VelocityRepository.getDistinctChannels", () => {
  it("throws when the lookup pool is unavailable", async () => {
    lookupPoolValue = null;
    await expect(VelocityRepository.getDistinctChannels()).rejects.toThrow("No lookup database connection configured");
  });

  it("only includes ebay sub-channels when rows are present", async () => {
    lookupQueryMock
      .mockResolvedValueOnce({ rows: [{ platform_source: "amazon" }, { platform_source: "ebay" }] })
      .mockResolvedValueOnce({ rows: [{ fulfillment_channel: "ebay-fba" }] });

    const result = await VelocityRepository.getDistinctChannels();

    expect(result.channels).toEqual(["amazon", "ebay"]);
    expect(result.subChannels).toEqual({ ebay: ["ebay-fba"] });
  });

  it("omits the ebay key entirely when there are no sub-channel rows", async () => {
    lookupQueryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const result = await VelocityRepository.getDistinctChannels();
    expect(result.subChannels).toEqual({});
  });
});

describe("VelocityRepository sync helpers", () => {
  it("tryAcquireSyncLock reflects the pg_try_advisory_lock result", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
    const acquired = await VelocityRepository.tryAcquireSyncLock(client as never);
    expect(acquired).toBe(true);
  });

  it("reclaimStaleLock does nothing when no holder is found", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await VelocityRepository.reclaimStaleLock(client as never);
    expect(result).toEqual({ reclaimed: false, holdSeconds: null });
  });

  it("reclaimStaleLock leaves a fresh lock alone", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ pid: 1, hold_seconds: 10 }] }) };
    const result = await VelocityRepository.reclaimStaleLock(client as never);
    expect(result).toEqual({ reclaimed: false, holdSeconds: 10 });
    expect(client.query).toHaveBeenCalledTimes(1); // no terminate call
  });

  it("reclaimStaleLock terminates a stale holder", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ pid: 42, hold_seconds: 10000 }] }).mockResolvedValueOnce({ rows: [] }) };
    const result = await VelocityRepository.reclaimStaleLock(client as never);
    expect(result).toEqual({ reclaimed: true, holdSeconds: 10000 });
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining("pg_terminate_backend"), [42]);
  });

  it("upsertLinkSnapshot batches inserts and returns the total row count", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      order_date: new Date("2026-01-01"),
      channel: "Amazon FBA", item_category: "Seat Cover", order_type: "sales",
      link_master_sku: `SKU-${i}`, link_qty: 1, is_custom: "N",
    }));

    const upserted = await VelocityRepository.upsertLinkSnapshot(rows, new Date());

    expect(upserted).toBe(3);
    expect(primaryQueryMock).toHaveBeenCalledTimes(1); // fits in one batch (BATCH_SIZE=2000)
  });

  // The INSERT lists columns positionally against an UNNEST per parameter, so a
  // column removed from one half and not the other silently writes the wrong
  // field. Pin the two counts to each other.
  it("upsertLinkSnapshot passes exactly one parameter array per inserted column", async () => {
    await VelocityRepository.upsertLinkSnapshot(
      [{
        order_date: new Date("2026-01-01"), channel: "Amazon FBA", item_category: "Seat Cover",
        order_type: "sales", link_master_sku: "SKU-1", link_qty: 1, is_custom: "N",
      }],
      new Date(),
    );

    const [sql, params] = primaryQueryMock.mock.calls[0];
    const columns = (sql as string).match(/\(([^)]*)\)\s*SELECT/)![1].split(",").length;
    expect(columns).toBe((params as unknown[]).length);
    expect(sql).not.toContain("order_date_la");
  });

  it("upsertCustomSnapshot passes exactly one parameter array per inserted column", async () => {
    await VelocityRepository.upsertCustomSnapshot(
      [{
        order_date: new Date("2026-01-01"), channel: "Amazon FBA", item_category: "Seat Cover",
        order_type: "sales", custom_master_sku: "SKU-1", custom_qty: 1, is_custom: "N",
      }],
      new Date(),
    );

    const [sql, params] = primaryQueryMock.mock.calls[0];
    const columns = (sql as string).match(/\(([^)]*)\)\s*SELECT/)![1].split(",").length;
    expect(columns).toBe((params as unknown[]).length);
    expect(sql).not.toContain("order_date_la");
  });

  it("querySnapshotByRanges always aggregates on order_date (no timezone option)", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await VelocityRepository.querySnapshotByRanges({
      table: "fc_velocity_link_snapshot", skuColumn: "link_master_sku", qtyColumn: "link_qty",
      items: ["Seat Cover"], channels: ["Amazon FBA"], orderType: "sales",
      ranges: [{ from: "2026-08-24", to: "2026-08-30" }],
    });

    const [sql] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("order_date >= '2026-08-24'");
    expect(sql).not.toContain("order_date_la");
  });

  it("deleteStaleSnapshots uses the full-wipe clause when full=true", async () => {
    primaryQueryMock.mockResolvedValue({ rowCount: 0 });
    await VelocityRepository.deleteStaleSnapshots(new Date(), true);
    const [linkSql] = primaryQueryMock.mock.calls[0];
    expect(linkSql).not.toContain("order_date >=");
  });

  it("deleteStaleSnapshots scopes to the lookback window when full=false", async () => {
    primaryQueryMock.mockResolvedValue({ rowCount: 0 });
    await VelocityRepository.deleteStaleSnapshots(new Date(), false);
    const [linkSql] = primaryQueryMock.mock.calls[0];
    expect(linkSql).toContain("order_date >= NOW() - INTERVAL '120 days'");
  });
});
