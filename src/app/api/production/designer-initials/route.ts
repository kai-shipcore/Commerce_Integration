// Code Guide: CRUD API for pd_designer_initials table. GET lists all designer initials with
// optional filters; POST creates a new designer initial record.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { MasterDataService, MASTER_DATA_CONFIGS } from "@/lib/parts-codes/service";

const DesignerInitialCreateSchema = z.object({
  initial: z.string().min(1),
  designerName: z.string().min(1),
  isActive: z.boolean().default(true),
});

function serialize(d: object): object {
  return JSON.parse(JSON.stringify(d, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export async function GET(request: NextRequest) {
  const denied = await guardPermission("parts-codes", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const activeParam = searchParams.get("active");

    const initials = await MasterDataService.list(MASTER_DATA_CONFIGS.designerInitial, search, activeParam !== null ? activeParam === "true" : null);
    return apiSuccess({ data: initials.map(serialize) });
  } catch (error) {
    console.error("Error fetching designer initials:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("parts-codes", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = DesignerInitialCreateSchema.parse(body);
    const session = await auth();

    const created = await MasterDataService.create(MASTER_DATA_CONFIGS.designerInitial, validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(created) }, 201);
  } catch (error) {
    console.error("Error creating designer initial:", error);
    return handleApiError(error);
  }
}
