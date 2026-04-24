export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  environment: "production" | "sandbox";
}

export interface EbayLineItem {
  lineItemId: string;
  title: string;
  quantity: number;
  sku?: string;
  lineItemFulfillmentStatus: string;
  lineItemCost: { value: string; currency: string };
  deliveredDate?: string;
}

export interface EbayOrder {
  orderId: string;
  creationDate: string;
  cancelStatus?: { cancelState: string };
  orderFulfillmentStatus: string;
  lineItems: EbayLineItem[];
}

export interface EbayOrdersResponse {
  orders: EbayOrder[];
  total: number;
  limit: number;
  offset: number;
  next?: string;
}
