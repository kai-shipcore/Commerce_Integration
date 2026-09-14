import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, MANAGED_ROLES, PERM_SECTION_ACTIONS } from "@/lib/permissions-config";

const { guard, save } = vi.hoisted(() => ({ guard: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ guardPermission: guard }));
vi.mock("@/lib/audit", () => ({ getIp: () => null }));
vi.mock("@/lib/planning-dashboard/service", () => ({
  PlanningDashboardService: {
    updateTotalAvgPrevOverride: save,
    updateTotalAvgRealOverride: save,
    updateTotalAvgCurrentOverride: save,
    updateProductCbm: save,
  },
}));
import { PATCH } from "@/app/api/planning/products/[sku]/route";

beforeEach(() => { vi.clearAllMocks(); });
describe("Demand Planning special Create permission", () => {
  it("is exposed and disabled by default for all managed roles", () => {
    expect(PERM_SECTION_ACTIONS["demand-planning"]).toContain("create");
    for (const role of MANAGED_ROLES) expect(DEFAULT_ROLE_PERMISSIONS[role]["demand-planning"].create).toBe(false);
  });
  it.each(["prev", "real", "curr"])("blocks %s override writes and Delete resets without Create", async (period) => {
    for (const value of [2.5, null]) {
      guard.mockResolvedValue(new Response(null, { status: 403 }));
      const response = await PATCH(new Request("http://localhost/api/planning/products/SKU-1", {
        method: "PATCH",
        body: JSON.stringify({ [`total_avg_${period}_override`]: value }),
      }), { params: Promise.resolve({ sku: "SKU-1" }) });
      expect(guard).toHaveBeenLastCalledWith("demand-planning", "create");
      expect(response.status).toBe(403);
      expect(save).not.toHaveBeenCalled();
    }
  });
});
