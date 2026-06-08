import { NextResponse } from "next/server";
import { getShipHeroInventory } from "@/lib/shiphero";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sku = searchParams.get("sku");

  if (!sku) {
    return NextResponse.json({ success: false, error: "sku param required" }, { status: 400 });
  }

  try {
    const warehouses = await getShipHeroInventory(sku);
    return NextResponse.json({ success: true, warehouses });
  } catch (err) {
    console.error("[parts/inventory] error", err);
    return NextResponse.json({ success: false, error: "Inventory lookup failed" }, { status: 500 });
  }
}
