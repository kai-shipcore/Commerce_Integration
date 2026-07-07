// Code Guide: Download an uploaded price list source file by id.

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  const { id } = await params;
  const result = await getPrimaryPool().query<{
    original_name: string;
    mime_type: string | null;
    file_data: Buffer;
  }>(
    `SELECT original_name, mime_type, file_data
     FROM shipcore.fc_price_list_files
     WHERE id = $1::bigint`,
    [id],
  );

  const row = result.rows[0];
  if (!row) return NextResponse.json({ success: false, error: "File not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(row.file_data), {
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${row.original_name.replace(/"/g, "")}"`,
    },
  });
}
