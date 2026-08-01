// Code Guide: CRUD API for pd_product_list table. GET lists all products (vehicles) with their
// rows (projects) summarized for the list/detail UI; POST creates a new product (header only —
// rows are added afterward via /api/production/products/[id]/projects).

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ProductListService } from "@/lib/product-list/service";

function serialize(p: object): object {
  return JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ProductCreateSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  yearGeneration: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("project-list", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const activeParam = searchParams.get("active");

    const products = await ProductListService.listProducts(activeParam !== null ? activeParam === "true" : null);
    return apiSuccess({ data: products.map(serialize) });
  } catch (error) {
    console.error("Error fetching products:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("project-list", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = ProductCreateSchema.parse(body);
    const session = await auth();

    const product = await ProductListService.createProduct(validated, {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ data: serialize(product) }, 201);
  } catch (error) {
    console.error("Error creating product:", error);
    return handleApiError(error);
  }
}
