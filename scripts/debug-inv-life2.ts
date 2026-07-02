import { getPrimaryPool } from "../src/lib/db/primary-db";

const SKU = "CA-SC-10-E-27-BK-1TO";

async function main() {
  const pool = getPrimaryPool();

  const stats = await pool.query(`
    SELECT master_sku,
           total_stock::float8 AS total_stock,
           back::float8 AS back,
           avg_daily_curr::float8,
           east_avg_curr::float8,
           fba_avg_curr::float8,
           total_avg_curr::float8,
           avg_daily_real::float8,
           east_avg_real::float8,
           fba_avg_real::float8,
           total_avg_real::float8
    FROM shipcore.fc_stats
    WHERE master_sku = $1
  `, [SKU]);

  const items = await pool.query(`
    SELECT c.container_number, c.eta_date::text AS eta, ci.qty::float8 AS qty
    FROM shipcore.fc_container_items ci
    JOIN shipcore.fc_containers c ON c.id = ci.container_id
    WHERE ci.master_sku = $1
    ORDER BY c.eta_date
  `, [SKU]);

  const s = stats.rows[0];
  console.log("Raw DB values:");
  console.log(JSON.stringify(s, null, 2));
  console.log("\nContainers:");
  console.table(items.rows);

  // Trace the route's calculation
  const total_stock = Number(s.total_stock);
  const back = Number(s.back);
  const total_avg_curr_raw = Number(s.total_avg_curr);

  // With floor (what our system uses)
  const avg_daily_curr = Math.max(0.01, Number(s.avg_daily_curr));
  const east_avg_curr  = Math.max(0.01, Number(s.east_avg_curr));
  const fba_avg_curr   = Math.max(0.01, Number(s.fba_avg_curr));
  const total_avg_curr = Math.max(0.03, avg_daily_curr + east_avg_curr + fba_avg_curr);

  console.log("\n--- Baseline ---");
  const availQty = total_stock + back;
  const prevCarryover = Math.max(0, availQty);
  const prevBackorder = availQty < 0 ? Math.abs(availQty) : 0;
  console.log(`availQty=${availQty}, prevCarryover=${prevCarryover}, prevBackorder=${prevBackorder}`);
  console.log(`total_avg_curr (raw)=${total_avg_curr_raw}, total_avg_curr (with floor)=${total_avg_curr}`);

  const first = items.rows[0];
  if (!first) { console.log("No container items"); await pool.end(); return; }

  const eta = first.eta;
  const qty = Number(first.qty);
  const todayStr = new Date().toISOString().slice(0, 10);
  const daysBetween = Math.round((new Date(eta).getTime() - new Date(todayStr).getTime()) / 86400000);
  const seasonalFactor = 1.0; // June = 1.0

  const estSales   = daysBetween * total_avg_curr * seasonalFactor;
  const availQtyC  = prevCarryover > 0 ? prevCarryover + qty : qty - prevBackorder;
  const backorderC = Math.max(0, estSales - availQtyC);
  const carryoverC = backorderC >= 1 ? 0 : Math.max(0, availQtyC - estSales);
  const invLifeC   = carryoverC / (total_avg_curr * seasonalFactor);

  console.log(`\n--- Container ${first.container_number} (eta=${eta}, qty=${qty}) ---`);
  console.log(`daysBetween=${daysBetween}, estSales=${estSales}`);
  console.log(`availQtyC=${availQtyC}, backorderC=${backorderC}, carryoverC=${carryoverC}`);
  console.log(`invLife (with floor) = ${carryoverC} / (${total_avg_curr} * ${seasonalFactor}) = ${invLifeC}`);

  // Without floor
  const total_avg_curr_nf = total_avg_curr_raw;
  const estSales_nf   = daysBetween * total_avg_curr_nf * seasonalFactor;
  const availQtyC_nf  = prevCarryover > 0 ? prevCarryover + qty : qty - prevBackorder;
  const backorderC_nf = Math.max(0, estSales_nf - availQtyC_nf);
  const carryoverC_nf = backorderC_nf >= 1 ? 0 : Math.max(0, availQtyC_nf - estSales_nf);
  const invLifeC_nf   = carryoverC_nf > 0 ? carryoverC_nf / (total_avg_curr_nf * seasonalFactor) : 0;
  console.log(`\nWithout floor: total_avg_curr=${total_avg_curr_nf}`);
  console.log(`carryoverC=${carryoverC_nf}, invLife = ${invLifeC_nf}`);

  await pool.end();
}

main().catch(console.error);
