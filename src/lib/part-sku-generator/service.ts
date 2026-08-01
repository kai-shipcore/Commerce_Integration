/**
 * Business logic for the Part SKU Generator page: assembling the SKU
 * string from its parts (Part-MakeAbbr-ModelAbbr-Code-Initial-Side, or just
 * the part name for Universal SKUs), the duplicate check, and the
 * isActive-only update/soft-delete flow (all other fields are immutable
 * once a SKU is generated).
 */

import { ValidationError, NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { PartSkusRepository, type PartSkuFilters } from "@/lib/part-sku-generator/repository";
import type { PartSku, Prisma } from "@prisma/client";

export interface Who {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  ip: string | null;
}

export type CreatePartSkuInput =
  | {
      skuType: "Custom";
      partName: string;
      make: string;
      makeAbbr: string;
      model: string;
      modelAbbr: string;
      code: string;
      initial: string;
      side: "D" | "P" | "MD" | "MP" | "Universal";
    }
  | { skuType: "Universal"; partName: string };

function buildSku(input: CreatePartSkuInput): string {
  if (input.skuType === "Universal") return input.partName.trim();
  return [input.partName, input.makeAbbr, input.modelAbbr, input.code, input.initial]
    .concat(input.side !== "Universal" ? [input.side] : [])
    .join("-");
}

export const PartSkuGeneratorService = {
  list(filters: PartSkuFilters): Promise<PartSku[]> {
    return PartSkusRepository.list(filters);
  },

  async create(validated: CreatePartSkuInput, who: Who): Promise<PartSku> {
    const sku = buildSku(validated);

    const existing = await PartSkusRepository.findBySku(sku);
    if (existing) {
      throw new ValidationError(`Part SKU already exists: ${sku}`);
    }

    const partSku = await PartSkusRepository.create({
      ...validated,
      sku,
      createdByName: who.userName ?? who.userEmail ?? null,
    } as Prisma.PartSkuCreateInput);

    void logAudit({
      entityType: "part_sku",
      entityId: String(partSku.id),
      entityLabel: partSku.sku,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { sku: partSku.sku },
      ip: who.ip,
    });

    return partSku;
  },

  async setActive(id: bigint, isActive: boolean, who: Who): Promise<PartSku> {
    const existing = await PartSkusRepository.findById(id);
    if (!existing) throw new NotFoundError("Part SKU not found");

    const partSku = await PartSkusRepository.update(id, { isActive });

    void logAudit({
      entityType: "part_sku",
      entityId: String(id),
      entityLabel: existing.sku,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: isActive ? "status_change" : "delete",
      before: { isActive: existing.isActive },
      after: { isActive: partSku.isActive },
      ip: who.ip,
    });

    return partSku;
  },

  async softDelete(id: bigint, who: Who): Promise<void> {
    const existing = await PartSkusRepository.findById(id);
    if (!existing) throw new NotFoundError("Part SKU not found");

    await PartSkusRepository.update(id, { isActive: false });

    void logAudit({
      entityType: "part_sku",
      entityId: String(id),
      entityLabel: existing.sku,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      before: { isActive: true },
      ip: who.ip,
    });
  },
};
