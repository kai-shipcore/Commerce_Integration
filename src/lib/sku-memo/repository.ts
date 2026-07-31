/**
 * Data access for the per-SKU memo note shown in the Master SKU popup on the
 * demand planning grid. Upserts into shipcore.fc_products.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";

export const SkuMemoRepository = {
  async saveMemo(sku: string, memo: string | null): Promise<void> {
    await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_products (master_sku, memo)
       VALUES ($1, $2)
       ON CONFLICT (master_sku) DO UPDATE SET memo = $2, updated_at = NOW()`,
      [sku, memo],
    );
  },
};
