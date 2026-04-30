import type { NormalizedOrder } from "@/lib/integrations/core/types";
import type { AmazonOrder, AmazonOrderItem } from "@/lib/integrations/amazon/client";

export function mapAmazonOrders(
  orders: AmazonOrder[],
  itemsMap: Map<string, AmazonOrderItem[]>
): NormalizedOrder[] {
  return orders.flatMap((order) => {
    const items = itemsMap.get(order.AmazonOrderId) ?? [];
    const lineItems = items
      .filter((item) => Boolean(item.SellerSKU))
      .map((item) => {
        const totalAmount = item.ItemPrice ? parseFloat(item.ItemPrice.Amount) : 0;
        const unitPrice = item.QuantityOrdered > 0 ? totalAmount / item.QuantityOrdered : 0;
        return {
          externalLineItemId: item.OrderItemId,
          sku: item.SellerSKU,
          title: item.Title ?? null,
          quantity: item.QuantityOrdered,
          unitPrice,
          totalAmount,
          fulfillmentStatus: order.OrderStatus === "Shipped" ? "fulfilled" : null,
          fulfilledAt: order.OrderStatus === "Shipped" ? order.LastUpdateDate : null,
        };
      });

    if (lineItems.length === 0) return [];

    return [
      {
        externalOrderId: order.AmazonOrderId,
        orderDisplayId: order.AmazonOrderId,
        orderedAt: order.PurchaseDate,
        cancelledAt: order.OrderStatus === "Canceled" ? order.LastUpdateDate : null,
        currency: order.OrderTotal?.CurrencyCode ?? null,
        lineItems,
      },
    ];
  });
}
