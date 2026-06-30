// Code Guide: GET /api/planning/seat-cover/parts — returns all replacement parts sorted by request date asc
// POST /api/planning/seat-cover/parts — inserts a new replacement part row; pass createShipHeroOrder:true to also create a ShipHero order
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notifySlack } from "@/lib/slack";
import { getShipHeroOrder, createShipHeroOrder, getUserShipHeroToken } from "@/lib/shiphero";
import { guardPermission } from "@/lib/permissions";

export async function GET(req: Request) {
  const denied = await guardPermission("parts", "read");
  if (denied) return denied;
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
  const denied = await guardPermission("parts", "create");
  if (denied) return denied;
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
         qty, "orderRequest", "partSku", note, "orderStatus",
         "shipheroOrder", "shippingStatus", "createdAt", "updatedAt")
      VALUES (
        ${receivedAt},
        ${orderNumber},
        ${partNumber},
        ${correspondingSku || null},
        ${Number(qty) || 0},
        ${orderRequest || null},
        ${partSku || null},
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

    if (body.createShipHeroOrder && partSku && shipheroOrder) {
      const qtyNum = parseInt(body.orderRequest ?? "0", 10);
      if (qtyNum >= 1) {
        try {
          const userToken = session?.user?.id ? await getUserShipHeroToken(session.user.id) : null;
          if (!userToken) {
            return NextResponse.json({ success: true, shipHeroError: "ShipHero 계정이 연결되어 있지 않습니다." }, { status: 201 });
          }
          const orderInfo = await getShipHeroOrder(String(orderNumber), userToken);
          if (!orderInfo) {
            return NextResponse.json({ success: true, shipHeroError: `Original ShipHero order not found: ${orderNumber}` }, { status: 201 });
          }
          const result = await createShipHeroOrder({
            order_number:    String(shipheroOrder),
            shop_name:       orderInfo.shop_name,
            shipping_lines:  { title: "Standard", price: "0.00" },
            shipping_address: orderInfo.shipping_address,
            billing_address:  orderInfo.shipping_address,
            line_items: [{
              sku:                          String(partSku),
              quantity:                     qtyNum,
              product_name:                 String(partSku),
              price:                        "0.00",
              quantity_pending_fulfillment: qtyNum,
              partner_line_item_id:         `${String(shipheroOrder)}-1`,
            }],
          }, userToken);
          if (!result) {
            return NextResponse.json({ success: true, shipHeroError: "ShipHero order creation failed" }, { status: 201 });
          }
          await prisma.$executeRaw`
            UPDATE shipcore.fc_replacement_parts
            SET "shipheroOrderId" = ${result.id}
            WHERE id = (
              SELECT id FROM shipcore.fc_replacement_parts
              WHERE "orderNumber" = ${String(orderNumber)}
                AND "shipheroOrder" = ${String(shipheroOrder)}
                AND "shipheroOrderId" IS NULL
              ORDER BY "createdAt" DESC
              LIMIT 1
            )
          `;
          return NextResponse.json({ success: true, shipHeroOrderNumber: result.order_number }, { status: 201 });
        } catch (err) {
          console.error("[parts] shiphero order error", err);
          const msg = err instanceof Error ? err.message : "ShipHero error";
          return NextResponse.json({ success: true, shipHeroError: msg }, { status: 201 });
        }
      }
    }

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
