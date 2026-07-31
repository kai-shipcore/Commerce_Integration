// Code Guide: lightweight picker source for Project List (Assigned to / Researched by /
// Reviewed by) — production-role users only. Distinct from the heavy admin-gated
// /api/admin/users endpoint, which requires user-permissions access.

import { guardPermission } from "@/lib/permissions";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { ProductListService } from "@/lib/product-list/service";

export async function GET() {
  const denied = await guardPermission("project-list", "read");
  if (denied) return denied;
  try {
    const users = await ProductListService.listAssignableUsers();
    return apiSuccess({ data: users });
  } catch (error) {
    console.error("Error fetching assignable users:", error);
    return handleApiError(error);
  }
}
