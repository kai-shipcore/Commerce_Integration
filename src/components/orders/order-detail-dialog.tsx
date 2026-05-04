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
  masterSku: string | null;
  channelSku: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  fulfillmentStatus: string | null;
}

export interface OrderDetail {
  id: number;
  platformSource: string;
  orderNumber: string | null;
  externalOrderId: string | null;
  orderDate: string | null;
  orderStatus: string | null;
  totalPrice: number;
  currency: string | null;
  fulfillmentChannel: string | null;
  cancelledAt: string | null;
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
            <div className="grid gap-4 md:grid-cols-3">
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
                  <CardDescription>Total</CardDescription>
                  <CardTitle className="text-base">
                    {formatCurrency(order.totalPrice, order.currency)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {order.fulfillmentChannel ? `Fulfillment: ${order.fulfillmentChannel}` : ""}
                  {order.cancelledAt
                    ? ` · Cancelled ${new Date(order.cancelledAt).toLocaleDateString()}`
                    : ""}
                </CardContent>
              </Card>
            </div>

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
                        <div className="space-y-3">
                          <div className="min-w-0">
                            <div className="font-medium">
                              {item.productName || "Untitled item"}
                            </div>
                            {item.channelSku && (
                              <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                {item.channelSku}
                              </div>
                            )}
                            {item.masterSku && item.masterSku !== item.channelSku && (
                              <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground/60">
                                Master: {item.masterSku}
                              </div>
                            )}
                            {item.fulfillmentStatus && (
                              <div className="mt-2">
                                <Badge variant="outline">{item.fulfillmentStatus}</Badge>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-3">
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
                                Unit Price
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {formatCurrency(item.unitPrice, order.currency)}
                              </div>
                            </div>
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Line Total
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {formatCurrency(item.lineTotal, order.currency)}
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
