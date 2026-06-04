// Code Guide: GET /api/planning/seat-cover/parts — returns all replacement parts sorted by request date asc
// POST /api/planning/seat-cover/parts — inserts a new replacement part row
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";

export async function GET() {
  try {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM shipcore.replacement_parts
      WHERE "deleteYN" = 'N'
      ORDER BY "requestReceivedAt" ASC
    `;
    const data = rows.map((r) => ({ ...r, id: String(r.id) }));
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[parts] fetch error", err);
    return NextResponse.json({ success: false, data: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      requestReceivedAt,
      orderNumber,
      partNumber,
      correspondingSku,
      qty,
      orderRequest,
      partSku,
      partSkuValue,
      note,
      orderStatus,
      shipheroOrder,
      shippingStatus,
    } = body;

    if (!requestReceivedAt || !orderNumber || !partNumber) {
      return NextResponse.json(
        { success: false, error: "requestReceivedAt, orderNumber, partNumber are required" },
        { status: 400 }
      );
    }

    const now = new Date();
    const receivedAt = new Date(requestReceivedAt);

    await prisma.$executeRaw`
      INSERT INTO shipcore.replacement_parts
        ("requestReceivedAt", "orderNumber", "partNumber", "correspondingSku",
         qty, "orderRequest", "partSku", "partSkuValue", note, "orderStatus",
         "shipheroOrder", "shippingStatus", "createdAt", "updatedAt")
      VALUES (
        ${receivedAt},
        ${orderNumber},
        ${partNumber},
        ${correspondingSku || null},
        ${Number(qty) || 0},
        ${orderRequest || null},
        ${partSku || null},
        ${partSkuValue || null},
        ${note || null},
        ${orderStatus || null},
        ${shipheroOrder || null},
        ${shippingStatus || null},
        ${now},
        ${now}
      )
    `;

    const session = await auth();
    const userName = session?.user?.name ?? session?.user?.email ?? "Unknown";
    notifySlack(`[Parts] ${userName} added a new row — Order #${orderNumber}`);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error("[parts] insert error", err);
    return NextResponse.json({ success: false, error: "Insert failed" }, { status: 500 });
  }
}
