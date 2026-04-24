import { prisma } from "@/lib/db/prisma";
import type {
  NormalizedLineItem,
  NormalizedOrder,
  SyncResult,
} from "@/lib/integrations/core/types";
import {
  ensureSkuMappings,
  lookupMasterSkus,
  type MasterSkuInfo,
} from "@/lib/integrations/core/sku-resolution";

function buildSalesRecordRows(args: {
  order: NormalizedOrder;
  item: NormalizedLineItem;
  skuId: string;
  platform: string;
  integrationId: string;
  masterInfo?: MasterSkuInfo;
}) {
  const { order, item, skuId, platform, integrationId, masterInfo } = args;
  const isFulfilled = item.fulfillmentStatus === "fulfilled";
  const fulfilledDate = isFulfilled
    ? new Date(item.fulfilledAt || order.orderedAt)
    : null;

  const rows = [
    {
      skuId,
      integrationId,
      platform,
      orderId: order.orderDisplayId,
      orderType: "actual_sale",
      saleDate: new Date(order.orderedAt),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalAmount: item.totalAmount,
      masterSkuCode: masterInfo?.parse1 || null,
      fulfilled: isFulfilled,
      fulfilledDate,
    },
  ];

  if (masterInfo?.parse2) {
    rows.push({
      skuId,
      integrationId,
      platform,
      orderId: `${order.orderDisplayId}-p2`,
      orderType: "actual_sale",
      saleDate: new Date(order.orderedAt),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalAmount: item.totalAmount,
      masterSkuCode: masterInfo.parse2,
      fulfilled: isFulfilled,
      fulfilledDate,
    });
  }

  if (masterInfo?.parse3) {
    rows.push({
      skuId,
      integrationId,
      platform,
      orderId: `${order.orderDisplayId}-p3`,
      orderType: "actual_sale",
      saleDate: new Date(order.orderedAt),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalAmount: item.totalAmount,
      masterSkuCode: masterInfo.parse3,
      fulfilled: isFulfilled,
      fulfilledDate,
    });
  }

  return rows;
}

export async function persistNormalizedOrders(args: {
  orders: NormalizedOrder[];
  integrationId: string;
  platform: string;
  skuMap: Map<string, string>;
  masterSkuCache: Map<string, MasterSkuInfo>;
  result: SyncResult;
}): Promise<void> {
  const { orders, integrationId, platform, skuMap, masterSkuCache, result } = args;
  const activeOrders = orders.filter((order) => !order.cancelledAt);

  const batchSkuCodes = activeOrders.flatMap((order) =>
    order.lineItems.map((item) => item.sku).filter(Boolean)
  );

  result.skusCreated += await ensureSkuMappings(batchSkuCodes, skuMap, masterSkuCache);

  const skusNeedingLookup = Array.from(
    new Set(
      activeOrders.flatMap((order) =>
        order.lineItems
          .map((item) => item.sku)
          .filter((sku) => Boolean(sku) && !masterSkuCache.has(sku))
      )
    )
  );

  if (skusNeedingLookup.length > 0) {
    const masterSkuLookup = await lookupMasterSkus(skusNeedingLookup);
    masterSkuLookup.forEach((value, key) => masterSkuCache.set(key, value));
  }

  const salesRecords = [];

  for (const order of activeOrders) {
    for (const item of order.lineItems) {
      if (!item.sku) {
        continue;
      }

      const skuId = skuMap.get(item.sku);
      if (!skuId) {
        continue;
      }

      salesRecords.push(
        ...buildSalesRecordRows({
          order,
          item,
          skuId,
          platform,
          integrationId,
          masterInfo: masterSkuCache.get(item.sku),
        })
      );
    }

  }

  if (salesRecords.length === 0) {
    return;
  }

  const existingOrderIds = await prisma.salesRecord.findMany({
    where: {
      platform,
      orderId: { in: salesRecords.map((record) => record.orderId) },
    },
    select: { orderId: true, skuId: true },
  });

  const existingKeys = new Set(existingOrderIds.map((row) => `${row.orderId}-${row.skuId}`));
  const newRecords = salesRecords.filter(
    (record) => !existingKeys.has(`${record.orderId}-${record.skuId}`)
  );

  if (newRecords.length === 0) {
    return;
  }

  await prisma.salesRecord.createMany({
    data: newRecords,
  });

  result.salesRecordsCreated += newRecords.length;

  // Count unique orders that actually contributed new records (strip -p2/-p3 suffixes)
  const newBaseOrderIds = new Set(
    newRecords.map((r) => r.orderId.replace(/-p[23]$/, ""))
  );
  result.ordersProcessed += newBaseOrderIds.size;
}
