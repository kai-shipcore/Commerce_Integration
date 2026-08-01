// Code Guide: CRUD API for pd_part_skus table. GET lists all generated Part SKUs with optional
// filters; POST generates and saves a new Part SKU (Part-MakeAbbr-ModelAbbr-Code-Initial-Side).

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { PartSkuGeneratorService } from "@/lib/part-sku-generator/service";

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const CustomPartSkuSchema = z.object({
  skuType: z.literal("Custom"),
  partName: z.string().min(1),
  make: z.string().min(1),
  makeAbbr: z.string().min(1),
  model: z.string().min(1),
  modelAbbr: z.string().min(1),
  code: z.string().min(1),
  initial: z.string().min(1),
  side: z.enum(["D", "P", "MD", "MP", "Universal"]),
});

const UniversalPartSkuSchema = z.object({
  skuType: z.literal("Universal"),
  partName: z.string().min(1),
});

const PartSkuCreateSchema = z.discriminatedUnion("skuType", [CustomPartSkuSchema, UniversalPartSkuSchema]);

export async function GET(request: NextRequest) {
  const denied = await guardPermission("part-sku-generator", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);

    const partSkus = await PartSkuGeneratorService.list({
      search: searchParams.get("search") ?? "",
      active: searchParams.get("active") !== null ? searchParams.get("active") === "true" : null,
      make: searchParams.get("make"),
      model: searchParams.get("model"),
    });

    return apiSuccess({ data: partSkus.map(serialize) });
  } catch (error) {
    console.error("Error fetching part skus:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("part-sku-generator", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = PartSkuCreateSchema.parse(body);
    const session = await auth();

    const partSku = await PartSkuGeneratorService.create(validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(partSku) }, 201);
  } catch (error) {
    console.error("Error creating part sku:", error);
    return handleApiError(error);
  }
}
