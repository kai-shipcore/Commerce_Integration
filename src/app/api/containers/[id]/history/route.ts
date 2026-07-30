// Code Guide: Audit history for a single container (shipcore.fc_container_audit_log).
// GET    → log entries newest-first (max 200), filterable by user/action/date range
// POST   → appends a manual note entry written by the current user
// PUT    → edits the text of an existing manual note
// DELETE → soft-deletes a manual note
//
// Note mutations are permission-gated on EITHER container-planning or
// container-timeline (create/edit) since this endpoint backs both UIs'
// history tabs.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";
import { ContainerPlanningService } from "@/lib/container-planning/service";

type Params = { params: Promise<{ id: string }> };

function clean(value: string | null): string {
  return value?.trim() ?? "";
}

async function canEditContainerHistoryNote(userId: string, role: string) {
  return (
    (await canDo(userId, role, "container-planning", "edit")) ||
    (await canDo(userId, role, "container-timeline", "edit"))
  );
}

async function canCreateContainerHistoryNote(userId: string, role: string) {
  return (
    (await canDo(userId, role, "container-planning", "create")) ||
    (await canDo(userId, role, "container-timeline", "create"))
  );
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiError("Invalid id", 400);

  try {
    const searchParams = req.nextUrl.searchParams;
    const data = await ContainerPlanningService.listHistory(id, {
      user: clean(searchParams.get("user")) || undefined,
      action: clean(searchParams.get("action")) || undefined,
      startDate: clean(searchParams.get("startDate")) || undefined,
      endDate: clean(searchParams.get("endDate")) || undefined,
    });
    return apiSuccess({ data });
  } catch {
    return apiError("Failed to fetch history", 500);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiError("Invalid id", 400);

  const session = await auth();
  if (!session?.user?.id) return apiError("Unauthorized", 401);

  const allowed = await canCreateContainerHistoryNote(session.user.id, (session.user.role as string) ?? "user");
  if (!allowed) return apiError("Permission denied", 403);

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const note = typeof (body as Record<string, unknown>).note === "string"
    ? ((body as Record<string, unknown>).note as string).trim()
    : "";
  if (!note) return apiError("Note is required", 400);

  try {
    await ContainerPlanningService.addHistoryNote(id, note, {
      userId: session.user.id,
      userName: session.user.name ?? null,
      userEmail: session.user.email ?? null,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiError("Invalid id", 400);

  const session = await auth();
  if (!session?.user?.id) return apiError("Unauthorized", 401);

  const allowed = await canEditContainerHistoryNote(session.user.id, (session.user.role as string) ?? "user");
  if (!allowed) return apiError("Permission denied", 403);

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const noteId = String((body as Record<string, unknown>).noteId ?? "").trim();
  const note = typeof (body as Record<string, unknown>).note === "string"
    ? ((body as Record<string, unknown>).note as string).trim()
    : "";
  if (!/^\d+$/.test(noteId)) return apiError("Invalid note id", 400);
  if (!note) return apiError("Note is required", 400);

  try {
    await ContainerPlanningService.editHistoryNote(noteId, id, note, session.user.id);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiError("Invalid id", 400);

  const session = await auth();
  if (!session?.user?.id) return apiError("Unauthorized", 401);

  const allowed = await canEditContainerHistoryNote(session.user.id, (session.user.role as string) ?? "user");
  if (!allowed) return apiError("Permission denied", 403);

  const noteId = clean(req.nextUrl.searchParams.get("noteId"));
  if (!/^\d+$/.test(noteId)) return apiError("Invalid note id", 400);

  try {
    await ContainerPlanningService.deleteHistoryNote(noteId, id, session.user.id);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}
