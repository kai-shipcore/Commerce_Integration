// Code Guide: POST /api/admin/import-containers — start an import run, returns SSE stream
//             GET  /api/admin/import-containers — status JSON or SSE subscription (?stream=1)
//             DELETE /api/admin/import-containers — cancel the active run
//
// This route intentionally does NOT use the apiSuccess/handleApiError envelope
// used elsewhere — its response shapes ({error}/{ok}/{status}/raw SSE) predate
// that convention and are preserved exactly. Controller layer only: process
// orchestration, the activeRun singleton, and SSE fan-out all live in
// src/lib/container-import/service.ts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { ContainerImportService, SSE_HEADERS } from "@/lib/container-import/service";

export async function GET(request: NextRequest) {
  const denied = await guardPermission("container-import", "read");
  if (denied) return denied;

  if (request.nextUrl.searchParams.get("stream") === "1") {
    return new NextResponse(ContainerImportService.subscribeStream(), { headers: SSE_HEADERS });
  }

  return NextResponse.json(ContainerImportService.getStatus());
}

export async function DELETE() {
  const denied = await guardPermission("container-import", "create");
  if (denied) return denied;

  const result = ContainerImportService.cancelRun();
  if ("notFound" in result) {
    return NextResponse.json({ error: "No active run" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("container-import", "create");
  if (denied) return denied;

  const body = await request.json();
  const { url, tab, dryRun, forceDownload } = body as {
    url: string; tab?: string; dryRun?: boolean; forceDownload?: boolean;
  };

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 422 });
  }

  const session = await auth();
  const result = ContainerImportService.startRun(
    { url, tab, dryRun: !!dryRun, forceDownload: !!forceDownload },
    { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null },
  );

  if (result.conflict) {
    return NextResponse.json(
      { error: "Import already in progress", startedAt: result.startedAt },
      { status: 409 },
    );
  }

  return new NextResponse(result.stream, { headers: SSE_HEADERS });
}
