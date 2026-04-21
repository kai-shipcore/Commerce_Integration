import type { NormalizedOrder } from "@/lib/integrations/core/types";
import type { ShopifyOrder } from "@/lib/integrations/shopify/types";

export function mapShopifyOrders(orders: ShopifyOrder[]): NormalizedOrder[] {
  return orders.map((order) => ({
    externalOrderId: String(order.id),
    orderDisplayId: order.name,
    orderedAt: order.created_at,
    cancelledAt: order.cancelled_at,
    lineItems: order.line_items
      .filter((item) => Boolean(item.sku))
      .map((item) => ({
        externalLineItemId: String(item.id),
        sku: item.sku,
        title: item.title,
        quantity: item.quantity,
        unitPrice: parseFloat(item.price),
        totalAmount: parseFloat(item.price) * item.quantity,
        fulfillmentStatus: item.fulfillment_status,
        fulfilledAt: item.fulfillment_status === "fulfilled" ? order.created_at : null,
      })),
  }));
}
