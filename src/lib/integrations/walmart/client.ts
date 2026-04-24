import { randomUUID } from "crypto";
import type { WalmartConfig } from "@/lib/integrations/walmart/config";
import type {
  WalmartOrder,
  WalmartOrdersResponse,
} from "@/lib/integrations/walmart/types";

const TOKEN_ENDPOINT_PRODUCTION = "https://marketplace.walmartapis.com/v3/token";
const TOKEN_ENDPOINT_SANDBOX = "https://sandbox.walmartapis.com/v3/token";

// Refresh token 5 minutes before it actually expires
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

export interface WalmartTokenResult {
  accessToken: string;
  expiresAt: string;
  isNew: boolean;
}

export class WalmartClient {
  private baseUrl: string;

  constructor(private config: WalmartConfig) {
    this.baseUrl =
      config.environment === "sandbox"
        ? "https://sandbox.walmartapis.com"
        : "https://marketplace.walmartapis.com";
  }

  static isTokenValid(config: WalmartConfig): boolean {
    if (!config.accessToken || !config.accessTokenExpiresAt) return false;
    return new Date(config.accessTokenExpiresAt).getTime() - Date.now() > TOKEN_BUFFER_MS;
  }

  static async fetchToken(
    clientId: string,
    clientSecret: string,
    environment: "sandbox" | "production"
  ): Promise<{ accessToken: string; expiresAt: string }> {
    const tokenUrl =
      environment === "sandbox" ? TOKEN_ENDPOINT_SANDBOX : TOKEN_ENDPOINT_PRODUCTION;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "WM_SVC.NAME": "Walmart Marketplace",
        "WM_QOS.CORRELATION_ID": randomUUID(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Walmart token request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    const accessToken = data.access_token as string;
    const expiresIn = (data.expires_in as number) ?? 900;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return { accessToken, expiresAt };
  }

  async ensureToken(): Promise<WalmartTokenResult> {
    if (WalmartClient.isTokenValid(this.config)) {
      return {
        accessToken: this.config.accessToken!,
        expiresAt: this.config.accessTokenExpiresAt!,
        isNew: false,
      };
    }

    const { accessToken, expiresAt } = await WalmartClient.fetchToken(
      this.config.clientId,
      this.config.clientSecret,
      this.config.environment
    );

    this.config.accessToken = accessToken;
    this.config.accessTokenExpiresAt = expiresAt;

    return { accessToken, expiresAt, isNew: true };
  }

  private async request<T>(path: string, accessToken: string): Promise<T> {
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        "WM_SEC.ACCESS_TOKEN": accessToken,
        "WM_SVC.NAME": "Walmart Marketplace",
        "WM_QOS.CORRELATION_ID": randomUUID(),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Walmart API error (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async getOrders(params: {
    createdStartDate?: string;
    createdEndDate?: string;
    limit?: number;
  }): Promise<{ orders: WalmartOrder[]; nextCursor: string | null }> {
    const { accessToken } = await this.ensureToken();
    const query = new URLSearchParams();

    if (params.createdStartDate) query.set("createdStartDate", params.createdStartDate);
    if (params.createdEndDate) query.set("createdEndDate", params.createdEndDate);
    query.set("limit", String(params.limit ?? 200));

    const data = await this.request<WalmartOrdersResponse>(
      `/v3/orders?${query.toString()}`,
      accessToken
    );

    return {
      orders: data.list?.elements?.order ?? [],
      nextCursor: data.list?.meta?.nextCursor ?? null,
    };
  }

  async getOrdersFromCursor(
    cursor: string
  ): Promise<{ orders: WalmartOrder[]; nextCursor: string | null }> {
    const { accessToken } = await this.ensureToken();

    const data = await this.request<WalmartOrdersResponse>(
      `/v3/orders?nextCursor=${encodeURIComponent(cursor)}`,
      accessToken
    );

    return {
      orders: data.list?.elements?.order ?? [],
      nextCursor: data.list?.meta?.nextCursor ?? null,
    };
  }

  async testConnection(): Promise<void> {
    const { accessToken } = await this.ensureToken();
    await this.request<unknown>("/v3/feeds?feedType=item&limit=1", accessToken);
  }
}
