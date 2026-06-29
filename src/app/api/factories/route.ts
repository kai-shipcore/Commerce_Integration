// Code Guide: CRUD-lite API for factory master records used by FC purchase orders.
// Reads and creates records in shipcore.fc_factories via DATABASE_URL.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { logAudit, getIp } from "@/lib/audit";

const FactoryCreateSchema = z.object({
  factoryName: z.string().trim().min(1),
  factoryCode: z.string().trim().optional(),
  origin: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

type FactoryRow = {
  id: string;
  factory_code: string | null;
  factory_name: string;
  origin: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

async function ensureFactoryCodes() {
  const pool = getPrimaryPool();

  await pool.query("CREATE SEQUENCE IF NOT EXISTS shipcore.fc_factory_code_seq START 1");
  await pool.query(`
    WITH code_state AS (
      SELECT COALESCE((
          SELECT MAX((regexp_match(factory_code, '^FC-([0-9]+)$'))[1]::bigint)
          FROM shipcore.fc_factories
          WHERE factory_code ~ '^FC-[0-9]+$'
        ), 0) AS max_code
    )
    SELECT setval(
      'shipcore.fc_factory_code_seq',
      GREATEST(code_state.max_code, shipcore.fc_factory_code_seq.last_value, 1),
      code_state.max_code > 0 OR shipcore.fc_factory_code_seq.is_called
    )
    FROM code_state, shipcore.fc_factory_code_seq
  `);
  await pool.query(`
    WITH missing AS (
      SELECT id
      FROM shipcore.fc_factories
      WHERE factory_code IS NULL OR btrim(factory_code) = ''
      ORDER BY id
      FOR UPDATE
    )
    UPDATE shipcore.fc_factories factory
    SET factory_code = 'FC-' || LPAD(nextval('shipcore.fc_factory_code_seq')::text, 4, '0'),
        updated_at = now()
    FROM missing
    WHERE factory.id = missing.id
  `);
}

function serializeFactory(row: FactoryRow) {
  return {
    id: row.id,
    factoryCode: row.factory_code,
    factoryName: row.factory_name,
    origin: row.origin,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    isActive: row.is_active,
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
  };
}

export async function GET(request: NextRequest) {
  const denied = await guardPermission("factory", "read");
  if (denied) return denied;
  try {
    await ensureFactoryCodes();

    const { searchParams } = new URL(request.url);
    const activeParam = searchParams.get("active");
    const search = searchParams.get("search")?.trim() ?? "";

    const filters: string[] = [];
    const params: unknown[] = [];

    if (activeParam !== null) {
      params.push(activeParam === "true");
      filters.push(`is_active = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(factory_name ILIKE $${params.length} OR COALESCE(factory_code, '') ILIKE $${params.length})`);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await getPrimaryPool().query<FactoryRow>(
      `SELECT
         id::text,
         factory_code,
         factory_name,
         origin,
         contact_name,
         email,
         phone,
         is_active,
         created_at,
         updated_at
       FROM shipcore.fc_factories
       ${where}
       ORDER BY factory_name ASC`,
      params
    );

    return NextResponse.json({ success: true, data: result.rows.map(serializeFactory) });
  } catch (error) {
    console.error("Error fetching factories:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("factory", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = FactoryCreateSchema.parse(body);
    const factoryName = validated.factoryName.trim();
    const factoryCode = validated.factoryCode?.trim() || null;

    await ensureFactoryCodes();

    const result = await getPrimaryPool().query<FactoryRow>(
      `INSERT INTO shipcore.fc_factories
         (factory_code, factory_name, origin, contact_name, email, phone)
       VALUES (
         COALESCE($1, 'FC-' || LPAD(nextval('shipcore.fc_factory_code_seq')::text, 4, '0')),
         $2,
         $3,
         $4,
         $5,
         $6
       )
       ON CONFLICT (factory_name) DO UPDATE SET
         factory_code = COALESCE(shipcore.fc_factories.factory_code, EXCLUDED.factory_code),
         origin = COALESCE(EXCLUDED.origin, shipcore.fc_factories.origin),
         contact_name = COALESCE(EXCLUDED.contact_name, shipcore.fc_factories.contact_name),
         email = COALESCE(EXCLUDED.email, shipcore.fc_factories.email),
         phone = COALESCE(EXCLUDED.phone, shipcore.fc_factories.phone),
         is_active = true,
         updated_at = now()
       RETURNING
         id::text,
         factory_code,
         factory_name,
         origin,
         contact_name,
         email,
         phone,
         is_active,
         created_at,
         updated_at`,
      [
        factoryCode,
        factoryName,
        validated.origin?.trim() || null,
        validated.contactName?.trim() || null,
        validated.email?.trim() || null,
        validated.phone?.trim() || null,
      ]
    );

    const created = serializeFactory(result.rows[0]);
    const session = await auth();
    void logAudit({
      entityType: "factory",
      entityId: created.id,
      entityLabel: created.factoryName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "create",
      after: { factoryCode: created.factoryCode, factoryName: created.factoryName, origin: created.origin },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating factory:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
