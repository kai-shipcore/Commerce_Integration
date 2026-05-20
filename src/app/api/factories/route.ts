// Code Guide: CRUD-lite API for factory master records used by FC purchase orders.
// Reads and creates records in shipcore.fc_factories via DATABASE_URL.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { z } from "zod";

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
  try {
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
  try {
    const body = await request.json();
    const validated = FactoryCreateSchema.parse(body);
    const factoryName = validated.factoryName.trim();
    const factoryCode = validated.factoryCode?.trim() || null;

    const result = await getPrimaryPool().query<FactoryRow>(
      `INSERT INTO shipcore.fc_factories
         (factory_code, factory_name, origin, contact_name, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (factory_name) DO UPDATE SET
         factory_code = COALESCE(EXCLUDED.factory_code, shipcore.fc_factories.factory_code),
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

    return NextResponse.json({ success: true, data: serializeFactory(result.rows[0]) }, { status: 201 });
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
