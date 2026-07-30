/**
 * Business logic for the SKU Planning inbound tabs: input validation only —
 * the actual data shaping already happens in the repository, matching the
 * original routes' minimal-logic footprint. Data access lives in
 * src/lib/sku-forecasts/repository.ts.
 */

import { ValidationError } from "@/lib/errors";
import { SkuForecastsRepository, type InboundHistoryRow, type InboundRow } from "@/lib/sku-forecasts/repository";

function requireMasterSku(rawMasterSku: string | null): string {
  const masterSku = rawMasterSku?.trim().toUpperCase() ?? "";
  if (!masterSku) throw new ValidationError("masterSku is required");
  return masterSku;
}

export const SkuForecastsService = {
  async getInboundHistory(rawMasterSku: string | null): Promise<InboundHistoryRow[]> {
    return SkuForecastsRepository.getInboundHistory(requireMasterSku(rawMasterSku));
  },

  async getInbound(rawMasterSku: string | null, includeDrafts: boolean): Promise<InboundRow[]> {
    return SkuForecastsRepository.getInbound(requireMasterSku(rawMasterSku), includeDrafts);
  },

  getForecastBounds(): Promise<string | null> {
    return SkuForecastsRepository.getForecastMinDate();
  },
};
