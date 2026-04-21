"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface OrderDetailItem {
  id: number;
  sku: string | null;
  productName: string | null;
  quantity: number;
  netQuantity: number;
  fulfilledQuantity: number;
  refundedQuantity: number;
  unitPrice: number;
  shippingPrice: number;
  itemTax: number;
  itemStatus: string | null;
  fulfillmentStatus: string | null;
  currency: string | null;
}

export interface OrderDetail {
  id: number;
  platformSource: string;
  orderNumber: string | null;
  externalOrderId: string | null;
  orderDate: string | null;
  orderStatus: string | null;
  financialStatus: string | null;
  totalPrice: number;
  currency: string | null;
  buyerEmail: string | null;
  shippingCountry: string | null;
  fulfillmentChannel: string | null;
  salesChannel: string | null;
  lineItems: OrderDetailItem[];
}

interface OrderDetailDialogProps {
  open: boolean;
  order: OrderDetail | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCurrency(value: number, currency: string | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function OrderDetailDialog({
  open,
  order,
  loading,
  onOpenChange,
}: OrderDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-auto max-h-[92vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[min(96vw,1400px)]">
        <DialogHeader>
          <DialogTitle>
            {order?.orderNumber || (loading ? "Loading order..." : "Order details")}
          </DialogTitle>
          <DialogDescription>
            Review line items and channel metadata for the selected order.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : !order ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Order details are not available.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Platform</CardDescription>
                  <CardTitle className="text-base">{order.platformSource}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {order.externalOrderId || `Internal ID ${order.id}`}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Order Status</CardDescription>
                  <CardTitle className="text-base">{order.orderStatus || "-"}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {order.orderDate ? new Date(order.orderDate).toLocaleString() : "-"}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Financial</CardDescription>
                  <CardTitle className="text-base">
                    {order.financialStatus || "-"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {formatCurrency(order.totalPrice, order.currency)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Buyer</CardDescription>
                  <CardTitle className="truncate text-base">
                    {order.buyerEmail || "-"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {order.shippingCountry || "No shipping country"}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Order Context</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Sales channel:</span>{" "}
                  {order.salesChannel || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Fulfillment channel:</span>{" "}
                  {order.fulfillmentChannel || "-"}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Line Items</CardTitle>
                <CardDescription>
                  {order.lineItems.length.toLocaleString()} line items in this order
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {order.lineItems.length === 0 ? (
                    <div className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
                      No line items found for this order.
                    </div>
                  ) : (
                    order.lineItems.map((item) => (
                      <div key={item.id} className="rounded-lg border p-4">
                        <div className="space-y-4">
                          <div className="min-w-0">
                            <div className="font-medium">
                              {item.productName || "Untitled item"}
                            </div>
                            <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                              {item.sku || "-"}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.itemStatus ? (
                                <Badge variant="secondary">{item.itemStatus}</Badge>
                              ) : null}
                              {item.fulfillmentStatus ? (
                                <Badge variant="outline">
                                  {item.fulfillmentStatus}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Qty
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {item.quantity.toLocaleString()}
                              </div>
                            </div>
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Net
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {item.netQuantity.toLocaleString()}
                              </div>
                            </div>
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Fulfilled
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {item.fulfilledQuantity.toLocaleString()}
                              </div>
                            </div>
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Refunded
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {item.refundedQuantity.toLocaleString()}
                              </div>
                            </div>
                            <div className="rounded-md bg-muted/40 px-3 py-2 sm:col-span-2 xl:col-span-1">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Unit Price
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {formatCurrency(item.unitPrice, item.currency)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
