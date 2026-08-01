/**
 * Shared business logic for the three /production/parts-codes master-data
 * tables (Part, Code, Designer Initial): list/create/update(status|delete|edit)/
 * soft-delete, all with the same validate → dup-check → write → audit shape.
 *
 * The three entities differ in a few specific, deliberately-preserved ways
 * (not normalized away): whether the key field is uppercased, which fields
 * appear in audit before/after payloads, and their user-facing messages.
 * Those differences are captured per-entity in MASTER_DATA_CONFIGS below —
 * confirmed by reading all three original route pairs, not assumed.
 */

import { ValidationError, NotFoundError } from "@/lib/errors";
import { logAudit, type AuditEntityType } from "@/lib/audit";
import { PartsRepository, CodesRepository, DesignerInitialsRepository } from "@/lib/parts-codes/repository";

export interface MasterDataRow {
  id: bigint;
  isActive: boolean;
  [key: string]: unknown;
}

interface MasterDataRepo {
  list(search: string, active: boolean | null): Promise<MasterDataRow[]>;
  findByKey(key: string): Promise<MasterDataRow | null>;
  findById(id: bigint): Promise<MasterDataRow | null>;
  create(data: Record<string, unknown>): Promise<MasterDataRow>;
  update(id: bigint, data: Record<string, unknown>): Promise<MasterDataRow>;
}

interface MasterDataConfig {
  entityType: AuditEntityType;
  keyField: string;
  uppercaseKey: boolean;
  notFoundMessage: string;
  alreadyExistsMessage: (value: string) => string;
  deactivatedMessage: string;
  buildCreateAfter: (row: MasterDataRow) => Record<string, unknown>;
  buildUpdateBeforeAfter: (existing: MasterDataRow, updated: MasterDataRow) => { before: Record<string, unknown>; after: Record<string, unknown> };
  buildDeleteBefore: (existing: MasterDataRow) => Record<string, unknown>;
  repo: MasterDataRepo;
}

export interface Who {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  ip: string | null;
}

export const MASTER_DATA_CONFIGS: Record<"part" | "code" | "designerInitial", MasterDataConfig> = {
  part: {
    entityType: "production_part",
    keyField: "partName",
    uppercaseKey: false,
    notFoundMessage: "Part not found",
    alreadyExistsMessage: (value) => `Part already exists: ${value}`,
    deactivatedMessage: "Part deactivated successfully",
    buildCreateAfter: (row) => ({ description: row.description }),
    buildUpdateBeforeAfter: (existing, updated) => ({
      before: { partName: existing.partName, description: existing.description },
      after: { partName: updated.partName, description: updated.description },
    }),
    buildDeleteBefore: (existing) => ({ isActive: true, partName: existing.partName }),
    repo: PartsRepository as unknown as MasterDataRepo,
  },
  code: {
    entityType: "production_code",
    keyField: "code",
    uppercaseKey: true,
    notFoundMessage: "Code not found",
    alreadyExistsMessage: (value) => `Code already exists: ${value}`,
    deactivatedMessage: "Code deactivated successfully",
    buildCreateAfter: (row) => ({ description: row.description }),
    buildUpdateBeforeAfter: (existing, updated) => ({
      before: { description: existing.description },
      after: { description: updated.description },
    }),
    buildDeleteBefore: () => ({ isActive: true }),
    repo: CodesRepository as unknown as MasterDataRepo,
  },
  designerInitial: {
    entityType: "designer_initial",
    keyField: "initial",
    uppercaseKey: true,
    notFoundMessage: "Designer initial not found",
    alreadyExistsMessage: (value) => `Initial already exists: ${value}`,
    deactivatedMessage: "Designer initial deactivated successfully",
    buildCreateAfter: (row) => ({ designerName: row.designerName }),
    buildUpdateBeforeAfter: (existing, updated) => ({
      before: { designerName: existing.designerName },
      after: { designerName: updated.designerName },
    }),
    buildDeleteBefore: (existing) => ({ isActive: true, designerName: existing.designerName }),
    repo: DesignerInitialsRepository as unknown as MasterDataRepo,
  },
};

export const MasterDataService = {
  list(config: MasterDataConfig, search: string, active: boolean | null): Promise<MasterDataRow[]> {
    return config.repo.list(search, active);
  },

  async create(config: MasterDataConfig, validated: Record<string, unknown>, who: Who): Promise<MasterDataRow> {
    const data = { ...validated };
    if (config.uppercaseKey) {
      data[config.keyField] = String(data[config.keyField]).toUpperCase();
    }
    const keyValue = String(data[config.keyField]);

    const existing = await config.repo.findByKey(keyValue);
    if (existing) {
      throw new ValidationError(config.alreadyExistsMessage(keyValue));
    }

    const row = await config.repo.create(data);

    void logAudit({
      entityType: config.entityType,
      entityId: String(row.id),
      entityLabel: String(row[config.keyField]),
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: config.buildCreateAfter(row),
      ip: who.ip,
    });

    return row;
  },

  async update(config: MasterDataConfig, id: bigint, validated: Record<string, unknown>, who: Who): Promise<MasterDataRow> {
    const isStatusOnly = Object.keys(validated).length === 1 && validated.isActive !== undefined;
    const existing = await config.repo.findById(id);
    if (!existing) throw new NotFoundError(config.notFoundMessage);

    const data = { ...validated };
    if (typeof data[config.keyField] === "string") {
      const keyValue = config.uppercaseKey ? (data[config.keyField] as string).toUpperCase() : (data[config.keyField] as string);
      const duplicate = await config.repo.findByKey(keyValue);
      if (duplicate && duplicate.id !== id) {
        throw new ValidationError(config.alreadyExistsMessage(keyValue));
      }
      data[config.keyField] = keyValue;
    }

    const updated = await config.repo.update(id, data);

    const auditAction = isStatusOnly ? (validated.isActive ? "status_change" : "delete") : "update";
    const { before, after } = isStatusOnly
      ? { before: { isActive: !validated.isActive }, after: { isActive: validated.isActive } }
      : config.buildUpdateBeforeAfter(existing, updated);

    void logAudit({
      entityType: config.entityType,
      entityId: String(id),
      entityLabel: String(existing[config.keyField]),
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: auditAction,
      before,
      after,
      ip: who.ip,
    });

    return updated;
  },

  async softDelete(config: MasterDataConfig, id: bigint, who: Who): Promise<void> {
    const existing = await config.repo.findById(id);
    if (!existing) throw new NotFoundError(config.notFoundMessage);

    await config.repo.update(id, { isActive: false });

    void logAudit({
      entityType: config.entityType,
      entityId: String(id),
      entityLabel: String(existing[config.keyField]),
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      before: config.buildDeleteBefore(existing),
      ip: who.ip,
    });
  },
};
