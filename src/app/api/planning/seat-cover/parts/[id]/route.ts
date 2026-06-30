// Code Guide: PATCH /api/planning/seat-cover/parts/[id] — updates a replacement part row
// DELETE /api/planning/seat-cover/parts/[id] — deletes a replacement part row
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";
import { guardPermission } from "@/lib/permissions";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("parts", "edit");
  if (denied) return denied;
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
      note,
      orderStatus,
      shipheroOrder,
      shipheroOrderId,
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
      UPDATE shipcore.fc_replacement_parts
      SET
        "requestReceivedAt" = ${receivedAt},
        "orderNumber"       = ${orderNumber},
        "partNumber"        = ${partNumber},
        "correspondingSku"  = ${correspondingSku || null},
        qty                 = ${Number(qty) || 0},
        "orderRequest"      = ${orderRequest || null},
        "partSku"           = ${partSku || null},
        note                = ${note || null},
        "orderStatus"       = ${orderStatus || null},
        "shipheroOrder"     = ${shipheroOrder || null},
        "shipheroOrderId"   = ${shipheroOrderId || null},
        "shippingStatus"    = ${shippingStatus || null},
        "updatedAt"         = ${now}
      WHERE id = ${rowId}
    `;

    const session = await auth();
    const userName = session?.user?.name ?? session?.user?.email ?? "Unknown";
    notifySlack(`[Parts] ${userName} edited a row — Order #${orderNumber}`);


    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    const isDuplicate =
      e.code === "P2002" ||
      (typeof e.message === "string" && e.message.includes("23505"));
    if (isDuplicate) {
      return NextResponse.json(
        { success: false, error: "Request Received Date · Order Number · Part Number 조합이 이미 존재합니다." },
        { status: 409 }
      );
    }
    console.error("[parts] update error", err);
    return NextResponse.json({ success: false, error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("parts", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await req.json();
    const { orderNumber } = body;

    await prisma.$executeRaw`
      UPDATE shipcore.fc_replacement_parts SET "deleteYN" = 'Y' WHERE id = ${BigInt(id)}
    `;

    const session = await auth();
    const userName = session?.user?.name ?? session?.user?.email ?? "Unknown";
    notifySlack(`[Parts] ${userName} deleted a row — Order #${orderNumber ?? id}`);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[parts] delete error", err);
    return NextResponse.json({ success: false, error: "Delete failed" }, { status: 500 });
  }
}
