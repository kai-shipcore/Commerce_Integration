import { getPrimaryPool } from "@/lib/db/primary-db";

export type PushableContainerRow = {
  id: string;
  container_number: string;
  status: string;
  /** DP warehouse code (fc_warehouses.warehouse_code), as the container stores it. */
  dest_warehouse: string | null;
  /** fc_warehouses.warehouse_name for that code; null when the code is not in fc_warehouses. */
  dest_warehouse_name: string | null;
  /** fc_warehouses.timezone for that code (IANA); null when unknown. */
  dest_timezone: string | null;
  /** YYYY-MM-DD; the planned arrival at the destination warehouse. */
  eta_date: string | null;
  /** YYYY-MM-DD; the planned arrival at the LA / Long Beach port. */
  eta_lax_lgb_date: string | null;
  items: { sku: string; qty: number }[];
};

export const WorkbenchContainerPushRepository = {
  /** Every container in one of `statuses`, with its full item list. */
  async listContainers(statuses: readonly string[]): Promise<PushableContainerRow[]> {
    // Dates go out as text: node-pg turns a DATE into a local-midnight Date,
    // which shifts a day under any non-UTC process timezone.
    const result = await getPrimaryPool().query<PushableContainerRow>(
      `SELECT c.id::text AS id,
              c.container_number,
              c.status::text AS status,
              c.dest_warehouse,
              w.warehouse_name AS dest_warehouse_name,
              w.timezone AS dest_timezone,
              to_char(c.eta_date, 'YYYY-MM-DD') AS eta_date,
              to_char(c.eta_lax_lgb_date, 'YYYY-MM-DD') AS eta_lax_lgb_date,
              COALESCE(item_list.items, '[]'::json) AS items
         FROM shipcore.fc_containers c
         LEFT JOIN shipcore.fc_warehouses w
           ON upper(w.warehouse_code) = upper(btrim(c.dest_warehouse))
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('sku', i.master_sku, 'qty', i.qty) ORDER BY i.id) AS items
             FROM shipcore.fc_container_items i
            WHERE i.container_id = c.id
         ) item_list ON TRUE
        WHERE c.status::text = ANY($1::text[])
        ORDER BY c.id`,
      [statuses],
    );
    return result.rows;
  },
};
