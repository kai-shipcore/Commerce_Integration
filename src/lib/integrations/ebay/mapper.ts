import type { NormalizedOrder } from "@/lib/integrations/core/types";
import type { EbayOrder } from "@/lib/integrations/ebay/types";

export function mapEbayOrders(orders: EbayOrder[]): NormalizedOrder[] {
  return orders.map((order) => ({
    externalOrderId: order.orderId,
    orderDisplayId: order.orderId,
    orderedAt: order.creationDate,
    cancelledAt:
      order.cancelStatus?.cancelState === "CANCEL_ACCEPTED"
        ? order.creationDate
        : null,
    lineItems: order.lineItems
      .filter((item) => Boolean(item.sku))
      .map((item) => {
        const totalAmount = parseFloat(item.lineItemCost?.value ?? "0");
        const quantity = item.quantity || 1;
        const isFulfilled = item.lineItemFulfillmentStatus === "FULFILLED";
        return {
          externalLineItemId: item.lineItemId,
          sku: item.sku!,
          title: item.title,
          quantity,
          unitPrice: totalAmount / quantity,
          totalAmount,
          fulfillmentStatus: item.lineItemFulfillmentStatus?.toLowerCase(),
          fulfilledAt: isFulfilled ? (item.deliveredDate ?? order.creationDate) : null,
        };
      }),
  }));
}
