/**
 * Business logic for factory planning Purchase Orders: the draft -> pending
 * -> approved -> sent workflow state machine, SKU validation against
 * fc_products (and syncing moq/cbm back onto it), and factory upsert-by-name.
 *
 * Authorization here is role-based (isPOApproverRole/isAdminLikeRole), not
 * the generic guardPermission/PermSection system the rest of the app uses —
 * that's preserved as-is rather than folded into a new permission section,
 * since the original route's transitions already encode exactly which
 * actions need elevated privilege.
 */

import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from "@/lib/errors";
import { isPOApproverRole } from "@/components/layout/navigation-config";
import {
  PurchaseOrdersRepository,
  withTransaction,
  type PurchaseOrderHeaderInput,
  type PurchaseOrderItemInput,
} from "@/lib/purchase-orders/repository";

export type WorkflowAction = "request_review" | "approve" | "reject" | "send_to_factory";

export const WORKFLOW_TRANSITIONS: Record<WorkflowAction, { from: string[]; to: string; adminOnly: boolean }> = {
  request_review: { from: ["draft"], to: "pending", adminOnly: false },
  approve: { from: ["draft", "pending"], to: "approved", adminOnly: true },
  reject: { from: ["pending", "approved"], to: "draft", adminOnly: true },
  send_to_factory: { from: ["approved"], to: "sent", adminOnly: true },
};

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    number: row.po_number as string,
    date: serializeDate(row.po_date),
    eta: serializeDate(row.eta_date),
    factoryId: row.factory_id as string | null,
    factory: row.factory_name as string | null,
    origin: row.origin as string | null,
    destination: row.dest_warehouse as string | null,
    manager: row.manager as string | null,
    note: row.note as string | null,
    status: row.status as string,
    createdBy: (row.created_by as string | null) ?? null,
    sentAt: serializeDate(row.sent_at),
    itemCount: Number(row.item_count ?? 0),
    totalQty: Number(row.total_qty ?? 0),
    totalCbm: Number(row.total_cbm ?? 0),
    items: ((row.items ?? []) as Array<{
      id?: string; sku?: string; moq?: number; qty?: number;
      cbm?: string | number; totalCbm?: string | number; unitPrice?: string | number | null;
    }>).map((item) => ({
      id: item.id ?? "",
      sku: item.sku ?? "",
      moq: Number(item.moq ?? 0),
      qty: Number(item.qty ?? 0),
      cbm: Number(item.cbm ?? 0),
      totalCbm: Number(item.totalCbm ?? 0),
      unitPrice: item.unitPrice == null ? null : Number(item.unitPrice),
    })),
  };
}

async function validateAndSyncSkus(items: PurchaseOrderItemInput[], executor: Parameters<typeof PurchaseOrdersRepository.findMissingSkus>[1]) {
  const distinctSkus = [...new Set(items.map((item) => item.sku.trim()))];
  const missingSkus = await PurchaseOrdersRepository.findMissingSkus(distinctSkus, executor);
  if (missingSkus.length > 0) {
    throw new ValidationError(`SKU does not exist in fc_products: ${missingSkus.join(", ")}`);
  }
  for (const item of items) {
    await PurchaseOrdersRepository.syncProductMoqCbm(item.sku.trim(), item.moq, item.cbm, executor);
  }
}

export const PurchaseOrdersService = {
  async getNextNumber(): Promise<string> {
    const seq = await PurchaseOrdersRepository.getNextPoNumberSeq();
    const year = new Date().getFullYear();
    return `PO-${year}-${String(seq).padStart(3, "0")}`;
  },

  async listPurchaseOrders(search: string) {
    await PurchaseOrdersRepository.ensureCreatedByColumn();
    const rows = await PurchaseOrdersRepository.listPurchaseOrders(search);
    return rows.map(mapRow);
  },

  async createPurchaseOrder(header: PurchaseOrderHeaderInput & { items: PurchaseOrderItemInput[] }, createdBy: string | null) {
    return withTransaction(async (client) => {
      await PurchaseOrdersRepository.ensureFactoryCodeSequence();
      await PurchaseOrdersRepository.ensureCreatedByColumn();

      const trimmedFactoryName = header.factory.trim();
      const factoryId = await PurchaseOrdersRepository.upsertFactoryByName(trimmedFactoryName, client);
      const poId = await PurchaseOrdersRepository.insertPurchaseOrder(header, factoryId, trimmedFactoryName, createdBy, client);

      await validateAndSyncSkus(header.items, client);
      for (const item of header.items) {
        await PurchaseOrdersRepository.insertPurchaseOrderItem(poId, item, client);
      }

      return { id: poId, factoryId };
    });
  },

  async transitionWorkflow(id: string, action: WorkflowAction, role: string | undefined) {
    const rule = WORKFLOW_TRANSITIONS[action];

    if (rule.adminOnly && !isPOApproverRole(role)) {
      throw new ForbiddenError("This action requires manager (planner) or admin privileges.");
    }

    return withTransaction(async (client) => {
      const currentStatus = await PurchaseOrdersRepository.getStatusById(id, client);
      if (currentStatus === null) throw new NotFoundError("Purchase order not found");
      if (!rule.from.includes(currentStatus)) {
        throw new ConflictError(`Cannot perform this action from status: ${currentStatus}`);
      }

      await PurchaseOrdersRepository.updateWorkflowStatus(id, rule.to, client);
      return { id, status: rule.to };
    });
  },

  async updatePurchaseOrder(id: string, header: PurchaseOrderHeaderInput & { items: PurchaseOrderItemInput[] }) {
    if (header.status === "sent") {
      throw new ValidationError("Sent purchase orders cannot be edited");
    }

    return withTransaction(async (client) => {
      await PurchaseOrdersRepository.ensureFactoryCodeSequence();

      const existing = await PurchaseOrdersRepository.lockForUpdate(id, client);
      if (!existing) throw new NotFoundError("Purchase order not found");
      if (existing.status === "sent") throw new ConflictError("Sent purchase orders cannot be edited");

      await validateAndSyncSkus(header.items, client);

      const trimmedFactoryName = header.factory.trim();
      const factoryId = await PurchaseOrdersRepository.upsertFactoryByName(trimmedFactoryName, client);

      await PurchaseOrdersRepository.updateHeader(id, header, factoryId, trimmedFactoryName, client);
      await PurchaseOrdersRepository.deleteItemsByPoId(id, client);
      for (const item of header.items) {
        await PurchaseOrdersRepository.insertPurchaseOrderItem(id, item, client);
      }

      return { id, factoryId };
    });
  },

  async deletePurchaseOrder(id: string) {
    return withTransaction(async (client) => {
      const existing = await PurchaseOrdersRepository.lockForDelete(id, client);
      if (!existing) throw new NotFoundError("Purchase order not found");

      await PurchaseOrdersRepository.deleteCascade(id, client);

      return { id: existing.id, number: existing.po_number };
    });
  },
};
