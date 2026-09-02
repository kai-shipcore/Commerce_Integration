import type { PoolClient } from "pg";
import {
  VelocityRepository,
  buildSyncDateFilters,
  type VelocityQueryResult,
} from "@/lib/velocity/repository";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { CacheManager } from "@/lib/redis";
import { ServiceUnavailableError } from "@/lib/errors";

const ENRICH_CACHE_TTL = 15 * 60;

/** Thrown when a sync is already running (advisory lock held by another request). */
export class SyncInProgressError extends Error {
  holdSeconds: number | null;
  constructor(holdSeconds: number | null) {
    super("Sync already in progress");
    this.name = "SyncInProgressError";
    this.holdSeconds = holdSeconds;
  }
}

const VALID_SORT_COLS = {
  masterSku: "master_sku",
  qty90d: "qty_90d",
  qty60d: "qty_60d",
  qty30d: "qty_30d",
  qty15d: "qty_15d",
  qty7d: "qty_7d",
} as const;

function toFullVelocityRow(r: VelocityQueryResult["rows"][number]) {
  return {
    masterSku: r.master_sku,
    qty90d: r.qty_90d, qty60d: r.qty_60d, qty30d: r.qty_30d,
    qty15d: r.qty_15d, qty7d: r.qty_7d,
    customMasterSku: null,
    customQty90d: null, customQty60d: null, customQty30d: null,
    customQty15d: null, customQty7d: null,
  };
}

function toSimpleVelocityRow(r: VelocityQueryResult["rows"][number]) {
  return {
    masterSku: r.master_sku,
    qty90d: r.qty_90d, qty60d: r.qty_60d, qty30d: r.qty_30d,
    qty15d: r.qty_15d, qty7d: r.qty_7d,
    customMasterSku: null,
  };
}

function toTotals(t: VelocityQueryResult["totals"]) {
  return {
    qty90d: Number(t?.total_90d ?? 0),
    qty60d: Number(t?.total_60d ?? 0),
    qty30d: Number(t?.total_30d ?? 0),
    qty15d: Number(t?.total_15d ?? 0),
    qty7d: Number(t?.total_7d ?? 0),
    skuCount: Number(t?.sku_count ?? 0),
  };
}

export interface ChannelVelocityQuery {
  isExport: boolean;
  page: number;
  limit: number;
  search: string;
  platformSource: string;
  fulfillmentChannel: string;
  sortByKey: string;
  sortOrder: "asc" | "desc";
  source: string;
}

/**
 * Business logic for the Velocity feature. Dispatches the various Channel-tab
 * "source" modes, orchestrates the item/channel snapshot queries, the three
 * enrichment endpoints, CSV export, and the inventory-sync flow (advisory
 * lock + batch upsert). Repository has no knowledge of caching, HTTP, or the
 * sync lock's retry/reclaim policy.
 */
export const VelocityService = {
  // ─── Main GET /api/velocity ────────────────────────────────────────────

  async getChannelVelocity(query: ChannelVelocityQuery) {
    const page = Math.max(1, query.page);
    const limit = query.isExport ? 10000 : Math.min(500, Math.max(1, query.limit));
    const offset = (page - 1) * limit;
    const sortOrder: "ASC" | "DESC" = query.sortOrder === "asc" ? "ASC" : "DESC";
    const sortCol =
      query.sortByKey in VALID_SORT_COLS
        ? VALID_SORT_COLS[query.sortByKey as keyof typeof VALID_SORT_COLS]
        : "qty_90d";

    if (query.source === "link") {
      const result = await VelocityRepository.getLinkSalesVelocity({ search: query.search, sortCol, sortOrder, limit, offset });
      const total = Number(result.rows[0]?.total_count ?? 0);
      return {
        data: result.rows.map(toFullVelocityRow),
        totals: toTotals(result.totals),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    if (query.source === "custom") {
      const result = await VelocityRepository.getCustomSalesVelocity({ search: query.search, sortCol, sortOrder, limit, offset });
      const total = Number(result.rows[0]?.total_count ?? 0);
      return {
        data: result.rows.map(toSimpleVelocityRow),
        totals: toTotals(result.totals),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    if (query.source === "link-ttm") {
      const cacheKey = `velocity:link-ttm:${page}:${limit}:${query.search}:${query.sortByKey}:${sortOrder}`;
      const cached = await CacheManager.get<Record<string, unknown>>(cacheKey);
      if (cached) return cached;

      const result = await VelocityRepository.getLinkTtmVelocity({ search: query.search, sortCol, sortOrder, limit, offset });
      const total = Number(result.rows[0]?.total_count ?? 0);
      const response = {
        data: result.rows.map(toFullVelocityRow),
        totals: toTotals(result.totals),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
      await CacheManager.set(cacheKey, response, ENRICH_CACHE_TTL);
      return response;
    }

    if (query.source === "custom-ttm") {
      const result = await VelocityRepository.getCustomTtmVelocity({ search: query.search, sortCol, sortOrder, limit, offset });
      const total = Number(result.rows[0]?.total_count ?? 0);
      return {
        data: result.rows.map(toSimpleVelocityRow),
        totals: toTotals(result.totals),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    if (query.source === "link-preorder") {
      const cacheKey = `velocity:link-preorder:${page}:${limit}:${query.search}:${query.sortByKey}:${sortOrder}`;
      const cached = await CacheManager.get<Record<string, unknown>>(cacheKey);
      if (cached) return cached;

      const result = await VelocityRepository.getLinkPreOrderVelocity({ search: query.search, sortCol, sortOrder, limit, offset });
      const total = Number(result.rows[0]?.total_count ?? 0);
      const response = {
        data: result.rows.map((r) => ({
          masterSku: r.master_sku, qty90d: r.qty_90d, qty60d: 0, qty30d: 0, qty15d: 0, qty7d: 0,
          customMasterSku: null, customQty90d: null, customQty60d: null,
          customQty30d: null, customQty15d: null, customQty7d: null,
          ttmCount: null, ttmMasterSku: null,
        })),
        totals: { qty90d: Number(result.totals?.total_90d ?? 0), qty60d: 0, qty30d: 0, qty15d: 0, qty7d: 0, skuCount: Number(result.totals?.sku_count ?? 0) },
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
      await CacheManager.set(cacheKey, response, ENRICH_CACHE_TTL);
      return response;
    }

    // Legacy default mode: raw ecommerce_data.vw_sales_order_items pivot.
    const result = await VelocityRepository.queryChannelVelocity({
      platformSource: query.platformSource,
      fulfillmentChannel: query.fulfillmentChannel,
      search: query.search,
      sortCol,
      sortOrder,
      limit,
      offset,
    });
    const total = Number(result.rows[0]?.total_count ?? 0);
    return {
      data: result.rows.map(toSimpleVelocityRow),
      totals: toTotals(result.totals),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  // ─── Channels (Channel tab sub-tabs) ───────────────────────────────────

  getChannels() {
    return VelocityRepository.getDistinctChannels();
  },

  // ─── Snapshot-based date-range queries (/api/velocity/data) ───────────

  async getSnapshotData(query: {
    items: string[];
    channels: string[];
    mode: string;
    rangesCsv: string;
    combined: boolean;
  }) {
    const ranges = parseRanges(query.rangesCsv);
    const { items, channels, mode, combined } = query;

    if (!items.length || !channels.length) {
      return mode === "preorder" ? { link: [], custom: [], ttm: [] } : { link: [], custom: [] };
    }

    const needsCustom = items.includes("Seat Cover");

    if (mode === "preorder") {
      if (!ranges.length) return { link: [], custom: [], ttm: [] };

      const linkFilter = combined ? `order_type IN ('preorder', 'ttm_preorder')` : `order_type = 'preorder'`;

      const [linkRows, ttmRows, customRows] = await Promise.all([
        VelocityRepository.querySnapshotPreorder({
          table: "fc_velocity_link_snapshot", skuColumn: "link_master_sku", qtyColumn: "link_qty",
          items, channels, ranges, orderTypeFilter: linkFilter,
        }),
        combined
          ? Promise.resolve([])
          : VelocityRepository.querySnapshotPreorder({
              table: "fc_velocity_link_snapshot", skuColumn: "link_master_sku", qtyColumn: "link_qty",
              items, channels, ranges, orderTypeFilter: `order_type = 'ttm_preorder'`,
            }),
        needsCustom
          ? VelocityRepository.querySnapshotPreorder({
              table: "fc_velocity_custom_snapshot", skuColumn: "custom_master_sku", qtyColumn: "custom_qty",
              items, channels, ranges, orderTypeFilter: linkFilter,
            })
          : Promise.resolve([]),
      ]);

      return {
        link: toPreorderRows(linkRows, ranges),
        custom: toPreorderRows(customRows, ranges),
        ttm: toPreorderRows(ttmRows, ranges),
      };
    }

    if (!ranges.length) return { link: [], custom: [] };

    const orderType = mode === "ttm" ? "ttm" : "sales";

    const [linkRows, customRows] = await Promise.all([
      VelocityRepository.querySnapshotByRanges({
        table: "fc_velocity_link_snapshot", skuColumn: "link_master_sku", qtyColumn: "link_qty",
        items, channels, orderType, ranges,
      }),
      needsCustom
        ? VelocityRepository.querySnapshotByRanges({
            table: "fc_velocity_custom_snapshot", skuColumn: "custom_master_sku", qtyColumn: "custom_qty",
            items, channels, orderType, ranges,
          })
        : Promise.resolve([]),
    ]);

    return { link: toPreorderRows(linkRows, ranges), custom: toPreorderRows(customRows, ranges) };
  },

  // ─── Enrichment endpoints ──────────────────────────────────────────────

  async getCustomEnrich(skus: string[], search: string) {
    const cacheKey = `velocity:custom-enrich:${search}:${[...skus].sort().join(",")}`;
    const cached = await CacheManager.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const response = await buildCustomEnrichResponse(skus, search);
    await CacheManager.set(cacheKey, response, ENRICH_CACHE_TTL);
    return response;
  },

  getCustomEnrichUncached(skus: string[], search: string) {
    return buildCustomEnrichResponse(skus, search);
  },

  async getTtmEnrich(skus: string[], search: string) {
    const cacheKey = `velocity:ttm-enrich:${search}:${[...skus].sort().join(",")}`;
    const cached = await CacheManager.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const response = await buildTtmEnrichResponse(skus, search);
    await CacheManager.set(cacheKey, response, ENRICH_CACHE_TTL);
    return response;
  },

  getTtmEnrichUncached(skus: string[], search: string) {
    return buildTtmEnrichResponse(skus, search);
  },

  async getPreorderEnrich(skus: string[], search: string) {
    const cacheKey = `velocity:preorder-enrich:${search}:${[...skus].sort().join(",")}`;
    const cached = await CacheManager.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const response = await buildPreorderEnrichResponse(skus, search);
    await CacheManager.set(cacheKey, response, ENRICH_CACHE_TTL);
    return response;
  },

  getPreorderEnrichUncached(skus: string[], search: string) {
    return buildPreorderEnrichResponse(skus, search);
  },

  // ─── CSV export ─────────────────────────────────────────────────────────

  async buildSalesExportCsv(): Promise<string> {
    return buildSalesExportCsvInternal();
  },

  // ─── Sync ───────────────────────────────────────────────────────────────

  getLastSyncedAt() {
    return VelocityRepository.getLastSyncedAt();
  },

  async runSync(full: boolean) {
    const lookupPool = getLookupPool();
    if (!lookupPool) {
      throw new ServiceUnavailableError("Supabase lookup pool not available");
    }

    const client = await VelocityRepository.checkoutSyncClient();
    let lockAcquired = false;
    try {
      let acquired = await VelocityRepository.tryAcquireSyncLock(client);

      if (!acquired) {
        const { reclaimed, holdSeconds } = await VelocityRepository.reclaimStaleLock(client);
        if (reclaimed) {
          acquired = await VelocityRepository.tryAcquireSyncLock(client);
        }
        if (!acquired) {
          throw new SyncInProgressError(holdSeconds);
        }
      }
      lockAcquired = true;

      const { dateFilter, dateFilterC } = buildSyncDateFilters(full);

      const [linkRows, customRows, linkForecastRows] = await Promise.all([
        VelocityRepository.fetchLinkRowsFromLookup(lookupPool, dateFilter),
        VelocityRepository.fetchCustomRowsFromLookup(lookupPool, dateFilterC),
        VelocityRepository.fetchLinkForecastRowsFromLookup(lookupPool),
      ]);

      const syncedAt = new Date();
      const [linkUpserted, customUpserted] = await Promise.all([
        VelocityRepository.upsertLinkSnapshot(linkRows, syncedAt),
        VelocityRepository.upsertCustomSnapshot(customRows, syncedAt),
        VelocityRepository.upsertLinkSnapshot(linkForecastRows, syncedAt, "shipcore.fc_velocity_link_snapshot_forecast"),
      ]);

      const { linkDeleted, customDeleted } = await VelocityRepository.deleteStaleSnapshots(syncedAt, full);

      await Promise.all([
        CacheManager.delete("oos-preorder:sku-list:v4"),
        CacheManager.delete("oos-recovery:sku-list"),
      ]);

      return { linkUpserted, customUpserted, linkDeleted, customDeleted };
    } finally {
      if (lockAcquired) {
        await VelocityRepository.releaseSyncLock(client);
      }
      (client as PoolClient).release();
    }
  },
};

// ─── Private helpers ────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  return DATE_RE.test(s) && !isNaN(Date.parse(s));
}

function parseRanges(csv: string): { from: string; to: string }[] {
  return csv
    .split(",")
    .map((s) => {
      const [from, to] = s.split(":");
      return { from: from?.trim() ?? "", to: to?.trim() ?? "" };
    })
    .filter(({ from, to }) => isValidDate(from) && isValidDate(to) && from <= to);
}

function toPreorderRows(rows: Array<{ master_sku: string } & Record<string, unknown>>, ranges: { from: string; to: string }[]) {
  return rows.map((r) => ({
    masterSku: r.master_sku,
    qtys: ranges.map((_, i) => (r[`qty_${i}`] as number) ?? 0),
  }));
}

async function buildCustomEnrichResponse(skus: string[], search: string) {
  const [customMap, customTotalsRaw] = await Promise.all([
    skus.length ? VelocityRepository.getCustomSalesForSkus(skus) : Promise.resolve(new Map()),
    VelocityRepository.getCustomSalesTotals(search || undefined),
  ]);

  const data: Record<string, {
    customMasterSku: string | null;
    customQty90d: number | null; customQty60d: number | null;
    customQty30d: number | null; customQty15d: number | null; customQty7d: number | null;
  }> = {};

  for (const [sku, c] of customMap as Map<string, { custom_master_sku: string; qty_90d: number; qty_60d: number; qty_30d: number; qty_15d: number; qty_7d: number }>) {
    data[sku] = {
      customMasterSku: c.custom_master_sku ?? null,
      customQty90d: c.qty_90d ?? null, customQty60d: c.qty_60d ?? null,
      customQty30d: c.qty_30d ?? null, customQty15d: c.qty_15d ?? null,
      customQty7d: c.qty_7d ?? null,
    };
  }

  return {
    data,
    customTotals: {
      customQty90d: Number(customTotalsRaw?.total_90d ?? 0),
      customQty60d: Number(customTotalsRaw?.total_60d ?? 0),
      customQty30d: Number(customTotalsRaw?.total_30d ?? 0),
      customQty15d: Number(customTotalsRaw?.total_15d ?? 0),
      customQty7d: Number(customTotalsRaw?.total_7d ?? 0),
    },
  };
}

async function buildTtmEnrichResponse(skus: string[], search: string) {
  const [customMap, customTotalsRaw] = await Promise.all([
    skus.length ? VelocityRepository.getCustomTtmForSkus(skus) : Promise.resolve(new Map()),
    VelocityRepository.getCustomTtmTotals(search || undefined),
  ]);

  const data: Record<string, {
    customMasterSku: string | null;
    customQty90d: number | null; customQty60d: number | null;
    customQty30d: number | null; customQty15d: number | null; customQty7d: number | null;
  }> = {};

  for (const [sku, c] of customMap as Map<string, { custom_master_sku: string; qty_90d: number; qty_60d: number; qty_30d: number; qty_15d: number; qty_7d: number }>) {
    data[sku] = {
      customMasterSku: c.custom_master_sku ?? null,
      customQty90d: c.qty_90d ?? null, customQty60d: c.qty_60d ?? null,
      customQty30d: c.qty_30d ?? null, customQty15d: c.qty_15d ?? null,
      customQty7d: c.qty_7d ?? null,
    };
  }

  return {
    data,
    customTotals: {
      customQty90d: Number(customTotalsRaw?.total_90d ?? 0),
      customQty60d: Number(customTotalsRaw?.total_60d ?? 0),
      customQty30d: Number(customTotalsRaw?.total_30d ?? 0),
      customQty15d: Number(customTotalsRaw?.total_15d ?? 0),
      customQty7d: Number(customTotalsRaw?.total_7d ?? 0),
    },
  };
}

async function buildPreorderEnrichResponse(skus: string[], search: string) {
  const [customMap, ttmMap, totalsRaw] = await Promise.all([
    skus.length ? VelocityRepository.getCustomPreOrderForSkus(skus) : Promise.resolve(new Map()),
    skus.length ? VelocityRepository.getTtmPreOrderForSkus(skus) : Promise.resolve(new Map()),
    VelocityRepository.getPreOrderTotals(search || undefined),
  ]);

  const data: Record<string, {
    customMasterSku: string | null;
    customQty90d: number | null;
    ttmCount: number | null;
    ttmMasterSku: string | null;
  }> = {};

  const allSkus = new Set([...customMap.keys(), ...ttmMap.keys(), ...skus]);
  for (const sku of allSkus) {
    const c = customMap.get(sku);
    const t = ttmMap.get(sku);
    data[sku] = {
      customMasterSku: c?.custom_master_sku ?? null,
      customQty90d: c?.qty_90d ?? null,
      ttmCount: t?.count ?? null,
      ttmMasterSku: t?.ttm_master_sku ?? null,
    };
  }

  return {
    data,
    customTotals: {
      customQty90d: Number(totalsRaw?.custom_total ?? 0),
      ttmQty90d: Number(totalsRaw?.ttm_total ?? 0),
    },
  };
}

function esc(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(...cells: (string | number | null | undefined)[]): string {
  return cells.map(esc).join(",");
}

async function buildSalesExportCsvInternal(): Promise<string> {
  const [linkResult, ttmLinkResult, preOrderResult] = await Promise.all([
    VelocityRepository.getLinkSalesVelocity({ limit: 10000, offset: 0, sortCol: "master_sku", sortOrder: "ASC" }),
    VelocityRepository.getLinkTtmVelocity({ limit: 10000, offset: 0, sortCol: "master_sku", sortOrder: "ASC" }),
    VelocityRepository.getLinkPreOrderVelocity({ limit: 10000, offset: 0, sortCol: "master_sku", sortOrder: "ASC" }),
  ]);

  const linkSkus = linkResult.rows.map((r) => r.master_sku);
  const ttmSkus = ttmLinkResult.rows.map((r) => r.master_sku);
  const preSkus = preOrderResult.rows.map((r) => r.master_sku);

  const [customMap, ttmCustomMap, customPoMap, ttmPoMap] = await Promise.all([
    VelocityRepository.getCustomSalesForSkus(linkSkus),
    VelocityRepository.getCustomTtmForSkus(ttmSkus),
    VelocityRepository.getCustomPreOrderForSkus(preSkus),
    VelocityRepository.getTtmPreOrderForSkus(preSkus),
  ]);

  type MainRow = [string, number, number, number, number, number];
  type PreRow = [string, number];

  const linkRows: MainRow[] = linkResult.rows.map((r) => [r.master_sku, r.qty_90d, r.qty_60d, r.qty_30d, r.qty_15d, r.qty_7d]);
  const customRows: MainRow[] = linkResult.rows.map((r) => {
    const c = customMap.get(r.master_sku);
    return [c?.custom_master_sku ?? r.master_sku, c?.qty_90d ?? 0, c?.qty_60d ?? 0, c?.qty_30d ?? 0, c?.qty_15d ?? 0, c?.qty_7d ?? 0];
  });

  const ttmLinkRows: MainRow[] = ttmLinkResult.rows.map((r) => [r.master_sku, r.qty_90d, r.qty_60d, r.qty_30d, r.qty_15d, r.qty_7d]);
  const ttmCustomRows: MainRow[] = ttmLinkResult.rows.map((r) => {
    const c = ttmCustomMap.get(r.master_sku);
    return [c?.custom_master_sku ?? r.master_sku, c?.qty_90d ?? 0, c?.qty_60d ?? 0, c?.qty_30d ?? 0, c?.qty_15d ?? 0, c?.qty_7d ?? 0];
  });

  const linkPoRows: PreRow[] = preOrderResult.rows.map((r) => [r.master_sku, r.qty_90d]);
  const newPoRows: PreRow[] = preOrderResult.rows.map((r) => {
    const c = customPoMap.get(r.master_sku);
    return [c?.custom_master_sku ?? r.master_sku, c?.qty_90d ?? 0];
  });
  const ttmPoRows: PreRow[] = preOrderResult.rows.map((r) => {
    const t = ttmPoMap.get(r.master_sku);
    return [r.master_sku, t?.count ?? 0];
  });

  const lt = linkResult.totals;
  const tlt = ttmLinkResult.totals;
  const pot = preOrderResult.totals;

  const customTotal90d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_90d ?? 0), 0);
  const customTotal60d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_60d ?? 0), 0);
  const customTotal30d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_30d ?? 0), 0);
  const customTotal15d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_15d ?? 0), 0);
  const customTotal7d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_7d ?? 0), 0);

  const ttmCustomTotal90d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_90d ?? 0), 0);
  const ttmCustomTotal60d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_60d ?? 0), 0);
  const ttmCustomTotal30d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_30d ?? 0), 0);
  const ttmCustomTotal15d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_15d ?? 0), 0);
  const ttmCustomTotal7d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_7d ?? 0), 0);

  const newPoTotal = preOrderResult.rows.reduce((s, r) => s + (customPoMap.get(r.master_sku)?.qty_90d ?? 0), 0);
  const ttmPoTotal = preOrderResult.rows.reduce((s, r) => s + (ttmPoMap.get(r.master_sku)?.count ?? 0), 0);

  const BLANK6 = ["", "", "", "", "", ""] as const;
  const BLANK2 = ["", ""] as const;
  const maxRows = Math.max(linkRows.length, ttmLinkRows.length, linkPoRows.length);
  const blank6 = () => Array(6).fill("");
  const blank2 = () => Array(2).fill("");

  const csvLines: string[] = [];

  csvLines.push(
    csvRow(
      "Link Sales", ...BLANK6.slice(1),
      "Custom Sales (L)", ...BLANK6.slice(1),
      "TTM Link", ...BLANK6.slice(1),
      "TTM Custom (L)", ...BLANK6.slice(1),
      "LINK Pre Order", ...BLANK2.slice(1),
      "NEW Pre Order", ...BLANK2.slice(1),
      "TTM Pre", ...BLANK2.slice(1)
    )
  );

  csvLines.push(
    csvRow(
      "Total", "90 D", "60 D", "30 D", "15 D", "7 D",
      "Total", "90 D", "60 D", "30 D", "15 D", "7 D",
      "Total", "90 D", "60 D", "30 D", "15 D", "7 D",
      "Total", "90 D", "60 D", "30 D", "15 D", "7 D",
      "", "",
      "", "",
      "", ""
    )
  );

  csvLines.push(
    csvRow(
      "Master SKU",
      lt?.total_90d ?? 0, lt?.total_60d ?? 0, lt?.total_30d ?? 0, lt?.total_15d ?? 0, lt?.total_7d ?? 0,
      "Master SKU",
      customTotal90d, customTotal60d, customTotal30d, customTotal15d, customTotal7d,
      "Master SKU",
      tlt?.total_90d ?? 0, tlt?.total_60d ?? 0, tlt?.total_30d ?? 0, tlt?.total_15d ?? 0, tlt?.total_7d ?? 0,
      "Master SKU",
      ttmCustomTotal90d, ttmCustomTotal60d, ttmCustomTotal30d, ttmCustomTotal15d, ttmCustomTotal7d,
      "Master SKU", pot?.total_90d ?? 0,
      "Master SKU", newPoTotal,
      "Master SKU", ttmPoTotal
    )
  );

  for (let i = 0; i < maxRows; i++) {
    const lr = linkRows[i];
    const cr = customRows[i];
    const tlr = ttmLinkRows[i];
    const tcr = ttmCustomRows[i];
    const lpr = linkPoRows[i];
    const npr = newPoRows[i];
    const tpr = ttmPoRows[i];

    csvLines.push(
      csvRow(
        ...(lr ?? blank6()),
        ...(cr ?? blank6()),
        ...(tlr ?? blank6()),
        ...(tcr ?? blank6()),
        ...(lpr ?? blank2()),
        ...(npr ?? blank2()),
        ...(tpr ?? blank2())
      )
    );
  }

  return "﻿" + csvLines.join("\n");
}
