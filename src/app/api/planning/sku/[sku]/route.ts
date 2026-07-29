/**
 * Code Guide:
 * GET /api/planning/sku/[sku] — Proxies the FastAPI /planning/sku/{id} endpoint.
 *
 * Everything the SKU detail view needs in one response: the planning row, the
 * order-quantity breakdown as arithmetic, the plausible band, weekly history and
 * forecast, and the backtest windows with their per-week predictions.
 *
 * A 404 here carries meaning and is passed through with its detail intact. The
 * upstream distinguishes a SKU that exists in the forecast run but has since
 * been reclassified intermittent, which is a normal outcome the page should
 * explain, from one that is genuinely unknown.
 */

import { type NextRequest } from "next/server";
import { proxyPlanning } from "@/lib/planning-api";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  const { sku } = await params;
  return proxyPlanning(
    `/planning/sku/${encodeURIComponent(sku)}`,
    req.nextUrl.searchParams.toString(),
  );
}
