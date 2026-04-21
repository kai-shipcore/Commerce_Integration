/**
 * Code Guide:
 * Utility script for local development or debugging.
 * These scripts are not part of the production runtime; they help inspect data or validate infrastructure setup.
 */

// Quick script to check sales dates for a SKU
// Run with: npx tsx scripts/check-sku-sales.ts

import { prisma } from "../src/lib/db/prisma";

async function main() {
  const skuId = "cmjizx48p04g15cugot27b4k4";

  // Get sales records
  const sales = await prisma.salesRecord.findMany({
    where: { skuId },
    select: {
      saleDate: true,
      quantity: true,
      orderId: true,
    },
    orderBy: { saleDate: "asc" },
  });

  console.log(`\nFound ${sales.length} sales records for SKU:\n`);

  // Group by date
  const byDate = new Map<string, { count: number; quantity: number }>();
  for (const sale of sales) {
    const date = sale.saleDate.toISOString().split("T")[0];
    const existing = byDate.get(date) || { count: 0, quantity: 0 };
    byDate.set(date, {
      count: existing.count + 1,
      quantity: existing.quantity + sale.quantity,
    });
  }

  console.log("Sales by date:");
  console.log("─".repeat(40));
  for (const [date, data] of byDate) {
    console.log(`${date}: ${data.count} orders, ${data.quantity} units`);
  }
  console.log("─".repeat(40));
  console.log(`Total: ${byDate.size} unique days\n`);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
