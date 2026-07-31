import { SkuMappingsSyncRepository, type KitMapping } from "@/lib/sku-mappings-sync/repository";

export const SkuMappingsSyncService = {
  async sync(): Promise<{ mappingsUpserted: number; mappingsDeleted: number }> {
    const rows = await SkuMappingsSyncRepository.getKitComponentMappings();

    // Deduplicate
    const mappingSet = new Map<string, KitMapping>();
    for (const row of rows) {
      mappingSet.set(`${row.parent_kit_sku}|${row.component_sku}`, {
        channel_sku: row.parent_kit_sku,
        master_sku: row.component_sku,
      });
    }
    const uniqueMappings = [...mappingSet.values()];
    const distinctMasterSkus = [...new Set(uniqueMappings.map((m) => m.master_sku))];

    // Commit sc_products rows first so the FK from sc_product_mapping_history
    // (via trg_sc_sku_mapping_history trigger) is satisfied at commit time of the next step.
    await SkuMappingsSyncRepository.ensureProductsExist(distinctMasterSkus);

    return SkuMappingsSyncRepository.syncMappings(uniqueMappings);
  },
};
