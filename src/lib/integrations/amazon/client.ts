const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

const MARKETPLACE_ENDPOINTS: Record<string, string> = {
  // North America
  ATVPDKIKX0DER: "https://sellingpartnerapi-na.amazon.com", // US
  A2EUQ1WTGCTBG2: "https://sellingpartnerapi-na.amazon.com", // CA
  A1AM78C64UM0Y8: "https://sellingpartnerapi-na.amazon.com", // MX
  A2Q3Y263D00KWC: "https://sellingpartnerapi-na.amazon.com", // BR
  // Europe
  A1F83G8C2ARO7P: "https://sellingpartnerapi-eu.amazon.com", // UK
  A1PA6795UKMFR9: "https://sellingpartnerapi-eu.amazon.com", // DE
  A13V1IB3VIYZZH: "https://sellingpartnerapi-eu.amazon.com", // FR
  APJ6JRA9NG5V4:  "https://sellingpartnerapi-eu.amazon.com", // IT
  A1RKKUPIHCS9HS: "https://sellingpartnerapi-eu.amazon.com", // ES
  // Far East
  A1VC38T7YXB528: "https://sellingpartnerapi-fe.amazon.com", // JP
  A39IBJ37TRP1C6: "https://sellingpartnerapi-fe.amazon.com", // AU
};

export interface AmazonOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  LastUpdateDate: string;
  OrderStatus: string;
  OrderTotal?: { Amount: string; CurrencyCode: string };
  FulfillmentChannel?: string;
  SalesChannel?: string;
  ShipCountry?: string;
  BuyerInfo?: { BuyerEmail?: string };
}

export interface AmazonOrderItem {
  OrderItemId: string;
  ASIN: string;
  SellerSKU: string;
  Title?: string;
  QuantityOrdered: number;
  ItemPrice?: { Amount: string; CurrencyCode: string };
}

export class AmazonClient {
  private readonly endpoint: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly config: {
      sellerId: string;
      marketplaceId: string;
      lwaClientId: string;
      lwaClientSecret: string;
      lwaRefreshToken: string;
    }
  ) {
    this.endpoint =
      MARKETPLACE_ENDPOINTS[config.marketplaceId] ??
      "https://sellingpartnerapi-na.amazon.com";
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const res = await fetch(LWA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.lwaRefreshToken,
        client_id: this.config.lwaClientId,
        client_secret: this.config.lwaClientSecret,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`LWA token error: ${body.error_description ?? res.statusText}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token as string;
    this.tokenExpiresAt = Date.now() + (data.expires_in as number) * 1000;
    return this.accessToken;
  }

  async getOrders(params: {
    createdAfter?: string;
    nextToken?: string;
  }): Promise<{ orders: AmazonOrder[]; nextToken?: string; rateLimited?: boolean }> {
    const token = await this.getAccessToken();
    const url = new URL(`${this.endpoint}/orders/v0/orders`);
    url.searchParams.set("MarketplaceIds", this.config.marketplaceId);
    url.searchParams.set("MaxResultsPerPage", "100");
    if (params.createdAfter) url.searchParams.set("CreatedAfter", params.createdAfter);
    if (params.nextToken) url.searchParams.set("NextToken", params.nextToken);

    const res = await fetch(url.toString(), {
      headers: { "x-amz-access-token": token, Accept: "application/json" },
    });

    if (res.status === 429) {
      return { orders: [], rateLimited: true };
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`SP-API orders error ${res.status}: ${JSON.stringify(body)}`);
    }

    const data = await res.json();
    return {
      orders: (data.payload?.Orders ?? []) as AmazonOrder[],
      nextToken: data.payload?.NextToken as string | undefined,
    };
  }

  async getOrderItems(orderId: string): Promise<AmazonOrderItem[]> {
    const token = await this.getAccessToken();
    const res = await fetch(
      `${this.endpoint}/orders/v0/orders/${orderId}/orderItems`,
      { headers: { "x-amz-access-token": token, Accept: "application/json" } }
    );

    if (res.status === 429) {
      return [];
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`SP-API order items error ${res.status}: ${JSON.stringify(body)}`);
    }

    const data = await res.json();
    return (data.payload?.OrderItems ?? []) as AmazonOrderItem[];
  }
}
