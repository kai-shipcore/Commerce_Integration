// Code Guide: POST /api/planning/seat-cover/parts/import — bulk upsert replacement parts from Excel
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";

interface ImportRow {
  requestReceivedAt: string;
  orderNumber: string;
  partNumber: string;
  correspondingSku: string;
  qty: string;
  orderRequest: string;
  partSku: string;
  partSkuValue: string;
  note: string;
  orderStatus: string;
  shipheroOrder: string;
  shippingStatus: string;
}

export async function POST(req: Request) {
  try {
    const { rows } = await req.json() as { rows: ImportRow[] };

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ success: false, error: "No rows provided" }, { status: 400 });
    }

    const now = new Date();
    let upserted = 0;

    for (const row of rows) {
      if (!row.requestReceivedAt || !row.orderNumber || !row.partNumber) continue;

      const receivedAt = new Date(row.requestReceivedAt);
      if (isNaN(receivedAt.getTime())) continue;

      await prisma.$executeRaw`
        INSERT INTO shipcore.replacement_parts
          ("requestReceivedAt", "orderNumber", "partNumber", "correspondingSku",
           qty, "orderRequest", "partSku", "partSkuValue", note, "orderStatus",
           "shipheroOrder", "shippingStatus", "deleteYN", "createdAt", "updatedAt")
        VALUES (
          ${receivedAt},
          ${row.orderNumber},
          ${row.partNumber},
          ${row.correspondingSku || null},
          ${Number(row.qty) || 0},
          ${row.orderRequest || null},
          ${row.partSku || null},
          ${row.partSkuValue || null},
          ${row.note || null},
          ${row.orderStatus || null},
          ${row.shipheroOrder || null},
          ${row.shippingStatus || "Not Ready"},
          'N',
          ${now},
          ${now}
        )
        ON CONFLICT ("requestReceivedAt", "orderNumber", "partNumber")
        DO UPDATE SET
          "correspondingSku" = EXCLUDED."correspondingSku",
          qty                = EXCLUDED.qty,
          "orderRequest"     = EXCLUDED."orderRequest",
          "partSku"          = EXCLUDED."partSku",
          "partSkuValue"     = EXCLUDED."partSkuValue",
          note               = EXCLUDED.note,
          "orderStatus"      = EXCLUDED."orderStatus",
          "shipheroOrder"    = EXCLUDED."shipheroOrder",
          "shippingStatus"   = EXCLUDED."shippingStatus",
          "updatedAt"        = ${now}
      `;
      upserted++;
    }

    const session = await auth();
    const userName = session?.user?.name ?? session?.user?.email ?? "Unknown";
    notifySlack(`[Parts] ${userName} bulk imported ${upserted} rows`);

    return NextResponse.json({ success: true, upserted });
  } catch (err) {
    console.error("[parts] import error", err);
    return NextResponse.json({ success: false, error: "Import failed" }, { status: 500 });
  }
}
