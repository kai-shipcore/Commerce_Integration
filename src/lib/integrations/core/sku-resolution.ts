import { prisma } from "@/lib/db/prisma";
import { lookupMasterSkusFromSupabase } from "@/lib/db/supabase-lookup";

export interface MasterSkuInfo {
  parse1: string;
  parse2: string | null;
  parse3: string | null;
}

export async function lookupMasterSkus(webSkus: string[]): Promise<Map<string, MasterSkuInfo>> {
  if (webSkus.length === 0) {
    return new Map();
  }

  try {
    return (await lookupMasterSkusFromSupabase(webSkus)) || new Map();
  } catch (error) {
    console.error("Error looking up master SKUs:", error);
    return new Map();
  }
}

export async function ensureSkuMappings(
  skuCodes: string[],
  skuMap: Map<string, string>,
  masterSkuCache: Map<string, MasterSkuInfo>
): Promise<number> {
  if (skuCodes.length === 0) {
    return 0;
  }

  const uniqueSkuCodes = Array.from(new Set(skuCodes.filter(Boolean)));
  if (uniqueSkuCodes.length === 0) {
    return 0;
  }

  const existingSkus = await prisma.sKU.findMany({
    where: { skuCode: { in: uniqueSkuCodes } },
    select: { id: true, skuCode: true },
  });

  existingSkus.forEach((sku) => skuMap.set(sku.skuCode, sku.id));

  const missingSkuCodes = uniqueSkuCodes.filter((code) => !skuMap.has(code));
  if (missingSkuCodes.length === 0) {
    return 0;
  }

  const masterSkuLookup = await lookupMasterSkus(missingSkuCodes);
  masterSkuLookup.forEach((value, key) => masterSkuCache.set(key, value));

  const newSkus = await prisma.sKU.createManyAndReturn({
    data: missingSkuCodes.map((skuCode) => {
      const masterInfo = masterSkuLookup.get(skuCode);
      return {
        skuCode,
        masterSkuCode: masterInfo?.parse1 || null,
        name: skuCode,
        currentStock: 0,
      };
    }),
    select: { id: true, skuCode: true, masterSkuCode: true },
  });

  newSkus.forEach((sku) => skuMap.set(sku.skuCode, sku.id));
  return newSkus.length;
}
