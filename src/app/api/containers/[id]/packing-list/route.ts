// Stores and downloads the original Packing List associated with a container.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canDo, guardPermission } from "@/lib/permissions";
import { apiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { ContainerPlanningService } from "@/lib/container-planning/service";

type Params = { params: Promise<{ id: string }> };

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\\r\n]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await guardPermission("container-planning", "read");
  if (denied) return denied;

  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiError("Invalid container id", 400);

  try {
    const file = await ContainerPlanningService.findPackingListFile(id);
    if (!file) return apiError("Packing List file not found", 404);
    return new NextResponse(new Uint8Array(file.fileData), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": contentDisposition(file.originalName),
        "Content-Length": String(file.fileData.byteLength),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  const allowed = await canDo(session.user.id, (session.user.role as string) ?? "user", "container-planning", "edit");
  if (!allowed) return apiError("Permission denied", 403);

  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiError("Invalid container id", 400);

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return apiError("Packing List file is required", 400);

    const data = await ContainerPlanningService.uploadPackingList(id, file, {
      userId: session.user.id,
      userName: session.user.name ?? null,
      userEmail: session.user.email ?? null,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  const allowed = await canDo(session.user.id, (session.user.role as string) ?? "user", "container-planning", "edit");
  if (!allowed) return apiError("Permission denied", 403);

  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiError("Invalid container id", 400);

  try {
    const data = await ContainerPlanningService.deletePackingList(id, {
      userId: session.user.id,
      userName: session.user.name ?? null,
      userEmail: session.user.email ?? null,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
