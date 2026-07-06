// Code Guide: Audit history for a single container.
// GET  → returns log entries newest-first (max 200)
// POST → appends a manual note entry written by the current user

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { auth } from "@/lib/auth";
import { logContainerAudit } from "@/lib/container-audit";

type Params = { params: Promise<{ id: string }> };

const ACTIONS = new Set([
  "status_change",
  "details_update",
  "eta_change",
  "confirmed_change",
  "items_update",
  "note_added",
  "create",
  "delete",
]);

function clean(value: string | null): string {
  return value?.trim() ?? "";
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const searchParams = req.nextUrl.searchParams;
    const user = clean(searchParams.get("user"));
    const action = clean(searchParams.get("action"));
    const startDate = clean(searchParams.get("startDate"));
    const endDate = clean(searchParams.get("endDate"));
    const filters = ["container_id = $1::bigint"];
    const values: unknown[] = [id];
    let idx = 2;

    if (user) {
      values.push(`%${user}%`);
      filters.push(`(
        COALESCE(user_name, '') ILIKE $${idx}
        OR COALESCE(user_email, '') ILIKE $${idx}
        OR COALESCE(user_id, '') ILIKE $${idx}
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

    const result = await getPrimaryPool().query(
      `SELECT id, container_id, container_number,
              user_id, user_name, user_email,
              action, before, after, note, ip, created_at
       FROM shipcore.fc_container_audit_log
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 200`,
      values,
    );

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => ({
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
    });
  } catch (err) {
    console.error("[ContainerHistory GET]", err);
    return NextResponse.json({ success: false, error: "Failed to fetch history" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  const note = typeof (body as Record<string, unknown>).note === "string"
    ? ((body as Record<string, unknown>).note as string).trim()
    : "";

  if (!note) {
    return NextResponse.json({ success: false, error: "Note is required" }, { status: 400 });
  }

  const container = await getPrimaryPool().query(
    `SELECT container_number FROM shipcore.fc_containers WHERE id = $1::bigint`,
    [id],
  );

  if (container.rowCount === 0) {
    return NextResponse.json({ success: false, error: "Container not found" }, { status: 404 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  await logContainerAudit({
    containerId: id,
    containerNumber: (container.rows[0] as { container_number: string }).container_number,
    userId: session.user.id,
    userName: session.user.name ?? null,
    userEmail: session.user.email ?? null,
    action: "note_added",
    note,
    ip,
  });

  return NextResponse.json({ success: true });
}
