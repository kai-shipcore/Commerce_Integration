/**
 * Data access for the three master-data tables behind /production/parts-codes:
 * ProductionPart (pd_production_parts), ProductionCode (pd_production_codes),
 * and DesignerInitial (pd_designer_initials). All three share the same
 * shape (id, a unique key field, isActive, timestamps) — this repository
 * exposes one method set per entity so MasterDataService can drive all
 * three off a single generic implementation.
 */

import { prisma } from "@/lib/db/prisma";
import type { Prisma, ProductionPart, ProductionCode, DesignerInitial } from "@prisma/client";

export const PartsRepository = {
  list(search: string, active: boolean | null): Promise<ProductionPart[]> {
    return prisma.productionPart.findMany({
      where: {
        ...(search ? { partName: { contains: search, mode: "insensitive" } } : {}),
        ...(active !== null ? { isActive: active } : {}),
      },
      orderBy: { partName: "asc" },
    });
  },
  findByKey(partName: string): Promise<ProductionPart | null> {
    return prisma.productionPart.findUnique({ where: { partName } });
  },
  findById(id: bigint): Promise<ProductionPart | null> {
    return prisma.productionPart.findUnique({ where: { id } });
  },
  create(data: Prisma.ProductionPartCreateInput): Promise<ProductionPart> {
    return prisma.productionPart.create({ data });
  },
  update(id: bigint, data: Prisma.ProductionPartUpdateInput): Promise<ProductionPart> {
    return prisma.productionPart.update({ where: { id }, data });
  },
};

export const CodesRepository = {
  list(search: string, active: boolean | null): Promise<ProductionCode[]> {
    return prisma.productionCode.findMany({
      where: {
        ...(search ? { code: { contains: search, mode: "insensitive" } } : {}),
        ...(active !== null ? { isActive: active } : {}),
      },
      orderBy: { code: "asc" },
    });
  },
  findByKey(code: string): Promise<ProductionCode | null> {
    return prisma.productionCode.findUnique({ where: { code } });
  },
  findById(id: bigint): Promise<ProductionCode | null> {
    return prisma.productionCode.findUnique({ where: { id } });
  },
  create(data: Prisma.ProductionCodeCreateInput): Promise<ProductionCode> {
    return prisma.productionCode.create({ data });
  },
  update(id: bigint, data: Prisma.ProductionCodeUpdateInput): Promise<ProductionCode> {
    return prisma.productionCode.update({ where: { id }, data });
  },
};

export const DesignerInitialsRepository = {
  list(search: string, active: boolean | null): Promise<DesignerInitial[]> {
    return prisma.designerInitial.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { initial: { contains: search, mode: "insensitive" } },
                { designerName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(active !== null ? { isActive: active } : {}),
      },
      orderBy: { initial: "asc" },
    });
  },
  findByKey(initial: string): Promise<DesignerInitial | null> {
    return prisma.designerInitial.findUnique({ where: { initial } });
  },
  findById(id: bigint): Promise<DesignerInitial | null> {
    return prisma.designerInitial.findUnique({ where: { id } });
  },
  create(data: Prisma.DesignerInitialCreateInput): Promise<DesignerInitial> {
    return prisma.designerInitial.create({ data });
  },
  update(id: bigint, data: Prisma.DesignerInitialUpdateInput): Promise<DesignerInitial> {
    return prisma.designerInitial.update({ where: { id }, data });
  },
};
