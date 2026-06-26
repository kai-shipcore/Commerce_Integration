// Code Guide: Audit history for a single container.
// GET  → returns log entries newest-first (max 200)
// POST → appends a manual note entry written by the current user

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { auth } from "@/lib/auth";
import { logContainerAudit } from "@/lib/container-audit";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const result = await getPrimaryPool().query(
      `SELECT id, container_id, container_number,
              user_id, user_name, user_email,
              action, before, after, note, ip, created_at
       FROM shipcore.fc_container_audit_log
       WHERE container_id = $1::bigint
       ORDER BY created_at DESC
       LIMIT 200`,
      [id],
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
