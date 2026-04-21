# Commerce Integration

Commerce Integration is an internal operations workspace for managing SKU master data, historical sales, external inventory snapshots, collections, user access, and marketplace connectivity in one Next.js application.

The project combines two data patterns:
- Operational application data stored in the main PostgreSQL database through Prisma
- Lookup and reporting data read from a separate external database for master SKU resolution, inventory snapshots, and order feeds

## What The App Does

The current application focuses on day-to-day commerce operations rather than forecasting. The main implemented areas are:

- Product catalog management for SKUs and master SKU mapping
- Historical sales tracking and manual sales import
- External inventory snapshot browsing with warehouse and grouped-product views
- External order feed browsing with filters and drill-down detail
- Dashboard and analytics built on historical sales and inventory data
- SKU collections for grouping products into reusable operational sets
- Marketplace credential management and Shopify sales sync
- User authentication, role-based access, and configurable menu visibility
- OpenAPI-backed API documentation via Swagger UI

## Current Product Areas

### Command Center
- Route: `/dashboard`
- High-level KPI cards for SKUs, collections, integrations, and low-stock items
- Sales trend chart, top sellers, and recent activity
- Data is sourced from internal operational tables and cached through Redis when available

### Products
- Route: `/skus`
- Create, edit, delete, search, sort, paginate, and export SKU records
- Track master SKU, category, cost, price, and summarized inventory
- Show sales summary by period
- Includes master-SKU backfill support for older records

### Product Detail
- Route: `/skus/[id]`
- Product summary, per-location inventory balances, recent sales history, and related web SKUs

### Inventory
- Route: `/inventory`
- Reads inventory snapshot data from the external lookup database
- Supports warehouse filtering, grouped-by-product mode, pagination, sorting, and CSV export
- Displays on-hand, allocated, available, backorder, warehouse, and snapshot timestamp values

### Orders
- Route: `/orders`
- Reads order headers and line items from the external lookup database
- Supports date presets, custom date ranges, platform filtering, search, pagination, sorting, CSV export, and detail dialogs

### Demand Signals / Sales
- Route: `/sales`
- Lists recent internal `SalesRecord` rows
- Supports filtering by platform and integration
- Includes manual entry and CSV import flows

### Collections
- Routes: `/collections`, `/collections/[id]`
- Create named SKU collections with optional description, pinning, and color coding
- Manage collection membership for merchandising, reporting, or operational grouping

### Analytics
- Route: `/analytics`
- Tabbed analytics views for overview, sales trends, and inventory status
- Built from historical sales and inventory-related data already present in the app

### Marketplace APIs
- Route: `/settings/integrations`
- Store credentials for Shopify, Amazon, eBay, and Walmart
- Check connection health
- Shopify sync is implemented today
- Amazon, eBay, and Walmart currently support credential storage and connection management, but not full sales sync

### User Access
- Route: `/settings/users`
- Admin-only screen for changing user roles and visible navigation menus

### API Docs
- Route: `/api-docs`
- Swagger UI generated from the in-app OpenAPI document exposed by `/api/openapi`

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma with PostgreSQL
- NextAuth for authentication
- Tailwind CSS 4
- Radix UI primitives
- TanStack Table and TanStack Query
- Recharts for charts
- Upstash Redis for optional caching
- Inngest client and route scaffolding for background workflows

## High-Level Architecture

### Main Database

The primary application database stores operational entities such as:

- `SKU`
- `SalesRecord`
- `InventoryBalance`
- `InventoryLocation`
- `InventoryTransaction`
- `SKUCollection` and `SKUCollectionMember`
- `PlatformIntegration`
- `User`, `Account`, `Session`

These tables back CRUD flows, authentication, dashboard metrics, and marketplace sync state.

### External Lookup Database

A separate PostgreSQL connection is used for:

- Master SKU parsing via `size_chart.fn_extract_master_sku_from_web_sku`
- Inventory snapshot reads from `ecommerce_data.coverland_inventory`
- Order and order item reads from `ecommerce_data.sales_orders` and `ecommerce_data.sales_order_items`

This keeps the internal app database separate from upstream reporting and lookup sources.

### Marketplace Sync Flow

The implemented sync path today is Shopify:

1. Store integration credentials in `PlatformIntegration`
2. Pull Shopify orders through the Admin API
3. Create missing SKUs on demand
4. Resolve master SKU mappings through the external lookup database
5. Write normalized rows into internal `SalesRecord`
6. Save sync progress and cursor state for resumable history sync

### Marketplace Integration Architecture

Marketplace integrations are now split into a shared core layer plus per-platform adapter folders so Shopify, Amazon, eBay, and Walmart can be developed independently without repeatedly editing the same files.

- `src/lib/integrations/core/*`
  Shared contracts and orchestration for adapter registration, connection checks, sync execution, SKU resolution, and normalized sales persistence
- `src/lib/integrations/shopify/*`
  Shopify-specific config validation, API client, payload mapping, and adapter logic
- `src/lib/integrations/amazon/*`
  Amazon-specific adapter scaffolding and config boundary
- `src/lib/integrations/ebay/*`
  eBay-specific adapter scaffolding and config boundary
- `src/lib/integrations/walmart/*`
  Walmart-specific adapter scaffolding and config boundary

Current ownership boundary for team work:
- Shared integration workflow changes belong in `core/*` and the integration API routes
- Platform-specific API/auth/mapping changes should stay inside that platform folder
- `src/app/api/integrations/*` and `src/lib/inngest/functions.ts` call the adapter registry instead of hard-coding per-platform logic

## Folder Structure

```text
.
├─ src/
│  ├─ app/
│  │  ├─ api/                  # Route handlers for app APIs
│  │  ├─ analytics/            # Analytics page
│  │  ├─ auth/                 # Sign-in, sign-up, auth error pages
│  │  ├─ collections/          # Collection list and detail pages
│  │  ├─ dashboard/            # Command center page
│  │  ├─ inventory/            # Inventory snapshot UI
│  │  ├─ orders/               # Order feed UI
│  │  ├─ sales/                # Sales records and import UI
│  │  ├─ settings/             # Integrations, menu, and user access pages
│  │  └─ skus/                 # Product list and detail pages
│  ├─ components/
│  │  ├─ analytics/            # Analytics widgets
│  │  ├─ auth/                 # Auth form UI
│  │  ├─ collection/           # Collection dialogs and helpers
│  │  ├─ dashboard/            # Dashboard widgets
│  │  ├─ inventory/            # Inventory table columns
│  │  ├─ layout/               # App shell, nav, theme, user menu
│  │  ├─ marketplaces/         # Marketplace icon helpers
│  │  ├─ orders/               # Orders grid and detail dialog
│  │  ├─ sales/                # Sales import and form dialogs
│  │  ├─ sku/                  # SKU forms, columns, bulk actions
│  │  └─ ui/                   # Shared UI primitives
│  └─ lib/
│     ├─ analytics/            # Analytics helpers
│     ├─ auth/                 # Password utilities
│     ├─ db/                   # Prisma and lookup DB access
│     ├─ inngest/              # Background workflow client/functions
│     ├─ integrations/
│     │  ├─ core/              # Shared adapter contracts, sync runner, and persistence
│     │  ├─ shopify/           # Shopify adapter, client, mapper, config
│     │  ├─ amazon/            # Amazon adapter scaffolding
│     │  ├─ ebay/              # eBay adapter scaffolding
│     │  └─ walmart/           # Walmart adapter scaffolding
│     ├─ openapi.ts            # OpenAPI document builder
│     └─ redis.ts              # Optional cache helpers
├─ prisma/
│  ├─ migrations/              # Prisma migrations
│  ├─ schema.prisma            # Data model
│  └─ seed.ts                  # Seed script
├─ scripts/
│  ├─ start-dev.cmd            # Convenience launcher
│  ├─ check-sku-sales.ts       # Local inspection script
│  └─ test-redis.ts            # Cache connectivity test
├─ public/                     # Static assets
├─ start-dev.cmd               # Root launcher using local Node 22 when available
└─ README.md
```

## Screen Guide

The repository does not currently ship committed screenshots, but these are the primary screens worth capturing for onboarding and product reviews.

| Screen | Route | What To Show |
| --- | --- | --- |
| Command Center | `/dashboard` | KPI cards, sales trend, top sellers, recent activity |
| Products | `/skus` | Master-SKU grouped table, filters, export, create dialog |
| Product Detail | `/skus/[id]` | Inventory balances by location and sales history chart |
| Inventory | `/inventory` | Warehouse filter, grouped-by-product toggle, summary cards |
| Orders | `/orders` | Date filters, platform filters, order list, detail dialog |
| Sales | `/sales` | Manual sales records, import flow, platform filtering |
| Collections | `/collections` | Collection cards and SKU grouping workflow |
| Marketplace APIs | `/settings/integrations` | Integration cards, connection check, sync actions |
| User Access | `/settings/users` | Role control and per-user menu visibility |
| API Docs | `/api-docs` | Swagger UI generated from `/api/openapi` |

If you want image assets later, a practical convention is:

```text
docs/
  screenshots/
    dashboard.png
    products.png
    inventory.png
    orders.png
    integrations.png
```

## ERD Summary

The complete model lives in `prisma/schema.prisma`. The most important entity relationships are summarized below.

```text
User
 ├─ Account
 └─ Session

SKU
 ├─ SalesRecord
 ├─ InventoryBalance ── InventoryLocation
 ├─ InventorySnapshot
 ├─ InventoryTransaction ── InventoryLocation
 ├─ SKUCollectionMember ── SKUCollection
 ├─ POItem ── PurchaseOrder
 ├─ TrendData
 └─ SKU (self relation for custom variants)

PlatformIntegration
 └─ SalesRecord

PurchaseOrder
 ├─ POItem ── SKU
 └─ Container
```

### Core Entity Notes

- `SKU` is the central business entity and can represent both a web SKU and a mapped master SKU family
- `SalesRecord` stores normalized sales rows and can optionally link back to a `PlatformIntegration`
- `InventoryBalance` stores per-location inventory state, while `currentStock` on `SKU` remains as a legacy summary field
- `SKUCollection` and `SKUCollectionMember` support reusable product groupings
- `PlatformIntegration` stores marketplace credentials, sync cursor state, and sync statistics
- `User` contains role and menu visibility metadata for UI-level access control
- Trend-related tables remain in the schema but are not the primary user-facing flow today

## API Surface

The app exposes route handlers under `src/app/api`, including:

- `api/analytics/dashboard`
- `api/auth/[...nextauth]`
- `api/auth/register`
- `api/collections`
- `api/integrations`
- `api/inventory`
- `api/openapi`
- `api/orders`
- `api/sales`
- `api/settings/menu`
- `api/settings/profile`
- `api/skus`
- `api/admin/users`

For interactive docs, open `/api-docs`.

## API Examples

The examples below reflect the current route handler behavior and are useful for local testing.

### List Products

```http
GET /api/skus?page=1&limit=20&sortBy=masterSkuCode&sortOrder=asc&salesPeriod=30
```

Example response:

```json
{
  "success": true,
  "data": [
    {
      "id": "cmabc123",
      "masterSkuCode": "DP-1001",
      "skuCode": "DP-1001",
      "name": "Demand Pilot Sample Product",
      "description": "Example product",
      "category": "Accessories",
      "currentStock": 42,
      "reorderPoint": 10,
      "unitCost": "12.50",
      "retailPrice": "29.99",
      "webSkuCount": 3,
      "inventory": {
        "onHand": 48,
        "reserved": 2,
        "allocated": 4,
        "backorder": 0,
        "inbound": 12,
        "available": 42
      },
      "_count": {
        "salesRecords": 128
      },
      "salesSummary": {
        "totalQuantity": 128,
        "days": 30
      }
    }
  ],
  "periods": {
    "sales": 30
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 120,
    "totalPages": 6
  }
}
```

### Create Product

```http
POST /api/skus
Content-Type: application/json
```

```json
{
  "skuCode": "DP-1001-BLK",
  "name": "Demand Pilot Sample Product Black",
  "description": "Black colorway",
  "category": "Accessories",
  "currentStock": 25,
  "reorderPoint": 8,
  "tags": ["sample", "black"],
  "unitCost": 12.5,
  "retailPrice": 29.99
}
```

### List Integrations

```http
GET /api/integrations
```

Example response:

```json
{
  "success": true,
  "data": [
    {
      "id": "cmint123",
      "platform": "shopify",
      "name": "Main Shopify Store",
      "isActive": true,
      "lastSyncAt": "2026-04-18T21:00:00.000Z",
      "lastSyncStatus": "success",
      "lastSyncError": null,
      "totalOrdersSynced": 540,
      "totalRecordsSynced": 1210,
      "createdAt": "2026-04-01T10:00:00.000Z",
      "updatedAt": "2026-04-18T21:00:00.000Z"
    }
  ]
}
```

### Create Shopify Integration

```http
POST /api/integrations
Content-Type: application/json
```

```json
{
  "platform": "shopify",
  "name": "Main Shopify Store",
  "config": {
    "shopDomain": "mystore.myshopify.com",
    "accessToken": "shpat_xxxxxxxxxxxxx",
    "apiVersion": "2024-01"
  }
}
```

### Inventory Snapshot Query

```http
GET /api/inventory?page=1&limit=20&groupBy=warehouse&warehouse=all&sortBy=masterSku&sortOrder=asc
```

Example response:

```json
{
  "success": true,
  "data": [
    {
      "masterSku": "DP-1001",
      "onHand": 120,
      "allocated": 15,
      "available": 105,
      "backorder": 0,
      "warehouse": "LA",
      "createdAt": "2026-04-18T06:00:00.000Z"
    }
  ],
  "warehouses": ["LA", "NJ"],
  "summary": {
    "totalRows": 350,
    "totalProducts": 180,
    "totalWarehouses": 2,
    "onHand": 8200,
    "allocated": 400,
    "available": 7800,
    "backorder": 65
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 350,
    "totalPages": 18
  }
}
```

### Orders Feed Query

```http
GET /api/orders?page=1&limit=20&platformSource=all&sortBy=orderDate&sortOrder=desc
```

Example response:

```json
{
  "success": true,
  "data": [
    {
      "id": 1024,
      "platformSource": "shopify",
      "externalOrderId": "gid://shopify/Order/123456789",
      "orderNumber": "#1001",
      "orderDate": "2026-04-18T14:30:00.000Z",
      "orderStatus": "paid",
      "totalPrice": 149.99,
      "currency": "USD",
      "financialStatus": "paid",
      "buyerEmail": "buyer@example.com",
      "shippingCountry": "US",
      "salesChannel": "online_store",
      "lineCount": 3,
      "unitCount": 5
    }
  ],
  "summary": {
    "totalOrders": 980,
    "totalRevenue": 182340.55,
    "totalUnits": 4130,
    "totalPlatforms": 3
  },
  "platformSources": ["amazon", "ebay", "shopify"],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 980,
    "totalPages": 49
  }
}
```

## Environment Variables

The following variables are relevant in the current codebase.

### Required
- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

### Optional but Important
- `SUPABASE_LOOKUP_DATABASE_URL`
  Required for master SKU lookup, inventory snapshots, and order feed pages
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
  Enable optional caching for dashboard and sales-related reads
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
  Enable Google sign-in in addition to credentials auth

## Local Development

### Runtime

- Recommended Node version: `22.x`
- Supported engine range in this repo: `>=20.9 <24`

### Install

```bash
npm install
```

### Database

Apply Prisma migrations before running the app:

```bash
npx prisma migrate dev
```

Optionally seed local data:

```bash
npm run db:seed
```

### Start The App

Preferred on this project:

```bash
start-dev.cmd
```

Alternative:

```bash
cmd /c npm.cmd run dev
```

Why the custom launcher exists:
- On Windows PowerShell, `npm` may resolve to `npm.ps1` and be blocked by execution policy
- This repository also includes a local Node 22 runtime path for more stable Windows development

### Production Build

```bash
cmd /c npm.cmd run build
cmd /c npm.cmd run start
```

## Notes And Limitations

- Forecast generation has been removed from the active application flow
- The Prisma schema no longer includes the old `Forecast` model
- Trend-related tables still exist in the schema for future work, but current UI flows focus on historical sales and operational data
- Shopify is the only marketplace with implemented sync logic today
- Marketplace code is now organized around a shared adapter core so each platform can be implemented with minimal cross-team file overlap
- Inventory and order pages depend on the external lookup database being reachable
- Redis is optional; the app falls back when Redis is not configured
- The repository currently has pre-existing lint issues outside the README changes

## Suggested Reading Order For New Contributors

1. `prisma/schema.prisma`
2. `src/components/layout/navigation-config.ts`
3. `src/app/dashboard/page.tsx`
4. `src/app/settings/integrations/page.tsx`
5. `src/lib/integrations/core/registry.ts`
6. `src/lib/integrations/core/sync-runner.ts`
7. `src/lib/integrations/shopify/adapter.ts`
8. `src/lib/db/supabase-lookup.ts`
