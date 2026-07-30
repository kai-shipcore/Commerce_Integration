// Code Guide: List + create API for Invoice Review. List returns both the filtered
// invoice rows for the left pane and the status-bucket counts for the filter pills
// in a single round trip.
// Controller layer only: parses/validates the request and delegates to
// InvoicePriceControlService. Data access lives in
// src/lib/invoice-price-control/repository.ts.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const InvoiceCreateSchema = z.object({
  factoryId: z.string().min(1),
  containerId: z.string().trim().optional(),
  containerNumber: z.string().trim().optional(),
  invoiceNumber: z.string().trim().min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().optional(),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const data = await InvoicePriceControlService.listInvoices({
      search: searchParams.get("search")?.trim() ?? "",
      factoryId: searchParams.get("factoryId")?.trim() ?? "",
      bucketsCsv: searchParams.get("buckets")?.trim() ?? "",
    });
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const body = await request.json();
    const parsed = InvoiceCreateSchema.parse(body);
    const data = await InvoicePriceControlService.createInvoice(parsed);
    return apiSuccess({ data }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
