/**
 * Code Guide:
 * This API route owns the sales / import backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { SalesService } from "@/lib/sales/service";

// POST /api/sales/import - Import sales records from CSV data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rows } = body as { rows: Record<string, string>[] };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return apiError("No data provided", 400);
    }

    const result = await SalesService.importRows(rows);
    return apiSuccess({ ...result });
  } catch (error) {
    console.error("Error importing sales:", error);
    return handleApiError(error);
  }
}

// GET /api/sales/import/template - Download CSV template
export async function GET() {
  const template = `sku_code,sale_date,quantity,unit_price,platform,order_id,order_type,fulfilled,fulfilled_date,notes
ABC-123,2024-01-15,10,29.99,shopify,ORD-001,actual_sale,yes,2024-01-16,Sample order
XYZ-456,2024-01-16,5,49.99,amazon,,actual_sale,no,,
DEF-789,2024-01-17,3,19.99,manual,,pre_order,no,,Pre-order for upcoming release`;

  return new NextResponse(template, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=sales-import-template.csv",
    },
  });
}
