/**
 * Business logic for saving a per-SKU memo: persists via SkuMemoRepository
 * and invalidates the demand planning dashboard cache the memo is displayed
 * on.
 */

import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { SkuMemoRepository } from "@/lib/sku-memo/repository";

export const SkuMemoService = {
  async saveMemo(sku: string, memo: string): Promise<void> {
    await SkuMemoRepository.saveMemo(sku, memo || null);
    await invalidatePlanningDashboardCache();
  },
};
