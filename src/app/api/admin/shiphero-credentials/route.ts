// Code Guide: Admin-only endpoint to manage ShipHero credentials for any user.
// GET    — returns all users with their credential status (no secrets)
// POST   — upserts email + encrypted password for a given userId
// DELETE — removes the credential row for a given userId

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { encrypt } from "@/lib/encrypt";

type TokenStatus = "valid" | "expiring_soon" | "expired" | "none";

function computeTokenStatus(expiresAt: Date | null): TokenStatus {
  if (!expiresAt) return "none";
  const now = Date.now();
  const exp = expiresAt.getTime();
  if (exp < now) return "expired";
  if (exp - now < 7 * 86400 * 1000) return "expiring_soon";
  return "valid";
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!isAdminLikeRole(session.user.role as string)) return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const pool = getPrimaryPool();
  try {
    const result = await pool.query(`
      SELECT
        u.id          AS user_id,
        u.name,
        u.email       AS user_email,
        u.role,
        c.email       AS shiphero_email,
        (c.password_enc IS NOT NULL) AS password_set,
        c.token_expires_at,
        c.updated_at
      FROM shipcore.fc_user u
      LEFT JOIN shipcore.fc_shiphero_credentials c ON c.user_id = u.id
      WHERE u.role = 'operation'
      ORDER BY COALESCE(u.name, u.email)
    `);

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => ({
        userId:         row.user_id as string,
        name:           row.name as string | null,
        userEmail:      row.user_email as string,
        role:           row.role as string,
        shipHeroEmail:  row.shiphero_email as string | null,
        passwordSet:    Boolean(row.password_set),
        tokenExpiresAt: row.token_expires_at ? (row.token_expires_at as Date).toISOString() : null,
        tokenStatus:    computeTokenStatus(row.token_expires_at as Date | null),
        updatedAt:      row.updated_at ? (row.updated_at as Date).toISOString() : null,
      })),
    });
  } catch (err) {
    console.error("[shiphero-credentials GET]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}

const UpsertSchema = z.object({
  userId:   z.string().min(1),
  email:    z.string().email(),
  password: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as unknown;
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { userId, email, password } = parsed.data;
  const pool = getPrimaryPool();

  try {
    let passwordEnc: string | null = null;

    if (password && password.trim() !== "") {
      passwordEnc = encrypt(password);
    } else {
      const existing = await pool.query(
        `SELECT password_enc FROM shipcore.fc_shiphero_credentials WHERE user_id = $1`,
        [userId]
      );
      passwordEnc = (existing.rows[0]?.password_enc as string | undefined) ?? null;
    }

    if (!passwordEnc) {
      return NextResponse.json(
        { success: false, error: "Password is required for new credentials" },
        { status: 400 }
      );
    }

    await pool.query(
      `INSERT INTO shipcore.fc_shiphero_credentials (user_id, email, password_enc, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         email        = EXCLUDED.email,
         password_enc = EXCLUDED.password_enc,
         updated_at   = NOW()`,
      [userId, email, passwordEnc]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[shiphero-credentials POST]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}

const DeleteSchema = z.object({
  userId: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as unknown;
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid input" }, { status: 400 });
  }

  const pool = getPrimaryPool();
  try {
    await pool.query(
      `DELETE FROM shipcore.fc_shiphero_credentials WHERE user_id = $1`,
      [parsed.data.userId]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[shiphero-credentials DELETE]", err);
    return NextResponse.json({ success: false, error: "DB error" }, { status: 500 });
  }
}
