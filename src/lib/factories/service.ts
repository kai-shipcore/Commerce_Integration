import { FactoriesRepository, type FactoryRow } from "@/lib/factories/repository";
import { logAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";

export interface ListFactoriesQuery {
  active: string | null;
  search: string;
}

export interface CreateFactoryInput {
  factoryName: string;
  factoryCode?: string;
  origin?: string;
  contactName?: string;
  email?: string;
  phone?: string;
}

export interface UpdateFactoryInput {
  factoryName: string;
  origin?: string;
  contactName?: string;
  email?: string;
  phone?: string;
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function serializeFactory(row: FactoryRow) {
  return {
    id: row.id,
    factoryCode: row.factory_code,
    factoryName: row.factory_name,
    origin: row.origin,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    isActive: row.is_active,
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
  };
}

/**
 * Business logic for factory master records: normalizes filters, shapes
 * Repository rows into the API response contract, enforces duplicate-name
 * rules, and writes audit log entries for mutations.
 */
export const FactoriesService = {
  async listFactories(query: ListFactoriesQuery) {
    await FactoriesRepository.ensureFactoryCodes();

    const active = query.active === null ? null : query.active === "true";
    const rows = await FactoriesRepository.listFactories({ active, search: query.search.trim() });
    return rows.map(serializeFactory);
  },

  async createFactory(input: CreateFactoryInput, ip: string | null) {
    await FactoriesRepository.ensureFactoryCodes();

    const factoryName = input.factoryName.trim();
    const row = await FactoriesRepository.createFactory({
      factoryCode: input.factoryCode?.trim() || null,
      factoryName,
      origin: input.origin?.trim() || null,
      contactName: input.contactName?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
    });

    const created = serializeFactory(row);
    const session = await auth();
    void logAudit({
      entityType: "factory",
      entityId: created.id,
      entityLabel: created.factoryName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { factoryCode: created.factoryCode, factoryName: created.factoryName, origin: created.origin },
      ip,
    });
    return created;
  },

  async updateFactory(id: string, input: UpdateFactoryInput, ip: string | null) {
    const existing = await FactoriesRepository.findById(id);
    if (!existing) throw new NotFoundError("Factory not found");
    const beforeData = serializeFactory(existing);

    const factoryName = input.factoryName.trim();
    if (await FactoriesRepository.existsByNameExcludingId(factoryName, id)) {
      throw new ValidationError(`Factory name already exists: ${factoryName}`);
    }

    const row = await FactoriesRepository.updateFactory(id, {
      factoryName,
      origin: input.origin?.trim() || null,
      contactName: input.contactName?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
    });
    if (!row) throw new NotFoundError("Factory not found");

    const updated = serializeFactory(row);
    const session = await auth();
    void logAudit({
      entityType: "factory",
      entityId: id,
      entityLabel: updated.factoryName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "update",
      before: { factoryName: beforeData.factoryName, origin: beforeData.origin, contactName: beforeData.contactName, email: beforeData.email, phone: beforeData.phone },
      after: { factoryName: updated.factoryName, origin: updated.origin, contactName: updated.contactName, email: updated.email, phone: updated.phone },
      ip,
    });
    return updated;
  },

  async setActive(id: string, isActive: boolean, ip: string | null) {
    const row = await FactoriesRepository.setActive(id, isActive);
    if (!row) throw new NotFoundError("Factory not found");

    const patched = serializeFactory(row);
    const session = await auth();
    void logAudit({
      entityType: "factory",
      entityId: id,
      entityLabel: patched.factoryName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: isActive ? "status_change" : "delete",
      before: { isActive: !isActive },
      after: { isActive },
      ip,
    });
    return patched;
  },
};
