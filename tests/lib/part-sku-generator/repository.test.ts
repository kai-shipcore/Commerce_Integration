import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = { partSku: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } };
vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

const { PartSkusRepository } = await import("@/lib/part-sku-generator/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PartSkusRepository.list", () => {
  it("includes Universal SKUs alongside Custom matches when make/model is given", async () => {
    prismaMock.partSku.findMany.mockResolvedValue([]);
    await PartSkusRepository.list({ search: "", active: null, make: "Toyota", model: null });
    const { where } = prismaMock.partSku.findMany.mock.calls[0][0];
    const vehicleFilter = where.AND[2];
    expect(vehicleFilter.OR).toEqual([
      { AND: [{ make: { equals: "Toyota", mode: "insensitive" } }] },
      { skuType: "Universal" },
    ]);
  });

  it("applies no vehicle filter when make/model are both absent", async () => {
    prismaMock.partSku.findMany.mockResolvedValue([]);
    await PartSkusRepository.list({ search: "", active: null, make: null, model: null });
    const { where } = prismaMock.partSku.findMany.mock.calls[0][0];
    expect(where.AND[2]).toEqual({});
  });
});
