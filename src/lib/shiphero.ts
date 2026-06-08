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

export interface ShipHeroAddress {
  first_name:   string | null;
  last_name:    string | null;
  address1:     string | null;
  address2:     string | null;
  city:         string | null;
  state:        string | null;
  state_code:   string | null;
  zip:          string | null;
  country:      string | null;
  country_code: string | null;
  email:        string | null;
  phone:        string | null;
  company:      string | null;
}

export interface ShipHeroLineItem {
  id:  string;
  sku: string | null;
}

export interface ShipHeroOrderInfo {
  id:               string;
  order_number:     string;
  shop_name:        string | null;
  shipping_address: ShipHeroAddress;
  line_items:       ShipHeroLineItem[];
}

export interface CreateOrderLineItem {
  sku:                          string;
  quantity:                     number;
  product_name:                 string;
  price:                        string;
  fulfillment_status:           string;
  quantity_pending_fulfillment: number;
  partner_line_item_id:         string;
}

export interface CreateOrderInput {
  order_number:      string;
  shop_name:         string | null;
  fulfillment_status: string;
  shipping_lines:    { title: string; price: string };
  shipping_address:  ShipHeroAddress;
  billing_address:   ShipHeroAddress;
  line_items:        CreateOrderLineItem[];
}

export interface CreatedOrderResult {
  id:           string;
  order_number: string;
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

export async function getShipHeroOrder(orderNumber: string): Promise<ShipHeroOrderInfo | null> {
  const cleanedNumber = orderNumber;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();

    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query($orderNumber: String) {
          orders(order_number: $orderNumber) {
            data {
              edges {
                node {
                  id
                  order_number
                  shop_name
                  shipping_address {
                    first_name last_name address1 address2
                    city state state_code zip country country_code email phone company
                  }
                  line_items {
                    edges {
                      node { id sku }
                    }
                  }
                }
              }
            }
          }
        }`,
        variables: { orderNumber: cleanedNumber },
      }),
    });

    if (res.status === 401) {
      cachedToken = null;
      tokenExpiry = 0;
      continue;
    }

    if (!res.ok) return null;

    const json = await res.json();
    const node = json?.data?.orders?.data?.edges?.[0]?.node;
    if (!node) return null;

    return {
      id:               node.id ?? "",
      order_number:     node.order_number ?? cleanedNumber,
      shop_name:        node.shop_name ?? null,
      shipping_address: node.shipping_address ?? {},
      line_items: (node.line_items?.edges ?? []).map(
        (e: { node: { id: string; sku: string | null } }) => ({ id: e.node.id, sku: e.node.sku ?? null })
      ),
    };
  }

  return null;
}

function toGqlInput(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) return `[${obj.map(toGqlInput).join(", ")}]`;
  if (typeof obj === "object") {
    const fields = Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${toGqlInput(v)}`)
      .join(", ");
    return `{ ${fields} }`;
  }
  return String(obj);
}

export async function updateShipHeroLineItemSku(
  lineItemId: string,
  newSku: string
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();

    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `mutation {
          line_item_update(data: { line_item_id: ${JSON.stringify(lineItemId)}, sku: ${JSON.stringify(newSku)} }) {
            request_id
            line_item { id sku }
          }
        }`,
      }),
    });

    if (res.status === 401) {
      cachedToken = null;
      tokenExpiry = 0;
      continue;
    }

    if (!res.ok) return false;

    const json = await res.json();

    if (json?.errors?.length) {
      console.error("[updateShipHeroLineItemSku] GraphQL error:", json.errors[0]?.message);
      return false;
    }

    return !!json?.data?.line_item_update?.line_item;
  }

  return false;
}

export async function createShipHeroOrder(data: CreateOrderInput): Promise<CreatedOrderResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();

    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `mutation {
          order_create(data: ${toGqlInput(data)}) {
            request_id
            order {
              id
              order_number
            }
          }
        }`,
      }),
    });

    if (res.status === 401) {
      cachedToken = null;
      tokenExpiry = 0;
      continue;
    }

    if (!res.ok) return null;

    const json = await res.json();

    if (json?.errors?.length) {
      console.error("[createShipHeroOrder] GraphQL error:", json.errors[0]?.message);
      return null;
    }

    const order = json?.data?.order_create?.order;
    if (!order) return null;

    return { id: order.id, order_number: order.order_number };
  }

  return null;
}
