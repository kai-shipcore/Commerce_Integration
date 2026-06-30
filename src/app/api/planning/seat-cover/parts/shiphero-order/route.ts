import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getShipHeroOrder, createShipHeroOrder, getUserShipHeroToken } from "@/lib/shiphero";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const userToken = await getUserShipHeroToken(session.user.id);
    if (!userToken) {
      return NextResponse.json({ success: false, error: "ShipHero 계정이 연결되어 있지 않습니다." }, { status: 403 });
    }

    const body = await req.json();
    const { orderNumber, shipheroOrderNumber, partSku, qty } = body ?? {};

    if (!orderNumber || !shipheroOrderNumber || !partSku || !qty || qty < 1) {
      return NextResponse.json(
        { success: false, error: "orderNumber, shipheroOrderNumber, partSku, qty (>= 1) required" },
        { status: 400 }
      );
    }

    const orderInfo = await getShipHeroOrder(orderNumber, userToken);
    if (!orderInfo) {
      return NextResponse.json(
        { success: false, error: `Original ShipHero order not found: ${orderNumber}` },
        { status: 404 }
      );
    }

    const result = await createShipHeroOrder({
      order_number:    shipheroOrderNumber,
      shop_name:       orderInfo.shop_name,
      shipping_lines:  { title: "Standard", price: "0.00" },
      shipping_address: orderInfo.shipping_address,
      billing_address:  orderInfo.shipping_address,
      line_items: [{
        sku:                          partSku,
        quantity:                     qty,
        product_name:                 partSku,
        price:                        "0.00",
        quantity_pending_fulfillment: qty,
        partner_line_item_id:         `${shipheroOrderNumber}-1`,
      }],
    }, userToken);

    if (!result) {
      return NextResponse.json(
        { success: false, error: "ShipHero order creation failed" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { success: true, orderId: result.id, orderNumber: result.order_number },
      { status: 201 }
    );
  } catch (err) {
    console.error("[parts/shiphero-order] error", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
