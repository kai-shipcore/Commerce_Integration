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

The project uses a `.env` file (not `.env.local`).
