import type { PoolClient } from "pg";

type SyncRemainingAllocationInput = {
  containerId: number;
  masterSku: string;
  targetQty: number;
};

type StockRow = {
  id: string;
  total_qty: number;
  allocated_total: number;
  allocated_here: number;
};

export async function syncRemainingAllocationForContainerItem(
  client: PoolClient,
  input: SyncRemainingAllocationInput,
): Promise<number> {
  const masterSku = input.masterSku.trim().toUpperCase();
  const targetQty = Math.max(0, Math.trunc(input.targetQty));

  const lockedStocks = await client.query<{ id: string }>(
    `SELECT id::text
     FROM shipcore.fc_available_stock
     WHERE source_type = 'remaining'
       AND master_sku = $1
     ORDER BY id
     FOR UPDATE`,
    [masterSku],
  );

  if (lockedStocks.rowCount === 0) {
    return 0;
  }

  const stockIds = lockedStocks.rows.map((row) => row.id);
  const stockResult = await client.query<StockRow>(
    `SELECT
       s.id::text,
       s.total_qty::int,
       COALESCE(SUM(a.qty), 0)::int AS allocated_total,
       COALESCE(SUM(a.qty) FILTER (WHERE a.container_id = $1::bigint), 0)::int AS allocated_here
     FROM shipcore.fc_available_stock s
     LEFT JOIN shipcore.fc_container_item_allocations a ON a.source_stock_id = s.id
     WHERE s.id = ANY($2::bigint[])
     GROUP BY s.id
     ORDER BY s.id`,
    [input.containerId, stockIds],
  );

  await client.query(
    `SELECT a.id
     FROM shipcore.fc_container_item_allocations a
     JOIN shipcore.fc_available_stock s ON s.id = a.source_stock_id
     WHERE a.container_id = $1::bigint
       AND s.master_sku = $2
       AND s.source_type = 'remaining'
     FOR UPDATE OF a`,
    [input.containerId, masterSku],
  );

  let qtyLeft = targetQty;
  let allocatedQty = 0;

  for (const stock of stockResult.rows) {
    const totalQty = Number(stock.total_qty);
    const allocatedTotal = Number(stock.allocated_total);
    const allocatedHere = Number(stock.allocated_here);
    const maxForThisContainer = Math.max(0, totalQty - (allocatedTotal - allocatedHere));
    const nextQty = Math.min(qtyLeft, maxForThisContainer);
    qtyLeft -= nextQty;
    allocatedQty += nextQty;

    if (nextQty > 0) {
      await client.query(
        `INSERT INTO shipcore.fc_container_item_allocations
           (container_id, source_stock_id, qty, created_at, updated_at)
         VALUES ($1::bigint, $2::bigint, $3::int, NOW(), NOW())
         ON CONFLICT (container_id, source_stock_id) DO UPDATE SET
           qty = EXCLUDED.qty,
           updated_at = NOW()`,
        [input.containerId, stock.id, nextQty],
      );
    } else if (allocatedHere > 0) {
      await client.query(
        `DELETE FROM shipcore.fc_container_item_allocations
         WHERE container_id = $1::bigint
           AND source_stock_id = $2::bigint`,
        [input.containerId, stock.id],
      );
    }
  }

  return allocatedQty;
}

export async function deleteRemainingAllocationsForContainerItem(
  client: PoolClient,
  input: Omit<SyncRemainingAllocationInput, "targetQty">,
): Promise<void> {
  await client.query(
    `DELETE FROM shipcore.fc_container_item_allocations a
     USING shipcore.fc_available_stock s
     WHERE s.id = a.source_stock_id
       AND a.container_id = $1::bigint
       AND s.master_sku = $2
       AND s.source_type = 'remaining'`,
    [input.containerId, input.masterSku.trim().toUpperCase()],
  );
}
