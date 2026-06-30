import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getShipHeroInventory, getUserShipHeroToken } from "@/lib/shiphero";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const userToken = await getUserShipHeroToken(session.user.id);
  if (!userToken) {
    return NextResponse.json({ success: false, error: "ShipHero 계정이 연결되어 있지 않습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sku = searchParams.get("sku");

  if (!sku) {
    return NextResponse.json({ success: false, error: "sku param required" }, { status: 400 });
  }

  try {
    const warehouses = await getShipHeroInventory(sku, userToken);
    return NextResponse.json({ success: true, warehouses });
  } catch (err) {
    console.error("[parts/inventory] error", err);
    return NextResponse.json({ success: false, error: "Inventory lookup failed" }, { status: 500 });
  }
}
