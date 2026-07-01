/**
 * One-time script: D/P = '동일'인 행의 Passenger 컬럼을 Driver 값으로 동기화
 * Run: npx tsx scripts/sync-seat-cover-parts-dongil.ts
 */
import "dotenv/config";
import { getPrimaryPool } from "../src/lib/db/primary-db";

const UPDATES: { table: string; driverCol: string; dpCol: string; passengerCol: string }[] = [
  // FRONT (4 pairs)
  { table: "fc_seat_cover_parts_front", driverCol: "headrest",        dpCol: "headrest_dp_detail",        passengerCol: "headrest2" },
  { table: "fc_seat_cover_parts_front", driverCol: "top_body",        dpCol: "top_body_dp_detail",        passengerCol: "top_body2" },
  { table: "fc_seat_cover_parts_front", driverCol: "bottom",          dpCol: "bottom_dp_detail",          passengerCol: "bottom2" },
  { table: "fc_seat_cover_parts_front", driverCol: "armrest",         dpCol: "armrest_detail",            passengerCol: "armrest2" },
  // REAR (6 pairs)
  { table: "fc_seat_cover_parts_rear",  driverCol: "headrest",        dpCol: "headrest_dp_detail",        passengerCol: "headrest2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "top_body",        dpCol: "top_body_dp_detail",        passengerCol: "top_body2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "bottom",          dpCol: "bottom_dp_detail",          passengerCol: "bottom2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "armrest",         dpCol: "armrest_detail",            passengerCol: "armrest2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "backrest_storage",dpCol: "backrest_storage_dp_detail",passengerCol: "backrest_storage2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "subpart",         dpCol: "subpart_dp_detail",         passengerCol: "subpart2" },
  // THIRD (6 pairs)
  { table: "fc_seat_cover_parts_third", driverCol: "headrest",        dpCol: "headrest_dp_detail",        passengerCol: "headrest2" },
  { table: "fc_seat_cover_parts_third", driverCol: "top_body",        dpCol: "top_body_dp_detail",        passengerCol: "top_body2" },
  { table: "fc_seat_cover_parts_third", driverCol: "bottom",          dpCol: "bottom_dp_detail",          passengerCol: "bottom2" },
  { table: "fc_seat_cover_parts_third", driverCol: "armrest",         dpCol: "armrest_detail",            passengerCol: "armrest2" },
  { table: "fc_seat_cover_parts_third", driverCol: "backrest_storage",dpCol: "backrest_storage_dp_detail",passengerCol: "backrest_storage2" },
  { table: "fc_seat_cover_parts_third", driverCol: "subpart",         dpCol: "subpart_dp_detail",         passengerCol: "subpart2" },
];

async function main() {
  const pool = getPrimaryPool();
  let totalUpdated = 0;

  for (const { table, driverCol, dpCol, passengerCol } of UPDATES) {
    const sql = `
      UPDATE shipcore.${table}
      SET    "${passengerCol}" = "${driverCol}"
      WHERE  "${dpCol}" = '동일'
        AND  "${driverCol}" IS NOT NULL
        AND  "${driverCol}" <> ''
        AND  ("${passengerCol}" IS NULL OR "${passengerCol}" = '')
    `;
    const result = await pool.query(sql);
    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.log(`✓ ${table}.${passengerCol} — ${count}행 업데이트`);
      totalUpdated += count;
    }
  }

  console.log(`\n완료: 총 ${totalUpdated}행 업데이트`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
