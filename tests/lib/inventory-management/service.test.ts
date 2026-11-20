import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProductRow } from "@/lib/sku-master/repository";
import type { WarehouseStockRow } from "@/lib/inventory-management/repository";

const listProductsMock = vi.fn();
const getStockMock = vi.fn();

vi.mock("@/lib/sku-master/repository", () => ({
  SkuMasterRepository: { listProducts: listProductsMock },
}));
vi.mock("@/lib/inventory-management/repository", () => ({
  InventoryManagementRepository: { getStockBySkuAndWarehouse: getStockMock },
}));

const { InventoryManagementService, buildInventoryRows } = await import("@/lib/inventory-management/service");

function product(masterSku: string, overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    master_sku: masterSku, product_name: "Name", category: "Car Cover", category_code: "CC",
    status: "active", sales_status: null, floor_mat_type: null, original_or_custom: "Original",
    moq: null, order_multiple: null, cbm_per_unit: null, case_qty: null, weight_kg: null,
    ...overrides,
  };
}

function stock(masterSku: string, warehouse: string, onHand: number, available = onHand): WarehouseStockRow {
  return { master_sku: masterSku, warehouse, on_hand: onHand, available };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildInventoryRows", () => {
  it("lists every SKU Master row, inactive ones included, with its classification", () => {
    const rows = buildInventoryRows(
      [
        product("CA-SC-10-F-10-BK-1TO", { category_code: "SC", original_or_custom: "Custom" }),
        product("CA-SC-10-F-10-GR-1TO", { category_code: "SC", status: "inactive", sales_status: "Discontinued" }),
      ],
      [],
    );

    expect(rows.map((row) => row.masterSku)).toEqual(["CA-SC-10-F-10-BK-1TO", "CA-SC-10-F-10-GR-1TO"]);
    expect(rows[0]).toMatchObject({ categoryCode: "SC", status: "active", salesStatus: null, originalOrCustom: "Custom" });
    expect(rows[1]).toMatchObject({ status: "inactive", salesStatus: "Discontinued" });
    expect(rows[1].total).toEqual({ onHand: 0, available: 0 });
  });

  it("splits stock by warehouse and keeps on hand apart from available", () => {
    const [row] = buildInventoryRows(
      [product("CA-SC-10-F-10-BK-1TO")],
      [
        stock("CA-SC-10-F-10-BK-1TO", "Fullerton", 100, 90),
        stock("CA-SC-10-F-10-BK-1TO", "TTM Group", 40, 38),
        stock("CA-SC-10-F-10-BK-1TO", "TTM Group Jefferson", 5),
        stock("CA-SC-10-F-10-BK-1TO", "Dream Trans", 7),
      ],
    );

    expect(row.warehouses.fullerton).toEqual({ onHand: 100, available: 90 });
    expect(row.warehouses.ttm).toEqual({ onHand: 40, available: 38 });
    expect(row.warehouses.ttmJefferson).toEqual({ onHand: 5, available: 5 });
    expect(row.warehouses.dreamTrans).toEqual({ onHand: 7, available: 7 });
    expect(row.total).toEqual({ onHand: 152, available: 140 });
  });

  it("keeps stock in a warehouse it has no column for, under Other", () => {
    const [row] = buildInventoryRows(
      [product("CA-SC-10-F-10-BK-1TO")],
      [stock("CA-SC-10-F-10-BK-1TO", "New Warehouse", 12)],
    );

    expect(row.warehouses.other).toEqual({ onHand: 12, available: 12 });
    expect(row.total.onHand).toBe(12);
  });

  // The question that started this page: 42 units at TTM on the CS row that
  // really sat under CSP. The two are separate products now.
  it("keeps CSP and CS stock on their own rows", () => {
    const rows = buildInventoryRows(
      [product("CC-CS-03-M-GR-1TO"), product("CC-CSP-03-M-GR-1TO")],
      [stock("CC-CSP-03-M-GR-1TO", "TTM Group", 42)],
    );

    expect(rows[0].warehouses.ttm.onHand).toBe(0);
    expect(rows[0].mergedFrom).toEqual([]);
    expect(rows[1].warehouses.ttm.onHand).toBe(42);
  });

  it("counts a merged SKU's stock on its target and says where it came from", () => {
    const [row] = buildInventoryRows(
      [product("CC-CS-03-J-GR-1TO")],
      [
        stock("CC-CS-03-J-GR-1TO", "Fullerton", 10),
        stock("C-SJ-GR-7", "Fullerton", 3),
        stock("C-SJ-GR-7", "TTM Group", 4, 2),
      ],
    );

    expect(row.warehouses.fullerton.onHand).toBe(13);
    expect(row.warehouses.ttm).toEqual({ onHand: 4, available: 2 });
    expect(row.total).toEqual({ onHand: 17, available: 15 });
    expect(row.mergedFrom).toHaveLength(1);
    expect(row.mergedFrom[0].sku).toBe("C-SJ-GR-7");
    expect(row.mergedFrom[0].total).toEqual({ onHand: 7, available: 5 });
    expect(row.mergedFrom[0].warehouses.ttm.onHand).toBe(4);
  });

  it("does not mark a merge that carries no stock", () => {
    const [row] = buildInventoryRows(
      [product("CC-CS-03-J-GR-1TO")],
      [stock("C-SJ-GR-7", "Fullerton", 0)],
    );

    expect(row.mergedFrom).toEqual([]);
  });

  it("shows no stock on a merged SKU's own row, since its units are on the target", () => {
    const rows = buildInventoryRows(
      [product("CC-CS-03-J-GR-1TO"), product("C-SJ-GR-7", { status: "inactive" })],
      [stock("C-SJ-GR-7", "Fullerton", 3)],
    );

    expect(rows[0].total.onHand).toBe(3);
    expect(rows[1].total.onHand).toBe(0);
  });

  it("leaves a legacy SWC spelling on its own row: only its sales are folded", () => {
    const rows = buildInventoryRows(
      [product("CA-SWC-10-47-BKBK", { category_code: "SWC" }), product("CA-10-SWC-47-BKBK", { category_code: "SWC" })],
      [stock("CA-SWC-10-47-BKBK", "Fullerton", 89), stock("CA-10-SWC-47-BKBK", "Fullerton", 96)],
    );

    expect(rows[0].total.onHand).toBe(89);
    expect(rows[0].mergedFrom).toEqual([]);
    expect(rows[1].total.onHand).toBe(96);
  });

  describe("final car cover SKU (TN to TNS, BKGR to BKLG)", () => {
    const stockRows = [
      stock("CC-TN-15-V-BKGR-STR", "Fullerton", 20),
      stock("CC-TNS-15-V-BKLG-STR", "Fullerton", 50),
    ];

    it("notes what Demand Planning adds, without adding it to the row's own numbers", () => {
      const rows = buildInventoryRows(
        [product("CC-TN-15-V-BKGR-STR"), product("CC-TNS-15-V-BKLG-STR")],
        stockRows,
      );

      const [legacy, final] = rows;
      // Each row is its own stock here, so the 20 units are listed once.
      expect(legacy.total.onHand).toBe(20);
      expect(final.total.onHand).toBe(50);
      expect(final.mergedFrom).toEqual([]);
      expect(final.demandPlanningAddsFrom.map((source) => [source.sku, source.total.onHand]))
        .toEqual([["CC-TN-15-V-BKGR-STR", 20]]);
      expect(legacy.demandPlanningAddsFrom).toEqual([]);
    });

    it("says nothing when the old SKU is inactive, as Demand Planning adds nothing then", () => {
      const rows = buildInventoryRows(
        [product("CC-TN-15-V-BKGR-STR", { status: "inactive" }), product("CC-TNS-15-V-BKLG-STR")],
        stockRows,
      );

      expect(rows[1].demandPlanningAddsFrom).toEqual([]);
    });

    it("says nothing when the old SKU holds no stock", () => {
      const rows = buildInventoryRows(
        [product("CC-TN-15-V-BKGR-STR"), product("CC-TNS-15-V-BKLG-STR")],
        [stock("CC-TNS-15-V-BKLG-STR", "Fullerton", 50)],
      );

      expect(rows[1].demandPlanningAddsFrom).toEqual([]);
    });
  });
});

describe("InventoryManagementService.list", () => {
  it("reads every SKU Master row, whatever its status", async () => {
    listProductsMock.mockResolvedValue([]);
    getStockMock.mockResolvedValue([]);

    await InventoryManagementService.list();

    expect(listProductsMock).toHaveBeenCalledWith(expect.objectContaining({
      status: "all", salesType: "all", typeFilter: "all", search: "", productValues: [], offset: 0,
    }));
  });

  it("returns the joined rows and reports the stock feed as available", async () => {
    listProductsMock.mockResolvedValue([product("CA-SC-10-F-10-BK-1TO")]);
    getStockMock.mockResolvedValue([stock("CA-SC-10-F-10-BK-1TO", "Fullerton", 9)]);

    const data = await InventoryManagementService.list();

    expect(data.stockAvailable).toBe(true);
    expect(data.rows[0].warehouses.fullerton.onHand).toBe(9);
  });

  it("still lists the SKUs when the lookup DB is not configured", async () => {
    listProductsMock.mockResolvedValue([product("CA-SC-10-F-10-BK-1TO")]);
    getStockMock.mockResolvedValue(null);

    const data = await InventoryManagementService.list();

    expect(data.stockAvailable).toBe(false);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].total).toEqual({ onHand: 0, available: 0 });
  });

  it("still lists the SKUs when the stock feed fails", async () => {
    listProductsMock.mockResolvedValue([product("CA-SC-10-F-10-BK-1TO")]);
    getStockMock.mockRejectedValue(new Error("connection refused"));

    const data = await InventoryManagementService.list();

    expect(data.stockAvailable).toBe(false);
    expect(data.rows).toHaveLength(1);
  });
});
