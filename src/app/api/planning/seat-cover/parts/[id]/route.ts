// Code Guide: PATCH /api/planning/seat-cover/parts/[id] — updates a replacement part row
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
    const rowId = BigInt(id);

    await prisma.$executeRaw`
      UPDATE shipcore.replacement_parts
      SET
        "requestReceivedAt" = ${receivedAt},
        "orderNumber"       = ${orderNumber},
        "partNumber"        = ${partNumber},
        "correspondingSku"  = ${correspondingSku || null},
        qty                 = ${Number(qty) || 0},
        "orderRequest"      = ${orderRequest || null},
        "partSku"           = ${partSku || null},
        "partSkuValue"      = ${partSkuValue || null},
        note                = ${note || null},
        "orderStatus"       = ${orderStatus || null},
        "shipheroOrder"     = ${shipheroOrder || null},
        "shippingStatus"    = ${shippingStatus || null},
        "updatedAt"         = ${now}
      WHERE id = ${rowId}
    `;

    const session = await auth();
    const userName = session?.user?.name ?? session?.user?.email ?? "Unknown";
    notifySlack(`[Parts] ${userName} edited a row — Order #${orderNumber}`);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[parts] update error", err);
    return NextResponse.json({ success: false, error: "Update failed" }, { status: 500 });
  }
}
