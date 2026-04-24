export interface WalmartOrderRecord {
  purchaseOrderId: string;
}

export interface WalmartChargeAmount {
  currency: string;
  amount: number;
}

export interface WalmartOrderCharge {
  chargeType: string;
  chargeAmount: WalmartChargeAmount;
}

export interface WalmartOrderLineStatusEntry {
  status: string;
  statusQuantity: {
    unitOfMeasurement: string;
    amount: string;
  };
  trackingInfo?: {
    shipDateTime: number;
    carrierName: { otherCarrier: string | null; carrier: string | null };
    methodCode: string;
    trackingNumber: string;
    trackingURL: string;
  };
}

export interface WalmartOrderLine {
  lineNumber: string;
  item: {
    productName: string;
    sku: string;
  };
  charges: {
    charge: WalmartOrderCharge[];
  };
  orderLineQuantity: {
    unitOfMeasurement: string;
    amount: string;
  };
  statusDate: number;
  orderLineStatuses: {
    orderLineStatus: WalmartOrderLineStatusEntry[];
  };
}

export interface WalmartOrder {
  purchaseOrderId: string;
  customerOrderId: string;
  status: string;
  orderDate: number;
  orderLines: {
    orderLine: WalmartOrderLine[];
  };
}

export interface WalmartOrdersResponse {
  list: {
    meta: {
      totalCount: number;
      limit: number;
      nextCursor?: string;
    };
    elements: {
      order: WalmartOrder[];
    };
  };
}
