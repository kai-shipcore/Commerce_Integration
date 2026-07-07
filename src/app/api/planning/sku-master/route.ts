import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { getLookupPool } from "@/lib/db/supabase-lookup";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { logAudit, getIp } from "@/lib/audit";

type ProductKey = "cc" | "fm" | "sc" | "ac";

type ExcelCbmRow = {
  masterSku: string;
  cbmPerUnit: number;
};

type QueryClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const forecastDashboardViewSql = `
  CREATE VIEW shipcore.fc_forecast_dashboard AS
  SELECT p.master_sku,
      p.sub_category_code,
      p.status AS product_status,
      p.moq,
      p.cbm_per_unit,
      COALESCE(st.total_usable_qty, 0::numeric) AS stock_qty,
      COALESCE(st.total_backorder, 0::numeric) AS backorder_qty,
      COALESCE(ib.inbound_qty, 0::bigint) AS inbound_qty,
      ib.nearest_eta,
      fb.adjusted_daily_forecast AS daily_forecast,
      fb.seasonality_factor,
      CASE
        WHEN fb.adjusted_daily_forecast > 0::numeric THEN round(COALESCE(st.total_usable_qty, 0::numeric) / fb.adjusted_daily_forecast)
        ELSE NULL::numeric
      END AS days_of_cover,
      CURRENT_DATE +
      CASE
        WHEN fb.adjusted_daily_forecast > 0::numeric THEN round(COALESCE(st.total_usable_qty, 0::numeric) / fb.adjusted_daily_forecast)::integer
        ELSE 9999
      END AS est_sold_out_date
    FROM shipcore.fc_products p
      LEFT JOIN shipcore.fc_stock_total st ON st.master_sku::text = p.master_sku::text
      LEFT JOIN shipcore.fc_inbound_qty ib ON ib.master_sku::text = p.master_sku::text
      LEFT JOIN LATERAL (
        SELECT fc_forecast_baselines.adjusted_daily_forecast,
          fc_forecast_baselines.seasonality_factor
        FROM shipcore.fc_forecast_baselines
        WHERE fc_forecast_baselines.master_sku::text = p.master_sku::text
        ORDER BY fc_forecast_baselines.forecast_date DESC
        LIMIT 1
      ) fb ON true
    WHERE p.status = 'active'::shipcore.fc_product_status
`;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const partSalesStatusSql = `(SELECT CASE WHEN EXISTS (SELECT 1 FROM shipcore.fc_replacement_parts r WHERE r."partSku" = p.master_sku AND r."shippingStatus" = 'Not Ready' AND r."deleteYN" = 'N' AND r."orderRequest" ~ '^[0-9]+$' AND r."orderRequest"::int > 0) THEN 'Part' END)`;
const salesStatusSql = `COALESCE(p.sales_status, (SELECT sales_status FROM shipcore.fc_stats WHERE master_sku = p.master_sku LIMIT 1), (SELECT sales_status FROM shipcore.fc_stats_custom WHERE master_sku = p.master_sku LIMIT 1), ${partSalesStatusSql}, 'Original')`;

function inferProduct(masterSku: string): {
  productKey: ProductKey;
  category: string;
  categoryCode: string;
  moq: number;
  cbmPerUnit: number;
  caseQty: number;
  weightKg: number;
} {
  const sku = masterSku.toUpperCase();

  if (sku.includes("SWC")) {
    return {
      productKey: "cc",
      category: "Car Cover",
      categoryCode: "CC",
      moq: 1,
      cbmPerUnit: 0.078,
      caseQty: 1,
      weightKg: 2.8,
    };
  }

  if (sku.startsWith("CC-") || sku === "C-SJ-GR-7") {
    return {
      productKey: "cc",
      category: "Car Cover",
      categoryCode: "CC",
      moq: 3,
      cbmPerUnit: 0.078,
      caseQty: 3,
      weightKg: 2.8,
    };
  }

  if (sku.startsWith("CA-SC-") || sku.startsWith("CL-SC-")) {
    return {
      productKey: "sc",
      category: "Seat Cover",
      categoryCode: "SC",
      moq: 5,
      cbmPerUnit: 0.048,
      caseQty: 1,
      weightKg: 0.9,
    };
  }

  if (sku.startsWith("CA-FM-")) {
    return {
      productKey: "fm",
      category: "Floor Mat",
      categoryCode: "FM",
      moq: 5,
      cbmPerUnit: 0.125,
      caseQty: 1,
      weightKg: 1.4,
    };
  }

  return {
    productKey: "ac",
    category: "Accessories",
    categoryCode: "AC",
    moq: 1,
    cbmPerUnit: 0.05,
    caseQty: 1,
    weightKg: 0.5,
  };
}

async function ensureCbmPrecision(client: QueryClient) {
  const result = await client.query(`
    SELECT numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'shipcore'
      AND table_name = 'fc_products'
      AND column_name = 'cbm_per_unit'
  `);
  const scale = Number(result.rows[0]?.numeric_scale ?? 0);

  if (scale < 6) {
    await client.query("DROP VIEW IF EXISTS shipcore.fc_forecast_dashboard");
    await client.query(`
      ALTER TABLE shipcore.fc_products
      ALTER COLUMN cbm_per_unit TYPE NUMERIC(14,6)
      USING cbm_per_unit::NUMERIC(14,6)
    `);
    await client.query(forecastDashboardViewSql);
  }
}

export async function GET(request: NextRequest) {
  const denied = await guardPermission("sku-master", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const product = searchParams.get("product")?.trim() ?? "all";
    const status = searchParams.get("status")?.trim().toLowerCase() ?? "active";
    const masterSku = searchParams.get("masterSku")?.trim() ?? "";
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(200, Math.max(20, Number(searchParams.get("limit") ?? 50)));
    const offset = (page - 1) * limit;

    const salesType = searchParams.get("salesType")?.trim() ?? "all";
    const validSalesStatuses = ["Original", "Custom", "Hold", "Part", "Discontinued", "TBD", "SWC"];
    if (salesType !== "all" && !validSalesStatuses.includes(salesType)) {
      return NextResponse.json({ success: false, error: "Invalid salesType filter" }, { status: 400 });
    }

    const filters: string[] = [];
    const params: unknown[] = [];

    if (status !== "all") {
      if (status !== "active" && status !== "inactive") {
        return NextResponse.json({ success: false, error: "Invalid status filter" }, { status: 400 });
      }
      params.push(status);
      filters.push(`p.status = $${params.length}::shipcore.fc_product_status`);
    }

    if (search) {
      params.push(`%${search}%`);
      filters.push(`p.master_sku ILIKE $${params.length}`);
    }

    if (product !== "all") {
      const productMap: Record<string, string> = {
        cc: "CC",
        fm: "FM",
        sc: "SC",
      };
      const code = productMap[product];
      if (code) {
        params.push(code);
        filters.push(`p.category_code = $${params.length}`);
      }
    }

    if (salesType !== "all") {
      params.push(salesType);
      filters.push(`${salesStatusSql} = $${params.length}`);
    }

    const pool = getPrimaryPool();
    const whereClause = filters.length > 0 ? filters.join(" AND ") : "TRUE";

    if (masterSku) {
      const result = await pool.query(
        `SELECT
           p.master_sku,
           p.product_name,
           p.category,
           p.category_code,
           p.status::text AS status,
           ${salesStatusSql} AS sales_status,
           p.moq,
           p.order_multiple,
           p.cbm_per_unit::text AS cbm_per_unit,
           p.case_qty,
           p.weight_kg::text AS weight_kg
         FROM shipcore.fc_products p
         WHERE p.master_sku = $1 AND p.status = 'active'
         LIMIT 1`,
        [masterSku]
      );

      if (result.rowCount === 0) {
        return NextResponse.json(
          { success: false, error: `SKU does not exist in fc_products: ${masterSku}` },
          { status: 404 }
        );
      }

      const row = result.rows[0];
      const inferred = inferProduct(row.master_sku);
      return NextResponse.json({
        success: true,
        data: {
          masterSku: row.master_sku,
          productName: row.product_name,
          productKey: (row.category_code?.toLowerCase() ?? inferred.productKey) as ProductKey,
          category: row.category ?? inferred.category,
          categoryCode: row.category_code ?? inferred.categoryCode,
          status: row.status ?? "active",
          salesStatus: (row.sales_status as string | null) ?? null,
          moq: Number(row.moq ?? inferred.moq),
          orderMultiple: Number(row.order_multiple ?? inferred.moq),
          cbmPerUnit: Number(row.cbm_per_unit ?? inferred.cbmPerUnit),
          caseQty: Number(row.case_qty ?? inferred.caseQty),
          weightKg: Number(row.weight_kg ?? inferred.weightKg),
        },
      });
    }

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM shipcore.fc_products p
       WHERE ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const dataParams = [...params, limit, offset];
    const limitParam = dataParams.length - 1;
    const offsetParam = dataParams.length;

    const result = await pool.query(
      `SELECT
         p.master_sku,
         p.product_name,
         p.category,
         p.category_code,
         p.status::text AS status,
         ${salesStatusSql} AS sales_status,
         p.moq,
         p.order_multiple,
         p.cbm_per_unit::text AS cbm_per_unit,
         p.case_qty,
         p.weight_kg::text AS weight_kg
       FROM shipcore.fc_products p
       WHERE ${whereClause}
       ORDER BY p.category_code NULLS LAST, p.master_sku
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      dataParams
    );

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => {
        const inferred = inferProduct(row.master_sku);
        return {
          masterSku: row.master_sku,
          productName: row.product_name,
          productKey: (row.category_code?.toLowerCase() ?? inferred.productKey) as ProductKey,
          category: row.category ?? inferred.category,
          categoryCode: row.category_code ?? inferred.categoryCode,
          status: row.status ?? "active",
          salesStatus: (row.sales_status as string | null) ?? null,
          moq: Number(row.moq ?? inferred.moq),
          orderMultiple: Number(row.order_multiple ?? inferred.moq),
          cbmPerUnit: Number(row.cbm_per_unit ?? inferred.cbmPerUnit),
          caseQty: Number(row.case_qty ?? inferred.caseQty),
          weightKg: Number(row.weight_kg ?? inferred.weightKg),
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("SKU master GET failed:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST() {
  const denied = await guardPermission("sku-master", "edit");
  if (denied) return denied;
  const lookup = getLookupPool();
  if (!lookup) {
    return NextResponse.json(
      { success: false, error: "SUPABASE_LOOKUP_DATABASE_URL is not configured" },
      { status: 500 }
    );
  }

  const primary = getPrimaryPool();
  const lookupClient = await lookup.connect();
  const primaryClient = await primary.connect();

  try {
    const source = await lookupClient.query<{ master_sku: string }>(
      `SELECT DISTINCT btrim(master_sku) AS master_sku
       FROM ecommerce_data.coverland_inventory_by_warehouse
       WHERE master_sku IS NOT NULL AND btrim(master_sku) <> ''
       ORDER BY btrim(master_sku)`
    );

    const rows = source.rows.map((row) => {
      const masterSku = row.master_sku.trim();
      return { masterSku, ...inferProduct(masterSku) };
    });

    await primaryClient.query("BEGIN");
    await primaryClient.query(`
      CREATE TEMP TABLE stg_fc_products (
        master_sku TEXT,
        product_name TEXT,
        category TEXT,
        category_code TEXT,
        moq INT,
        order_multiple INT,
        cbm_per_unit NUMERIC,
        case_qty INT,
        weight_kg NUMERIC
      ) ON COMMIT DROP
    `);

    if (rows.length > 0) {
      await primaryClient.query(
        `INSERT INTO stg_fc_products
           (master_sku, product_name, category, category_code, moq, order_multiple, cbm_per_unit, case_qty, weight_kg)
         SELECT
           unnest($1::text[]),
           unnest($2::text[]),
           unnest($3::text[]),
           unnest($4::text[]),
           unnest($5::int[]),
           unnest($6::int[]),
           unnest($7::numeric[]),
           unnest($8::int[]),
           unnest($9::numeric[])`,
        [
          rows.map((row) => row.masterSku),
          rows.map((row) => row.masterSku),
          rows.map((row) => row.category),
          rows.map((row) => row.categoryCode),
          rows.map((row) => row.moq),
          rows.map((row) => row.moq),
          rows.map((row) => row.cbmPerUnit),
          rows.map((row) => row.caseQty),
          rows.map((row) => row.weightKg),
        ]
      );
    }

    const upsert = await primaryClient.query(`
      INSERT INTO shipcore.fc_products (
        master_sku, product_name, category, category_code, status,
        moq, order_multiple, cbm_per_unit, case_qty, weight_kg,
        created_at, updated_at
      )
      SELECT
        master_sku, product_name, category, category_code, 'active',
        moq, order_multiple, cbm_per_unit, case_qty, weight_kg,
        NOW(), NOW()
      FROM stg_fc_products
      ON CONFLICT (master_sku) DO UPDATE SET
        product_name = COALESCE(NULLIF(shipcore.fc_products.product_name, ''), EXCLUDED.product_name),
        category = COALESCE(shipcore.fc_products.category, EXCLUDED.category),
        category_code = COALESCE(shipcore.fc_products.category_code, EXCLUDED.category_code),
        status = 'active',
        updated_at = NOW()
    `);

    await primaryClient.query("COMMIT");

    return NextResponse.json({
      success: true,
      sourceRows: source.rowCount,
      upserted: upsert.rowCount,
    });
  } catch (error) {
    await primaryClient.query("ROLLBACK");
    console.error("SKU master sync failed:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  } finally {
    lookupClient.release();
    primaryClient.release();
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await guardPermission("sku-master", "edit");
  if (denied) return denied;
  try {
    const body = await request.json();
    const masterSku = String(body.masterSku ?? "").trim();
    if (!masterSku) {
      return NextResponse.json({ success: false, error: "masterSku is required" }, { status: 400 });
    }

    const moq = body.moq == null ? null : Math.max(1, Number(body.moq));
    const orderMultiple = body.orderMultiple == null ? null : Math.max(1, Number(body.orderMultiple));
    const caseQty = body.caseQty == null ? null : Math.max(1, Number(body.caseQty));
    const cbmPerUnit = body.cbmPerUnit == null ? null : Math.max(0.000001, Number(body.cbmPerUnit));
    const weightKg = body.weightKg == null ? null : Math.max(0, Number(body.weightKg));
    const statusValue = body.status == null ? null : String(body.status).trim().toLowerCase();
    const salesStatusRaw = body.salesStatus == null ? undefined : String(body.salesStatus).trim();
    const salesStatusValue = salesStatusRaw === "" ? null : salesStatusRaw ?? undefined;

    const validSalesStatuses = ["Original", "Custom", "Hold", "Part", "Discontinued", "TBD", "SWC"];
    if (salesStatusValue != null && !validSalesStatuses.includes(salesStatusValue)) {
      return NextResponse.json({ success: false, error: "Invalid salesStatus" }, { status: 400 });
    }

    if (statusValue !== null && statusValue !== "active" && statusValue !== "inactive") {
      return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
    }

    const pool = getPrimaryPool();
    const result = await pool.query(
      `UPDATE shipcore.fc_products
       SET moq = COALESCE($2, moq),
           order_multiple = COALESCE($3, order_multiple),
           cbm_per_unit = COALESCE($4, cbm_per_unit),
           case_qty = COALESCE($5, case_qty),
           weight_kg = COALESCE($6, weight_kg),
           status = COALESCE($7::shipcore.fc_product_status, status),
           sales_status = CASE WHEN $8::text IS NOT NULL THEN $8::text ELSE sales_status END,
           updated_at = NOW()
       WHERE master_sku = $1
       RETURNING master_sku`,
      [masterSku, moq, orderMultiple, cbmPerUnit, caseQty, weightKg, statusValue, salesStatusValue ?? null]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: "SKU not found" }, { status: 404 });
    }

    const session = await auth();
    void logAudit({
      entityType: "sku",
      entityId: masterSku,
      entityLabel: masterSku,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: statusValue === "inactive" ? "delete" : "update",
      after: Object.fromEntries(
        Object.entries({ moq, orderMultiple, cbmPerUnit, caseQty, weightKg, status: statusValue, salesStatus: salesStatusValue })
          .filter(([, v]) => v != null)
      ),
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("SKU master PATCH failed:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await guardPermission("sku-master", "edit");
  if (denied) return denied;
  const pool = getPrimaryPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    const rowsBySku = new Map<string, ExcelCbmRow>();

    for (const rawRow of rawRows) {
      const masterSku = String(rawRow?.masterSku ?? "").trim().toUpperCase();
      const cbmPerUnit = Number(rawRow?.cbmPerUnit);

      if (!masterSku || !Number.isFinite(cbmPerUnit) || cbmPerUnit <= 0) {
        continue;
      }

      rowsBySku.set(masterSku, { masterSku, cbmPerUnit });
    }

    const rows = [...rowsBySku.values()];

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid Master SKU / CBM rows found" },
        { status: 400 }
      );
    }

    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE stg_excel_cbm (
        master_sku TEXT PRIMARY KEY,
        product_name TEXT,
        category TEXT,
        category_code TEXT,
        moq INT,
        order_multiple INT,
        cbm_per_unit NUMERIC,
        case_qty INT,
        weight_kg NUMERIC
      ) ON COMMIT DROP
    `);

    await ensureCbmPrecision(client);

    const inferredRows = rows.map((row) => ({
      ...inferProduct(row.masterSku),
      ...row,
    }));

    await client.query(
      `INSERT INTO stg_excel_cbm
         (master_sku, product_name, category, category_code, moq, order_multiple, cbm_per_unit, case_qty, weight_kg)
       SELECT
         unnest($1::text[]),
         unnest($2::text[]),
         unnest($3::text[]),
         unnest($4::text[]),
         unnest($5::int[]),
         unnest($6::int[]),
         unnest($7::numeric[]),
         unnest($8::int[]),
         unnest($9::numeric[])`,
      [
        inferredRows.map((row) => row.masterSku),
        inferredRows.map((row) => row.masterSku),
        inferredRows.map((row) => row.category),
        inferredRows.map((row) => row.categoryCode),
        inferredRows.map((row) => row.moq),
        inferredRows.map((row) => row.moq),
        inferredRows.map((row) => row.cbmPerUnit),
        inferredRows.map((row) => row.caseQty),
        inferredRows.map((row) => row.weightKg),
      ]
    );

    const existing = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM stg_excel_cbm stg
      JOIN shipcore.fc_products product ON product.master_sku = stg.master_sku
    `);

    const upsert = await client.query(`
      INSERT INTO shipcore.fc_products (
        master_sku, product_name, category, category_code, status,
        moq, order_multiple, cbm_per_unit, case_qty, weight_kg,
        created_at, updated_at
      )
      SELECT
        master_sku, product_name, category, category_code, 'active',
        moq, order_multiple, cbm_per_unit, case_qty, weight_kg,
        NOW(), NOW()
      FROM stg_excel_cbm
      ON CONFLICT (master_sku) DO UPDATE SET
        cbm_per_unit = EXCLUDED.cbm_per_unit,
        product_name = COALESCE(NULLIF(shipcore.fc_products.product_name, ''), EXCLUDED.product_name),
        category = COALESCE(shipcore.fc_products.category, EXCLUDED.category),
        category_code = COALESCE(shipcore.fc_products.category_code, EXCLUDED.category_code),
        status = 'active',
        updated_at = NOW()
    `);

    await client.query("COMMIT");

    const updated = Number(existing.rows[0]?.count ?? 0);
    return NextResponse.json({
      success: true,
      imported: rows.length,
      upserted: upsert.rowCount,
      updated,
      inserted: Math.max(0, rows.length - updated),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("SKU master Excel import failed:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("sku-master", "delete");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const masterSku = searchParams.get("masterSku")?.trim() ?? "";
    if (!masterSku) {
      return NextResponse.json({ success: false, error: "masterSku is required" }, { status: 400 });
    }

    const pool = getPrimaryPool();
    await pool.query(
      `UPDATE shipcore.fc_products
       SET status = 'inactive', updated_at = NOW()
       WHERE master_sku = $1`,
      [masterSku]
    );

    const session = await auth();
    void logAudit({
      entityType: "sku",
      entityId: masterSku,
      entityLabel: masterSku,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: { status: "active" },
      after: { status: "inactive" },
      ip: getIp(request.headers),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("SKU master DELETE failed:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
