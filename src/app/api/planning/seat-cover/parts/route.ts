// Code Guide: GET /api/planning/seat-cover/parts — returns all replacement parts sorted by request date asc
// POST /api/planning/seat-cover/parts — inserts a new replacement part row
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const deletedOnly = searchParams.get("deleted") === "true";
  try {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM shipcore.fc_replacement_parts
      WHERE "deleteYN" = ${deletedOnly ? "Y" : "N"}
      ORDER BY "requestReceivedAt" ASC
    `;
    const data = rows.map((r) => ({
      ...r,
      id: String(r.id),
      requestReceivedAt: (() => {
        const d = r.requestReceivedAt as Date | string | null;
        if (!d) return null;
        if (d instanceof Date)
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        return String(d).split("T")[0];
      })(),
    }));
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
      INSERT INTO shipcore.fc_replacement_parts
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
    console.error("[parts] insert error", err);
    return NextResponse.json({ success: false, error: "Insert failed" }, { status: 500 });
  }
}
