export function getOpenApiDocument(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Commerce Integration API",
      version: "1.0.0",
      description:
        "Current API map for the Next.js App Router backend in this repository.",
    },
    servers: [
      {
        url: `${baseUrl}/api`,
        description: "Current application server",
      },
    ],
    tags: [
      { name: "Auth" },
      { name: "SKUs" },
      { name: "Inventory" },
      { name: "Orders" },
      { name: "Sales" },
      { name: "Analytics" },
      { name: "Collections" },
      { name: "Integrations" },
      { name: "Settings" },
      { name: "Admin" },
      { name: "Background" },
    ],
    paths: {
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new user",
          responses: {
            "200": { description: "User registered" },
            "400": { description: "Validation error" },
          },
        },
      },
      "/skus": {
        get: {
          tags: ["SKUs"],
          summary: "List SKUs aggregated by master SKU",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "sortBy", in: "query", schema: { type: "string" } },
            { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
            { name: "salesPeriod", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": { description: "Aggregated SKU list" },
          },
        },
        post: {
          tags: ["SKUs"],
          summary: "Create one SKU",
          responses: {
            "201": { description: "SKU created" },
            "400": { description: "Validation error" },
          },
        },
      },
      "/skus/{id}": {
        get: {
          tags: ["SKUs"],
          summary: "Get one SKU",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "SKU detail" },
            "404": { description: "SKU not found" },
          },
        },
        patch: {
          tags: ["SKUs"],
          summary: "Update one SKU",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "SKU updated" },
            "400": { description: "Validation error" },
          },
        },
        delete: {
          tags: ["SKUs"],
          summary: "Delete one SKU",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "SKU deleted" },
          },
        },
      },
      "/skus/bulk": {
        delete: {
          tags: ["SKUs"],
          summary: "Delete multiple SKUs",
          responses: {
            "200": { description: "Bulk delete completed" },
          },
        },
      },
      "/skus/backfill-master": {
        get: {
          tags: ["SKUs"],
          summary: "Get master SKU backfill status",
          responses: {
            "200": { description: "Backfill stats" },
          },
        },
        post: {
          tags: ["SKUs"],
          summary: "Backfill master SKU codes into SKU and sales data",
          responses: {
            "200": { description: "Backfill executed" },
          },
        },
      },
      "/inventory": {
        get: {
          tags: ["Inventory"],
          summary: "List external inventory rows",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } },
            {
              name: "groupBy",
              in: "query",
              schema: { type: "string", enum: ["warehouse", "product"] },
            },
            { name: "warehouse", in: "query", schema: { type: "string" } },
            { name: "sortBy", in: "query", schema: { type: "string" } },
            { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
            { name: "exportAll", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": { description: "Inventory result from external lookup database" },
          },
        },
      },
      "/orders": {
        get: {
          tags: ["Orders"],
          summary: "List external sales orders",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "platformSource", in: "query", schema: { type: "string" } },
            { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
            { name: "endDate", in: "query", schema: { type: "string", format: "date" } },
            { name: "sortBy", in: "query", schema: { type: "string" } },
            { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
            { name: "exportAll", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": { description: "Sales order list from external lookup database" },
          },
        },
      },
      "/orders/{id}": {
        get: {
          tags: ["Orders"],
          summary: "Get one sales order with line items",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: {
            "200": { description: "Sales order detail with line items" },
            "404": { description: "Order not found" },
          },
        },
      },
      "/sales": {
        get: {
          tags: ["Sales"],
          summary: "Query sales data",
          responses: {
            "200": { description: "Sales query result" },
          },
        },
        post: {
          tags: ["Sales"],
          summary: "Create one or more sales records",
          responses: {
            "200": { description: "Sales records created" },
          },
        },
      },
      "/sales/import": {
        get: {
          tags: ["Sales"],
          summary: "Download sales CSV import template",
          responses: {
            "200": { description: "CSV template" },
          },
        },
        post: {
          tags: ["Sales"],
          summary: "Import sales from CSV payload",
          responses: {
            "200": { description: "Import result" },
          },
        },
      },
      "/analytics/dashboard": {
        get: {
          tags: ["Analytics"],
          summary: "Get dashboard metrics",
          responses: {
            "200": { description: "Dashboard analytics" },
          },
        },
      },
      "/collections": {
        get: {
          tags: ["Collections"],
          summary: "List collections",
          responses: {
            "200": { description: "Collection list" },
          },
        },
        post: {
          tags: ["Collections"],
          summary: "Create one collection",
          responses: {
            "201": { description: "Collection created" },
          },
        },
      },
      "/collections/{id}": {
        get: {
          tags: ["Collections"],
          summary: "Get one collection",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Collection detail" },
          },
        },
        patch: {
          tags: ["Collections"],
          summary: "Update one collection",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Collection updated" },
          },
        },
        delete: {
          tags: ["Collections"],
          summary: "Delete one collection",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Collection deleted" },
          },
        },
      },
      "/integrations": {
        get: {
          tags: ["Integrations"],
          summary: "List platform integrations",
          responses: {
            "200": { description: "Integration list" },
          },
        },
        post: {
          tags: ["Integrations"],
          summary: "Create one integration",
          responses: {
            "201": { description: "Integration created" },
          },
        },
      },
      "/integrations/{id}": {
        get: {
          tags: ["Integrations"],
          summary: "Get one integration",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Integration detail" },
          },
        },
        patch: {
          tags: ["Integrations"],
          summary: "Update one integration",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Integration updated" },
          },
        },
        delete: {
          tags: ["Integrations"],
          summary: "Delete one integration",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Integration deleted" },
          },
        },
      },
      "/integrations/{id}/check": {
        post: {
          tags: ["Integrations"],
          summary: "Check whether saved integration credentials are usable",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Integration check result" },
          },
        },
      },
      "/integrations/{id}/sync": {
        get: {
          tags: ["Integrations"],
          summary: "Get sync status for one integration",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Sync status" },
          },
        },
        post: {
          tags: ["Integrations"],
          summary: "Trigger a sync for one integration",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Sync triggered" },
          },
        },
      },
      "/settings/menu": {
        get: {
          tags: ["Settings"],
          summary: "Get menu visibility for the current user",
          responses: {
            "200": { description: "Menu visibility" },
            "401": { description: "Unauthorized" },
          },
        },
        patch: {
          tags: ["Settings"],
          summary: "Update menu visibility for the current user",
          responses: {
            "200": { description: "Menu visibility updated" },
            "403": { description: "Forbidden" },
          },
        },
      },
      "/settings/profile": {
        get: {
          tags: ["Settings"],
          summary: "Get the current user profile",
          responses: {
            "200": { description: "Profile result" },
          },
        },
        patch: {
          tags: ["Settings"],
          summary: "Update the current user profile",
          responses: {
            "200": { description: "Profile updated" },
          },
        },
      },
      "/admin/users": {
        get: {
          tags: ["Admin"],
          summary: "List users and menu visibility",
          responses: {
            "200": { description: "User list" },
            "403": { description: "Forbidden" },
          },
        },
      },
      "/admin/users/{userId}/menu": {
        patch: {
          tags: ["Admin"],
          summary: "Update menu visibility for one user",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Menu visibility updated" },
          },
        },
      },
      "/admin/users/{userId}/role": {
        patch: {
          tags: ["Admin"],
          summary: "Update role for one user",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Role updated" },
          },
        },
      },
      "/inngest": {
        get: {
          tags: ["Background"],
          summary: "Inngest serve handler",
          responses: {
            "200": { description: "Inngest endpoint" },
          },
        },
        post: {
          tags: ["Background"],
          summary: "Inngest event handler",
          responses: {
            "200": { description: "Inngest event accepted" },
          },
        },
        put: {
          tags: ["Background"],
          summary: "Inngest auxiliary handler",
          responses: {
            "200": { description: "Inngest request handled" },
          },
        },
      },
    },
  };
}
