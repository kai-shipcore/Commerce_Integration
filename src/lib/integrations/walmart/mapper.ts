import type { NormalizedOrder } from "@/lib/integrations/core/types";
import type { WalmartOrder } from "@/lib/integrations/walmart/types";

export function mapWalmartOrders(orders: WalmartOrder[]): NormalizedOrder[] {
  return orders.map((order) => {
    const orderedAt = new Date(order.orderDate).toISOString();
    const isCancelled = order.status === "Cancelled";

    const lineItems = (order.orderLines?.orderLine ?? [])
      .filter((line) => Boolean(line.item?.sku))
      .map((line) => {
        const qty = parseInt(line.orderLineQuantity?.amount ?? "1", 10);

        const productCharge = (line.charges?.charge ?? []).find(
          (c) => c.chargeType === "PRODUCT"
        );
        const unitPrice = productCharge?.chargeAmount?.amount ?? 0;

        const statuses = line.orderLineStatuses?.orderLineStatus ?? [];
        const shippedStatus = statuses.find(
          (s) => s.status === "Shipped" || s.status === "Delivered"
        );
        const isFulfilled = Boolean(shippedStatus);
        const fulfilledAt = shippedStatus?.trackingInfo?.shipDateTime
          ? new Date(shippedStatus.trackingInfo.shipDateTime).toISOString()
          : isFulfilled
            ? orderedAt
            : null;

        return {
          externalLineItemId: `${order.purchaseOrderId}-${line.lineNumber}`,
          sku: line.item.sku,
          title: line.item.productName,
          quantity: qty,
          unitPrice,
          totalAmount: unitPrice * qty,
          fulfillmentStatus: isFulfilled ? "fulfilled" : "unfulfilled",
          fulfilledAt,
        };
      });

    return {
      externalOrderId: order.purchaseOrderId,
      orderDisplayId: order.customerOrderId,
      orderedAt,
      cancelledAt: isCancelled ? orderedAt : null,
      lineItems,
    };
  });
}
