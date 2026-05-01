import type { NormalizedOrder } from "@/lib/integrations/core/types";
import type { WalmartOrder } from "@/lib/integrations/walmart/types";

function isLineShipped(line: WalmartOrder["orderLines"]["orderLine"][number]): boolean {
  return (line.orderLineStatuses?.orderLineStatus ?? []).some(
    (s) => s.status === "Shipped" || s.status === "Delivered"
  );
}

export function mapWalmartOrders(orders: WalmartOrder[], integrationName: string): NormalizedOrder[] {
  return orders
    .filter((order) => (order.orderLines?.orderLine ?? []).some(isLineShipped))
    .map((order) => {
      const orderedAt = new Date(order.orderDate).toISOString();

      const lineItems = (order.orderLines?.orderLine ?? [])
        .filter((line) => Boolean(line.item?.sku))
        .map((line) => {
          const qty = parseInt(line.orderLineQuantity?.amount ?? "1", 10);

          const productCharge = (line.charges?.charge ?? []).find(
            (c) => c.chargeType === "PRODUCT"
          );
          const unitPrice = productCharge?.chargeAmount?.amount ?? 0;

          const shippedStatus = (line.orderLineStatuses?.orderLineStatus ?? []).find(
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
        })
        .filter((item) => item.totalAmount > 0);

      const firstCharge = (order.orderLines?.orderLine?.[0]?.charges?.charge ?? []).find(
        (c) => c.chargeType === "PRODUCT"
      );

      return {
        externalOrderId: order.purchaseOrderId,
        orderDisplayId: order.customerOrderId,
        orderedAt,
        cancelledAt: null,
        orderStatus: "Shipped",
        currency: firstCharge?.chargeAmount?.currency ?? null,
        fulfillmentChannel: integrationName,
        lineItems,
      };
    });
}
