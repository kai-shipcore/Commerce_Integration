// Trace exactly what the spreadsheet computes vs our system
// Spreadsheet prepared date: June 17, 2026 (filename) — data ref likely June 16
// Spreadsheet ETA for 176-CA-SEAT = 46192 = June 18
// Our DB ETA = 2026-06-19 = June 19

function invLife(carryover: number, rate: number, sf: number) {
  return carryover / (rate * sf);
}

const SF_JUN = 1.0;
const RATE = 0.03; // total_avg_curr with 0.03 floor
const CARRYOVER_BASE = 3; // 10 qty - 7 backorder, before est_sales

console.log("=== Spreadsheet scenario (today=June 16, ETA=June 18) ===");
{
  const daysBetween = 2; // June 18 - June 16
  const estSales = daysBetween * RATE * SF_JUN;
  const carryoverC = CARRYOVER_BASE - estSales;
  const inv = invLife(carryoverC, RATE, SF_JUN);
  console.log(`daysBetween=${daysBetween}, estSales=${estSales}, carryoverC=${carryoverC}`);
  console.log(`inv_life = ${carryoverC} / ${RATE} = ${inv} → spreadsheet shows 98 ✓`);
  console.log(`plan_sod = ETA(46192) + inv - 1 = ${46192 + Math.round(inv) - 1} (spreadsheet shows 46289)`);
}

console.log("\n=== Our system scenario (today=June 19, ETA=June 19 from DB) ===");
{
  const daysBetween = 0; // June 19 - June 19
  const estSales = daysBetween * RATE * SF_JUN;
  const carryoverC = CARRYOVER_BASE - estSales;
  const inv = invLife(carryoverC, RATE, SF_JUN);
  console.log(`daysBetween=${daysBetween}, estSales=${estSales}, carryoverC=${carryoverC}`);
  console.log(`inv_life = ${carryoverC} / ${RATE} = ${inv} → our system shows 100`);
}

console.log("\n=== What our system showed on June 16 (today=June 16, ETA=June 19 from DB) ===");
{
  const daysBetween = 3; // June 19 - June 16
  const estSales = daysBetween * RATE * SF_JUN;
  const carryoverC = Math.max(0, CARRYOVER_BASE - estSales);
  const inv = invLife(carryoverC, RATE, SF_JUN);
  console.log(`daysBetween=${daysBetween}, estSales=${estSales}, carryoverC=${carryoverC}`);
  console.log(`inv_life = ${carryoverC} / ${RATE} = ${inv} → our system showed ~97 on June 16`);
}

console.log("\n=== Root cause summary ===");
console.log("Spreadsheet ETA for 176-CA-SEAT: June 18 (Excel serial 46192)");
console.log("Our DB ETA for 176-CA-SEAT:       June 19");
console.log("→ 1-day ETA mismatch = 1 fewer day of estSales before arrival");
console.log("→ Spreadsheet today was June 16 (2 days before June 18 ETA)");
console.log("→ Our system today is June 19 (0 days before June 19 ETA)");
console.log("→ Combined: spreadsheet carryover=2.94, ours=3.0");
console.log("→ 2.94/0.03=98 vs 3.0/0.03=100");
