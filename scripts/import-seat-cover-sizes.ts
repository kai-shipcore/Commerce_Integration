// import-seat-cover-sizes.ts
// Usage: npx tsx --env-file=.env.local scripts/import-seat-cover-sizes.ts <path/to/file.csv> [--dry-run]
//
// Google Sheets > File > Download > CSV 로 내보낸 파일을 읽어 shipcore.seat_cover_sizes 에 upsert.
// size 컬럼(7번째)이 unique key. size 없는 행은 건너뜀.

import * as path from "path";
import * as XLSX from "xlsx";
import { getPrimaryPool } from "../src/lib/db/primary-db";

const filePath = process.argv[2];
const dryRun   = process.argv.includes("--dry-run");

if (!filePath) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/import-seat-cover-sizes.ts <file.csv> [--dry-run]");
  process.exit(1);
}

// 시트 컬럼 위치 (0-based) — 구글 시트 헤더 순서와 동일
const COL = {
  inventory:           0,
  fittingPhoto:        1,
  confirmed:           2,
  blueprint:           3,
  manual:              4,
  ymm:                 5,
  fittingDpDetail:     6,
  size:                7,  // unique key
  package:             8,
  headrest:            9,
  headrestDpDetail:   10,
  headrestQty:        11,
  headrest2:          12,
  headrest2DpDetail:  13,
  headrest2Qty:       14,
  topBody:            15,
  topBodyDpDetail:    16,
  topBodyQty:         17,
  topBody2:           18,
  topBody2DpDetail:   19,
  topBody2Qty:        20,
  bottom:             21,
  bottomDpDetail:     22,
  bottomQty:          23,
  bottom2:            24,
  bottom2DpDetail:    25,
  bottom2Qty:         26,
  middleHeadrest:     27,
  middleHeadrestDetail: 28,
  middleHeadrestQty:  29,
  middleTopBody:      30,
  middleTopBodyDetail: 31,
  middleTopBodyQty:   32,
  middleBottom:       33,
  middleBottomDetail: 34,
  middleBottomQty:    35,
  armrest:            36,
  armrestDetail:      37,
  armrestQty:         38,
  armrest2:           39,
  armrest2Detail:     40,
  armrest2Qty:        41,
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

  // Note 컬럼 위치를 헤더에서 자동 탐지
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
      `INSERT INTO shipcore.fc_seat_cover_parts_front (
        size, inventory, fitting_photo, confirmed, blueprint, manual, ymm,
        fitting_dp_detail, package,
        headrest, headrest_dp_detail, headrest_qty,
        headrest2, headrest2_dp_detail, headrest2_qty,
        top_body, top_body_dp_detail, top_body_qty,
        top_body2, top_body2_dp_detail, top_body2_qty,
        bottom, bottom_dp_detail, bottom_qty,
        bottom2, bottom2_dp_detail, bottom2_qty,
        middle_headrest, middle_headrest_detail, middle_headrest_qty,
        middle_top_body, middle_top_body_detail, middle_top_body_qty,
        middle_bottom, middle_bottom_detail, middle_bottom_qty,
        armrest, armrest_detail, armrest_qty,
        armrest2, armrest2_detail, armrest2_qty,
        note
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
        $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43
      )
      ON CONFLICT (size) DO UPDATE SET
        inventory              = EXCLUDED.inventory,
        fitting_photo          = EXCLUDED.fitting_photo,
        confirmed              = EXCLUDED.confirmed,
        blueprint              = EXCLUDED.blueprint,
        manual                 = EXCLUDED.manual,
        ymm                    = EXCLUDED.ymm,
        fitting_dp_detail      = EXCLUDED.fitting_dp_detail,
        package                = EXCLUDED.package,
        headrest               = EXCLUDED.headrest,
        headrest_dp_detail     = EXCLUDED.headrest_dp_detail,
        headrest_qty           = EXCLUDED.headrest_qty,
        headrest2              = EXCLUDED.headrest2,
        headrest2_dp_detail    = EXCLUDED.headrest2_dp_detail,
        headrest2_qty          = EXCLUDED.headrest2_qty,
        top_body               = EXCLUDED.top_body,
        top_body_dp_detail     = EXCLUDED.top_body_dp_detail,
        top_body_qty           = EXCLUDED.top_body_qty,
        top_body2              = EXCLUDED.top_body2,
        top_body2_dp_detail    = EXCLUDED.top_body2_dp_detail,
        top_body2_qty          = EXCLUDED.top_body2_qty,
        bottom                 = EXCLUDED.bottom,
        bottom_dp_detail       = EXCLUDED.bottom_dp_detail,
        bottom_qty             = EXCLUDED.bottom_qty,
        bottom2                = EXCLUDED.bottom2,
        bottom2_dp_detail      = EXCLUDED.bottom2_dp_detail,
        bottom2_qty            = EXCLUDED.bottom2_qty,
        middle_headrest        = EXCLUDED.middle_headrest,
        middle_headrest_detail = EXCLUDED.middle_headrest_detail,
        middle_headrest_qty    = EXCLUDED.middle_headrest_qty,
        middle_top_body        = EXCLUDED.middle_top_body,
        middle_top_body_detail = EXCLUDED.middle_top_body_detail,
        middle_top_body_qty    = EXCLUDED.middle_top_body_qty,
        middle_bottom          = EXCLUDED.middle_bottom,
        middle_bottom_detail   = EXCLUDED.middle_bottom_detail,
        middle_bottom_qty      = EXCLUDED.middle_bottom_qty,
        armrest                = EXCLUDED.armrest,
        armrest_detail         = EXCLUDED.armrest_detail,
        armrest_qty            = EXCLUDED.armrest_qty,
        armrest2               = EXCLUDED.armrest2,
        armrest2_detail        = EXCLUDED.armrest2_detail,
        armrest2_qty           = EXCLUDED.armrest2_qty,
        note                   = EXCLUDED.note,
        updated_at             = NOW()`,
      [
        size,
        cell(row, COL.inventory),
        cell(row, COL.fittingPhoto),
        cell(row, COL.confirmed),
        cell(row, COL.blueprint),
        cell(row, COL.manual),
        cell(row, COL.ymm),
        cell(row, COL.fittingDpDetail),
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
        cell(row, COL.armrest),
        cell(row, COL.armrestDetail),
        cell(row, COL.armrestQty),
        cell(row, COL.armrest2),
        cell(row, COL.armrest2Detail),
        cell(row, COL.armrest2Qty),
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
