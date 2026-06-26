import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";

const ACTIONS = new Set([
  "status_change",
  "details_update",
  "eta_change",
  "items_update",
  "note_added",
  "create",
  "delete",
]);

function clean(value: string | null): string {
  return value?.trim() ?? "";
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const user = clean(searchParams.get("user"));
  const container = clean(searchParams.get("container"));
  const action = clean(searchParams.get("action"));
  const startDate = clean(searchParams.get("startDate"));
  const endDate = clean(searchParams.get("endDate"));
  const exportAll = searchParams.get("export") === "1";
  const page = parsePositiveInt(searchParams.get("page"), 1, 100000);
  const limit = exportAll ? 5000 : parsePositiveInt(searchParams.get("limit"), 20, 100);
  const offset = (page - 1) * limit;

  const filters: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (user) {
    values.push(`%${user}%`);
    filters.push(`(
      COALESCE(user_name, '') ILIKE $${idx}
      OR COALESCE(user_email, '') ILIKE $${idx}
      OR COALESCE(user_id, '') ILIKE $${idx}
    )`);
    idx++;
  }

  if (container) {
    values.push(`%${container}%`);
    filters.push(`(
      COALESCE(container_number, '') ILIKE $${idx}
      OR container_id::text ILIKE $${idx}
    )`);
    idx++;
  }

  if (action && ACTIONS.has(action)) {
    values.push(action);
    filters.push(`action = $${idx++}`);
  }

  if (startDate) {
    values.push(startDate);
    filters.push(`created_at >= $${idx++}::date`);
  }

  if (endDate) {
    values.push(endDate);
    filters.push(`created_at < ($${idx++}::date + INTERVAL '1 day')`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const pool = getPrimaryPool();
    const countPromise = pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM shipcore.fc_container_audit_log
       ${where}`,
      values,
    );

    const dataPromise = pool.query(
      `SELECT id, container_id, container_number,
              user_id, user_name, user_email,
              action, before, after, note, ip, created_at
       FROM shipcore.fc_container_audit_log
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...values, limit, offset],
    );

    const [countResult, dataResult] = await Promise.all([countPromise, dataPromise]);
    const total = Number(countResult.rows[0]?.total ?? 0);

    return NextResponse.json({
      success: true,
      data: dataResult.rows.map((row) => ({
        id: String(row.id),
        containerId: String(row.container_id),
        containerNumber: row.container_number as string | null,
        userId: row.user_id as string | null,
        userName: row.user_name as string | null,
        userEmail: row.user_email as string | null,
        action: row.action as string,
        before: row.before as Record<string, unknown> | null,
        after: row.after as Record<string, unknown> | null,
        note: row.note as string | null,
        ip: row.ip as string | null,
        createdAt: (row.created_at as Date).toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("[AdminAuditLog GET]", error);
    return NextResponse.json({ success: false, error: "Failed to fetch audit logs" }, { status: 500 });
  }
}
