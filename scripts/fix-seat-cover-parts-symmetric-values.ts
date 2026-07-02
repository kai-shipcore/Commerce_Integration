/**
 * One-time script: 대칭 행의 Driver/Passenger 값에 -D/-P suffix 보정
 *   - D/P = "Driver 기준 대칭" OR "Passenger 기준 대칭" 인 모든 행
 *   - base = COALESCE(driver, passenger)에서 기존 -D/-P 제거
 *   - Driver = base+"-D", Passenger = base+"-P"
 * Run: npx tsx scripts/fix-seat-cover-parts-symmetric-values.ts
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
    const result = await pool.query(`
      UPDATE shipcore.${table}
      SET
        "${driverCol}"    = regexp_replace(
                              COALESCE(NULLIF("${driverCol}",''), NULLIF("${passengerCol}",'')),
                              '-(D|P)$', '', 'i') || '-D',
        "${passengerCol}" = regexp_replace(
                              COALESCE(NULLIF("${driverCol}",''), NULLIF("${passengerCol}",'')),
                              '-(D|P)$', '', 'i') || '-P'
      WHERE "${dpCol}" IN ('Driver 기준 대칭', 'Passenger 기준 대칭')
        AND COALESCE(NULLIF("${driverCol}",''), NULLIF("${passengerCol}",'')) IS NOT NULL
    `);
    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.log(`✓ ${table}.${driverCol}/${passengerCol}: ${count}행`);
      total += count;
    }
  }

  console.log(`\n완료: 총 ${total}행 업데이트`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
