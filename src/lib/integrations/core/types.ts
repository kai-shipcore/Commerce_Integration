export type MarketplacePlatform = "shopify" | "walmart" | "ebay" | "amazon";

export type IntegrationConfig = Record<string, unknown>;

export type ConnectionCheckStatus =
  | "connected"
  | "credentials_saved"
  | "incomplete"
  | "failed";

export interface ConnectionCheckResult {
  success: boolean;
  status: ConnectionCheckStatus;
  verification: "live" | "config_only";
  message: string;
  checkedAt: string;
}

export interface SyncResult {
  success: boolean;
  ordersProcessed: number;
  salesRecordsCreated: number;
  skusCreated: number;
  errors: string[];
}

export interface NormalizedLineItem {
  externalLineItemId?: string;
  sku: string;
  title?: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  fulfillmentStatus?: string | null;
  fulfilledAt?: string | null;
}

export interface NormalizedOrder {
  externalOrderId: string;
  orderDisplayId: string;
  orderedAt: string;
  cancelledAt?: string | null;
  currency?: string | null;
  lineItems: NormalizedLineItem[];
}
