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
import { useI18n } from "@/lib/i18n/i18n-provider";

export interface OrderDetailItem {
  id: number;
  sku: string | null;
  masterSku?: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  shippingPrice: number;
  itemTax: number;
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
  subtotalPrice: number;
  shippingPrice: number;
  taxPrice: number;
  currency: string | null;
  fulfillmentChannel: string | null;
  cancelledAt?: string | null;
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

function formatStatusLabel(value: string | null | undefined, locale: "ko" | "en") {
  if (!value) return "-";
  const normalized = value.trim().toUpperCase();
  const koLabels: Record<string, string> = {
    CANCELLED: "취소됨",
    DELIVERED: "배송 완료",
    FULFILLED: "처리 완료",
    PAID: "결제 완료",
    PARTIALLY_REFUNDED: "부분 환불",
    PENDING: "대기",
    REFUNDED: "환불됨",
    SHIPPED: "배송됨",
    UNFULFILLED: "미처리",
    VOIDED: "무효",
  };
  if (locale === "ko" && koLabels[normalized]) return koLabels[normalized];
  return value.replace(/_/g, " ");
}

export function OrderDetailDialog({
  open,
  order,
  loading,
  onOpenChange,
}: OrderDetailDialogProps) {
  const { locale, pick } = useI18n();
  const dateLocale = locale === "ko" ? "ko-KR" : "en-US";
  const subtotalPrice =
    order?.subtotalPrice ??
    order?.lineItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    ) ??
    0;
  const shippingPrice =
    order?.shippingPrice ??
    order?.lineItems.reduce((sum, item) => sum + item.shippingPrice, 0) ??
    0;
  const taxPrice =
    order?.taxPrice ??
    order?.lineItems.reduce((sum, item) => sum + item.itemTax, 0) ??
    0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-auto max-h-[92vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[min(96vw,1400px)]">
        <DialogHeader>
          <DialogTitle>
            {order?.orderNumber || (loading ? pick("주문 불러오는 중...", "Loading order...") : pick("주문 상세", "Order details"))}
          </DialogTitle>
          <DialogDescription>
            {pick("선택한 주문의 라인 아이템과 채널 정보를 확인합니다.", "Review line items and channel metadata for the selected order.")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : !order ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {pick("주문 상세 정보를 사용할 수 없습니다.", "Order details are not available.")}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{pick("플랫폼", "Platform")}</CardDescription>
                  <CardTitle className="text-base">{order.platformSource}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {order.externalOrderId || `${pick("내부 ID", "Internal ID")} ${order.id}`}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{pick("주문 상태", "Order Status")}</CardDescription>
                  <CardTitle className="text-base">{formatStatusLabel(order.orderStatus, locale)}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {order.orderDate ? new Date(order.orderDate).toLocaleString(dateLocale) : "-"}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{pick("합계", "Total")}</CardDescription>
                  <CardTitle className="text-base">
                    {formatCurrency(order.totalPrice, order.currency)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {order.fulfillmentChannel ? `${pick("처리 채널", "Fulfillment")}: ${order.fulfillmentChannel}` : ""}
                  {order.cancelledAt
                    ? ` · ${pick("취소일", "Cancelled")} ${new Date(order.cancelledAt).toLocaleDateString(dateLocale)}`
                    : ""}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{pick("라인 아이템", "Line Items")}</CardTitle>
                <CardDescription>
                  {pick(
                    `이 주문에 라인 아이템 ${order.lineItems.length.toLocaleString()}개`,
                    `${order.lineItems.length.toLocaleString()} line items in this order`,
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {order.lineItems.length === 0 ? (
                    <div className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
                      {pick("이 주문의 라인 아이템이 없습니다.", "No line items found for this order.")}
                    </div>
                  ) : (
                    order.lineItems.map((item) => (
                      <div key={item.id} className="rounded-lg border p-4">
                        <div className="space-y-3">
                          <div className="min-w-0">
                            <div className="font-medium">
                              {item.productName || pick("이름 없는 아이템", "Untitled item")}
                            </div>
                            {item.masterSku && item.masterSku !== item.sku ? (
                              <div className="mt-1 space-y-0.5">
                                <div className="break-all font-mono text-xs font-medium text-primary">
                                  {item.masterSku}
                                </div>
                                {item.sku && (
                                  <div className="break-all font-mono text-xs text-muted-foreground">
                                    {item.sku}
                                  </div>
                                )}
                              </div>
                            ) : (item.masterSku ?? item.sku) ? (
                              <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                {item.masterSku ?? item.sku}
                              </div>
                            ) : null}
                            {item.fulfillmentStatus && (
                              <div className="mt-2">
                                <Badge variant="outline">{formatStatusLabel(item.fulfillmentStatus, locale)}</Badge>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                {pick("수량", "Qty")}
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {item.quantity.toLocaleString()}
                              </div>
                            </div>
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                {pick("단가", "Unit Price")}
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {formatCurrency(item.unitPrice, order.currency)}
                              </div>
                            </div>
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                {pick("라인 합계", "Line Total")}
                              </div>
                              <div className="mt-1 text-right font-medium tabular-nums">
                                {formatCurrency(
                                  item.unitPrice * item.quantity,
                                  order.currency,
                                )}
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

              <div className="ml-auto w-full max-w-sm px-1">
                <div className="space-y-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span>{pick("소계", "Subtotal")}</span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(subtotalPrice, order.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{pick("배송비", "Shipping")}</span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(shippingPrice, order.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{pick("판매세*", "Sales tax*")}</span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(taxPrice, order.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-4 text-base font-semibold">
                    <span>{pick("주문 합계**", "Order total**")}</span>
                    <span className="tabular-nums">
                      {formatCurrency(order.totalPrice, order.currency)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}
