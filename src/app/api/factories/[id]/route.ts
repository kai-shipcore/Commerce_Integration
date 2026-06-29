// Code Guide: PUT/PATCH API for a single fc_factories record by id.
// PUT replaces all writable fields; PATCH toggles is_active.

import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { logAudit, getIp } from "@/lib/audit";

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

const FactoryUpdateSchema = z.object({
  factoryName: z.string().trim().min(1),
  factoryCode: z.string().trim().optional(),
  origin: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

const FactoryPatchSchema = z.object({
  isActive: z.boolean(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardPermission("factory", "edit");
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = FactoryUpdateSchema.parse(body);

    const pool = getPrimaryPool();

    const existing = await pool.query<FactoryRow>(
      `SELECT id::text, factory_code, factory_name, origin, contact_name, email, phone, is_active, created_at, updated_at
       FROM shipcore.fc_factories WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Factory not found" },
        { status: 404 }
      );
    }
    const beforeData = serializeFactory(existing.rows[0]);

    const factoryName = validated.factoryName.trim();

    // Check for duplicate name (excluding current row)
    const dupName = await pool.query<{ id: string }>(
      "SELECT id::text FROM shipcore.fc_factories WHERE factory_name = $1 AND id != $2",
      [factoryName, id]
    );
    if (dupName.rows.length > 0) {
      return NextResponse.json(
        { success: false, error: `Factory name already exists: ${factoryName}` },
        { status: 400 }
      );
    }

    const result = await pool.query<FactoryRow>(
      `UPDATE shipcore.fc_factories SET
         factory_name = $1,
         origin = $2,
         contact_name = $3,
         email = $4,
         phone = $5,
         updated_at = now()
       WHERE id = $6
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
        factoryName,
        validated.origin?.trim() || null,
        validated.contactName?.trim() || null,
        validated.email?.trim() || null,
        validated.phone?.trim() || null,
        id,
      ]
    );

    const updated = serializeFactory(result.rows[0]);
    const session = await auth();
    void logAudit({
      entityType: "factory",
      entityId: id,
      entityLabel: updated.factoryName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "update",
      before: { factoryName: beforeData.factoryName, origin: beforeData.origin, contactName: beforeData.contactName, email: beforeData.email, phone: beforeData.phone },
      after: { factoryName: updated.factoryName, origin: updated.origin, contactName: updated.contactName, email: updated.email, phone: updated.phone },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating factory:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = FactoryPatchSchema.parse(body);
    const denied = await guardPermission("factory", validated.isActive ? "status" : "delete");
    if (denied) return denied;

    const pool = getPrimaryPool();

    const result = await pool.query<FactoryRow>(
      `UPDATE shipcore.fc_factories SET
         is_active = $1,
         updated_at = now()
       WHERE id = $2
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
      [validated.isActive, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Factory not found" },
        { status: 404 }
      );
    }

    const patched = serializeFactory(result.rows[0]);
    const session = await auth();
    void logAudit({
      entityType: "factory",
      entityId: id,
      entityLabel: patched.factoryName,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: validated.isActive ? "status_change" : "delete",
      before: { isActive: !validated.isActive },
      after: { isActive: validated.isActive },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true, data: patched });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error patching factory:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
