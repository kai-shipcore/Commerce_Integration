export interface ShopifyConfig extends Record<string, unknown> {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

export interface ShopifyLineItem {
  id: number;
  sku: string;
  name: string;
  title: string;
  variant_title: string | null;
  quantity: number;
  price: string;
  fulfillment_status: string | null;
  product_id: number | null;
  variant_id: number | null;
  vendor: string | null;
  properties: Array<{ name: string; value: string }>;
  product_exists: boolean;
  grams: number;
  requires_shipping: boolean;
  taxable: boolean;
  gift_card: boolean;
}

export interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  line_items: ShopifyLineItem[];
  total_price: string;
  subtotal_price: string;
  cancelled_at: string | null;
}

export interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}
