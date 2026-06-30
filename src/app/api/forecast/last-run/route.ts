import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";

export async function GET() {
  try {
    const rows = await prisma.$queryRaw<{ run_date: Date | null; horizon_weeks: bigint | null }[]>`
      SELECT run_date, horizon_weeks
      FROM shipcore.fc_forecast_history
      ORDER BY run_date DESC
      LIMIT 1
    `;
    if (!rows.length || !rows[0].run_date) {
      return NextResponse.json({ run_date: null, horizon_weeks: null });
    }
    return NextResponse.json({
      run_date: rows[0].run_date.toISOString(),
      horizon_weeks: rows[0].horizon_weeks ? Number(rows[0].horizon_weeks) : null,
    });
  } catch (err) {
    return NextResponse.json({ run_date: null, horizon_weeks: null, error: String(err) });
  }
}
