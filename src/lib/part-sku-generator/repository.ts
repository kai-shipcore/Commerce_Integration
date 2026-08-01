/**
 * Data access for pd_part_skus (the Part SKU Generator page).
 */

import { prisma } from "@/lib/db/prisma";
import type { Prisma, PartSku } from "@prisma/client";

export interface PartSkuFilters {
  search: string;
  active: boolean | null;
  make: string | null;
  model: string | null;
}

export const PartSkusRepository = {
  list(filters: PartSkuFilters): Promise<PartSku[]> {
    // Universal SKUs have no make/model (they fit every vehicle), so they're always
    // included alongside whatever Custom SKUs match the requested make/model.
    const vehicleFilter =
      filters.make || filters.model
        ? {
            OR: [
              {
                AND: [
                  ...(filters.make ? [{ make: { equals: filters.make, mode: "insensitive" as const } }] : []),
                  ...(filters.model ? [{ model: { equals: filters.model, mode: "insensitive" as const } }] : []),
                ],
              },
              { skuType: "Universal" },
            ],
          }
        : {};

    return prisma.partSku.findMany({
      where: {
        AND: [
          filters.search
            ? {
                OR: [
                  { sku: { contains: filters.search, mode: "insensitive" } },
                  { partName: { contains: filters.search, mode: "insensitive" } },
                ],
              }
            : {},
          filters.active !== null ? { isActive: filters.active } : {},
          vehicleFilter,
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  },

  findBySku(sku: string): Promise<PartSku | null> {
    return prisma.partSku.findUnique({ where: { sku } });
  },

  findById(id: bigint): Promise<PartSku | null> {
    return prisma.partSku.findUnique({ where: { id } });
  },

  create(data: Prisma.PartSkuCreateInput): Promise<PartSku> {
    return prisma.partSku.create({ data });
  },

  update(id: bigint, data: Prisma.PartSkuUpdateInput): Promise<PartSku> {
    return prisma.partSku.update({ where: { id }, data });
  },
};
