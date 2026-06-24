import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

export async function GET() {
  try {
    const result = await getPrimaryPool().query<{ min_date: string | null }>(
      `SELECT MIN(order_date)::text AS min_date FROM shipcore.fc_velocity_link_snapshot`,
    );
    return NextResponse.json({ minDate: result.rows[0]?.min_date?.slice(0, 10) ?? null });
  } catch {
    return NextResponse.json({ minDate: null });
  }
}
