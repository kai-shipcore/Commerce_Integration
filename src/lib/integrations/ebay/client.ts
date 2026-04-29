import type { EbayConfig, EbayOrder, EbayOrdersResponse } from "@/lib/integrations/ebay/types";

export class EbayClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly authUrl: string;
  private readonly oauthBaseUrl: string;

  constructor(config: EbayConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    const root =
      config.environment === "sandbox"
        ? "https://api.sandbox.ebay.com"
        : "https://api.ebay.com";
    this.baseUrl = root;
    this.authUrl = `${root}/identity/v1/oauth2/token`;
    this.oauthBaseUrl =
      config.environment === "sandbox"
        ? "https://auth.sandbox.ebay.com"
        : "https://auth.ebay.com";
  }

  private get basicAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
  }

  buildAuthorizationUrl(ruName: string, state: string): string {
    const scope = [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    ].join(" ");

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: ruName,
      scope,
      state,
    });

    return `${this.oauthBaseUrl}/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(
    code: string,
    ruName: string
  ): Promise<{ accessToken: string; refreshToken: string; refreshTokenExpiresAt: string }> {
    const response = await fetch(this.authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: this.basicAuthHeader,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: ruName,
      }).toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `eBay token exchange failed: ${data?.error_description ?? data?.error ?? response.statusText}`
      );
    }

    const refreshTokenExpiresAt = new Date(
      Date.now() + (Number(data.refresh_token_expires_in) || 0) * 1000
    ).toISOString();

    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      refreshTokenExpiresAt,
    };
  }

  async getValidAccessToken(refreshToken: string): Promise<string> {
    const response = await fetch(this.authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: this.basicAuthHeader,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      const desc = data?.error_description ?? data?.error ?? response.statusText;
      if (data?.error === "invalid_grant") {
        throw new Error(`REFRESH_TOKEN_EXPIRED: ${desc}`);
      }
      throw new Error(`eBay auth failed (${data?.error ?? response.status}): ${desc}`);
    }

    return data.access_token as string;
  }

  async getOrders(params: {
    accessToken: string;
    createdAtMin?: string;
    offset?: number;
    limit?: number;
  }): Promise<{ orders: EbayOrder[]; nextOffset: number | null }> {
    const limit = params.limit ?? 200;
    const offset = params.offset ?? 0;

    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    if (params.createdAtMin) {
      const now = new Date().toISOString();
      // "creationdate" is the eBay API filter parameter name (not a typo)
      query.set("filter", `creationdate:[${params.createdAtMin}..${now}]`);
    }

    const url = `${this.baseUrl}/sell/fulfillment/v1/order?${query.toString()}`;
    console.log("[eBay] GET", url);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[eBay] Orders API error:", response.status, error);
      throw new Error(`eBay Orders API error (${response.status}): ${error}`);
    }

    const data: EbayOrdersResponse = await response.json();
    const orders = data.orders ?? [];
    const nextOffset = data.next && orders.length === limit ? offset + limit : null;

    console.log(`[eBay] Response: total=${data.total}, returned=${orders.length}, next=${data.next ?? "none"}`);
    if (orders.length > 0) {
      const sample = orders[0];
      console.log("[eBay] First order:", {
        orderId: sample.orderId,
        creationDate: sample.creationDate,
        lineItems: sample.lineItems.map((li) => ({ sku: li.sku ?? "(no sku)", title: li.title, qty: li.quantity })),
      });
    }

    return { orders, nextOffset };
  }

  async testConnection(
    refreshToken: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const accessToken = await this.getValidAccessToken(refreshToken);
      await this.getOrders({ accessToken, limit: 1 });
      return { success: true };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
