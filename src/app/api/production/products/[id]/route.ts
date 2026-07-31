// Code Guide: single pd_product_list record by id. PATCH updates header fields (make/model/
// fNumber/yearGeneration/isActive). DELETE hard-deletes (cascades to projects -> parts + checklist).

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

const ProductUpdateSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  fNumber: z.string().min(1).optional(),
  yearGeneration: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("project-list", "edit");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = ProductUpdateSchema.parse(body);

    const product = await ProductListService.updateProduct(BigInt(id), validated);
    return apiSuccess({ data: serialize(product) });
  } catch (error) {
    console.error("Error updating product:", error);
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardPermission("project-list", "delete");
  if (denied) return denied;
  try {
    const { id } = await params;
    const session = await auth();

    await ProductListService.deleteProduct(BigInt(id), {
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      ip: getIp(request.headers),
    });

    return apiSuccess({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    return handleApiError(error);
  }
}
