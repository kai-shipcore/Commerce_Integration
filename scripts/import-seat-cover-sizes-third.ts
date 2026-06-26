// import-seat-cover-sizes-third.ts
// Usage: npx tsx --env-file=.env scripts/import-seat-cover-sizes-third.ts <path/to/file.xlsx> [--dry-run]
//
// Google Sheets > File > Download > XLSX 로 내보낸 파일을 읽어 shipcore.fc_seat_cover_parts_third 에 upsert.
// size 컬럼(8번째)이 unique key. size 없는 행은 건너뜀.

import * as path from "path";
import * as XLSX from "xlsx";
import { getPrimaryPool } from "../src/lib/db/primary-db";

const filePath = process.argv[2];
const dryRun   = process.argv.includes("--dry-run");

if (!filePath) {
  console.error("Usage: npx tsx --env-file=.env scripts/import-seat-cover-sizes-third.ts <file.xlsx> [--dry-run]");
  process.exit(1);
}

// col 0: empty (leading tab)
const COL = {
  inventory:              1,
  fittingPhoto:           2,
  confirmed:              3,
  blueprint:              4,
  manual:                 5,
  ymm:                    6,
  // col 7: empty
  size:                   8,  // unique key
  // col 9: empty
  package:               10,
  headrest:              11,
  headrestDpDetail:      12,
  headrestQty:           13,
  headrest2:             14,
  headrest2DpDetail:     15,
  headrest2Qty:          16,
  topBody:               17,
  topBodyDpDetail:       18,
  topBodyQty:            19,
  topBody2:              20,
  topBody2DpDetail:      21,
  topBody2Qty:           22,
  bottom:                23,
  bottomDpDetail:        24,
  bottomQty:             25,
  bottom2:               26,
  bottom2DpDetail:       27,
  bottom2Qty:            28,
  middleHeadrest:        29,
  middleHeadrestDetail:  30,
  middleHeadrestQty:     31,
  middleTopBody:         32,
  middleTopBodyDetail:   33,
  middleTopBodyQty:      34,
  middleBottom:          35,
  middleBottomDetail:    36,
  middleBottomQty:       37,
  console:               38,
  consoleDpDetail:       39,
  consoleQty:            40,
  backrestStorage:       41,
  backrestStorageDpDetail: 42,
  backrestStorageQty:    43,
  backrestStorage2:      44,
  backrestStorage2DpDetail: 45,
  backrestStorage2Qty:   46,
  armrest:               47,
  armrestDetail:         48,
  armrestQty:            49,
  armrest2:              50,
  armrest2Detail:        51,
  armrest2Qty:           52,
  subpart:               53,
  subpartDpDetail:       54,
  subpartQty:            55,
  subpart2:              56,
  subpart2DpDetail:      57,
  subpart2Qty:           58,
  // note: 헤더에서 위치를 자동 탐지
};

function cell(row: unknown[], idx: number): string | null {
  if (idx < 0 || idx >= row.length) return null;
  const val = String(row[idx] ?? "").trim();
  return val === "" ? null : val;
}

async function main() {
  const workbook = XLSX.readFile(path.resolve(filePath), { raw: false, cellDates: false });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

  if (rows.length < 2) {
    console.error("데이터 행이 없습니다.");
    process.exit(1);
  }

  const headerRow = rows[0] as unknown[];
  const dataRows  = rows.slice(1);

  const noteCol = headerRow.findIndex(h => String(h ?? "").trim().toLowerCase() === "note");
  console.log(noteCol !== -1
    ? `Note 컬럼 위치: ${noteCol}`
    : "Note 컬럼을 찾지 못했습니다. note 필드는 null로 저장됩니다."
  );
  console.log(`총 데이터 행: ${dataRows.length}`);

  if (dryRun) {
    console.log("\nDry run — 처음 5행 미리보기:");
    for (const row of dataRows.slice(0, 5)) {
      const size = cell(row, COL.size);
      if (!size) { console.log("  [건너뜀 — size 없음]"); continue; }
      console.log(`  size=${size}  ymm=${cell(row, COL.ymm)}  package=${cell(row, COL.package)}`);
    }
    return;
  }

  const pool = getPrimaryPool();
  let upserted = 0, skipped = 0;

  for (const row of dataRows) {
    const size = cell(row, COL.size);
    if (!size) { skipped++; continue; }

    await pool.query(
      `INSERT INTO shipcore.fc_seat_cover_parts_third (
        size, inventory, fitting_photo, confirmed, blueprint, manual, ymm, package,
        headrest, headrest_dp_detail, headrest_qty,
        headrest2, headrest2_dp_detail, headrest2_qty,
        top_body, top_body_dp_detail, top_body_qty,
        top_body2, top_body2_dp_detail, top_body2_qty,
        bottom, bottom_dp_detail, bottom_qty,
        bottom2, bottom2_dp_detail, bottom2_qty,
        middle_headrest, middle_headrest_detail, middle_headrest_qty,
        middle_top_body, middle_top_body_detail, middle_top_body_qty,
        middle_bottom, middle_bottom_detail, middle_bottom_qty,
        console, console_dp_detail, console_qty,
        backrest_storage, backrest_storage_dp_detail, backrest_storage_qty,
        backrest_storage2, backrest_storage2_dp_detail, backrest_storage2_qty,
        armrest, armrest_detail, armrest_qty,
        armrest2, armrest2_detail, armrest2_qty,
        subpart, subpart_dp_detail, subpart_qty,
        subpart2, subpart2_dp_detail, subpart2_qty,
        note
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
        $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
        $42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,
        $55,$56,$57
      )
      ON CONFLICT (size) DO UPDATE SET
        inventory                    = EXCLUDED.inventory,
        fitting_photo                = EXCLUDED.fitting_photo,
        confirmed                    = EXCLUDED.confirmed,
        blueprint                    = EXCLUDED.blueprint,
        manual                       = EXCLUDED.manual,
        ymm                          = EXCLUDED.ymm,
        package                      = EXCLUDED.package,
        headrest                     = EXCLUDED.headrest,
        headrest_dp_detail           = EXCLUDED.headrest_dp_detail,
        headrest_qty                 = EXCLUDED.headrest_qty,
        headrest2                    = EXCLUDED.headrest2,
        headrest2_dp_detail          = EXCLUDED.headrest2_dp_detail,
        headrest2_qty                = EXCLUDED.headrest2_qty,
        top_body                     = EXCLUDED.top_body,
        top_body_dp_detail           = EXCLUDED.top_body_dp_detail,
        top_body_qty                 = EXCLUDED.top_body_qty,
        top_body2                    = EXCLUDED.top_body2,
        top_body2_dp_detail          = EXCLUDED.top_body2_dp_detail,
        top_body2_qty                = EXCLUDED.top_body2_qty,
        bottom                       = EXCLUDED.bottom,
        bottom_dp_detail             = EXCLUDED.bottom_dp_detail,
        bottom_qty                   = EXCLUDED.bottom_qty,
        bottom2                      = EXCLUDED.bottom2,
        bottom2_dp_detail            = EXCLUDED.bottom2_dp_detail,
        bottom2_qty                  = EXCLUDED.bottom2_qty,
        middle_headrest              = EXCLUDED.middle_headrest,
        middle_headrest_detail       = EXCLUDED.middle_headrest_detail,
        middle_headrest_qty          = EXCLUDED.middle_headrest_qty,
        middle_top_body              = EXCLUDED.middle_top_body,
        middle_top_body_detail       = EXCLUDED.middle_top_body_detail,
        middle_top_body_qty          = EXCLUDED.middle_top_body_qty,
        middle_bottom                = EXCLUDED.middle_bottom,
        middle_bottom_detail         = EXCLUDED.middle_bottom_detail,
        middle_bottom_qty            = EXCLUDED.middle_bottom_qty,
        console                      = EXCLUDED.console,
        console_dp_detail            = EXCLUDED.console_dp_detail,
        console_qty                  = EXCLUDED.console_qty,
        backrest_storage             = EXCLUDED.backrest_storage,
        backrest_storage_dp_detail   = EXCLUDED.backrest_storage_dp_detail,
        backrest_storage_qty         = EXCLUDED.backrest_storage_qty,
        backrest_storage2            = EXCLUDED.backrest_storage2,
        backrest_storage2_dp_detail  = EXCLUDED.backrest_storage2_dp_detail,
        backrest_storage2_qty        = EXCLUDED.backrest_storage2_qty,
        armrest                      = EXCLUDED.armrest,
        armrest_detail               = EXCLUDED.armrest_detail,
        armrest_qty                  = EXCLUDED.armrest_qty,
        armrest2                     = EXCLUDED.armrest2,
        armrest2_detail              = EXCLUDED.armrest2_detail,
        armrest2_qty                 = EXCLUDED.armrest2_qty,
        subpart                      = EXCLUDED.subpart,
        subpart_dp_detail            = EXCLUDED.subpart_dp_detail,
        subpart_qty                  = EXCLUDED.subpart_qty,
        subpart2                     = EXCLUDED.subpart2,
        subpart2_dp_detail           = EXCLUDED.subpart2_dp_detail,
        subpart2_qty                 = EXCLUDED.subpart2_qty,
        note                         = EXCLUDED.note,
        updated_at                   = NOW()`,
      [
        size,
        cell(row, COL.inventory),
        cell(row, COL.fittingPhoto),
        cell(row, COL.confirmed),
        cell(row, COL.blueprint),
        cell(row, COL.manual),
        cell(row, COL.ymm),
        cell(row, COL.package),
        cell(row, COL.headrest),
        cell(row, COL.headrestDpDetail),
        cell(row, COL.headrestQty),
        cell(row, COL.headrest2),
        cell(row, COL.headrest2DpDetail),
        cell(row, COL.headrest2Qty),
        cell(row, COL.topBody),
        cell(row, COL.topBodyDpDetail),
        cell(row, COL.topBodyQty),
        cell(row, COL.topBody2),
        cell(row, COL.topBody2DpDetail),
        cell(row, COL.topBody2Qty),
        cell(row, COL.bottom),
        cell(row, COL.bottomDpDetail),
        cell(row, COL.bottomQty),
        cell(row, COL.bottom2),
        cell(row, COL.bottom2DpDetail),
        cell(row, COL.bottom2Qty),
        cell(row, COL.middleHeadrest),
        cell(row, COL.middleHeadrestDetail),
        cell(row, COL.middleHeadrestQty),
        cell(row, COL.middleTopBody),
        cell(row, COL.middleTopBodyDetail),
        cell(row, COL.middleTopBodyQty),
        cell(row, COL.middleBottom),
        cell(row, COL.middleBottomDetail),
        cell(row, COL.middleBottomQty),
        cell(row, COL.console),
        cell(row, COL.consoleDpDetail),
        cell(row, COL.consoleQty),
        cell(row, COL.backrestStorage),
        cell(row, COL.backrestStorageDpDetail),
        cell(row, COL.backrestStorageQty),
        cell(row, COL.backrestStorage2),
        cell(row, COL.backrestStorage2DpDetail),
        cell(row, COL.backrestStorage2Qty),
        cell(row, COL.armrest),
        cell(row, COL.armrestDetail),
        cell(row, COL.armrestQty),
        cell(row, COL.armrest2),
        cell(row, COL.armrest2Detail),
        cell(row, COL.armrest2Qty),
        cell(row, COL.subpart),
        cell(row, COL.subpartDpDetail),
        cell(row, COL.subpartQty),
        cell(row, COL.subpart2),
        cell(row, COL.subpart2DpDetail),
        cell(row, COL.subpart2Qty),
        noteCol !== -1 ? cell(row, noteCol) : null,
      ]
    );
    upserted++;
  }

  console.log(`\n완료 — upserted: ${upserted}, skipped: ${skipped} (size 없는 행)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
