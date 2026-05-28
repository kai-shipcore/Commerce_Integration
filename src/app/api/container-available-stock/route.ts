import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";

const StockSourceSchema = z.enum(["remaining", "mistake"]);

const CreateStockSchema = z.object({
  sourceType: StockSourceSchema,
  referenceNo: z.string().trim().min(1),
  plNo: z.string().trim().optional(),
  masterSku: z.string().trim().min(1),
  totalQty: z.number().int().positive(),
  cbm: z.number().positive(),
  note: z.string().trim().optional(),
});

const UpdateStockSchema = CreateStockSchema.extend({
  id: z.string().regex(/^\d+$/),
});

const AllocateSchema = z.object({
  action: z.literal("allocate"),
  containerId: z.string().regex(/^\d+$/),
  allocations: z.array(z.object({
    stockId: z.string().regex(/^\d+$/),
    qty: z.number().int().positive(),
  })).min(1),
});

const ImportStockSchema = z.object({
  action: z.literal("import"),
  rows: z.array(z.object({
    sourceType: StockSourceSchema,
    referenceNo: z.string().trim().min(1),
    plNo: z.string().trim().optional(),
    masterSku: z.string().trim().min(1),
    totalQty: z.number().int().positive(),
    cbm: z.number().positive().optional(),
    note: z.string().trim().optional(),
  })).min(1),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: NextRequest) {
  try {
    const containerId = new URL(request.url).searchParams.get("containerId")?.trim() ?? "";
    const params: unknown[] = [];
    let allocationExpr = "0::int";
    if (/^\d+$/.test(containerId)) {
      params.push(containerId);
      allocationExpr = `COALESCE(SUM(a.qty) FILTER (WHERE a.container_id = $1::bigint), 0)::int`;
    }

    const result = await getPrimaryPool().query(
      `SELECT
         s.id::text AS id,
         s.source_type,
         s.reference_no,
         s.pl_no,
         s.master_sku,
         s.total_qty::int,
         s.cbm_unit::float8 AS cbm,
         s.note,
         (s.total_qty - COALESCE(SUM(a.qty), 0))::int AS available_qty,
         ${allocationExpr} AS allocated_to_container
       FROM shipcore.fc_available_stock s
       LEFT JOIN shipcore.fc_container_item_allocations a ON a.source_stock_id = s.id
       GROUP BY s.id
       ORDER BY s.source_type, s.reference_no, s.master_sku`,
      params
    );

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id as string,
        sourceType: row.source_type as "remaining" | "mistake",
        referenceNo: row.reference_no as string,
        plNo: row.pl_no as string | null,
        masterSku: row.master_sku as string,
        totalQty: Number(row.total_qty),
        availableQty: Number(row.available_qty),
        allocatedToContainer: Number(row.allocated_to_container),
        cbm: Number(row.cbm),
        note: row.note as string | null,
      })),
    });
  } catch (error) {
    console.error("Available stock GET failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json();
  const importRequest = ImportStockSchema.safeParse(body);
  if (importRequest.success) {
    const client = await getPrimaryPool().connect();
    try {
      await client.query("BEGIN");
      const normalizedRows = importRequest.data.rows.map((row) => ({
        ...row,
        referenceNo: row.referenceNo.trim(),
        plNo: row.plNo?.trim() || null,
        masterSku: row.masterSku.trim().toUpperCase(),
        note: row.note?.trim() || null,
      }));
      const skus = [...new Set(normalizedRows.map((row) => row.masterSku))];
      const products = await client.query<{ master_sku: string; cbm: number }>(
        `SELECT master_sku, cbm_per_unit::float8 AS cbm
         FROM shipcore.fc_products
         WHERE master_sku = ANY($1::text[])`,
        [skus]
      );
      const cbmBySku = new Map(products.rows.map((row) => [row.master_sku, Number(row.cbm)]));
      const missingSkus = skus.filter((sku) => !cbmBySku.has(sku));
      if (missingSkus.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { success: false, error: `SKU does not exist in SKU Master: ${missingSkus.join(", ")}` },
          { status: 400 }
        );
      }

      let inserted = 0;
      let skipped = 0;
      for (const row of normalizedRows) {
        const cbm = row.cbm ?? cbmBySku.get(row.masterSku) ?? 0;
        if (cbm <= 0) {
          throw new Error(`No CBM per unit on file for ${row.masterSku}.`);
        }
        const result = await client.query(
          `INSERT INTO shipcore.fc_available_stock
             (source_type, reference_no, pl_no, master_sku, total_qty, cbm_unit, note)
           SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::int, $6::numeric, $7::text
           WHERE NOT EXISTS (
             SELECT 1 FROM shipcore.fc_available_stock
             WHERE source_type = $1::varchar
               AND reference_no = $2::varchar
               AND pl_no IS NOT DISTINCT FROM $3::varchar
               AND master_sku = $4::varchar
           )
           RETURNING id`,
          [row.sourceType, row.referenceNo, row.plNo, row.masterSku, row.totalQty, cbm, row.note]
        );
        if (result.rowCount === 1) inserted += 1;
        else skipped += 1;
      }
      await client.query("COMMIT");
      await invalidatePlanningDashboardCache();
      return NextResponse.json({ success: true, data: { inserted, skipped, total: normalizedRows.length } });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Available stock import failed:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    } finally {
      client.release();
    }
  }

  const allocation = AllocateSchema.safeParse(body);

  if (!allocation.success) {
    try {
      const validated = CreateStockSchema.parse(body);
      const masterSku = validated.masterSku.toUpperCase();
      const product = await getPrimaryPool().query(
        `SELECT master_sku
         FROM shipcore.fc_products
         WHERE master_sku = $1
         LIMIT 1`,
        [masterSku]
      );
      if (product.rowCount === 0) {
        return NextResponse.json(
          { success: false, error: `SKU not found in SKU Master: ${masterSku}` },
          { status: 400 }
        );
      }
      const result = await getPrimaryPool().query(
        `INSERT INTO shipcore.fc_available_stock
           (source_type, reference_no, pl_no, master_sku, total_qty, cbm_unit, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id::text`,
        [
          validated.sourceType,
          validated.referenceNo,
          validated.plNo || null,
          masterSku,
          validated.totalQty,
          validated.cbm,
          validated.note || null,
        ]
      );
      await invalidatePlanningDashboardCache();
      return NextResponse.json({ success: true, data: { id: result.rows[0].id } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ success: false, error: "Validation error", details: error.issues }, { status: 400 });
      }
      console.error("Available stock POST failed:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
  }

  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");
    const container = await client.query<{ status: string }>(
      `SELECT status::text FROM shipcore.fc_containers WHERE id = $1::bigint FOR UPDATE`,
      [allocation.data.containerId]
    );
    if (container.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Container not found" }, { status: 404 });
    }
    if (container.rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Available stock can be added only while the container is Draft." }, { status: 409 });
    }

    const qtyByStockId = new Map<string, number>();
    for (const requested of allocation.data.allocations) {
      qtyByStockId.set(requested.stockId, (qtyByStockId.get(requested.stockId) ?? 0) + requested.qty);
    }

    const stockIds = [...qtyByStockId.keys()];
    const stockResult = await client.query<{ id: string; master_sku: string; cbm: number; available_qty: number }>(
      `SELECT
         s.id::text,
         s.master_sku,
         s.cbm_unit::float8 AS cbm,
         (s.total_qty - COALESCE((
           SELECT SUM(a.qty)
           FROM shipcore.fc_container_item_allocations a
           WHERE a.source_stock_id = s.id
         ), 0))::int AS available_qty
       FROM shipcore.fc_available_stock s
       WHERE s.id = ANY($1::bigint[])
       FOR UPDATE OF s`,
      [stockIds]
    );

    if (stockResult.rowCount !== stockIds.length) {
      throw new Error("One or more available stock records were not found.");
    }

    const itemQtyBySku = new Map<string, { qty: number; cbm: number }>();
    for (const stock of stockResult.rows) {
      const requestedQty = qtyByStockId.get(stock.id) ?? 0;
      if (requestedQty > stock.available_qty) {
        throw new Error(`Requested quantity exceeds available quantity for ${stock.master_sku}`);
      }
      const current = itemQtyBySku.get(stock.master_sku);
      itemQtyBySku.set(stock.master_sku, {
        qty: (current?.qty ?? 0) + requestedQty,
        cbm: stock.cbm,
      });
    }

    const allocationStockIds = stockIds;
    const allocationQtys = allocationStockIds.map((stockId) => qtyByStockId.get(stockId) ?? 0);
    await client.query(
      `INSERT INTO shipcore.fc_container_item_allocations (container_id, source_stock_id, qty)
       SELECT $1::bigint, stock_id, qty
       FROM unnest($2::bigint[], $3::int[]) AS allocation(stock_id, qty)
       ON CONFLICT (container_id, source_stock_id) DO UPDATE SET
         qty = shipcore.fc_container_item_allocations.qty + EXCLUDED.qty,
         updated_at = NOW()`,
      [allocation.data.containerId, allocationStockIds, allocationQtys]
    );

    const itemSkus = [...itemQtyBySku.keys()];
    const itemQtys = itemSkus.map((sku) => itemQtyBySku.get(sku)?.qty ?? 0);
    const itemCbms = itemSkus.map((sku) => itemQtyBySku.get(sku)?.cbm ?? 0);
    await client.query(
      `INSERT INTO shipcore.fc_container_items
         (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
       SELECT $1::bigint, master_sku, qty, cbm, NOW(), NOW()
       FROM unnest($2::text[], $3::int[], $4::numeric[]) AS item(master_sku, qty, cbm)
       ON CONFLICT (container_id, master_sku) DO UPDATE SET
         qty = shipcore.fc_container_items.qty + EXCLUDED.qty,
         cbm_unit = EXCLUDED.cbm_unit,
         updated_at = NOW()`,
      [allocation.data.containerId, itemSkus, itemQtys, itemCbms]
    );

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Available stock allocation failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 400 });
  } finally {
    client.release();
  }
}

export async function PATCH(request: NextRequest) {
  const client = await getPrimaryPool().connect();

  try {
    const body: unknown = await request.json();
    const validated = UpdateStockSchema.parse(body);
    const masterSku = validated.masterSku.toUpperCase();

    await client.query("BEGIN");
    const product = await client.query(
      `SELECT master_sku
       FROM shipcore.fc_products
       WHERE master_sku = $1
       LIMIT 1`,
      [masterSku]
    );
    if (product.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: `SKU not found in SKU Master: ${masterSku}` },
        { status: 400 }
      );
    }
    const existing = await client.query<{
      source_type: "remaining" | "mistake";
      master_sku: string;
      cbm: number;
      allocated_qty: number;
    }>(
      `SELECT
         s.source_type,
         s.master_sku,
         s.cbm_unit::float8 AS cbm,
         COALESCE((
           SELECT SUM(a.qty)
           FROM shipcore.fc_container_item_allocations a
           WHERE a.source_stock_id = s.id
         ), 0)::int AS allocated_qty
       FROM shipcore.fc_available_stock s
       WHERE s.id = $1::bigint
       FOR UPDATE OF s`,
      [validated.id]
    );

    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Available stock not found." }, { status: 404 });
    }

    const current = existing.rows[0];
    if (validated.totalQty < current.allocated_qty) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: `Quantity cannot be less than allocated quantity (${current.allocated_qty}).` },
        { status: 409 }
      );
    }
    if (
      current.allocated_qty > 0 &&
      (validated.sourceType !== current.source_type ||
        masterSku !== current.master_sku ||
        validated.cbm !== current.cbm)
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "Allocated stock cannot change list, Master SKU, or CBM." },
        { status: 409 }
      );
    }

    await client.query(
      `UPDATE shipcore.fc_available_stock
       SET source_type = $2,
           reference_no = $3,
           pl_no = $4,
           master_sku = $5,
           total_qty = $6::int,
           cbm_unit = $7::numeric,
           note = $8,
           updated_at = NOW()
       WHERE id = $1::bigint`,
      [
        validated.id,
        validated.sourceType,
        validated.referenceNo,
        validated.plNo || null,
        masterSku,
        validated.totalQty,
        validated.cbm,
        validated.note || null,
      ]
    );
    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();
    return NextResponse.json({ success: true, data: { id: validated.id } });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Validation error", details: error.issues }, { status: 400 });
    }
    console.error("Available stock PATCH failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const stockId = searchParams.get("stockId")?.trim() ?? "";
  if (stockId) {
    if (!/^\d+$/.test(stockId)) {
      return NextResponse.json({ success: false, error: "Valid stockId is required" }, { status: 400 });
    }

    const client = await getPrimaryPool().connect();
    try {
      await client.query("BEGIN");
      const stock = await client.query<{ allocated_qty: number }>(
        `SELECT COALESCE((
           SELECT SUM(a.qty)
           FROM shipcore.fc_container_item_allocations a
           WHERE a.source_stock_id = s.id
         ), 0)::int AS allocated_qty
         FROM shipcore.fc_available_stock s
         WHERE s.id = $1::bigint
         FOR UPDATE OF s`,
        [stockId]
      );
      if (stock.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ success: false, error: "Available stock not found." }, { status: 404 });
      }
      if (stock.rows[0].allocated_qty > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { success: false, error: "Allocated stock cannot be deleted. Remove its container allocation first." },
          { status: 409 }
        );
      }
      await client.query(`DELETE FROM shipcore.fc_available_stock WHERE id = $1::bigint`, [stockId]);
      await client.query("COMMIT");
      await invalidatePlanningDashboardCache();
      return NextResponse.json({ success: true, data: { id: stockId } });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Available stock record DELETE failed:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    } finally {
      client.release();
    }
  }

  const allocationInput = searchParams.get("allocationIds")?.trim() || searchParams.get("allocationId")?.trim() || "";
  const allocationIds = [...new Set(allocationInput.split(",").map((id) => id.trim()).filter(Boolean))];
  if (allocationIds.length === 0 || allocationIds.some((id) => !/^\d+$/.test(id))) {
    return NextResponse.json({ success: false, error: "Valid allocationId or allocationIds is required" }, { status: 400 });
  }

  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");
    const allocationResult = await client.query<{ id: string; container_id: string; master_sku: string; qty: number; status: string }>(
      `SELECT
         a.id::text,
         a.container_id::text,
         s.master_sku,
         a.qty::int,
         c.status::text
       FROM shipcore.fc_container_item_allocations a
       JOIN shipcore.fc_available_stock s ON s.id = a.source_stock_id
       JOIN shipcore.fc_containers c ON c.id = a.container_id
       WHERE a.id = ANY($1::bigint[])
       FOR UPDATE OF a, c`,
      [allocationIds]
    );

    if (allocationResult.rowCount !== allocationIds.length) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Allocation not found" }, { status: 404 });
    }

    const containerIds = new Set(allocationResult.rows.map((row) => row.container_id));
    if (containerIds.size !== 1) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Selected allocations must belong to the same container." }, { status: 400 });
    }

    const containerId = allocationResult.rows[0].container_id;
    if (allocationResult.rows.some((row) => row.status !== "draft")) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Allocated stock can be removed only while the container is Draft." }, { status: 409 });
    }

    const removeQtyBySku = new Map<string, number>();
    for (const row of allocationResult.rows) {
      removeQtyBySku.set(row.master_sku, (removeQtyBySku.get(row.master_sku) ?? 0) + row.qty);
    }

    const skus = [...removeQtyBySku.keys()];
    const removeQtys = skus.map((sku) => removeQtyBySku.get(sku) ?? 0);
    const itemResult = await client.query<{ master_sku: string; qty: number }>(
      `SELECT master_sku, qty::int
       FROM shipcore.fc_container_items
       WHERE container_id = $1::bigint
         AND master_sku = ANY($2::text[])
       FOR UPDATE`,
      [containerId, skus]
    );
    const itemQtyBySku = new Map(itemResult.rows.map((row) => [row.master_sku, row.qty]));
    const inconsistentSku = skus.find((sku) => (itemQtyBySku.get(sku) ?? 0) < (removeQtyBySku.get(sku) ?? 0));
    if (inconsistentSku) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "Container item quantity is inconsistent with allocated stock." }, { status: 409 });
    }

    await client.query(
      `DELETE FROM shipcore.fc_container_item_allocations
       WHERE id = ANY($1::bigint[])`,
      [allocationIds]
    );

    await client.query(
      `UPDATE shipcore.fc_container_items ci
       SET qty = ci.qty - removed.remove_qty,
           updated_at = NOW()
       FROM (
         SELECT unnest($2::text[]) AS master_sku,
                unnest($3::int[]) AS remove_qty
       ) removed
       WHERE ci.container_id = $1::bigint
         AND ci.master_sku = removed.master_sku
         AND ci.qty > removed.remove_qty`,
      [containerId, skus, removeQtys]
    );

    await client.query(
      `DELETE FROM shipcore.fc_container_items ci
       USING (
         SELECT unnest($2::text[]) AS master_sku,
                unnest($3::int[]) AS remove_qty
       ) removed
       WHERE ci.container_id = $1::bigint
         AND ci.master_sku = removed.master_sku
         AND ci.qty = removed.remove_qty`,
      [containerId, skus, removeQtys]
    );

    await client.query("COMMIT");
    await invalidatePlanningDashboardCache();
    return NextResponse.json({ success: true, data: { containerId, deletedCount: allocationIds.length } });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Available stock allocation DELETE failed:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    client.release();
  }
}
