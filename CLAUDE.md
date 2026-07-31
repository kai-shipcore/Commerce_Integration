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

### Key Layers

| Layer | Location | Notes |
|-------|----------|-------|
| Pages & API routes | `src/app/` | App Router; API under `src/app/api/` |
| Feature components | `src/components/<area>/` | Organized by feature (sku, sales, orders, etc.) |
| UI primitives | `src/components/ui/` | Radix UI wrappers |
| Business logic & DB | `src/lib/` | Database clients, auth, integrations, cache |
| Data model | `prisma/schema.prisma` | All tables in `shipcore` schema |

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

The project uses a `.env` file (not `.env.local`).

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
