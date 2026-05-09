/**
 * Code Guide:
 * GET /api/velocity/preorder-enrich — Enriches Link Pre Order rows with Custom + TTM pre order counts.
 * POST /api/velocity/preorder-enrich — Same, accepts { skus, search } JSON body (for export).
 * Called as a second async request after the main Link Pre Order data renders.
 * Results cached 15 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCustomPreOrderForSkus, getTtmPreOrderForSkus, getPreOrderTotals } from "@/lib/db/supabase-lookup";
import { CacheManager } from "@/lib/redis";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const CACHE_TTL = 15 * 60;

async function buildEnrichResponse(skus: string[], search: string) {
  const [customMap, ttmMap, totalsRaw] = await Promise.all([
    skus.length ? getCustomPreOrderForSkus(skus) : Promise.resolve(new Map()),
    skus.length ? getTtmPreOrderForSkus(skus)    : Promise.resolve(new Map()),
    getPreOrderTotals(search || undefined),
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
      customQty90d:    c?.qty_90d           ?? null,
      ttmCount:        t?.count             ?? null,
      ttmMasterSku:    t?.ttm_master_sku    ?? null,
    };
  }

  return {
    success: true,
    data,
    customTotals: {
      customQty90d: Number(totalsRaw?.custom_total ?? 0),
      ttmQty90d:    Number(totalsRaw?.ttm_total    ?? 0),
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const skusParam = searchParams.get("skus") ?? "";
    const search = searchParams.get("search")?.trim() ?? "";
    const skus = skusParam ? skusParam.split(",").filter(Boolean) : [];

    const cacheKey = `velocity:preorder-enrich:${search}:${[...skus].sort().join(",")}`;
    const cached = await CacheManager.get<object>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const response = await buildEnrichResponse(skus, search);
    await CacheManager.set(cacheKey, response, CACHE_TTL);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[velocity/preorder-enrich] GET error:", getErrorMessage(error));
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
    console.error("[velocity/preorder-enrich] POST error:", getErrorMessage(error));
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
