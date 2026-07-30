/**
 * Code Guide:
 * GET /api/velocity/sales-export — Generates a multi-section Sales velocity CSV
 * matching the manual spreadsheet format.
 * Sections: Link Sales | Custom Sales (L) | TTM Link | TTM Custom (L) |
 *           LINK Pre Order | NEW Pre Order | TTM Pre
 * Controller layer only: delegates CSV assembly to VelocityService and shapes
 * the file-download HTTP response.
 */

import { NextResponse } from "next/server";
import { VelocityService } from "@/lib/velocity/service";

export async function GET() {
  try {
    const csv = await VelocityService.buildSalesExportCsv();

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-velocity-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error("[sales-export] error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
