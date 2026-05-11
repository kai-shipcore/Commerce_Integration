/**
 * Code Guide:
 * GET /api/velocity/sales-export — Generates a multi-section Sales velocity CSV
 * matching the manual spreadsheet format.
 * Sections: Link Sales | Custom Sales (L) | TTM Link | TTM Custom (L) |
 *           LINK Pre Order | NEW Pre Order | TTM Pre
 * Each section has independent row ordering. Sections are laid out side-by-side
 * in wide CSV format, rows padded with blanks where a section has fewer rows.
 */

import { NextResponse } from "next/server";
import {
  getLinkSalesVelocity,
  getCustomSalesForSkus,
  getLinkTtmVelocity,
  getCustomTtmForSkus,
  getLinkPreOrderVelocity,
  getCustomPreOrderForSkus,
  getTtmPreOrderForSkus,
} from "@/lib/db/supabase-lookup";

function esc(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function row(...cells: (string | number | null | undefined)[]): string {
  return cells.map(esc).join(",");
}

export async function GET() {
  try {
    // ── Fetch all sections in parallel ─────────────────────────────────────
    const [linkResult, ttmLinkResult, preOrderResult] = await Promise.all([
      getLinkSalesVelocity({ limit: 10000, offset: 0, sortCol: "master_sku", sortOrder: "ASC" }),
      getLinkTtmVelocity({ limit: 10000, offset: 0, sortCol: "master_sku", sortOrder: "ASC" }),
      getLinkPreOrderVelocity({ limit: 10000, offset: 0, sortCol: "master_sku", sortOrder: "ASC" }),
    ]);

    const linkSkus = linkResult.rows.map((r) => r.master_sku);
    const ttmSkus = ttmLinkResult.rows.map((r) => r.master_sku);
    const preSkus = preOrderResult.rows.map((r) => r.master_sku);

    const [customMap, ttmCustomMap, customPoMap, ttmPoMap] = await Promise.all([
      getCustomSalesForSkus(linkSkus),
      getCustomTtmForSkus(ttmSkus),
      getCustomPreOrderForSkus(preSkus),
      getTtmPreOrderForSkus(preSkus),
    ]);

    // ── Build section row arrays ────────────────────────────────────────────
    type MainRow = [string, number, number, number, number, number]; // sku,90d,60d,30d,15d,7d
    type PreRow = [string, number]; // sku,total

    const linkRows: MainRow[] = linkResult.rows.map((r) => [
      r.master_sku, r.qty_90d, r.qty_60d, r.qty_30d, r.qty_15d, r.qty_7d,
    ]);
    const customRows: MainRow[] = linkResult.rows.map((r) => {
      const c = customMap.get(r.master_sku);
      return [
        c?.custom_master_sku ?? r.master_sku,
        c?.qty_90d ?? 0,
        c?.qty_60d ?? 0,
        c?.qty_30d ?? 0,
        c?.qty_15d ?? 0,
        c?.qty_7d ?? 0,
      ];
    });

    const ttmLinkRows: MainRow[] = ttmLinkResult.rows.map((r) => [
      r.master_sku, r.qty_90d, r.qty_60d, r.qty_30d, r.qty_15d, r.qty_7d,
    ]);
    const ttmCustomRows: MainRow[] = ttmLinkResult.rows.map((r) => {
      const c = ttmCustomMap.get(r.master_sku);
      return [
        c?.custom_master_sku ?? r.master_sku,
        c?.qty_90d ?? 0,
        c?.qty_60d ?? 0,
        c?.qty_30d ?? 0,
        c?.qty_15d ?? 0,
        c?.qty_7d ?? 0,
      ];
    });

    const linkPoRows: PreRow[] = preOrderResult.rows.map((r) => [r.master_sku, r.qty_90d]);
    const newPoRows: PreRow[] = preOrderResult.rows.map((r) => {
      const c = customPoMap.get(r.master_sku);
      return [c?.custom_master_sku ?? r.master_sku, c?.qty_90d ?? 0];
    });
    const ttmPoRows: PreRow[] = preOrderResult.rows.map((r) => {
      const t = ttmPoMap.get(r.master_sku);
      return [r.master_sku, t?.count ?? 0];
    });

    // ── Totals ──────────────────────────────────────────────────────────────
    const lt = linkResult.totals;
    const tlt = ttmLinkResult.totals;
    const pot = preOrderResult.totals;

    const customTotal90d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_90d ?? 0), 0);
    const customTotal60d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_60d ?? 0), 0);
    const customTotal30d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_30d ?? 0), 0);
    const customTotal15d = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_15d ?? 0), 0);
    const customTotal7d  = linkResult.rows.reduce((s, r) => s + (customMap.get(r.master_sku)?.qty_7d  ?? 0), 0);

    const ttmCustomTotal90d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_90d ?? 0), 0);
    const ttmCustomTotal60d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_60d ?? 0), 0);
    const ttmCustomTotal30d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_30d ?? 0), 0);
    const ttmCustomTotal15d = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_15d ?? 0), 0);
    const ttmCustomTotal7d  = ttmLinkResult.rows.reduce((s, r) => s + (ttmCustomMap.get(r.master_sku)?.qty_7d  ?? 0), 0);

    const newPoTotal = preOrderResult.rows.reduce((s, r) => s + (customPoMap.get(r.master_sku)?.qty_90d ?? 0), 0);
    const ttmPoTotal = preOrderResult.rows.reduce((s, r) => s + (ttmPoMap.get(r.master_sku)?.count ?? 0), 0);

    // ── CSV generation ──────────────────────────────────────────────────────
    const BLANK6 = ["", "", "", "", "", ""] as const;
    const BLANK2 = ["", ""] as const;

    const maxRows = Math.max(linkRows.length, ttmLinkRows.length, linkPoRows.length);
    const blank6 = () => Array(6).fill("");
    const blank2 = () => Array(2).fill("");

    const csvLines: string[] = [];

    // Row 1: section headers
    csvLines.push(
      row(
        "Link Sales", ...BLANK6.slice(1),
        "Custom Sales (L)", ...BLANK6.slice(1),
        "TTM Link", ...BLANK6.slice(1),
        "TTM Custom (L)", ...BLANK6.slice(1),
        "LINK Pre Order", ...BLANK2.slice(1),
        "NEW Pre Order", ...BLANK2.slice(1),
        "TTM Pre", ...BLANK2.slice(1),
      )
    );

    // Row 2: sub-column headers
    csvLines.push(
      row(
        "Total", "90 D", "60 D", "30 D", "15 D", "7 D",
        "Total", "90 D", "60 D", "30 D", "15 D", "7 D",
        "Total", "90 D", "60 D", "30 D", "15 D", "7 D",
        "Total", "90 D", "60 D", "30 D", "15 D", "7 D",
        "", "",
        "", "",
        "", "",
      )
    );

    // Row 3: totals row
    csvLines.push(
      row(
        "Master SKU",
        lt?.total_90d ?? 0, lt?.total_60d ?? 0, lt?.total_30d ?? 0, lt?.total_15d ?? 0, lt?.total_7d ?? 0,
        "Master SKU",
        customTotal90d, customTotal60d, customTotal30d, customTotal15d, customTotal7d,
        "Master SKU",
        tlt?.total_90d ?? 0, tlt?.total_60d ?? 0, tlt?.total_30d ?? 0, tlt?.total_15d ?? 0, tlt?.total_7d ?? 0,
        "Master SKU",
        ttmCustomTotal90d, ttmCustomTotal60d, ttmCustomTotal30d, ttmCustomTotal15d, ttmCustomTotal7d,
        "Master SKU", pot?.total_90d ?? 0,
        "Master SKU", newPoTotal,
        "Master SKU", ttmPoTotal,
      )
    );

    // Data rows
    for (let i = 0; i < maxRows; i++) {
      const lr = linkRows[i];
      const cr = customRows[i];
      const tlr = ttmLinkRows[i];
      const tcr = ttmCustomRows[i];
      const lpr = linkPoRows[i];
      const npr = newPoRows[i];
      const tpr = ttmPoRows[i];

      csvLines.push(
        row(
          ...(lr ?? blank6()),
          ...(cr ?? blank6()),
          ...(tlr ?? blank6()),
          ...(tcr ?? blank6()),
          ...(lpr ?? blank2()),
          ...(npr ?? blank2()),
          ...(tpr ?? blank2()),
        )
      );
    }

    const csv = "﻿" + csvLines.join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-velocity-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error("[sales-export] error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
