import type {
  ShopifyConfig,
  ShopifyOrder,
  ShopifyOrdersResponse,
} from "@/lib/integrations/shopify/types";

export class ShopifyClient {
  private config: ShopifyConfig;
  private baseUrl: string;

  constructor(config: ShopifyConfig) {
    this.config = config;
    this.baseUrl = `https://${config.shopDomain}/admin/api/${config.apiVersion}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ data: T; headers: Headers }> {
    const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.config.accessToken,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify API error (${response.status}) [${url}]: ${error}`);
    }

    const data = await response.json();
    return { data, headers: response.headers };
  }

  private parseNextPageUrl(linkHeader: string | null): string | null {
    if (!linkHeader) {
      return null;
    }

    const links = linkHeader.split(",");
    for (const link of links) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  async getOrders(params: {
    created_at_min?: string;
    created_at_max?: string;
    status?: "open" | "closed" | "cancelled" | "any";
    limit?: number;
  }): Promise<{ orders: ShopifyOrder[]; nextPageUrl: string | null }> {
    const queryParams = new URLSearchParams();

    if (params.created_at_min) {
      queryParams.set("created_at_min", params.created_at_min);
    }

    if (params.created_at_max) {
      queryParams.set("created_at_max", params.created_at_max);
    }

    if (params.status) {
      queryParams.set("status", params.status);
    }

    queryParams.set("limit", String(params.limit || 250));

    const { data, headers } = await this.request<ShopifyOrdersResponse>(
      `/orders.json?${queryParams.toString()}`
    );

    return {
      orders: data.orders,
      nextPageUrl: this.parseNextPageUrl(headers.get("link")),
    };
  }

  async getOrdersFromUrl(url: string): Promise<{ orders: ShopifyOrder[]; nextPageUrl: string | null }> {
    const { data, headers } = await this.request<ShopifyOrdersResponse>(url);

    return {
      orders: data.orders,
      nextPageUrl: this.parseNextPageUrl(headers.get("link")),
    };
  }

  async testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }> {
    try {
      const { data } = await this.request<{ shop: { name: string } }>("/shop.json");
      return { success: true, shopName: data.shop.name };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
