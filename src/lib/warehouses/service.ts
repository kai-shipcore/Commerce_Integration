import { WarehousesRepository } from "@/lib/warehouses/repository";
import type { Warehouse, Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";

export interface ListWarehousesQuery {
  search: string;
  type: string;
  active: string | null;
}

export interface CreateWarehouseInput {
  warehouseCode: string;
  warehouseName: string;
  warehouseType: "own" | "fba" | "3pl" | "transit";
  country?: string;
  stateRegion?: string;
  city?: string;
  timezone?: string;
  isActive: boolean;
}

export type UpdateWarehouseInput = Partial<CreateWarehouseInput>;

// BigInt fields (id) must be converted to string before JSON serialization.
function serialize(w: Warehouse): Record<string, unknown> {
  return JSON.parse(JSON.stringify(w, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function isStatusOnlyUpdate(input: UpdateWarehouseInput): boolean {
  return Object.keys(input).length === 1 && input.isActive !== undefined;
}

/**
 * Business logic for the Warehouse entity: enforces unique warehouse codes,
 * shapes Prisma rows (BigInt id -> string) for the API response, and writes
 * audit log entries for mutations. Also serves the lightweight active-
 * warehouse dropdown feed used by transit records.
 */
export const WarehousesService = {
  async listWarehouses(query: ListWarehousesQuery) {
    const warehouses = await WarehousesRepository.findMany({
      search: query.search,
      type: query.type,
      active: query.active === null ? null : query.active === "true",
    });
    return warehouses.map(serialize);
  },

  listActiveForDropdown() {
    return WarehousesRepository.listActiveForDropdown();
  },

  async createWarehouse(input: CreateWarehouseInput, ip: string | null) {
    const code = input.warehouseCode.toUpperCase();

    const existing = await WarehousesRepository.findByCode(code);
    if (existing) throw new ValidationError(`Warehouse code already exists: ${code}`);

    const warehouse = await WarehousesRepository.create({
      ...input,
      warehouseCode: code,
    } as Prisma.WarehouseCreateInput);

    const session = await auth();
    void logAudit({
      entityType: "warehouse",
      entityId: String(warehouse.id),
      entityLabel: warehouse.warehouseCode,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { warehouseName: warehouse.warehouseName, warehouseType: warehouse.warehouseType, country: warehouse.country },
      ip,
    });
    return serialize(warehouse);
  },

  async updateWarehouse(id: string, input: UpdateWarehouseInput, ip: string | null) {
    const existing = await WarehousesRepository.findById(id);
    if (!existing) throw new NotFoundError("Warehouse not found");

    const isStatusOnly = isStatusOnlyUpdate(input);
    const data = { ...input };

    if (data.warehouseCode) {
      const code = data.warehouseCode.toUpperCase();
      const duplicate = await WarehousesRepository.findByCode(code);
      if (duplicate && duplicate.id !== BigInt(id)) {
        throw new ValidationError(`Warehouse code already exists: ${code}`);
      }
      data.warehouseCode = code;
    }

    const warehouse = await WarehousesRepository.update(id, data as Prisma.WarehouseUpdateInput);

    const session = await auth();
    const auditAction = isStatusOnly ? (data.isActive ? "status_change" : "delete") : "update";
    void logAudit({
      entityType: "warehouse",
      entityId: id,
      entityLabel: existing.warehouseCode,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: auditAction,
      before: isStatusOnly
        ? { isActive: !data.isActive }
        : { warehouseName: existing.warehouseName, warehouseType: existing.warehouseType, country: existing.country },
      after: isStatusOnly
        ? { isActive: data.isActive }
        : { warehouseName: warehouse.warehouseName, warehouseType: warehouse.warehouseType, country: warehouse.country },
      ip,
    });
    return serialize(warehouse);
  },

  async deactivateWarehouse(id: string, ip: string | null) {
    const existing = await WarehousesRepository.findById(id);
    if (!existing) throw new NotFoundError("Warehouse not found");

    await WarehousesRepository.setActive(id, false);

    const session = await auth();
    void logAudit({
      entityType: "warehouse",
      entityId: id,
      entityLabel: existing.warehouseCode,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: { isActive: true, warehouseName: existing.warehouseName },
      ip,
    });
  },
};
