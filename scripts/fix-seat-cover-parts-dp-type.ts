/**
 * One-time script: 대칭 행의 D/P 타입을 Driver/Passenger suffix로 보정
 *   - Driver 컬럼이 -D로 끝나면 → "Passenger 기준 대칭"
 *   - Passenger 컬럼이 -P로 끝나면 → "Driver 기준 대칭"
 * Run: npx tsx scripts/fix-seat-cover-parts-dp-type.ts
 */
import "dotenv/config";
import { getPrimaryPool } from "../src/lib/db/primary-db";

const PAIRS: { table: string; driverCol: string; dpCol: string; passengerCol: string }[] = [
  { table: "fc_seat_cover_parts_front", driverCol: "headrest",         dpCol: "headrest_dp_detail",         passengerCol: "headrest2" },
  { table: "fc_seat_cover_parts_front", driverCol: "top_body",         dpCol: "top_body_dp_detail",         passengerCol: "top_body2" },
  { table: "fc_seat_cover_parts_front", driverCol: "bottom",           dpCol: "bottom_dp_detail",           passengerCol: "bottom2" },
  { table: "fc_seat_cover_parts_front", driverCol: "armrest",          dpCol: "armrest_detail",             passengerCol: "armrest2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "headrest",         dpCol: "headrest_dp_detail",         passengerCol: "headrest2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "top_body",         dpCol: "top_body_dp_detail",         passengerCol: "top_body2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "bottom",           dpCol: "bottom_dp_detail",           passengerCol: "bottom2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "armrest",          dpCol: "armrest_detail",             passengerCol: "armrest2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "backrest_storage", dpCol: "backrest_storage_dp_detail", passengerCol: "backrest_storage2" },
  { table: "fc_seat_cover_parts_rear",  driverCol: "subpart",          dpCol: "subpart_dp_detail",          passengerCol: "subpart2" },
  { table: "fc_seat_cover_parts_third", driverCol: "headrest",         dpCol: "headrest_dp_detail",         passengerCol: "headrest2" },
  { table: "fc_seat_cover_parts_third", driverCol: "top_body",         dpCol: "top_body_dp_detail",         passengerCol: "top_body2" },
  { table: "fc_seat_cover_parts_third", driverCol: "bottom",           dpCol: "bottom_dp_detail",           passengerCol: "bottom2" },
  { table: "fc_seat_cover_parts_third", driverCol: "armrest",          dpCol: "armrest_detail",             passengerCol: "armrest2" },
  { table: "fc_seat_cover_parts_third", driverCol: "backrest_storage", dpCol: "backrest_storage_dp_detail", passengerCol: "backrest_storage2" },
  { table: "fc_seat_cover_parts_third", driverCol: "subpart",          dpCol: "subpart_dp_detail",          passengerCol: "subpart2" },
];

async function main() {
  const pool = getPrimaryPool();
  let total = 0;

  for (const { table, driverCol, dpCol, passengerCol } of PAIRS) {
    // Driver가 -D로 끝나면 → "Passenger 기준 대칭"
    const r1 = await pool.query(`
      UPDATE shipcore.${table}
      SET    "${dpCol}" = 'Passenger 기준 대칭'
      WHERE  "${driverCol}" ~* '-D$'
        AND  "${dpCol}" IS DISTINCT FROM 'Passenger 기준 대칭'
        AND  "${dpCol}" IS DISTINCT FROM '동일'
    `);
    if ((r1.rowCount ?? 0) > 0) {
      console.log(`✓ ${table}.${dpCol} → Passenger 기준 대칭: ${r1.rowCount}행`);
      total += r1.rowCount ?? 0;
    }

    // Passenger가 -P로 끝나면 → "Driver 기준 대칭"
    const r2 = await pool.query(`
      UPDATE shipcore.${table}
      SET    "${dpCol}" = 'Driver 기준 대칭'
      WHERE  "${passengerCol}" ~* '-P$'
        AND  "${dpCol}" IS DISTINCT FROM 'Driver 기준 대칭'
        AND  "${dpCol}" IS DISTINCT FROM '동일'
        AND  "${dpCol}" IS DISTINCT FROM 'Passenger 기준 대칭'
    `);
    if ((r2.rowCount ?? 0) > 0) {
      console.log(`✓ ${table}.${dpCol} → Driver 기준 대칭: ${r2.rowCount}행`);
      total += r2.rowCount ?? 0;
    }
  }

  console.log(`\n완료: 총 ${total}행 업데이트`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
