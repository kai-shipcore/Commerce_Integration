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
      { name: "Integrations" },
      { name: "Settings" },
      { name: "Admin" },
      { name: "Background" },
      { name: "Containers" },
      { name: "Docs" },
      { name: "Factories" },
      { name: "Forecast" },
      { name: "Home" },
      { name: "Planning" },
      { name: "Production" },
      { name: "Purchase Orders" },
      { name: "User" },
      { name: "Velocity" },
      { name: "Warehouses" },
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
      "/auth/{...nextauth}": {
        get: {
          tags: ["Auth"],
          summary: "NextAuth.js catch-all handler (session, callback, signin, signout, csrf, providers, etc.)",
          parameters: [
            { name: "...nextauth", in: "path", required: true, schema: { type: "string" }, description: "NextAuth internal action segments" },
          ],
          responses: {
            "200": { description: "NextAuth response (shape depends on the action segment)" },
          },
        },
        post: {
          tags: ["Auth"],
          summary: "NextAuth.js catch-all handler (signin, signout, callback, etc.)",
          parameters: [
            { name: "...nextauth", in: "path", required: true, schema: { type: "string" }, description: "NextAuth internal action segments" },
          ],
          responses: {
            "200": { description: "NextAuth response (shape depends on the action segment)" },
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
      "/admin/audit-log": {
        get: {
          tags: ["Admin"],
          summary: "List audit log entries across containers, invoices, and general entities",
          parameters: [
            { name: "user", in: "query", schema: { type: "string" }, description: "Free-text match on actor name/email/id" },
            { name: "entity", in: "query", schema: { type: "string" }, description: "Free-text match on entity label/id/before/after/note" },
            { name: "entityId", in: "query", schema: { type: "string" } },
            { name: "entityType", in: "query", schema: { type: "string", enum: ["container", "invoice", "factory", "warehouse", "sku", "user_permission", "user_role", "integration"] } },
            { name: "action", in: "query", schema: { type: "string" }, description: "One of the known audit action values (e.g. create, update, delete, role_change)" },
            { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
            { name: "endDate", in: "query", schema: { type: "string", format: "date" } },
            { name: "export", in: "query", schema: { type: "string", enum: ["1"] }, description: "When '1', raises the page size to 5000 for export" },
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": { description: "Paginated audit log entries" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/admin/import-containers": {
        get: {
          tags: ["Admin"],
          summary: "Get the current container-import job status, or subscribe to its log via SSE (?stream=1)",
          parameters: [
            { name: "stream", in: "query", schema: { type: "string", enum: ["1"] }, description: "When '1', responds with a text/event-stream of log lines instead of a status JSON" },
          ],
          responses: {
            "200": { description: "Job status JSON, or an SSE stream when stream=1" },
            "403": { description: "Forbidden" },
          },
        },
        post: {
          tags: ["Admin"],
          summary: "Start a container-import run from a Google Sheet URL (fire-and-forget child process, streams progress via SSE)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string" },
                    tab: { type: "string" },
                    dryRun: { type: "boolean" },
                    forceDownload: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "SSE stream of import log lines, ending with a done event" },
            "403": { description: "Forbidden" },
            "409": { description: "An import is already in progress" },
            "422": { description: "url is required" },
          },
        },
        delete: {
          tags: ["Admin"],
          summary: "Cancel the active container-import run",
          responses: {
            "200": { description: "Run cancelled" },
            "403": { description: "Forbidden" },
            "404": { description: "No active run" },
          },
        },
      },
      "/admin/role-permissions": {
        get: {
          tags: ["Admin"],
          summary: "Get the permission matrix for every managed role (cached 10 min)",
          responses: {
            "200": { description: "Map of role -> section -> action -> allowed" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        },
        put: {
          tags: ["Admin"],
          summary: "Replace one role's full permission matrix",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["role", "permissions"],
                  properties: {
                    role: { type: "string" },
                    permissions: { type: "object", description: "section -> action -> allowed" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Permissions saved" },
            "400": { description: "Invalid role or permissions" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        },
      },
      "/admin/user-activity": {
        get: {
          tags: ["Admin"],
          summary: "Get org-wide user activity summary, daily trend, and per-user activity rows",
          parameters: [
            { name: "days", in: "query", schema: { type: "integer", enum: [7, 30, 90] }, description: "Trend window; defaults to 30 if not one of 7/30/90" },
          ],
          responses: {
            "200": { description: "Activity summary + trend + per-user rows" },
            "403": { description: "Forbidden" },
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
      "/admin/users/{userId}/activity-timeline": {
        get: {
          tags: ["Admin"],
          summary: "Get one user's merged activity timeline (button clicks, logins, audit log) for a single day",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
            { name: "date", in: "query", schema: { type: "string", format: "date" }, description: "Defaults to today (America/Los_Angeles)" },
          ],
          responses: {
            "200": { description: "User info + that day's merged, chronologically sorted events" },
            "403": { description: "Forbidden" },
            "404": { description: "User not found" },
          },
        },
      },
      "/admin/users/{userId}/login-history": {
        get: {
          tags: ["Admin"],
          summary: "Get a user's 10 most recent login records",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Up to 10 login records (id, loggedInAt, ip, userAgent)" },
            "401": { description: "Unauthorized" },
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
      "/admin/users/{userId}/name": {
        patch: {
          tags: ["Admin"],
          summary: "Rename one user (admin-only, audit logged)",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: { name: { type: "string", minLength: 1 } },
                },
              },
            },
          },
          responses: {
            "200": { description: "User renamed" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "User not found" },
          },
        },
      },
      "/admin/users/{userId}/permission-overrides": {
        get: {
          tags: ["Admin"],
          summary: "List a user's permission overrides (exceptions to their role defaults, cached 10 min)",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "List of {section, action, allowed} overrides" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        },
        post: {
          tags: ["Admin"],
          summary: "Add or update one permission override for a user",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["section", "action", "allowed"],
                  properties: {
                    section: { type: "string" },
                    action: { type: "string" },
                    allowed: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Override saved" },
            "400": { description: "Invalid section/action/allowed" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        },
        delete: {
          tags: ["Admin"],
          summary: "Remove one permission override for a user",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["section", "action"],
                  properties: {
                    section: { type: "string" },
                    action: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Override removed" },
            "400": { description: "Invalid section/action" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
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
      "/admin/users/{userId}/status": {
        patch: {
          tags: ["Admin"],
          summary: "Toggle a user's active/inactive status (blocked for self, and for the last active admin)",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Status toggled" },
            "400": { description: "Cannot change own status, or cannot deactivate the last active admin" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "User not found" },
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
      "/auth/forgot-password": {
        post: {
          tags: ["Auth"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/auth/reset-password": {
        post: {
          tags: ["Auth"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/container-available-stock": {
        get: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/containers/{id}/history": {
        get: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        put: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/containers": {
        get: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Containers"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/factories/{id}": {
        put: {
          tags: ["Factories"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Factories"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/factories": {
        get: {
          tags: ["Factories"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Factories"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast-server/start": {
        post: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast-server/status": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast-server/stop": {
        post: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/{sku}/accuracy": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "sku", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/{sku}/backtest": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "sku", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/{sku}/history": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "sku", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/{sku}": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "sku", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/accuracy-history": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/all-skus": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/backtest-cycles": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/bounds": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/cancel/{jobId}": {
        post: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "jobId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/chat": {
        post: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/config": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        put: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/demand-trend": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/last-run": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/run": {
        post: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/segment/{segment}": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "segment", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/segment/{segment}/simulate/cancel/{jobId}": {
        post: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "segment", in: "path", required: true, schema: { type: "string" } },
            { name: "jobId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/segment/{segment}/simulate/result": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "segment", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/segment/{segment}/simulate": {
        post: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "segment", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/segmentation": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/sku-search": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/forecast/status/{jobId}": {
        get: {
          tags: ["Forecast"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "jobId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/home/sales-trend": {
        get: {
          tags: ["Home"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/integrations/{id}/ebay-auth": {
        get: {
          tags: ["Integrations"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/integrations/ebay-callback": {
        get: {
          tags: ["Integrations"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/openapi": {
        get: {
          tags: ["Docs"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/action-list": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/containers/{id}/auto-fill": {
        post: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/containers/items/{id}": {
        delete: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/containers/items": {
        post: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/dashboard": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/home-stats": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/not-forecast": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/oos-impact/preorder": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/oos-impact/recovery/drilldown": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/oos-impact/recovery": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/oos-impact/top-sellers": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/products/{sku}": {
        patch: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "sku", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/sku-forecasts/inbound-history": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/sku-forecasts/inbound": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/sku-forecasts/sales-history": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/sku-master": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        put: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/sku-notes": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        put: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/sku/{sku}/memo": {
        patch: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "sku", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/sku/{sku}": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "sku", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/stats/oos-lost-demand-weights": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/stats/refresh": {
        post: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/transit-records/{id}": {
        patch: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/transit-records/import": {
        post: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/transit-records": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/planning/warehouses": {
        get: {
          tags: ["Planning"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/product-vehicles/sync": {
        post: {
          tags: ["Integrations"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/assignable-users": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/codes/{id}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/codes": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/credit-notes/{id}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/credit-notes/bulk": {
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/credit-notes": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/designer-initials/{id}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/designer-initials": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}/attachment": {
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}/generated-invoice": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}/items/{itemId}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "itemId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "itemId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}/items/import": {
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}/items/imports/{sourceFileId}": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "sourceFileId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "sourceFileId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}/items/imports": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}/items": {
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}/recompare": {
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices/{id}": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/invoices": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/part-skus/{id}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/part-skus": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/parts/{id}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/parts": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/price-history/files/{id}": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/price-history": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        put: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/product-vehicles/{id}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/product-vehicles": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/products/{id}/projects": {
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/products/{id}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/products": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/projects/{id}/checklist/{itemId}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "itemId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "itemId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/projects/{id}/checklist": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/projects/{id}/parts/{partId}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "partId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "partId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/projects/{id}/parts": {
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/projects/{id}": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/seat-cover-parts/{id}": {
        patch: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/seat-cover-parts": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/production/vehicle-options": {
        get: {
          tags: ["Production"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/products/sync": {
        post: {
          tags: ["Integrations"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/purchase-orders": {
        get: {
          tags: ["Purchase Orders"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Purchase Orders"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        patch: {
          tags: ["Purchase Orders"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Purchase Orders"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/settings/password": {
        patch: {
          tags: ["Settings"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/sku-mappings/sync": {
        post: {
          tags: ["Integrations"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/swagger-ui/{...file}": {
        get: {
          tags: ["Docs"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "file", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/user/activity/events": {
        post: {
          tags: ["User"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/user/activity": {
        post: {
          tags: ["User"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/user/permissions": {
        get: {
          tags: ["User"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/user/preferences": {
        get: {
          tags: ["User"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        put: {
          tags: ["User"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/velocity/channels": {
        get: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/velocity/custom-enrich": {
        get: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/velocity/data": {
        get: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/velocity/preorder-enrich": {
        get: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/velocity": {
        get: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/velocity/sales-export": {
        get: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/velocity/sync": {
        get: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/velocity/ttm-enrich": {
        get: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Velocity"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/warehouses/{id}": {
        patch: {
          tags: ["Warehouses"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
        delete: {
          tags: ["Warehouses"],
          summary: "TODO: undocumented (auto-generated stub)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
          },
        },
      },
      "/warehouses": {
        get: {
          tags: ["Warehouses"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
        post: {
          tags: ["Warehouses"],
          summary: "TODO: undocumented (auto-generated stub)",
          responses: {
            "200": { description: "Success" },
          },
        },
      },
    },
  };
}
