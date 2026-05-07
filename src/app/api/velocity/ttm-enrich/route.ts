/**
 * Code Guide:
 * GET /api/velocity/ttm-enrich — Custom TTM enrichment for a given list of Link TTM master SKUs.
 * POST /api/velocity/ttm-enrich — Same, but accepts { skus, search } in JSON body (for large SKU lists on export).
 * Called as a second async request after the main Link TTM data renders.
 * Results are cached for 15 minutes to avoid repeated expensive view scans.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCustomTtmForSkus, getCustomTtmTotals } from "@/lib/db/supabase-lookup";
import { CacheManager } from "@/lib/redis";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const CACHE_TTL = 15 * 60; // 15 minutes

async function buildEnrichResponse(skus: string[], search: string) {
  const [customMap, customTotalsRaw] = await Promise.all([
    skus.length ? getCustomTtmForSkus(skus) : Promise.resolve(new Map()),
    getCustomTtmTotals(search || undefined),
  ]);

  const data: Record<string, {
    customMasterSku: string | null;
    customQty90d: number | null; customQty60d: number | null;
    customQty30d: number | null; customQty15d: number | null; customQty7d: number | null;
  }> = {};

  for (const [sku, c] of customMap) {
    data[sku] = {
      customMasterSku: c.custom_master_sku ?? null,
      customQty90d: c.qty_90d ?? null, customQty60d: c.qty_60d ?? null,
      customQty30d: c.qty_30d ?? null, customQty15d: c.qty_15d ?? null,
      customQty7d:  c.qty_7d  ?? null,
    };
  }

  return {
    success: true,
    data,
    customTotals: {
      customQty90d: Number(customTotalsRaw?.total_90d ?? 0),
      customQty60d: Number(customTotalsRaw?.total_60d ?? 0),
      customQty30d: Number(customTotalsRaw?.total_30d ?? 0),
      customQty15d: Number(customTotalsRaw?.total_15d ?? 0),
      customQty7d:  Number(customTotalsRaw?.total_7d  ?? 0),
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const skusParam = searchParams.get("skus") ?? "";
    const search = searchParams.get("search")?.trim() ?? "";
    const skus = skusParam ? skusParam.split(",").filter(Boolean) : [];

    const cacheKey = `velocity:ttm-enrich:${search}:${skus.sort().join(",")}`;
    const cached = await CacheManager.get<object>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const response = await buildEnrichResponse(skus, search);
    await CacheManager.set(cacheKey, response, CACHE_TTL);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[velocity/ttm-enrich] GET error:", getErrorMessage(error));
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const skus: string[] = Array.isArray(body.skus) ? body.skus : [];
    const search: string = typeof body.search === "string" ? body.search.trim() : "";

    const response = await buildEnrichResponse(skus, search);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[velocity/ttm-enrich] POST error:", getErrorMessage(error));
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
