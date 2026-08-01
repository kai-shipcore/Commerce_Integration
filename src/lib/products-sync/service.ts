import { ProductsSyncRepository } from "@/lib/products-sync/repository";

export const ProductsSyncService = {
  async sync(): Promise<{ productsUpserted: number; productsDeleted: number }> {
    const rows = await ProductsSyncRepository.getLookupRows();
    await ProductsSyncRepository.upsertProducts(rows);
    return { productsUpserted: rows.length, productsDeleted: 0 };
  },
};
