// Seed script: inserts sample fc_containers, fc_container_items, fc_purchase_orders, fc_container_po_links
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "",
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 0. Products (fc_products) — required by fc_container_items FK ────────
    await client.query(`
      INSERT INTO shipcore.fc_products (master_sku, product_name, category, brand, cbm_per_unit, created_at, updated_at)
      VALUES
        ('CC-UNI-L',   'Car Cover Universal Large',       'Car Cover',   'Coverland', 0.080, NOW(), NOW()),
        ('CC-UNI-XL',  'Car Cover Universal XL',          'Car Cover',   'Coverland', 0.085, NOW(), NOW()),
        ('CC-MID-M',   'Car Cover Mid Size M',            'Car Cover',   'Coverland', 0.075, NOW(), NOW()),
        ('CC-MID-L',   'Car Cover Mid Size L',            'Car Cover',   'Coverland', 0.080, NOW(), NOW()),
        ('FM-SET-1',   'Floor Mat Set Standard',          'Floor Mat',   'Coverland', 0.040, NOW(), NOW()),
        ('FM-SET-2',   'Floor Mat Set Premium',           'Floor Mat',   'Coverland', 0.035, NOW(), NOW()),
        ('SC-BASIC-B', 'Seat Cover Basic Black',          'Seat Cover',  'Coverland', 0.060, NOW(), NOW()),
        ('SC-PREM-B',  'Seat Cover Premium Black',        'Seat Cover',  'Coverland', 0.065, NOW(), NOW())
      ON CONFLICT (master_sku) DO NOTHING
    `);
    console.log("Upserted sample products");

    // ── 1. Purchase Orders ────────────────────────────────────────────────────
    const poResult = await client.query(`
      INSERT INTO shipcore.fc_purchase_orders
        (po_number, po_date, eta_date, factory_name, origin, dest_warehouse, manager, status, sent_at, created_at, updated_at)
      VALUES
        ('PO-2025-0041', '2025-11-10', '2026-06-15', 'Zhejiang Cover Co.', 'CN-Ningbo', 'WEST', 'Kai C.', 'sent'::shipcore.fc_po_status,     '2025-11-15 09:00:00+00', NOW(), NOW()),
        ('PO-2025-0042', '2025-11-20', '2026-06-30', 'Guangzhou Textile',  'CN-Guangzhou', 'TTM',  'Kai C.', 'sent'::shipcore.fc_po_status, '2025-11-25 09:00:00+00', NOW(), NOW()),
        ('PO-2025-0039', '2025-10-15', '2026-05-20', 'Zhejiang Cover Co.', 'CN-Ningbo', 'WEST', 'Kai C.', 'approved'::shipcore.fc_po_status, NULL, NOW(), NOW()),
        ('PO-2025-0040', '2025-10-25', '2026-05-25', 'Guangzhou Textile',  'CN-Guangzhou', 'TTM',  'Kai C.', 'approved'::shipcore.fc_po_status, NULL, NOW(), NOW())
      ON CONFLICT DO NOTHING
      RETURNING id, po_number
    `);
    const poMap: Record<string, bigint> = {};
    poResult.rows.forEach((r: { id: bigint; po_number: string }) => {
      poMap[r.po_number] = r.id;
    });
    console.log("Inserted POs:", Object.keys(poMap));

    // ── 2. Containers ─────────────────────────────────────────────────────────
    const containerResult = await client.query(`
      INSERT INTO shipcore.fc_containers
        (container_number, eta_date, status, cbm_capacity, factory_name, origin, dest_warehouse, created_at, updated_at)
      VALUES
        ('CONT-2025-001', '2026-06-15', 'draft'::shipcore.fc_container_status,    67.5, 'Zhejiang Cover Co.', 'CN-Ningbo',    'WEST', NOW(), NOW()),
        ('CONT-2025-002', '2026-06-30', 'draft'::shipcore.fc_container_status,    67.5, 'Guangzhou Textile',  'CN-Guangzhou', 'TTM',  NOW(), NOW()),
        ('CONT-2025-003', '2026-05-20', 'shipped'::shipcore.fc_container_status,  67.5, 'Zhejiang Cover Co.', 'CN-Ningbo',    'WEST', NOW(), NOW()),
        ('CONT-2025-004', '2026-05-25', 'shipped'::shipcore.fc_container_status,  67.5, 'Guangzhou Textile',  'CN-Guangzhou', 'TTM',  NOW(), NOW())
      ON CONFLICT DO NOTHING
      RETURNING id, container_number
    `);
    const containerMap: Record<string, bigint> = {};
    containerResult.rows.forEach((r: { id: bigint; container_number: string }) => {
      containerMap[r.container_number] = r.id;
    });
    console.log("Inserted containers:", Object.keys(containerMap));

    if (Object.keys(containerMap).length === 0) {
      console.log("All containers already exist, skipping items and links.");
      await client.query("COMMIT");
      return;
    }

    // ── 3. Container Items ────────────────────────────────────────────────────
    const itemRows: Array<[bigint, string, number, number, number]> = [];

    const c1 = containerMap["CONT-2025-001"];
    const c2 = containerMap["CONT-2025-002"];
    const c3 = containerMap["CONT-2025-003"];
    const c4 = containerMap["CONT-2025-004"];

    if (c1) {
      itemRows.push(
        [c1, "CC-UNI-L",    600, 0.080, 48.0],
        [c1, "CC-UNI-XL",   400, 0.085, 34.0],
      );
    }
    if (c2) {
      itemRows.push(
        [c2, "FM-SET-1",    800, 0.040, 32.0],
        [c2, "SC-BASIC-B",  500, 0.060, 30.0],
      );
    }
    if (c3) {
      itemRows.push(
        [c3, "CC-MID-M",    700, 0.075, 52.5],
        [c3, "CC-MID-L",    200, 0.080, 16.0],
      );
    }
    if (c4) {
      itemRows.push(
        [c4, "FM-SET-2",   1000, 0.035, 35.0],
        [c4, "SC-PREM-B",   400, 0.065, 26.0],
      );
    }

    for (const [containerId, masterSku, qty, cbmUnit] of itemRows) {
      await client.query(
        `INSERT INTO shipcore.fc_container_items
           (container_id, master_sku, qty, cbm_unit, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [containerId, masterSku, qty, cbmUnit]
      );
    }
    console.log(`Inserted ${itemRows.length} container items`);

    // ── 4. PO ↔ Container Links ───────────────────────────────────────────────
    const links: Array<[bigint, bigint]> = [];
    if (c1 && poMap["PO-2025-0041"]) links.push([c1, poMap["PO-2025-0041"]]);
    if (c2 && poMap["PO-2025-0042"]) links.push([c2, poMap["PO-2025-0042"]]);
    if (c3 && poMap["PO-2025-0039"]) links.push([c3, poMap["PO-2025-0039"]]);
    if (c4 && poMap["PO-2025-0040"]) links.push([c4, poMap["PO-2025-0040"]]);

    for (const [containerId, poId] of links) {
      await client.query(
        `INSERT INTO shipcore.fc_container_po_links (container_id, po_id, created_at)
         VALUES ($1, $2, NOW())`,
        [containerId, poId]
      );
    }
    console.log(`Inserted ${links.length} PO-container links`);

    await client.query("COMMIT");
    console.log("\nDone. Sample data inserted successfully.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
