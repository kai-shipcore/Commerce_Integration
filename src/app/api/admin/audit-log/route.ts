// Code Guide: GET /api/admin/audit-log — merged read+export viewer across the
// container/invoice/general audit tables. CSV export re-calls this same GET
// with export=1 and builds the CSV client-side (no separate export route).
// Controller layer only: parses query params and delegates to
// AuditLogService. Data access lives in src/lib/audit-log/repository.ts.

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { AuditLogService } from "@/lib/audit-log/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

function clean(value: string | null): string {
  return value?.trim() ?? "";
}

export async function GET(req: NextRequest) {
  const denied = await guardPermission("audit-log", "read");
  if (denied) return denied;

  try {
    const searchParams = req.nextUrl.searchParams;
    const { data, pagination } = await AuditLogService.listAuditLogs({
      user: clean(searchParams.get("user")),
      entity: clean(searchParams.get("entity")),
      entityId: clean(searchParams.get("entityId")),
      entityType: clean(searchParams.get("entityType")),
      action: clean(searchParams.get("action")),
      startDate: clean(searchParams.get("startDate")),
      endDate: clean(searchParams.get("endDate")),
      exportAll: searchParams.get("export") === "1",
      pageParam: searchParams.get("page"),
      limitParam: searchParams.get("limit"),
    });

    return apiSuccess({ data, pagination });
  } catch (error) {
    return handleApiError(error);
  }
}
