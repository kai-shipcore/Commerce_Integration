"use client";

import { useCallback, useState } from "react";
import { DemandPlanningGrid } from "./demand-planning-grid";
import { SkuMasterTable } from "./sku-master-table";
import { StatusBar } from "./status-bar";
import { TODAY } from "./columns";
import { demandPlanningData } from "@/features/planning/demand-planning-mock-data";
import type { DemandRow, ProductFilter, UrgencyFilter } from "@/types/demand-planning";

type PageTab = "grid" | "sm";

export function DemandPlanningDashboard() {
  const [tab, setTab]                   = useState<PageTab>("grid");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter | null>(null);
  const [search, setSearch]             = useState("");
  const [filteredRows, setFilteredRows] = useState<DemandRow[]>(demandPlanningData.rows);

  const handleUrgencyFilter = useCallback((f: UrgencyFilter) => {
    setUrgencyFilter((prev) => (prev === f ? null : f));
  }, []);

  const handleProductFilter = useCallback((f: ProductFilter) => {
    setProductFilter(f);
    setUrgencyFilter(null);
  }, []);

  const handleExportCSV = useCallback(() => {
    const header = [
      "#","SKU","West","East","Total","Back","Status",
      "W30D","E30D","Total30D","TAvgCurr","Inbound","ContainersList","NextETA","SOD",
    ];
    const csvRows = [header, ...filteredRows.map((r, i) => [
      i + 1, r.sku, r.west_stock, r.east_stock, r.total_stock,
      r.back, r.sales_status, r.west_30d, r.east_30d, r.total_30d,
      r.total_avg_curr, r.total_inbound_qty, r.containers_list,
      r.next_eta ?? "", r.sod ?? "",
    ])];
    const csv = csvRows
      .map((row) =>
        row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `planning_${TODAY}.csv`;
    a.click();
  }, [filteredRows]);

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Malgun Gothic','Apple SD Gothic Neo',sans-serif",
        fontSize: 11,
        background: "#F0EEE9",
        color: "#1A1917",
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          background: "#1E1C19",
          height: 34,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          borderBottom: "2px solid #3a3835",
        }}
      >
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.15em",
            padding: "0 14px",
            color: "#E5C03A",
            borderRight: "1px solid #3a3835",
            height: "100%",
            display: "flex",
            alignItems: "center",
            minWidth: 108,
          }}
        >
          ▦ FBM PLANNER
        </div>
        {(["grid", "sm"] as PageTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "0 13px",
              fontSize: 10,
              fontWeight: 600,
              color: tab === t ? "#fff" : "rgba(255,255,255,.4)",
              cursor: "pointer",
              borderRight: "1px solid #3a3835",
              height: "100%",
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: tab === t ? "rgba(255,255,255,.1)" : "transparent",
              borderBottom: tab === t ? "2px solid #E5C03A" : "none",
              border: "none",
            }}
          >
            {t === "grid" ? "📊 Planning Grid" : "⚙ SKU Master"}
          </button>
        ))}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingRight: 12,
            fontSize: 10,
            color: "rgba(255,255,255,.35)",
            fontFamily: "monospace",
          }}
        >
          {TODAY} &nbsp;|&nbsp; L-Min 5.13.2026
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #D8D6CE",
          height: 34,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "0 12px",
          overflowX: "auto",
        }}
      >
        {/* Product filter chips */}
        {(["all", "orig", "cust"] as ProductFilter[]).map((f) => {
          const label = f === "all" ? "전체" : f === "orig" ? "Original" : "Custom";
          const active = productFilter === f;
          return (
            <button
              key={f}
              onClick={() => handleProductFilter(f)}
              style={{
                fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                border: "1px solid",
                borderColor: active ? "#aac0f0" : "#C2BFB5",
                cursor: "pointer",
                background: active ? "#E5EEFF" : "transparent",
                color: active ? "#1A4FC0" : "#5A5750",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {label}
            </button>
          );
        })}
        <div style={{ width: 1, height: 18, background: "#C2BFB5", margin: "0 2px", flexShrink: 0 }} />
        {/* Urgency filter chips */}
        {(["crit", "warn", "bo"] as UrgencyFilter[]).map((f) => {
          const active = urgencyFilter === f;
          const label  = f === "crit" ? "🔴 긴급" : f === "warn" ? "⚠ 주의" : "📦 BackOrder";
          const activeStyle =
            f === "crit"
              ? { background: "#FFEDED", color: "#C42020", borderColor: "#f0aaaa" }
              : f === "warn"
              ? { background: "#FEF3D8", color: "#9A5200", borderColor: "#f0d0aa" }
              : { background: "#E5EEFF", color: "#1A4FC0", borderColor: "#aac0f0" };
          return (
            <button
              key={f}
              onClick={() => handleUrgencyFilter(f)}
              style={{
                fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                border: "1px solid",
                borderColor: active ? activeStyle.borderColor : "#C2BFB5",
                cursor: "pointer",
                background: active ? activeStyle.background : "transparent",
                color: active ? activeStyle.color : "#5A5750",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {label}
            </button>
          );
        })}
        <div style={{ width: 1, height: 18, background: "#C2BFB5", margin: "0 2px", flexShrink: 0 }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 SKU / 컨테이너..."
          style={{
            padding: "3px 8px", border: "1px solid #C2BFB5", borderRadius: 3,
            fontSize: 10, fontFamily: "monospace", outline: "none",
            width: 160, background: "#F5F4EF", color: "#1A1917", flexShrink: 0,
          }}
        />
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          <button
            onClick={handleExportCSV}
            style={{
              fontSize: 10, fontWeight: 600, padding: "3px 9px", borderRadius: 3,
              border: "1px solid #C2BFB5", background: "#fff", cursor: "pointer",
              color: "#1A1917", whiteSpace: "nowrap",
            }}
          >
            📥 CSV
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar rows={filteredRows} />

      {/* Pages */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {tab === "grid" ? (
          <DemandPlanningGrid
            data={demandPlanningData}
            productFilter={productFilter}
            urgencyFilter={urgencyFilter}
            search={search}
            onSearchChange={setSearch}
            onProductFilterChange={handleProductFilter}
            onUrgencyFilterChange={setUrgencyFilter}
            onFilteredRowsChange={setFilteredRows}
          />
        ) : (
          <SkuMasterTable rows={demandPlanningData.rows} />
        )}
      </div>
    </div>
  );
}
