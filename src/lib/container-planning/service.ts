/**
 * Business logic for the Container Planning domain: container CRUD, the
 * focused PATCH sub-contracts multiplexed onto /api/containers (status-only,
 * color-only, confirmed-only, details-only, eta-only, eta-lax-lgb-only, and full
 * replace), container item mutations, auto-fill, container audit history,
 * and the manual allocate/deallocate flow.
 *
 * PATCH's shared containers API also serves Demand Planning (requests carry
 * an `x-planning-permission-context: demand-planning` header, checked at the
 * controller layer) — this service does not need to know which UI a call
 * came from, only what to do.
 */

import { logContainerAudit } from "@/lib/container-audit";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
import { isPOApproverRole } from "@/components/layout/navigation-config";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "@/lib/errors";
import {
  ContainerPlanningRepository,
  withTransaction,
  type ContainerListFilters,
  type ContainerListRow,
  type ContainerSaveInput,
  type ContainerDetailsInput,
  type ExistingContainerRow,
  type AuditHistoryFilters,
  type AuditHistoryRow,
} from "@/lib/container-planning/repository";

export type ContainerStatus = "draft" | "final-list-sent" | "packing-list-received" | "complete";

export interface Who {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  ip: string | null;
}

function toDbStatus(status: ContainerStatus): string {
  if (status === "final-list-sent") return "packing_received";
  if (status === "packing-list-received") return "shipped";
  if (status === "complete") return "complete";
  return "draft";
}

function fromDbStatus(s: string): ContainerStatus {
  if (s === "shipped") return "packing-list-received";
  if (s === "packing_received") return "final-list-sent";
  if (s === "complete") return "complete";
  return "draft";
}

export const ContainerPlanningService = {
  // ─── List ───────────────────────────────────────────────────────────

  listContainers(filters: ContainerListFilters): Promise<ContainerListRow[]> {
    return ContainerPlanningRepository.listContainers(filters);
  },

  // ─── Create ─────────────────────────────────────────────────────────

  async createContainer(input: ContainerSaveInput, who: Who): Promise<{ id: string }> {
    const createStatus = input.status ?? "draft";
    if (createStatus === "packing-list-received") {
      throw new ValidationError("A Packing List file is required before changing the status to Shipped.");
    }
    const distinctSkus = [...new Set(input.items.map((item) => item.sku.trim().toUpperCase()))];

    const containerId = await withTransaction(async (client) => {
      const missingSkus = await ContainerPlanningRepository.findMissingSkus(distinctSkus, client);
      if (missingSkus.length > 0) {
        throw new ValidationError(`SKU does not exist in fc_products: ${missingSkus.join(", ")}`);
      }

      const id = await ContainerPlanningRepository.insertContainer(input, toDbStatus(createStatus), client);
      await ContainerPlanningRepository.insertContainerItems(id, input.items, client);
      return id;
    }).catch((error: unknown) => {
      if ((error as { constraint?: string })?.constraint === "fc_containers_number_uk") {
        throw new ConflictError("Container number already exists.");
      }
      throw error;
    });

    await invalidatePlanningDashboardCache();

    void logContainerAudit({
      containerId,
      containerNumber: input.number.trim(),
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: {
        status: createStatus,
        eta: input.eta,
        factory: input.factory ?? null,
        destWarehouse: input.destination ?? null,
        skuCount: input.items.length,
        totalQty: input.items.reduce((s, i) => s + i.qty, 0),
      },
      ip: who.ip,
    });

    return { id: containerId };
  },

  // ─── PATCH branches ─────────────────────────────────────────────────

  async getExistingOrThrow(id: string): Promise<ExistingContainerRow> {
    const existing = await ContainerPlanningRepository.getContainer(id);
    if (!existing) throw new NotFoundError("Container not found");
    return existing;
  },

  assertNotComplete(existing: ExistingContainerRow): void {
    if (existing.status === "complete") {
      throw new ForbiddenError("Stock-in completed containers cannot be modified.");
    }
  },

  async updateStatus(id: string, existing: ExistingContainerRow, newStatus: ContainerStatus, who: Who): Promise<{ id: string }> {
    const oldStatus = fromDbStatus(existing.status);
    if (newStatus === "packing-list-received" && oldStatus !== newStatus && !existing.packingListFileId) {
      throw new ValidationError("A Packing List file is required before changing the status to Shipped.");
    }
    const updated = await ContainerPlanningRepository.updateStatus(id, toDbStatus(newStatus));
    if (!updated) throw new NotFoundError("Container not found");

    await invalidatePlanningDashboardCache();

    if (oldStatus !== newStatus) {
      void logContainerAudit({
        containerId: id,
        containerNumber: existing.containerNumber,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: "status_change",
        before: { status: oldStatus },
        after: { status: newStatus },
        ip: who.ip,
      });
    }

    return { id };
  },

  async uploadPackingList(id: string, file: File, who: Who): Promise<{ id: string; originalName: string }> {
    const existing = await ContainerPlanningRepository.getContainer(id);
    if (!existing) throw new NotFoundError("Container not found");
    this.assertNotComplete(existing);

    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      throw new ValidationError("Packing List must be an Excel or CSV file.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) throw new ValidationError("Packing List file is empty.");
    if (buffer.byteLength > 20 * 1024 * 1024) throw new ValidationError("Packing List file must be 20 MB or smaller.");

    const saved = await ContainerPlanningRepository.upsertPackingListFile({
      containerId: id,
      originalName: file.name,
      mimeType: file.type || null,
      sizeBytes: buffer.byteLength,
      fileData: buffer,
      uploadedBy: who.userId,
    });

    void logContainerAudit({
      containerId: id,
      containerNumber: existing.containerNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "packing_list_upload",
      before: existing.packingListFileId ? { fileId: existing.packingListFileId } : null,
      after: { fileId: saved.id, fileName: saved.originalName },
      ip: who.ip,
    });

    return saved;
  },

  findPackingListFile(containerId: string) {
    return ContainerPlanningRepository.getPackingListFile(containerId);
  },

  async deletePackingList(id: string, who: Who): Promise<{ id: string }> {
    const existing = await ContainerPlanningRepository.getContainer(id);
    if (!existing) throw new NotFoundError("Container not found");
    this.assertNotComplete(existing);
    if (fromDbStatus(existing.status) === "packing-list-received") {
      throw new ConflictError("The Packing List cannot be deleted while the container status is Shipped.");
    }

    const deleted = await ContainerPlanningRepository.deletePackingListFile(id);
    if (!deleted) throw new NotFoundError("Packing List file not found");

    void logContainerAudit({
      containerId: id,
      containerNumber: existing.containerNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "packing_list_delete",
      before: { fileId: deleted.id, fileName: deleted.originalName },
      after: null,
      ip: who.ip,
    });

    return { id };
  },

  async updateCalendarColor(id: string, existing: ExistingContainerRow, calendarColor: string | null, who: Who): Promise<{ id: string }> {
    const updated = await ContainerPlanningRepository.updateCalendarColor(id, calendarColor);
    if (!updated) throw new NotFoundError("Container not found");

    if (existing.calendarColor !== calendarColor) {
      void logContainerAudit({
        containerId: id,
        containerNumber: existing.containerNumber,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: "color_change",
        before: { calendarColor: existing.calendarColor },
        after: { calendarColor },
        ip: who.ip,
      });
    }

    return { id };
  },

  async updateConfirmed(
    id: string,
    existing: ExistingContainerRow,
    confirmedDate: string | null,
    confirmedTime: string | null,
    who: Who,
  ): Promise<{ id: string }> {
    const updated = await ContainerPlanningRepository.updateConfirmed(id, confirmedDate, confirmedTime);
    if (!updated) throw new NotFoundError("Container not found");

    await invalidatePlanningDashboardCache();

    const oldConfirmedTime = existing.confirmedTime ? existing.confirmedTime.slice(0, 5) : null;
    if (existing.confirmedDate !== confirmedDate || oldConfirmedTime !== confirmedTime) {
      void logContainerAudit({
        containerId: id,
        containerNumber: existing.containerNumber,
        userId: who.userId,
        userName: who.userName,
        userEmail: who.userEmail,
        action: "confirmed_change",
        before: { confirmedDate: existing.confirmedDate, confirmedTime: oldConfirmedTime },
        after: { confirmedDate, confirmedTime },
        ip: who.ip,
      });
    }

    return { id };
  },

  async updateDetails(id: string, existing: ExistingContainerRow, details: ContainerDetailsInput, who: Who): Promise<{ id: string; updated: "details" }> {
    const updated = await ContainerPlanningRepository.updateDetails(id, details);
    if (!updated) throw new NotFoundError("Container not found");

    await invalidatePlanningDashboardCache();

    const beforeSnap = {
      status: fromDbStatus(existing.status), eta: existing.eta,
      factory: existing.factoryName, destWarehouse: existing.destWarehouse,
      cbmCapacity: existing.cbmCapacity, note: existing.note,
      estLoading: existing.estLoading, etdNgb: existing.etdNgb, etaLaxLgb: existing.etaLaxLgb,
    };
    const afterSnap = {
      status: fromDbStatus(existing.status), eta: details.eta,
      factory: details.factory ?? null, destWarehouse: details.destination ?? null,
      cbmCapacity: details.cbmCapacity, note: details.note ?? null,
      estLoading: details.estLoading ?? null, etdNgb: details.etdNgb ?? null, etaLaxLgb: details.etaLaxLgb ?? null,
    };

    const statusChanged = beforeSnap.status !== afterSnap.status;
    if (statusChanged) {
      void logContainerAudit({
        containerId: id, containerNumber: existing.containerNumber,
        userId: who.userId, userName: who.userName, userEmail: who.userEmail,
        action: "status_change",
        before: { status: beforeSnap.status }, after: { status: afterSnap.status },
        ip: who.ip,
      });
    }
    const etaChanged = beforeSnap.eta !== afterSnap.eta;
    if (etaChanged) {
      void logContainerAudit({
        containerId: id, containerNumber: details.number,
        userId: who.userId, userName: who.userName, userEmail: who.userEmail,
        action: "eta_change",
        before: { eta: beforeSnap.eta }, after: { eta: afterSnap.eta },
        ip: who.ip,
      });
    }
    const otherFields = ["factory", "destWarehouse", "cbmCapacity", "note", "estLoading", "etdNgb", "etaLaxLgb"] as const;
    const otherChanged = otherFields.some((k) => String(beforeSnap[k] ?? "") !== String(afterSnap[k] ?? ""));
    if (otherChanged) {
      void logContainerAudit({
        containerId: id, containerNumber: details.number,
        userId: who.userId, userName: who.userName, userEmail: who.userEmail,
        action: "details_update",
        before: beforeSnap as Record<string, unknown>,
        after: afterSnap as Record<string, unknown>,
        ip: who.ip,
      });
    }

    return { id, updated: "details" };
  },

  async updateEta(id: string, existing: ExistingContainerRow, eta: string, who: Who): Promise<{ id: string }> {
    const updated = await ContainerPlanningRepository.updateEta(id, eta);
    if (!updated) throw new NotFoundError("Container not found");

    await invalidatePlanningDashboardCache();

    if (existing.eta !== eta) {
      void logContainerAudit({
        containerId: id, containerNumber: existing.containerNumber,
        userId: who.userId, userName: who.userName, userEmail: who.userEmail,
        action: "eta_change",
        before: { eta: existing.eta }, after: { eta },
        ip: who.ip,
      });
    }

    return { id };
  },

  async updateEtaLaxLgb(id: string, existing: ExistingContainerRow, etaLaxLgbDate: string, who: Who): Promise<{ id: string }> {
    const updated = await ContainerPlanningRepository.updateEtaLaxLgb(id, etaLaxLgbDate);
    if (!updated) throw new NotFoundError("Container not found");

    await invalidatePlanningDashboardCache();

    if (existing.etaLaxLgb !== etaLaxLgbDate) {
      void logContainerAudit({
        containerId: id, containerNumber: existing.containerNumber,
        userId: who.userId, userName: who.userName, userEmail: who.userEmail,
        action: "eta_lax_lgb_change",
        before: { etaLaxLgbDate: existing.etaLaxLgb }, after: { etaLaxLgbDate },
        ip: who.ip,
      });
    }

    return { id };
  },

  async replaceContainer(id: string, existing: ExistingContainerRow, validated: ContainerSaveInput, who: Who): Promise<{ id: string }> {
    const distinctSkus = [...new Set(validated.items.map((item) => item.sku.trim().toUpperCase()))];

    const itemsBefore = await withTransaction(async (client) => {
      const locked = await ContainerPlanningRepository.lockContainer(id, client);
      if (!locked) throw new NotFoundError("Container not found");

      const before = await ContainerPlanningRepository.getItemSummary(id, client);

      const missingSkus = await ContainerPlanningRepository.findMissingSkus(distinctSkus, client);
      if (missingSkus.length > 0) {
        throw new ValidationError(`SKU does not exist in fc_products: ${missingSkus.join(", ")}`);
      }

      await ContainerPlanningRepository.replaceContainerFull(id, validated, client);
      return before;
    });

    await invalidatePlanningDashboardCache();

    const detailsBefore = {
      status: fromDbStatus(existing.status), eta: existing.eta,
    };
    const detailsAfter = {
      status: fromDbStatus(existing.status), eta: validated.eta,
    };
    if (detailsBefore.status !== detailsAfter.status) {
      void logContainerAudit({
        containerId: id, containerNumber: validated.number.trim(),
        userId: who.userId, userName: who.userName, userEmail: who.userEmail,
        action: "status_change",
        before: { status: detailsBefore.status }, after: { status: detailsAfter.status },
        ip: who.ip,
      });
    }
    if (detailsBefore.eta !== detailsAfter.eta) {
      void logContainerAudit({
        containerId: id, containerNumber: validated.number.trim(),
        userId: who.userId, userName: who.userName, userEmail: who.userEmail,
        action: "eta_change",
        before: { eta: detailsBefore.eta }, after: { eta: detailsAfter.eta },
        ip: who.ip,
      });
    }
    if (validated.items.length > 0) {
      const itemsAfter = {
        skuCount: validated.items.length,
        totalQty: validated.items.reduce((s, i) => s + i.qty, 0),
      };
      if (itemsBefore.skuCount !== itemsAfter.skuCount || itemsBefore.totalQty !== itemsAfter.totalQty) {
        void logContainerAudit({
          containerId: id, containerNumber: validated.number.trim(),
          userId: who.userId, userName: who.userName, userEmail: who.userEmail,
          action: "items_update",
          before: itemsBefore as Record<string, unknown>,
          after: itemsAfter as Record<string, unknown>,
          ip: who.ip,
        });
      }
    }

    return { id };
  },

  // ─── Delete ─────────────────────────────────────────────────────────

  async deleteContainer(id: string, who: Who & { role: string | null }): Promise<{ id: string }> {
    const { deletedId, existing } = await withTransaction(async (client) => {
      const found = await ContainerPlanningRepository.getContainerForDelete(id, client);
      if (!found) throw new NotFoundError("Container not found");

      if (found.status === "complete" && !isPOApproverRole(who.role)) {
        throw new ForbiddenError("Only Planner or Admin can delete Stock-in completed containers.");
      }

      const deletedId = await ContainerPlanningRepository.deleteContainerCascade(id, client);
      return { deletedId, existing: found };
    });

    await invalidatePlanningDashboardCache();

    void logContainerAudit({
      containerId: id,
      containerNumber: existing.containerNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      before: {
        status: fromDbStatus(existing.status),
        eta: existing.eta,
        containerNumber: existing.containerNumber,
      },
      ip: who.ip,
    });

    return { id: deletedId };
  },

  // ─── Audit history ──────────────────────────────────────────────────

  listHistory(containerId: string, filters: AuditHistoryFilters): Promise<AuditHistoryRow[]> {
    return ContainerPlanningRepository.listAuditLog(containerId, filters);
  },

  async addHistoryNote(containerId: string, note: string, who: Who): Promise<void> {
    const containerNumber = await ContainerPlanningRepository.getContainerNumber(containerId);
    if (containerNumber === null) throw new NotFoundError("Container not found");

    await logContainerAudit({
      containerId,
      containerNumber,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "note_added",
      note,
      ip: who.ip,
    });
  },

  async editHistoryNote(noteId: string, containerId: string, note: string, userId: string): Promise<void> {
    const updated = await ContainerPlanningRepository.updateNote(noteId, containerId, note, userId);
    if (!updated) throw new NotFoundError("Note not found");
  },

  async deleteHistoryNote(noteId: string, containerId: string, userId: string): Promise<void> {
    const deleted = await ContainerPlanningRepository.softDeleteNote(noteId, containerId, userId);
    if (!deleted) throw new NotFoundError("Note not found");
  },

  // ─── Container items ────────────────────────────────────────────────

  async upsertItem(
    containerId: number,
    masterSku: string,
    qty: number,
    rawCbmUnit: number,
    skuMemo: string | null,
  ): Promise<{ item_id: number; qty: number; allocated_qty: number; cbm_unit: number; total_cbm: number; sku_memo: string | null }> {
    const normalizedSku = masterSku.toUpperCase();

    const result = await withTransaction(async (client) => {
      let cbmUnit = rawCbmUnit;
      if (cbmUnit <= 0) {
        cbmUnit = (await ContainerPlanningRepository.getProductCbm(normalizedSku, client)) ?? 0;
      }
      if (cbmUnit <= 0) {
        throw new ValidationError("No CBM per unit on file for this SKU. Set it in SKU Master first.");
      }

      const row = await ContainerPlanningRepository.upsertItem(containerId, normalizedSku, qty, cbmUnit, skuMemo, client);
      const allocatedQty = await ContainerPlanningRepository.syncRemainingAllocationForContainerItem(client, {
        containerId,
        masterSku: normalizedSku,
        targetQty: qty,
      });

      return { row, allocatedQty };
    });

    await invalidatePlanningDashboardCache();

    return {
      item_id: result.row.id,
      qty,
      allocated_qty: result.allocatedQty,
      cbm_unit: result.row.cbmUnit,
      total_cbm: result.row.totalCbm,
      sku_memo: result.row.skuMemo,
    };
  },

  async updateItem(itemId: number, qty: number, skuMemo: string | null): Promise<{ qty: number; allocated_qty: number; cbm_unit: number; total_cbm: number }> {
    const result = await withTransaction(async (client) => {
      const existing = await ContainerPlanningRepository.getItemForUpdate(itemId, client);
      if (!existing) throw new NotFoundError("Item not found");

      const updated = await ContainerPlanningRepository.updateItemQty(itemId, qty, skuMemo, client);
      const allocatedQty = await ContainerPlanningRepository.syncRemainingAllocationForContainerItem(client, {
        containerId: existing.containerId,
        masterSku: existing.masterSku,
        targetQty: qty,
      });

      return { updated, allocatedQty };
    });

    await invalidatePlanningDashboardCache();

    return { qty, allocated_qty: result.allocatedQty, cbm_unit: result.updated.cbmUnit, total_cbm: result.updated.totalCbm };
  },

  async deleteItem(itemId: number): Promise<void> {
    await withTransaction(async (client) => {
      const existing = await ContainerPlanningRepository.getItemForUpdate(itemId, client);
      // DELETE is intentionally idempotent. The dashboard can briefly hold a
      // cached item id after another request already removed the row; treating
      // that stale id as success keeps the cleared cell from rolling back.
      if (!existing) return;

      await ContainerPlanningRepository.deleteRemainingAllocationsForContainerItem(client, {
        containerId: existing.containerId,
        masterSku: existing.masterSku,
      });
      await ContainerPlanningRepository.deleteItem(itemId, client);
    });

    await invalidatePlanningDashboardCache();
  },

  // ─── Auto-fill ──────────────────────────────────────────────────────

  async autoFill(
    containerId: number,
    items: Array<{ sku: string; qty: number }>,
  ): Promise<Array<{ sku: string; item_id: number; qty: number; cbm_unit: number; total_cbm: number; allocated_qty: number }>> {
    const skus = items.map((i) => i.sku.toUpperCase());

    const results = await withTransaction(async (client) => {
      const cbmMap = await ContainerPlanningRepository.getProductCbmMap(skus, client);
      const out: Array<{ sku: string; item_id: number; qty: number; cbm_unit: number; total_cbm: number; allocated_qty: number }> = [];

      for (const item of items) {
        const sku = item.sku.toUpperCase();
        const cbmUnit = cbmMap.get(sku) ?? 0;
        if (cbmUnit <= 0) continue;

        const row = await ContainerPlanningRepository.upsertItemForAutoFill(containerId, sku, item.qty, cbmUnit, client);
        const allocatedQty = await ContainerPlanningRepository.syncRemainingAllocationForContainerItem(client, {
          containerId,
          masterSku: sku,
          targetQty: item.qty,
        });

        out.push({ sku, item_id: row.id, qty: item.qty, cbm_unit: row.cbmUnit, total_cbm: row.totalCbm, allocated_qty: allocatedQty });
      }

      return out;
    });

    await invalidatePlanningDashboardCache();

    return results;
  },

  // ─── Manual allocate / deallocate ───────────────────────────────────

  async allocateStock(containerId: string, allocations: Array<{ stockId: string; qty: number }>): Promise<void> {
    await withTransaction(async (client) => {
      const status = await ContainerPlanningRepository.lockContainerStatus(containerId, client);
      if (status === null) throw new NotFoundError("Container not found");
      if (status !== "draft") throw new ConflictError("Available stock can be added only while the container is Draft.");

      const qtyByStockId = new Map<string, number>();
      for (const requested of allocations) {
        qtyByStockId.set(requested.stockId, (qtyByStockId.get(requested.stockId) ?? 0) + requested.qty);
      }

      const stockIds = [...qtyByStockId.keys()];
      const stockRows = await ContainerPlanningRepository.lockAvailableStockForAllocate(stockIds, client);

      if (stockRows.length !== stockIds.length) {
        throw new ValidationError("One or more available stock records were not found.");
      }

      const itemQtyBySku = new Map<string, { qty: number; cbm: number }>();
      for (const stock of stockRows) {
        const requestedQty = qtyByStockId.get(stock.id) ?? 0;
        if (requestedQty > stock.availableQty) {
          throw new ValidationError(`Requested quantity exceeds available quantity for ${stock.masterSku}`);
        }
        const current = itemQtyBySku.get(stock.masterSku);
        itemQtyBySku.set(stock.masterSku, { qty: (current?.qty ?? 0) + requestedQty, cbm: stock.cbm });
      }

      const allocationQtys = stockIds.map((stockId) => qtyByStockId.get(stockId) ?? 0);
      await ContainerPlanningRepository.bulkIncrementAllocations(containerId, stockIds, allocationQtys, client);

      const itemSkus = [...itemQtyBySku.keys()];
      const itemQtys = itemSkus.map((sku) => itemQtyBySku.get(sku)?.qty ?? 0);
      const itemCbms = itemSkus.map((sku) => itemQtyBySku.get(sku)?.cbm ?? 0);
      await ContainerPlanningRepository.bulkIncrementItems(containerId, itemSkus, itemQtys, itemCbms, client);
    });

    await invalidatePlanningDashboardCache();
  },

  async deallocateStock(allocationIds: string[]): Promise<{ containerId: string; deletedCount: number }> {
    const containerId = await withTransaction(async (client) => {
      const rows = await ContainerPlanningRepository.lockAllocationsForDeallocate(allocationIds, client);
      if (rows.length !== allocationIds.length) throw new NotFoundError("Allocation not found");

      const containerIds = new Set(rows.map((row) => row.containerId));
      if (containerIds.size !== 1) throw new ValidationError("Selected allocations must belong to the same container.");

      const containerId = rows[0].containerId;
      if (rows.some((row) => row.status !== "draft")) {
        throw new ConflictError("Allocated stock can be removed only while the container is Draft.");
      }

      const removeQtyBySku = new Map<string, number>();
      for (const row of rows) {
        removeQtyBySku.set(row.masterSku, (removeQtyBySku.get(row.masterSku) ?? 0) + row.qty);
      }

      const skus = [...removeQtyBySku.keys()];
      const removeQtys = skus.map((sku) => removeQtyBySku.get(sku) ?? 0);
      const itemQtyBySku = await ContainerPlanningRepository.getItemQtysBySku(containerId, skus, client);
      const inconsistentSku = skus.find((sku) => (itemQtyBySku.get(sku) ?? 0) < (removeQtyBySku.get(sku) ?? 0));
      if (inconsistentSku) {
        throw new ConflictError("Container item quantity is inconsistent with allocated stock.");
      }

      await ContainerPlanningRepository.deleteAllocationsByIds(allocationIds, client);
      await ContainerPlanningRepository.decrementOrDeleteItemsBySku(containerId, skus, removeQtys, client);

      return containerId;
    });

    await invalidatePlanningDashboardCache();

    return { containerId, deletedCount: allocationIds.length };
  },
};
