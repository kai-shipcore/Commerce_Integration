// Code Guide: CRUD API for pd_production_parts table. GET lists all parts with optional filters;
// POST creates a new part record.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { MasterDataService, MASTER_DATA_CONFIGS } from "@/lib/parts-codes/service";

const ProductionPartCreateSchema = z.object({
  partName: z.string().min(1),
  description: z.string().optional(),
  seatRow: z.enum(["Front", "Rear", "Second Row", "Third Row"]).optional(),
  position: z.enum(["Driver", "Passenger", "Middle", "Universal"]).optional(),
  category: z.enum(["Headrest", "Top Body", "Bottom", "Arm", "Console", "Back Storage", "Sub-part", "Leg Support", "Side Bolster"]).optional(),
  isActive: z.boolean().default(true),
});

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function GET(request: NextRequest) {
  const denied = await guardPermission("parts-codes", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const activeParam = searchParams.get("active");

    const parts = await MasterDataService.list(MASTER_DATA_CONFIGS.part, search, activeParam !== null ? activeParam === "true" : null);
    return apiSuccess({ data: parts.map(serialize) });
  } catch (error) {
    console.error("Error fetching production parts:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("parts-codes", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = ProductionPartCreateSchema.parse(body);
    const session = await auth();

    const part = await MasterDataService.create(MASTER_DATA_CONFIGS.part, validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(part) }, 201);
  } catch (error) {
    console.error("Error creating production part:", error);
    return handleApiError(error);
  }
}
