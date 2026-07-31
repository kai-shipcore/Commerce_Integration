import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  product: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  project: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  projectChecklistItem: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  projectPart: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  user: { findMany: vi.fn() },
};

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

const { ProductListRepository } = await import("@/lib/product-list/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProductListRepository.listProducts", () => {
  it("defaults to isActive:true when no active filter is given", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await ProductListRepository.listProducts(null);
    const { where } = prismaMock.product.findMany.mock.calls[0][0];
    expect(where).toEqual({ isActive: true });
  });

  it("respects an explicit active:false filter", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await ProductListRepository.listProducts(false);
    const { where } = prismaMock.product.findMany.mock.calls[0][0];
    expect(where).toEqual({ isActive: false });
  });
});

describe("ProductListRepository.createProject", () => {
  it("nests parts and checklistItems as create operations", async () => {
    prismaMock.project.create.mockResolvedValue({ id: BigInt(1) });
    await ProductListRepository.createProject(BigInt(1), { seatRow: "Front" }, [{ status: "Pending" }], [{ description: "x", status: "Pending" }]);
    const { data } = prismaMock.project.create.mock.calls[0][0];
    expect(data.parts).toEqual({ create: [{ status: "Pending" }] });
    expect(data.checklistItems).toEqual({ create: [{ description: "x", status: "Pending" }] });
  });
});

describe("ProductListRepository.listAssignableUsers", () => {
  it("filters to active production-role users", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await ProductListRepository.listAssignableUsers();
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { role: "production", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
  });
});
