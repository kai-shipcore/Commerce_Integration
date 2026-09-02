# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (Next.js)
npm run build      # Production build
npx eslint .       # Lint

npx prisma migrate dev          # Run pending migrations
npx prisma migrate dev --name <name>  # Create + run a new migration
npm run db:seed                 # Seed local database (tsx prisma/seed.ts)
npx prisma studio               # Open Prisma Studio
```

On Windows, use `start-dev.cmd` instead of `npm run dev` if PowerShell execution policy blocks the script.

## Architecture Overview

**Demand Pilot** is a Next.js 16 (App Router) internal operations workspace for managing SKU master data, sales records, inventory snapshots, collections, and marketplace integrations.

### Two-Database Pattern

The app writes to a **primary PostgreSQL database** (via Prisma) and reads from a **separate external lookup database** (Supabase) for master SKU resolution, inventory snapshots, and order feeds.

- `DATABASE_URL` — Prisma (primary, all writes)
- `SUPABASE_LOOKUP_DATABASE_URL` — external read-only lookup DB (`src/lib/db/supabase-lookup.ts`)

Pages that depend on the lookup DB (Inventory, Orders) will fail gracefully if that connection is missing.

### Sync Pipelines

Several pages pull from the Supabase lookup DB (or reconcile purely within the primary DB) into `shipcore.*`. Not exhaustive — these are the ones documented so far:

| Page(s) | Reads from | Writes to |
|---|---|---|
| Velocity (`/velocity`) | Supabase `ecommerce_data.vw_sales_order_items_link_new`, `sales_orders` | `shipcore.fc_velocity_link_snapshot`, `fc_velocity_custom_snapshot` |
| Demand Planning dashboard, SKU Forecasts, OOS Impact | Supabase `ecommerce_data.coverland_inventory_by_warehouse`, `vw_coverland_inventory_history` + primary `fc_velocity_*_snapshot` | `shipcore.fc_stats`, `fc_stats_custom`, `fc_inventory_history_snapshot`, `fc_products` (backfill only) |
| SKU Master admin (`/planning/sku-master`) | Supabase `ecommerce_data.coverland_inventory_by_warehouse` | `shipcore.fc_products` |
| Transit Stock (`/planning/transit-stock`) | primary `fc_transit_records` only | `fc_stats.transit_stock`, `fc_stats_custom.transit_stock` |

- The Demand Planning row is **one shared pipeline** (`DemandPlanningService.refreshStats()`, queued via `PlanningStatsRefreshService`) triggered from three different pages' "Sync" buttons — clicking any of them runs the identical job, not three separate ones.
- That pipeline's `fc_products` backfill (`SkuMasterRepository.insertMissingProducts`) is **insert-only**: it fills in a `fc_products` row for any master SKU seen in inventory/velocity data that doesn't have one yet, but never touches a row that already exists — so it can't undo a manual deactivation. The SKU Master admin page's own sync (`upsertProductsFromSync`) is a true upsert and *does* force `status = 'active'` on conflict, which is fine there because a human is the one clicking it.
- Transit Stock has **no dedicated Sync button**: `syncAllStats()` (full reconciliation) only runs as a step inside the Demand Planning pipeline above; `syncStats()` (targeted, per-SKU) runs silently as a side effect of every Transit Stock create/import/update/delete, with no visible sync control of its own.

### Dates: order date is UTC, the planning business day is LA

Two different things, deliberately on two different clocks:

- **Order dates are aggregated on UTC only.** `fc_velocity_*_snapshot.order_date` is
  `(order_date AT TIME ZONE 'UTC')::date`, and every reader — Velocity and Demand Planning
  alike — groups on it. There is no timezone option anywhere in the UI.
- **The planning "today" is the Los Angeles calendar date** (`planningLocalDateString()` in
  `src/lib/planning/date-utils.ts`). It sets the ends of the sales windows, the S.O.D.
  arithmetic, the container baseline ETA, and the grid's today marker. That is the
  warehouse's working day, not a display preference, so it stays on LA.

Velocity used to carry a UTC/LA toggle (and the snapshots an `order_date_la` column) while
Demand Planning was UTC-only. Same SKU, same period, different numbers — the resulting
support question (`CA-SC-10-F-10-BK-1TO`, 8/24–8/30: Velocity 138 vs Demand Planning 121)
was five units of pure timezone plus twelve units of Link-vs-Custom snapshot. The toggle and
the column were removed in `20260901180000_drop_velocity_order_date_la` rather than
documented, because the option itself was the bug. Roughly 44% of snapshot rows fall on a
different day under the two clocks, so do not reintroduce a second date column: standardise
on `order_date` and convert at the edges if a report ever needs LA.

Also note the snapshot sync's `GROUP BY 1, 2, 3, 4, 5, 7` is positional against
`LINK_SELECT` / `CUSTOM_SELECT`. Changing the select list shifts those numbers, and a
wrong-but-valid number groups the wrong column without raising an error.

### Key Layers

| Layer | Location | Notes |
|-------|----------|-------|
| Pages & API routes | `src/app/` | App Router; API under `src/app/api/` |
| Feature components | `src/components/<area>/` | Organized by feature (sku, sales, orders, etc.) |
| UI primitives | `src/components/ui/` | Radix UI wrappers |
| Business logic & DB | `src/lib/` | Database clients, auth, integrations, cache |
| Data model | `prisma/schema.prisma` | All tables in `shipcore` schema |

### Layered Architecture (Controller/Service/Repository)

The codebase is being migrated domain-by-domain from logic embedded directly in `route.ts` files to a layered structure. When adding to or touching an existing domain, or refactoring one, follow this pattern:

- **Controller** (`src/app/api/**/route.ts`) — thin. Parses/validates the request (Zod), calls one Service method, maps the result/error to a response. No SQL, no business logic.
- **Service** (`src/lib/<domain>/service.ts`) — business logic, validation rules, cache read/write, orchestration across repository calls. Throws typed errors from `src/lib/errors.ts` (`ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`, `ServiceUnavailableError`) instead of building responses itself.
- **Repository** (`src/lib/<domain>/repository.ts`) — raw SQL (`getPrimaryPool()`/`getLookupPool()`) or Prisma calls only. No business logic.
- Controllers use `apiSuccess` / `apiError` / `handleApiError` from `src/lib/api-response.ts`; `handleApiError` maps the typed errors above to their status codes (400/404/409/403/503) plus a 500 fallback.
- One `src/lib/<domain>/` folder per route group, named after the route path (e.g. `src/app/api/analytics/dashboard` → `src/lib/analytics/`). Don't merge unrelated route groups into one domain folder just because they share a table.
- Tests live under `tests/lib/<domain>/` (Vitest), mocking the layer below (Service tests mock the Repository; Repository tests mock the DB pool).
- **When migrating an existing route: preserve its exact behavior** — response shape, status codes, error message text, and even known bugs/quirks — unless the user explicitly approves a change. Flag anything surprising (broken contracts, dead code, missing auth checks) instead of silently fixing it.
- Workflow for a new domain: scope it (read the route(s) in full), ask the user about any real design decisions (e.g. how to split shared/entangled routes, whether to add previously-missing permission checks), implement repository → service → controller, write tests, verify with `tsc --noEmit` + `eslint` + `vitest run`, then a GET-only live smoke test against the dev server (never live-test mutating methods). Commit/push only when explicitly asked.

### Integrations (Adapter Pattern)

Marketplace integrations live in `src/lib/integrations/`. Each platform has an adapter implementing the interface in `integrations/core/adapter.ts`. **Shopify is the only platform with a full sync** (orders → `SalesRecord`). Amazon, eBay, and Walmart only store credentials in `PlatformIntegration.config`.

### Caching

Optional Upstash Redis via `src/lib/redis.ts` (`CacheManager`). If Redis env vars are absent, all cache operations silently no-op. Cache keys are prefixed by data type; TTL is auto-assigned by prefix (e.g., `stats:` = 24h, `sku:` = 1h). API routes call `CacheManager.invalidate*()` after writes.

### Authentication

NextAuth v5 (JWT strategy) with Credentials + optional Google OAuth. Middleware (`middleware.ts`) guards all non-auth routes and redirects to `/auth/signin`. Users have a `role` (admin/user/dev) and a `menuVisibility` JSON field for per-user menu preferences. Navigation config and role defaults are in `src/components/layout/navigation-config.ts`.

### API Route Conventions

- Each route handler has a "Code Guide" comment describing its purpose.
- Validation uses Zod before any DB access.
- Response shape: `{ success: boolean, data: T, pagination?, summary? }`.
- Pagination, sorting, and filtering are query-param driven.
- Cache invalidation happens at the API layer after mutations.

### Background Jobs

Inngest (`src/lib/inngest/`) handles event-driven background workflows. The client is initialized in `src/lib/inngest/client.ts`.

## Environment Variables

**Required**:
- `DATABASE_URL` — Prisma PostgreSQL connection
- `NEXTAUTH_SECRET` — JWT signing secret
- `NEXTAUTH_URL` — App origin (e.g., `http://localhost:3000`)

**Optional / Feature-gated**:
- `SUPABASE_LOOKUP_DATABASE_URL` — External inventory/order read DB
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — Caching
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google OAuth
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` — Password reset email
- `NEXT_PUBLIC_APP_URL` — Public-facing URL

**Forecasting service** (the Planning pages: Demand Forecast, Action List, Forecast Validation):
- `AI_SERVICE_URL` — Where the FastAPI forecast service lives. Defaults to `http://localhost:8000`.
- `FORECAST_API_TOKEN` — Sent as `x-forecast-token`. Must match the same variable on the Python side, or every request except `/health` returns 401.
- `FORECAST_SERVER_DIR` — **Machine-specific absolute path** to your own `Time_Series_Forecasting` checkout. When `AI_SERVICE_URL` is localhost and the service is not answering, the app starts it from here on demand. Do not copy this value from someone else's `.env`: pointing at a directory that does not exist on your machine is the usual reason the Planning pages report that they cannot reach the forecast server.
- `FORECAST_SERVER_APP` — Optional uvicorn app path. Inferred as `api.main:app` when `api/main.py` is present.

Auto-start only applies to a local service. If `AI_SERVICE_URL` points at another host, that server is not this app's to manage and an outage is reported rather than worked around.

**Both `.env` and `.env.local` exist here, and `.env.local` wins.** That is Next.js
precedence, not a project convention, and this file previously claimed the opposite
("uses a `.env` file, not `.env.local`"), which cost a full afternoon: two people edited
`AI_SERVICE_URL` in `.env` on separate machines and neither edit had any effect, because
`.env.local` was setting it to something else on one machine and not existing on the other.

Both are gitignored (`.env*`), so neither travels between machines and the two can disagree
indefinitely without anything saying so.

Before changing any variable, check which file is actually supplying it:

```bash
grep -n AI_SERVICE_URL .env .env.local     # macOS / Linux
findstr /C:"AI_SERVICE_URL" .env .env.local  # Windows
```

Edit whichever one is winning, and restart `npm run dev` afterwards: env is read at
startup, so a change to a running dev server does nothing and looks like the change
failed.

## Dependency notes

### `xlsx` is installed from a URL, deliberately

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

SheetJS stopped publishing to npm. The `xlsx` package on the public registry is
frozen at `0.18.5` from 2022 and carries two unpatched advisories, prototype
pollution and a ReDoS, both in the parsing path. `npm audit` reports them as
"no fix available", which is true of npm and not of the library: maintained
releases live on the vendor's own CDN and are installed by URL.

Do not "tidy" this back to a semver range. That silently reinstalls the
abandoned 2022 build. The app parses user-supplied spreadsheets in
`sku-master`, `container-planning`, `transit-stock`, `available-stock` and the
transit-stock import dialog, so the parsing path is reachable.

Consequence for deployment: whatever runs `npm install` needs network access to
`cdn.sheetjs.com`. If a build host is locked down, vendor the tarball rather
than reverting the version.

### `nodemailer` was upgraded 7 to 9, and none of it was reachable

The advisories against nodemailer 7 cover SMTP command injection via
`envelope.size`, CRLF injection in the transport `name` and in `List-*` header
comments, `jsonTransport` and `raw` bypassing `disableFileAccess`, and TLS
validation during OAuth2 token fetch. `src/lib/email.ts` sets none of those
options: it calls `createTransport({host, port, secure, auth})` and `sendMail`
with a fixed subject and body.

The one plausible vector, an attacker-controlled address reaching a header, is
closed twice over in `src/app/api/auth/forgot-password/route.ts`: the address is
validated by Zod `.email()`, then used only to look up a user, and the value
passed to `sendMail` is `user.email` from the database rather than the request.

Recorded so this is not re-litigated at the next audit. The upgrade was still
correct, and it was not urgent.

### Reading `npm audit` in this repo

`npm audit fix --force` proposes `next@9.3.3` over the installed 16.x, and
`exceljs@3.4.0` over 4.4.0. npm treats any version whose tree lacks the advisory
as a fix and does not weigh that it is a downgrade of several years. Run
`npm audit fix` without `--force`, then read `git diff package-lock.json` before
committing. Most remaining findings sit under `eslint` or inside `next`'s own
tree and never execute in production.
