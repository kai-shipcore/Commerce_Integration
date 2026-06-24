export type ProductKey = "sc" | "cc" | "fm" | "ac";
export type ContainerStatus = "draft" | "final-list-sent" | "packing-list-received" | "complete";
export type PurchaseOrderStatus = "draft" | "approved" | "sent";

export interface MockSku {
  product: ProductKey;
  id: string;
  tags: string[];
  velocity: "high" | "low" | "custom";
  stock: number;
  backorder: number;
  stockSub: string;
  linkDaily: number;
  customDaily: number;
  life: number;
  sod: string;
  preorder: number;
  cbmUnit: number;
  moq: number;
  caseQty: number;
  linkSales: number[];
  customSales: number[];
}

export interface MockContainer {
  id: string;
  number: string;
  poNumbers: string[];
  eta: string;
  estLoadingDate?: string;
  etdNgbDate?: string;
  etaLaxLgbDate?: string;
  status: ContainerStatus;
  cbmCapacity: number;
  factory: string;
  origin?: string;
  destination: string;
  note?: string;
  items: Array<{
    id?: string;
    sku: string;
    qty: number;
    cbm: number;
    skuMemo?: string;
    remainingStockQty?: number;
    allocations?: Array<{
      id: string;
      stockId: string;
      sourceType: "remaining" | "mistake";
      referenceNo: string;
      qty: number;
      cbm: number;
    }>;
  }>;
}

export interface MockPurchaseOrder {
  id: string;
  number: string;
  date: string;
  eta: string;
  factory: string;
  destination: string;
  manager: string;
  status: PurchaseOrderStatus;
  items: Array<{ sku: string; moq: number; qty: number; cbm: number }>;
}

export const productLabels: Record<ProductKey, string> = {
  sc: "Seat Cover",
  cc: "Car Cover",
  fm: "Floor Mat",
  ac: "Accessories",
};

export const mockSkus: MockSku[] = [
  {
    product: "sc",
    id: "CA-SC-10-F-99-BK-1TO",
    tags: ["Front F99", "Black", "1TO"],
    velocity: "high",
    stock: 33,
    backorder: 0,
    stockSub: "West 33 / East 0",
    linkDaily: 0.47,
    customDaily: 0.47,
    life: 70,
    sod: "2026-07-27",
    preorder: 9,
    cbmUnit: 0.048,
    moq: 5,
    caseQty: 1,
    linkSales: [9, 18, 35, 48, 74],
    customSales: [9, 18, 35, 48, 74],
  },
  {
    product: "sc",
    id: "CA-SC-10-F-99-GR-1TO",
    tags: ["Front F99", "Green", "1TO"],
    velocity: "low",
    stock: 10,
    backorder: 0,
    stockSub: "West 8 / East 2",
    linkDaily: 0.06,
    customDaily: 0.04,
    life: 30,
    sod: "2026-06-14",
    preorder: 0,
    cbmUnit: 0.048,
    moq: 5,
    caseQty: 1,
    linkSales: [3, 4, 7, 11, 15],
    customSales: [2, 3, 5, 8, 12],
  },
  {
    product: "cc",
    id: "CC-CN-03-CHCV15-GR-1TO",
    tags: ["Car & SUV", "CHCV15", "Green", "1TO"],
    velocity: "high",
    stock: 493,
    backorder: 0,
    stockSub: "West 493 / East 0",
    linkDaily: 0.96,
    customDaily: 0.89,
    life: 90,
    sod: "2026-08-13",
    preorder: 0,
    cbmUnit: 0.078,
    moq: 3,
    caseQty: 3,
    linkSales: [15, 29, 56, 87, 120],
    customSales: [14, 27, 52, 80, 111],
  },
  {
    product: "fm",
    id: "CA-FM-80-FM12897",
    tags: ["Floor Mat", "FM12897", "Black"],
    velocity: "high",
    stock: 2,
    backorder: 0,
    stockSub: "West 2 / East 0",
    linkDaily: 0.07,
    customDaily: 0.07,
    life: 28,
    sod: "2026-06-10",
    preorder: 0,
    cbmUnit: 0.125,
    moq: 5,
    caseQty: 1,
    linkSales: [1, 2, 4, 6, 9],
    customSales: [1, 2, 4, 6, 9],
  },
];

export const mockContainers: MockContainer[] = [
  {
    id: "c1",
    number: "#159",
    poNumbers: ["PO-2026-038"],
    eta: "2026-05-21",
    status: "packing-list-received",
    cbmCapacity: 67.5,
    factory: "Guangzhou A",
    destination: "West",
    items: [
      { sku: "CA-SC-10-F-99-BK-1TO", qty: 20, cbm: 0.048 },
      { sku: "CA-SC-10-F-99-GR-1TO", qty: 15, cbm: 0.048 },
    ],
  },
  {
    id: "c2",
    number: "#162",
    poNumbers: ["PO-2026-039"],
    eta: "2026-06-09",
    status: "final-list-sent",
    cbmCapacity: 67.5,
    factory: "Guangzhou B",
    destination: "West",
    items: [{ sku: "CC-CN-03-CHCV15-GR-1TO", qty: 12, cbm: 0.078 }],
  },
  {
    id: "c3",
    number: "#163",
    poNumbers: ["PO-2026-040"],
    eta: "2026-06-14",
    status: "draft",
    cbmCapacity: 67.5,
    factory: "Shenzhen C",
    destination: "East",
    items: [{ sku: "CA-FM-80-FM12897", qty: 20, cbm: 0.125 }],
  },
];

export const mockPurchaseOrders: MockPurchaseOrder[] = [
  {
    id: "po1",
    number: "PO-2026-038",
    date: "2026-04-10",
    eta: "2026-05-21",
    factory: "Guangzhou A",
    destination: "West",
    manager: "Mina",
    status: "sent",
    items: [
      { sku: "CA-SC-10-F-99-BK-1TO", moq: 5, qty: 20, cbm: 0.048 },
      { sku: "CA-SC-10-F-99-GR-1TO", moq: 5, qty: 15, cbm: 0.048 },
    ],
  },
  {
    id: "po2",
    number: "PO-2026-039",
    date: "2026-04-18",
    eta: "2026-06-09",
    factory: "Guangzhou B",
    destination: "West",
    manager: "Mina",
    status: "sent",
    items: [{ sku: "CC-CN-03-CHCV15-GR-1TO", moq: 3, qty: 12, cbm: 0.078 }],
  },
  {
    id: "po3",
    number: "PO-2026-040",
    date: "2026-05-01",
    eta: "2026-06-14",
    factory: "Shenzhen C",
    destination: "East",
    manager: "Mina",
    status: "approved",
    items: [{ sku: "CA-FM-80-FM12897", moq: 5, qty: 20, cbm: 0.125 }],
  },
];

export const containerStatusLabels: Record<ContainerStatus, string> = {
  draft: "Container Draft (Pre-Plan)",
  "final-list-sent": "Packing List to Factory",
  "packing-list-received": "Shipped",
  complete: "Stock-in completed",
};

export function getInboundQty(skuId: string) {
  return mockContainers
    .flatMap((container) => container.items)
    .filter((item) => item.sku === skuId)
    .reduce((sum, item) => sum + item.qty, 0);
}

export function getWeightedAverage(values: number[]) {
  const averages = [
    values[0] / 7,
    values[2] / 30,
    values[3] / 60,
    values[4] / 90,
  ];
  return averages[0] * 0.1 + averages[1] * 0.3 + averages[2] * 0.3 + averages[3] * 0.3;
}
