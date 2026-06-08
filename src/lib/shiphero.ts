const REFRESH_URL = "https://public-api.shiphero.com/auth/refresh";
const GQL_URL     = "https://public-api.shiphero.com/graphql";

let cachedToken: string | null = process.env.SHIPHERO_API_TOKEN ?? null;
let tokenExpiry = cachedToken ? Date.now() + 23 * 60 * 60 * 1000 : 0;

async function refreshToken(): Promise<string> {
  const rt = process.env.SHIPHERO_REFRESH_TOKEN;
  if (!rt) throw new Error("ShipHero: SHIPHERO_REFRESH_TOKEN not set");

  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  });

  if (!res.ok) throw new Error(`ShipHero token refresh failed: ${res.status}`);

  const json = await res.json();
  const token = json?.token ?? json?.access_token ?? json?.data?.token;
  if (!token) throw new Error("ShipHero: no token in refresh response");
  return token;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const token = await refreshToken();
  cachedToken = token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return token;
}

export interface WarehouseStock {
  warehouse: string;
  available: number;
}

export async function getShipHeroInventory(sku: string): Promise<WarehouseStock[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();

    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query($sku: String) {
          product(sku: $sku) {
            data {
              warehouse_products {
                warehouse_identifier
                available
              }
            }
          }
        }`,
        variables: { sku },
      }),
    });

    if (res.status === 401) {
      cachedToken = null;
      tokenExpiry = 0;
      continue;
    }

    if (!res.ok) return null;

    const json = await res.json();
    const wps: { warehouse_identifier: string; available: number }[] =
      json?.data?.product?.data?.warehouse_products ?? [];

    if (wps.length === 0) return null;

    return wps.map((wp) => ({
      warehouse: wp.warehouse_identifier ?? "",
      available: wp.available ?? 0,
    }));
  }

  return null;
}
