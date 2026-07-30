/**
 * Pure data access for the PlatformIntegration entity (shipcore.fc_platform_integration).
 * Business logic (adapter orchestration, token status, audit logging) lives in
 * src/lib/integrations/service.ts — this file only runs queries.
 *
 * Also called directly by the platform adapters (shopify/walmart/ebay/amazon) to
 * persist sync cursors mid-pagination, and by Inngest background jobs — those
 * call sites are intentionally left as-is (adapters are pure integration clients,
 * out of scope for this layering pass).
 */

import { randomUUID } from "crypto";
import { getPrimaryPool } from "@/lib/db/primary-db";

type IntegrationPlatform = "shopify" | "walmart" | "ebay" | "amazon";

export interface PlatformIntegrationRecord {
  id: string;
  platform: string;
  name: string;
  isActive: boolean;
  config: Record<string, unknown>;
  syncCursor: Record<string, unknown> | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  totalOrdersSynced: number;
  totalRecordsSynced: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PlatformIntegrationRow {
  id: string;
  platform: string;
  name: string;
  isActive: boolean;
  config: Record<string, unknown>;
  syncCursor: Record<string, unknown> | null;
  lastSyncAt: Date | string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  totalOrdersSynced: number | null;
  totalRecordsSynced: number | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

interface CreatePlatformIntegrationInput {
  platform: IntegrationPlatform;
  name: string;
  config: Record<string, unknown>;
  isActive?: boolean;
}

export interface UpdatePlatformIntegrationInput {
  name?: string;
  isActive?: boolean;
  config?: Record<string, unknown>;
  syncCursor?: Record<string, unknown> | null;
  lastSyncAt?: Date | string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  incrementTotalOrdersSynced?: number;
  incrementTotalRecordsSynced?: number;
}

const SELECT_COLUMNS = `
  id,
  platform,
  name,
  "isActive",
  config,
  "syncCursor",
  "lastSyncAt",
  "lastSyncStatus",
  "lastSyncError",
  "totalOrdersSynced",
  "totalRecordsSynced",
  "createdAt",
  "updatedAt"`;

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapPlatformIntegration(row: PlatformIntegrationRow): PlatformIntegrationRecord {
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    isActive: row.isActive,
    config: (row.config ?? {}) as Record<string, unknown>,
    syncCursor: (row.syncCursor ?? null) as Record<string, unknown> | null,
    lastSyncAt: toIsoString(row.lastSyncAt),
    lastSyncStatus: row.lastSyncStatus,
    lastSyncError: row.lastSyncError,
    totalOrdersSynced: Number(row.totalOrdersSynced ?? 0),
    totalRecordsSynced: Number(row.totalRecordsSynced ?? 0),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export async function listPlatformIntegrations(): Promise<PlatformIntegrationRecord[]> {
  const result = await getPrimaryPool().query<PlatformIntegrationRow>(
    `SELECT ${SELECT_COLUMNS}
    FROM "shipcore"."fc_platform_integration"
    ORDER BY "createdAt" DESC NULLS LAST, name ASC`
  );

  return result.rows.map(mapPlatformIntegration);
}

export async function listActivePlatformIntegrations(): Promise<PlatformIntegrationRecord[]> {
  const result = await getPrimaryPool().query<PlatformIntegrationRow>(
    `SELECT ${SELECT_COLUMNS}
    FROM "shipcore"."fc_platform_integration"
    WHERE "isActive" = TRUE
    ORDER BY "createdAt" DESC NULLS LAST, name ASC`
  );

  return result.rows.map(mapPlatformIntegration);
}

export async function getPlatformIntegrationById(
  id: string
): Promise<PlatformIntegrationRecord | null> {
  const result = await getPrimaryPool().query<PlatformIntegrationRow>(
    `SELECT ${SELECT_COLUMNS}
    FROM "shipcore"."fc_platform_integration"
    WHERE id = $1
    LIMIT 1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapPlatformIntegration(result.rows[0]);
}

export async function createPlatformIntegration(
  input: CreatePlatformIntegrationInput
): Promise<PlatformIntegrationRecord> {
  const id = randomUUID();

  const result = await getPrimaryPool().query<PlatformIntegrationRow>(
    `INSERT INTO "shipcore"."fc_platform_integration" (
      id,
      platform,
      name,
      "isActive",
      config,
      "syncCursor",
      "lastSyncAt",
      "lastSyncStatus",
      "lastSyncError",
      "totalOrdersSynced",
      "totalRecordsSynced",
      "createdAt",
      "updatedAt"
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5::jsonb,
      NULL,
      NULL,
      NULL,
      NULL,
      0,
      0,
      NOW(),
      NOW()
    )
    RETURNING ${SELECT_COLUMNS}`,
    [id, input.platform, input.name, input.isActive ?? true, JSON.stringify(input.config)]
  );

  return mapPlatformIntegration(result.rows[0]);
}

export async function updatePlatformIntegration(
  id: string,
  updates: UpdatePlatformIntegrationInput
): Promise<PlatformIntegrationRecord | null> {
  const values: Array<string | number | boolean | Date | null> = [id];
  const sets: string[] = [];
  let index = 2;

  if (updates.name !== undefined) {
    sets.push(`name = $${index++}`);
    values.push(updates.name);
  }

  if (updates.isActive !== undefined) {
    sets.push(`"isActive" = $${index++}`);
    values.push(updates.isActive);
  }

  if (updates.config !== undefined) {
    sets.push(`config = $${index++}::jsonb`);
    values.push(JSON.stringify(updates.config));
  }

  if (updates.syncCursor !== undefined) {
    if (updates.syncCursor === null) {
      sets.push(`"syncCursor" = NULL`);
    } else {
      sets.push(`"syncCursor" = $${index++}::jsonb`);
      values.push(JSON.stringify(updates.syncCursor));
    }
  }

  if (updates.lastSyncAt !== undefined) {
    if (updates.lastSyncAt === null) {
      sets.push(`"lastSyncAt" = NULL`);
    } else {
      sets.push(`"lastSyncAt" = $${index++}`);
      values.push(updates.lastSyncAt instanceof Date ? updates.lastSyncAt : new Date(updates.lastSyncAt));
    }
  }

  if (updates.lastSyncStatus !== undefined) {
    if (updates.lastSyncStatus === null) {
      sets.push(`"lastSyncStatus" = NULL`);
    } else {
      sets.push(`"lastSyncStatus" = $${index++}`);
      values.push(updates.lastSyncStatus);
    }
  }

  if (updates.lastSyncError !== undefined) {
    if (updates.lastSyncError === null) {
      sets.push(`"lastSyncError" = NULL`);
    } else {
      sets.push(`"lastSyncError" = $${index++}`);
      values.push(updates.lastSyncError);
    }
  }

  if (updates.incrementTotalOrdersSynced !== undefined) {
    sets.push(
      `"totalOrdersSynced" = COALESCE("totalOrdersSynced", 0) + $${index++}`
    );
    values.push(updates.incrementTotalOrdersSynced);
  }

  if (updates.incrementTotalRecordsSynced !== undefined) {
    sets.push(
      `"totalRecordsSynced" = COALESCE("totalRecordsSynced", 0) + $${index++}`
    );
    values.push(updates.incrementTotalRecordsSynced);
  }

  sets.push(`"updatedAt" = NOW()`);

  const result = await getPrimaryPool().query<PlatformIntegrationRow>(
    `UPDATE "shipcore"."fc_platform_integration"
    SET ${sets.join(", ")}
    WHERE id = $1
    RETURNING ${SELECT_COLUMNS}`,
    values
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapPlatformIntegration(result.rows[0]);
}

export async function deletePlatformIntegration(id: string): Promise<boolean> {
  const result = await getPrimaryPool().query<{ id: string }>(
    `DELETE FROM "shipcore"."fc_platform_integration"
    WHERE id = $1
    RETURNING id`,
    [id]
  );

  return result.rows.length > 0;
}
