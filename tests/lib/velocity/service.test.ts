import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServiceUnavailableError } from "@/lib/errors";

const repositoryMock = {
  getLinkSalesVelocity: vi.fn(),
  getCustomSalesForSkus: vi.fn(),
  getCustomSalesTotals: vi.fn(),
  getLinkTtmVelocity: vi.fn(),
  getCustomTtmForSkus: vi.fn(),
  getCustomTtmTotals: vi.fn(),
  getCustomSalesVelocity: vi.fn(),
  getCustomTtmVelocity: vi.fn(),
  getLinkPreOrderVelocity: vi.fn(),
  getCustomPreOrderForSkus: vi.fn(),
  getTtmPreOrderForSkus: vi.fn(),
  getPreOrderTotals: vi.fn(),
  queryChannelVelocity: vi.fn(),
  getDistinctChannels: vi.fn(),
  querySnapshotByRanges: vi.fn(),
  querySnapshotPreorder: vi.fn(),
  getLastSyncedAt: vi.fn(),
  checkoutSyncClient: vi.fn(),
  tryAcquireSyncLock: vi.fn(),
  reclaimStaleLock: vi.fn(),
  releaseSyncLock: vi.fn(),
  fetchLinkRowsFromLookup: vi.fn(),
  fetchCustomRowsFromLookup: vi.fn(),
  fetchLinkForecastRowsFromLookup: vi.fn(),
  upsertLinkSnapshot: vi.fn(),
  upsertCustomSnapshot: vi.fn(),
  deleteStaleSnapshots: vi.fn(),
};

const cacheManagerMock = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const getLookupPoolMock = vi.fn();
const releaseClientMock = vi.fn();

vi.mock("@/lib/velocity/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/velocity/repository")>("@/lib/velocity/repository");
  return { ...actual, VelocityRepository: repositoryMock };
});
vi.mock("@/lib/redis", () => ({ CacheManager: cacheManagerMock }));
vi.mock("@/lib/db/supabase-lookup", () => ({ getLookupPool: getLookupPoolMock }));

const { VelocityService, SyncInProgressError } = await import("@/lib/velocity/service");

const EMPTY_RESULT = { rows: [], totals: null };

beforeEach(() => {
  vi.clearAllMocks();
  cacheManagerMock.get.mockResolvedValue(null);
  getLookupPoolMock.mockReturnValue({});
  repositoryMock.checkoutSyncClient.mockResolvedValue({ release: releaseClientMock });
});

describe("VelocityService.getChannelVelocity", () => {
  const base = {
    isExport: false, page: 1, limit: 100, search: "", platformSource: "", fulfillmentChannel: "",
    sortByKey: "qty90d", sortOrder: "desc" as const, source: "",
  };

  it("source=link maps rows with the full (customQty*) shape", async () => {
    repositoryMock.getLinkSalesVelocity.mockResolvedValue({
      rows: [{ master_sku: "SKU-1", qty_90d: 1, qty_60d: 2, qty_30d: 3, qty_15d: 4, qty_7d: 5, total_count: "1" }],
      totals: { total_90d: "1", total_60d: "2", total_30d: "3", total_15d: "4", total_7d: "5", sku_count: "1" },
    });

    const result = (await VelocityService.getChannelVelocity({ ...base, source: "link" })) as {
      data: Array<Record<string, unknown>>;
      totals: Record<string, unknown>;
    };

    expect(result.data[0]).toMatchObject({ masterSku: "SKU-1", customMasterSku: null, customQty90d: null });
  });

  it("source=custom maps rows with the simple shape (no customQty fields)", async () => {
    repositoryMock.getCustomSalesVelocity.mockResolvedValue(EMPTY_RESULT);
    const result = await VelocityService.getChannelVelocity({ ...base, source: "custom" });
    expect(result.data).toEqual([]);
    expect(repositoryMock.getCustomSalesVelocity).toHaveBeenCalled();
  });

  it("source=link-ttm returns the cached response without querying on a cache hit", async () => {
    const cached = { data: [], totals: {}, pagination: {} };
    cacheManagerMock.get.mockResolvedValue(cached);

    const result = await VelocityService.getChannelVelocity({ ...base, source: "link-ttm" });

    expect(result).toBe(cached);
    expect(repositoryMock.getLinkTtmVelocity).not.toHaveBeenCalled();
  });

  it("source=link-ttm queries and caches on a miss", async () => {
    repositoryMock.getLinkTtmVelocity.mockResolvedValue(EMPTY_RESULT);
    await VelocityService.getChannelVelocity({ ...base, source: "link-ttm" });
    expect(cacheManagerMock.set).toHaveBeenCalledWith(expect.stringContaining("velocity:link-ttm:"), expect.anything(), 900);
  });

  it("source=link-preorder zeroes out qty60d..qty7d", async () => {
    repositoryMock.getLinkPreOrderVelocity.mockResolvedValue({
      rows: [{ master_sku: "SKU-1", qty_90d: 9, qty_60d: 0, qty_30d: 0, qty_15d: 0, qty_7d: 0, total_count: "1" }],
      totals: { total_90d: "9", total_60d: "0", total_30d: "0", total_15d: "0", total_7d: "0", sku_count: "1" },
    });

    const result = (await VelocityService.getChannelVelocity({ ...base, source: "link-preorder" })) as {
      data: Array<Record<string, unknown>>;
      totals: Record<string, unknown>;
    };

    expect(result.data[0]).toMatchObject({ qty90d: 9, qty60d: 0, ttmCount: null, ttmMasterSku: null });
    expect(result.totals.qty60d).toBe(0);
  });

  it("falls back to the legacy raw query when no source is given", async () => {
    repositoryMock.queryChannelVelocity.mockResolvedValue(EMPTY_RESULT);
    await VelocityService.getChannelVelocity(base);
    expect(repositoryMock.queryChannelVelocity).toHaveBeenCalledWith(
      expect.objectContaining({ platformSource: "", fulfillmentChannel: "" })
    );
  });

  it("clamps limit to 10000 when isExport is true", async () => {
    repositoryMock.queryChannelVelocity.mockResolvedValue(EMPTY_RESULT);
    await VelocityService.getChannelVelocity({ ...base, isExport: true, limit: 5 });
    expect(repositoryMock.queryChannelVelocity).toHaveBeenCalledWith(expect.objectContaining({ limit: 10000 }));
  });
});

describe("VelocityService.getSnapshotData", () => {
  it("returns empty arrays when items or channels are missing", async () => {
    const result = await VelocityService.getSnapshotData({ items: [], channels: ["Amazon"], mode: "sales", rangesCsv: "", dateCol: "order_date", combined: false });
    expect(result).toEqual({ link: [], custom: [] });
  });

  it("returns empty preorder shape when items/channels are missing in preorder mode", async () => {
    const result = await VelocityService.getSnapshotData({ items: [], channels: [], mode: "preorder", rangesCsv: "", dateCol: "order_date", combined: false });
    expect(result).toEqual({ link: [], custom: [], ttm: [] });
  });

  it("filters out invalid date ranges before querying", async () => {
    repositoryMock.querySnapshotByRanges.mockResolvedValue([]);
    await VelocityService.getSnapshotData({
      items: ["Car Cover"], channels: ["Amazon"], mode: "sales",
      rangesCsv: "2026-01-01:2026-01-31,not-a-date:also-not", dateCol: "order_date", combined: false,
    });
    const call = repositoryMock.querySnapshotByRanges.mock.calls[0][0];
    expect(call.ranges).toEqual([{ from: "2026-01-01", to: "2026-01-31" }]);
  });

  it("only queries the custom snapshot for Seat Cover", async () => {
    repositoryMock.querySnapshotByRanges.mockResolvedValue([]);
    await VelocityService.getSnapshotData({
      items: ["Car Cover"], channels: ["Amazon"], mode: "sales",
      rangesCsv: "2026-01-01:2026-01-31", dateCol: "order_date", combined: false,
    });
    // only the link query fires; custom snapshot query is skipped for non-Seat-Cover items
    expect(repositoryMock.querySnapshotByRanges).toHaveBeenCalledTimes(1);
  });

  it("preorder mode with combined=true skips the separate ttm query", async () => {
    repositoryMock.querySnapshotPreorder.mockResolvedValue([]);
    await VelocityService.getSnapshotData({
      items: ["Car Cover"], channels: ["Amazon"], mode: "preorder",
      rangesCsv: "2026-01-01:2026-01-31", dateCol: "order_date", combined: true,
    });
    // only the combined link query fires (no separate ttm query, no custom for Car Cover)
    expect(repositoryMock.querySnapshotPreorder).toHaveBeenCalledTimes(1);
  });
});

describe("VelocityService enrichment caching", () => {
  it("getCustomEnrich returns the cached value on a hit", async () => {
    const cached = { data: {}, customTotals: {} };
    cacheManagerMock.get.mockResolvedValue(cached);
    const result = await VelocityService.getCustomEnrich(["SKU-1"], "");
    expect(result).toBe(cached);
    expect(repositoryMock.getCustomSalesForSkus).not.toHaveBeenCalled();
  });

  it("getCustomEnrich queries and caches on a miss", async () => {
    repositoryMock.getCustomSalesForSkus.mockResolvedValue(new Map());
    repositoryMock.getCustomSalesTotals.mockResolvedValue(null);
    await VelocityService.getCustomEnrich(["SKU-1"], "");
    expect(cacheManagerMock.set).toHaveBeenCalled();
  });

  it("getCustomEnrichUncached never touches the cache", async () => {
    repositoryMock.getCustomSalesForSkus.mockResolvedValue(new Map());
    repositoryMock.getCustomSalesTotals.mockResolvedValue(null);
    await VelocityService.getCustomEnrichUncached(["SKU-1"], "");
    expect(cacheManagerMock.get).not.toHaveBeenCalled();
    expect(cacheManagerMock.set).not.toHaveBeenCalled();
  });
});

describe("VelocityService.runSync", () => {
  it("throws ServiceUnavailableError when the lookup pool is unavailable", async () => {
    getLookupPoolMock.mockReturnValue(null);
    await expect(VelocityService.runSync(false)).rejects.toThrow(ServiceUnavailableError);
  });

  it("throws SyncInProgressError when the lock can't be acquired and isn't stale", async () => {
    repositoryMock.tryAcquireSyncLock.mockResolvedValue(false);
    repositoryMock.reclaimStaleLock.mockResolvedValue({ reclaimed: false, holdSeconds: 42 });

    await expect(VelocityService.runSync(false)).rejects.toThrow(SyncInProgressError);
    await expect(VelocityService.runSync(false)).rejects.toMatchObject({ holdSeconds: 42 });
    expect(releaseClientMock).toHaveBeenCalled(); // client still released even when lock wasn't ours
  });

  it("retries the lock after reclaiming a stale one", async () => {
    repositoryMock.tryAcquireSyncLock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    repositoryMock.reclaimStaleLock.mockResolvedValue({ reclaimed: true, holdSeconds: 1000 });
    repositoryMock.fetchLinkRowsFromLookup.mockResolvedValue([]);
    repositoryMock.fetchCustomRowsFromLookup.mockResolvedValue([]);
    repositoryMock.fetchLinkForecastRowsFromLookup.mockResolvedValue([]);
    repositoryMock.upsertLinkSnapshot.mockResolvedValue(0);
    repositoryMock.upsertCustomSnapshot.mockResolvedValue(0);
    repositoryMock.deleteStaleSnapshots.mockResolvedValue({ linkDeleted: 0, customDeleted: 0 });

    const result = await VelocityService.runSync(false);

    expect(result).toEqual({ linkUpserted: 0, customUpserted: 0, linkDeleted: 0, customDeleted: 0 });
    expect(repositoryMock.releaseSyncLock).toHaveBeenCalled();
  });

  it("fetches, upserts, deletes stale rows, and invalidates cache on success", async () => {
    repositoryMock.tryAcquireSyncLock.mockResolvedValue(true);
    repositoryMock.fetchLinkRowsFromLookup.mockResolvedValue([{ link_master_sku: "A" }]);
    repositoryMock.fetchCustomRowsFromLookup.mockResolvedValue([{ custom_master_sku: "B" }]);
    repositoryMock.fetchLinkForecastRowsFromLookup.mockResolvedValue([]);
    repositoryMock.upsertLinkSnapshot.mockResolvedValue(1);
    repositoryMock.upsertCustomSnapshot.mockResolvedValue(1);
    repositoryMock.deleteStaleSnapshots.mockResolvedValue({ linkDeleted: 2, customDeleted: 3 });

    const result = await VelocityService.runSync(true);

    expect(result).toEqual({ linkUpserted: 1, customUpserted: 1, linkDeleted: 2, customDeleted: 3 });
    expect(cacheManagerMock.delete).toHaveBeenCalledWith("oos-preorder:sku-list:v4");
    expect(cacheManagerMock.delete).toHaveBeenCalledWith("oos-recovery:sku-list");
    expect(repositoryMock.releaseSyncLock).toHaveBeenCalled();
    expect(releaseClientMock).toHaveBeenCalled();
  });
});

describe("VelocityService.getLastSyncedAt", () => {
  it("delegates to the repository", async () => {
    repositoryMock.getLastSyncedAt.mockResolvedValue(null);
    expect(await VelocityService.getLastSyncedAt()).toBeNull();
  });
});
