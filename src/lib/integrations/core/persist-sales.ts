import { getPrimaryPool } from "@/lib/db/primary-db";
import type {
  NormalizedOrder,
  SyncResult,
} from "@/lib/integrations/core/types";
import {
  lookupMasterSkus,
  type MasterSkuInfo,
} from "@/lib/integrations/core/sku-resolution";

export async function persistNormalizedOrders(args: {
  orders: NormalizedOrder[];
  integrationId: string;
  platform: string;
  skuMap: Map<string, string>;
  masterSkuCache: Map<string, MasterSkuInfo>;
  result: SyncResult;
}): Promise<void> {
  const { orders, platform, masterSkuCache, result } = args;
  if (orders.length === 0) return;

  // Resolve master SKUs for all channel SKUs not yet cached
  const skusNeedingLookup = Array.from(
    new Set(
      orders.flatMap((o) =>
        o.lineItems.map((i) => i.sku).filter((s) => Boolean(s) && !masterSkuCache.has(s))
      )
    )
  );
  if (skusNeedingLookup.length > 0) {
    const resolved = await lookupMasterSkus(skusNeedingLookup);
    resolved.forEach((v, k) => masterSkuCache.set(k, v));
  }

  const pool = getPrimaryPool();

  for (const order of orders) {
    const isCanceled = Boolean(order.cancelledAt);
    const client = await pool.connect();

    try {
      const orderRes = await client.query<{ id: string; inserted: boolean }>(
        `INSERT INTO shipcore.sc_sales_orders (
          platform_source, external_order_id, order_number,
          order_date, order_status,
          total_price, currency,
          cancelled_at, is_counted_in_demand
        ) VALUES (
          $1, $2, $2,
          $3, $4,
          $5, $6,
          $7, $8
        )
        ON CONFLICT (external_order_id) DO UPDATE SET
          order_status         = EXCLUDED.order_status,
          total_price          = COALESCE(EXCLUDED.total_price, sc_sales_orders.total_price),
          cancelled_at         = EXCLUDED.cancelled_at,
          is_counted_in_demand = EXCLUDED.is_counted_in_demand,
          updated_at           = NOW()
        RETURNING id, (xmax = 0) AS inserted`,
        [
          platform,
          order.externalOrderId,
          order.orderedAt,
          isCanceled ? "Canceled" : "Unshipped",
          order.lineItems.reduce((s, i) => s + i.totalAmount, 0) || null,
          order.currency ?? null,
          order.cancelledAt ?? null,
          !isCanceled,
        ]
      );

      const { id: orderId, inserted: isNewOrder } = orderRes.rows[0];

      for (const item of order.lineItems) {
        if (!item.sku) continue;

        const masterInfo = masterSkuCache.get(item.sku);
        const masterSku = masterInfo?.parse1 ?? null;
        const lineItemId = item.externalLineItemId ?? `${order.externalOrderId}-${item.sku}`;

        await client.query(
          `INSERT INTO shipcore.sc_sales_order_items (
            order_id, platform_source, external_line_item_id,
            master_sku, channel_sku, sku,
            product_name,
            quantity, unit_price, line_total,
            fulfillment_status,
            is_counted_in_demand
          ) VALUES (
            $1, $2, $3,
            $4, $5, $5,
            $6,
            $7, $8, $9,
            $10,
            $11
          )
          ON CONFLICT (external_line_item_id) DO UPDATE SET
            order_id             = EXCLUDED.order_id,
            master_sku           = COALESCE(EXCLUDED.master_sku, sc_sales_order_items.master_sku),
            channel_sku          = EXCLUDED.channel_sku,
            sku                  = EXCLUDED.sku,
            product_name         = COALESCE(EXCLUDED.product_name, sc_sales_order_items.product_name),
            quantity             = EXCLUDED.quantity,
            unit_price           = COALESCE(EXCLUDED.unit_price, sc_sales_order_items.unit_price),
            line_total           = COALESCE(EXCLUDED.line_total, sc_sales_order_items.line_total),
            fulfillment_status   = EXCLUDED.fulfillment_status,
            is_counted_in_demand = EXCLUDED.is_counted_in_demand,
            updated_at           = NOW()`,
          [
            orderId,
            platform,
            lineItemId,
            masterSku,
            item.sku,
            item.title ?? null,
            item.quantity,
            item.unitPrice ?? null,
            item.totalAmount ?? null,
            item.fulfillmentStatus ?? null,
            !isCanceled,
          ]
        );
      }

      if (isNewOrder && !isCanceled && order.lineItems.length > 0) {
        result.ordersProcessed++;
        result.salesRecordsCreated += order.lineItems.length;
      }
    } catch (e) {
      console.error(`[persist-sales] Failed to persist order ${order.externalOrderId}:`, e);
      throw e;
    } finally {
      client.release();
    }
  }
}
