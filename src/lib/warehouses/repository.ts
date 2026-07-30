import { prisma } from "@/lib/db/prisma";
import { getPrimaryPool } from "@/lib/db/primary-db";
import type { Warehouse, Prisma } from "@prisma/client";

export interface WarehouseListFilter {
  search: string;
  type: string;
  active: boolean | null;
}

export interface DropdownWarehouseRow {
  warehouseCode: string;
  warehouseName: string;
  warehouseType: string;
}

/**
 * Pure data access for the Warehouse entity. Two callers share this table:
 * the Prisma-modeled `Warehouse` (full CRUD, `fc_warehouses`) and a
 * lightweight raw-SQL dropdown feed used by transit records. Caching/
 * validation/audit orchestration are Service concerns (see
 * warehouses/service.ts) — this repository only runs queries.
 */
export const WarehousesRepository = {
  findMany(filter: WarehouseListFilter): Promise<Warehouse[]> {
    const where: Prisma.WarehouseWhereInput = {
      ...(filter.search
        ? {
            OR: [
              { warehouseCode: { contains: filter.search, mode: "insensitive" } },
              { warehouseName: { contains: filter.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(filter.type ? { warehouseType: filter.type } : {}),
      ...(filter.active !== null ? { isActive: filter.active } : {}),
    };

    return prisma.warehouse.findMany({ where, orderBy: { warehouseCode: "asc" } });
  },

  findByCode(warehouseCode: string): Promise<Warehouse | null> {
    return prisma.warehouse.findUnique({ where: { warehouseCode } });
  },

  findById(id: string): Promise<Warehouse | null> {
    return prisma.warehouse.findUnique({ where: { id: BigInt(id) } });
  },

  create(data: Prisma.WarehouseCreateInput): Promise<Warehouse> {
    return prisma.warehouse.create({ data });
  },

  update(id: string, data: Prisma.WarehouseUpdateInput): Promise<Warehouse> {
    return prisma.warehouse.update({ where: { id: BigInt(id) }, data });
  },

  setActive(id: string, isActive: boolean): Promise<Warehouse> {
    return prisma.warehouse.update({ where: { id: BigInt(id) }, data: { isActive } });
  },

  async listActiveForDropdown(): Promise<DropdownWarehouseRow[]> {
    const pool = getPrimaryPool();
    const result = await pool.query<DropdownWarehouseRow>(
      `SELECT warehouse_code AS "warehouseCode", warehouse_name AS "warehouseName", warehouse_type AS "warehouseType"
       FROM shipcore.fc_warehouses
       WHERE is_active = true
       ORDER BY warehouse_name ASC`
    );
    return result.rows;
  },
};
