import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  productionPart: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  productionCode: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  designerInitial: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
};

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

const { PartsRepository, CodesRepository, DesignerInitialsRepository } = await import("@/lib/parts-codes/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PartsRepository.list", () => {
  it("filters by partName contains and isActive when provided", async () => {
    prismaMock.productionPart.findMany.mockResolvedValue([]);
    await PartsRepository.list("seat", true);
    expect(prismaMock.productionPart.findMany).toHaveBeenCalledWith({
      where: { partName: { contains: "seat", mode: "insensitive" }, isActive: true },
      orderBy: { partName: "asc" },
    });
  });

  it("omits filters when search is empty and active is null", async () => {
    prismaMock.productionPart.findMany.mockResolvedValue([]);
    await PartsRepository.list("", null);
    expect(prismaMock.productionPart.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { partName: "asc" },
    });
  });
});

describe("CodesRepository.findByKey", () => {
  it("queries by the code field", async () => {
    prismaMock.productionCode.findUnique.mockResolvedValue(null);
    await CodesRepository.findByKey("AB");
    expect(prismaMock.productionCode.findUnique).toHaveBeenCalledWith({ where: { code: "AB" } });
  });
});

describe("DesignerInitialsRepository.list", () => {
  it("ORs initial and designerName for search", async () => {
    prismaMock.designerInitial.findMany.mockResolvedValue([]);
    await DesignerInitialsRepository.list("kim", null);
    const call = prismaMock.designerInitial.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { initial: { contains: "kim", mode: "insensitive" } },
      { designerName: { contains: "kim", mode: "insensitive" } },
    ]);
  });
});
