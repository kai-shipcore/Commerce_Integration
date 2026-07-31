/**
 * Data access for the Product List domain: Product (pd_product_list, one
 * vehicle header), Project (pd_project_list, one seat row of a product),
 * ProjectPart (pd_project, a configuration row within a project), and
 * ProjectChecklistItem (pd_project_list_checklist_items).
 */

import { prisma } from "@/lib/db/prisma";
import type { Prisma, Product, Project, ProjectPart, ProjectChecklistItem } from "@prisma/client";

const USER_SELECT = { id: true, name: true, email: true } as const;

const PROJECTS_SUMMARY_INCLUDE = {
  projects: {
    select: {
      id: true,
      seatRow: true,
      submodel: true,
      parts: { select: { status: true } },
      _count: { select: { checklistItems: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

const PROJECT_DETAIL_INCLUDE = {
  parts: { orderBy: { createdAt: "asc" }, include: { assignedTo: { select: USER_SELECT } } },
  product: { select: { id: true, make: true, model: true, fNumber: true, yearGeneration: true } },
} as const;

export const ProductListRepository = {
  listProducts(active: boolean | null) {
    return prisma.product.findMany({
      where: active !== null ? { isActive: active } : { isActive: true },
      include: PROJECTS_SUMMARY_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  },

  findProductById(id: bigint): Promise<Product | null> {
    return prisma.product.findUnique({ where: { id } });
  },

  findProductWithProjectPartStatuses(id: bigint) {
    return prisma.product.findUnique({
      where: { id },
      include: { projects: { include: { parts: { select: { status: true } } } } },
    });
  },

  createProduct(data: Prisma.ProductCreateInput) {
    return prisma.product.create({ data, include: PROJECTS_SUMMARY_INCLUDE });
  },

  updateProduct(id: bigint, data: Prisma.ProductUpdateInput): Promise<Product> {
    return prisma.product.update({ where: { id }, data });
  },

  deleteProduct(id: bigint): Promise<Product> {
    return prisma.product.delete({ where: { id } });
  },

  createProject(productId: bigint, header: { seatRow: string; submodel?: string }, parts: Prisma.ProjectPartCreateWithoutProjectInput[], checklistItems: Prisma.ProjectChecklistItemCreateWithoutProjectInput[]) {
    return prisma.project.create({
      data: {
        productId,
        ...header,
        parts: { create: parts },
        checklistItems: { create: checklistItems },
      },
      include: {
        parts: { orderBy: { createdAt: "asc" }, include: { assignedTo: { select: USER_SELECT } } },
        _count: { select: { checklistItems: true } },
      },
    });
  },

  findProjectById(id: bigint) {
    return prisma.project.findUnique({ where: { id }, include: PROJECT_DETAIL_INCLUDE });
  },

  findProjectBare(id: bigint): Promise<Project | null> {
    return prisma.project.findUnique({ where: { id } });
  },

  findProjectWithProduct(id: bigint) {
    return prisma.project.findUnique({ where: { id }, include: { product: true } });
  },

  updateProject(id: bigint, data: Prisma.ProjectUpdateInput) {
    return prisma.project.update({ where: { id }, data, include: PROJECT_DETAIL_INCLUDE });
  },

  deleteProject(id: bigint): Promise<Project> {
    return prisma.project.delete({ where: { id } });
  },

  listChecklistItems(projectId: bigint): Promise<ProjectChecklistItem[]> {
    return prisma.projectChecklistItem.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  },

  createChecklistItem(projectId: bigint, data: { description: string; status: string }): Promise<ProjectChecklistItem> {
    return prisma.projectChecklistItem.create({ data: { ...data, projectId } });
  },

  findChecklistItem(itemId: bigint): Promise<ProjectChecklistItem | null> {
    return prisma.projectChecklistItem.findUnique({ where: { id: itemId } });
  },

  updateChecklistItem(itemId: bigint, data: Prisma.ProjectChecklistItemUpdateInput): Promise<ProjectChecklistItem> {
    return prisma.projectChecklistItem.update({ where: { id: itemId }, data });
  },

  deleteChecklistItem(itemId: bigint): Promise<ProjectChecklistItem> {
    return prisma.projectChecklistItem.delete({ where: { id: itemId } });
  },

  createProjectPart(projectId: bigint, data: Prisma.ProjectPartUncheckedCreateWithoutProjectInput) {
    return prisma.projectPart.create({
      data: { ...data, projectId },
      include: { assignedTo: { select: USER_SELECT } },
    });
  },

  findProjectPart(partId: bigint): Promise<ProjectPart | null> {
    return prisma.projectPart.findUnique({ where: { id: partId } });
  },

  updateProjectPart(partId: bigint, data: Prisma.ProjectPartUpdateInput) {
    return prisma.projectPart.update({
      where: { id: partId },
      data,
      include: { assignedTo: { select: USER_SELECT } },
    });
  },

  deleteProjectPart(partId: bigint): Promise<ProjectPart> {
    return prisma.projectPart.delete({ where: { id: partId } });
  },

  listAssignableUsers() {
    return prisma.user.findMany({
      where: { role: "production", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
  },
};
