/**
 * Business logic for the Product List domain. Audit logging is
 * intentionally present only on Product and Project create/delete —
 * checklist items and configuration rows (ProjectPart) are trivial
 * sub-rows in the original routes and were never audited, so that's
 * preserved here rather than added as a "consistency" fix.
 */

import { ValidationError, NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { ProductListRepository } from "@/lib/product-list/repository";
import type { Prisma } from "@prisma/client";

export interface Who {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  ip: string | null;
}

export const ProductListService = {
  listProducts(active: boolean | null) {
    return ProductListRepository.listProducts(active);
  },

  async createProduct(validated: { make: string; model: string; yearGeneration?: string }, who: Who) {
    const product = await ProductListRepository.createProduct(validated);

    void logAudit({
      entityType: "product",
      entityId: String(product.id),
      entityLabel: `${product.make} ${product.model}`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { make: product.make, model: product.model, fNumber: product.fNumber },
      ip: who.ip,
    });

    return product;
  },

  async updateProduct(id: bigint, validated: Prisma.ProductUpdateInput & { fNumber?: string }) {
    const existing = await ProductListRepository.findProductById(id);
    if (!existing) throw new NotFoundError("Product not found");

    if (validated.fNumber !== undefined) {
      const withProjects = await ProductListRepository.findProductWithProjectPartStatuses(id);
      const allComplete =
        !!withProjects &&
        withProjects.projects.length > 0 &&
        withProjects.projects.every(
          (p) => p.parts.length > 0 && p.parts.every((part) => part.status === "Scanned"),
        );
      if (!allComplete) {
        throw new ValidationError("Cannot set F Number until every row's parts are all Scanned.");
      }
    }

    return ProductListRepository.updateProduct(id, validated);
  },

  async deleteProduct(id: bigint, who: Who): Promise<void> {
    const existing = await ProductListRepository.findProductById(id);
    if (!existing) throw new NotFoundError("Product not found");

    await ProductListRepository.deleteProduct(id);

    void logAudit({
      entityType: "product",
      entityId: String(id),
      entityLabel: `${existing.make} ${existing.model}${existing.fNumber ? ` — ${existing.fNumber}` : ""}`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      ip: who.ip,
    });
  },

  async createProject(
    productId: bigint,
    validated: { seatRow: string; submodel?: string; parts: Prisma.ProjectPartCreateWithoutProjectInput[]; checklistItems: Prisma.ProjectChecklistItemCreateWithoutProjectInput[] },
    who: Who,
  ) {
    const product = await ProductListRepository.findProductById(productId);
    if (!product) throw new NotFoundError("Product not found");

    const { parts, checklistItems, ...header } = validated;
    const project = await ProductListRepository.createProject(productId, header, parts, checklistItems);

    void logAudit({
      entityType: "project",
      entityId: String(project.id),
      entityLabel: `${product.make} ${product.model} · ${header.seatRow}${header.submodel ? ` ${header.submodel}` : ""}`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { productId: String(productId), seatRow: project.seatRow, submodel: project.submodel },
      ip: who.ip,
    });

    return project;
  },

  async getProject(id: bigint) {
    const project = await ProductListRepository.findProjectById(id);
    if (!project) throw new NotFoundError("Project not found");
    return project;
  },

  async updateProject(id: bigint, validated: Prisma.ProjectUpdateInput) {
    const existing = await ProductListRepository.findProjectBare(id);
    if (!existing) throw new NotFoundError("Project not found");
    return ProductListRepository.updateProject(id, validated);
  },

  async deleteProject(id: bigint, who: Who): Promise<void> {
    const existing = await ProductListRepository.findProjectWithProduct(id);
    if (!existing) throw new NotFoundError("Project not found");

    await ProductListRepository.deleteProject(id);

    void logAudit({
      entityType: "project",
      entityId: String(id),
      entityLabel: `${existing.product.make} ${existing.product.model} · ${existing.seatRow}${existing.submodel ? ` ${existing.submodel}` : ""}`,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "delete",
      ip: who.ip,
    });
  },

  listChecklistItems(projectId: bigint) {
    return ProductListRepository.listChecklistItems(projectId);
  },

  async createChecklistItem(projectId: bigint, validated: { description: string; status: string }) {
    const project = await ProductListRepository.findProjectBare(projectId);
    if (!project) throw new NotFoundError("Project not found");
    return ProductListRepository.createChecklistItem(projectId, validated);
  },

  async updateChecklistItem(projectId: bigint, itemId: bigint, validated: Prisma.ProjectChecklistItemUpdateInput) {
    const existing = await ProductListRepository.findChecklistItem(itemId);
    if (!existing || existing.projectId !== projectId) throw new NotFoundError("Checklist item not found");
    return ProductListRepository.updateChecklistItem(itemId, validated);
  },

  async deleteChecklistItem(projectId: bigint, itemId: bigint): Promise<void> {
    const existing = await ProductListRepository.findChecklistItem(itemId);
    if (!existing || existing.projectId !== projectId) throw new NotFoundError("Checklist item not found");
    await ProductListRepository.deleteChecklistItem(itemId);
  },

  async createProjectPart(projectId: bigint, validated: { cab?: string; code?: string; status: string; assignedToUserId?: string; photoCount: number; docUrl?: string }) {
    const project = await ProductListRepository.findProjectBare(projectId);
    if (!project) throw new NotFoundError("Project not found");
    const { docUrl, ...rest } = validated;
    return ProductListRepository.createProjectPart(projectId, { ...rest, docUrl: docUrl || undefined });
  },

  async updateProjectPart(projectId: bigint, partId: bigint, validated: Prisma.ProjectPartUpdateInput) {
    const existing = await ProductListRepository.findProjectPart(partId);
    if (!existing || existing.projectId !== projectId) throw new NotFoundError("Configuration not found");
    return ProductListRepository.updateProjectPart(partId, validated);
  },

  async deleteProjectPart(projectId: bigint, partId: bigint): Promise<void> {
    const existing = await ProductListRepository.findProjectPart(partId);
    if (!existing || existing.projectId !== projectId) throw new NotFoundError("Configuration not found");
    await ProductListRepository.deleteProjectPart(partId);
  },

  listAssignableUsers() {
    return ProductListRepository.listAssignableUsers();
  },
};
