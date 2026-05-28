"use client";

import { useCallback, useState } from "react";
import { Search } from "lucide-react";
import { DemandPlanningGrid } from "./demand-planning-grid";
import { StatusBar } from "./status-bar";
import { TODAY } from "./columns";
import { useDemandPlanningData } from "@/features/planning/demand-planning-data";
import type { VelocityMode } from "@/features/planning/demand-planning-data";
import type { CategoryFilter, DemandRow, ProductFilter, UrgencyFilter } from "@/types/demand-planning";

export function DemandPlanningDashboard() {
  const [velocityMode, setVelocityMode] = useState<VelocityMode>("link");
  const {
    data,
    loading,
    containerDetailsLoading,
    containerDetailsLoaded,
    error: loadError,
    reload,
    loadContainerDetails,
  } = useDemandPlanningData(velocityMode);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("sc");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter | null>(null);
  const [search, setSearch] = useState("");
  const [filteredRows, setFilteredRows] = useState<DemandRow[]>([]);

  const handleUrgencyFilter = useCallback((filter: UrgencyFilter) => {
    setUrgencyFilter((current) => (current === filter ? null : filter));
  }, []);

  const handleProductFilter = useCallback((filter: ProductFilter) => {
    setProductFilter(filter);
    setUrgencyFilter(null);
  }, []);

  const handleExportCSV = useCallback(() => {
    const header = [
      "#",
      "SKU",
      "West",
      "East",
      "Total",
      "Back",
      "Status",
      "W30D",
      "E30D",
      "Total30D",
      "TAvgCurr",
      "Inbound",
      "ContainersList",
      "NextETA",
      "SOD",
    ];
    const csvRows = [
      header,
      ...filteredRows.map((row, index) => [
        index + 1,
        row.sku,
        row.west_stock,
        row.east_stock,
        row.total_stock,
        row.back,
        row.sales_status,
        row.west_30d,
        row.east_30d,
        row.total_30d,
        row.total_avg_curr,
        row.total_inbound_qty,
        row.containers_list,
        row.next_eta ?? "",
        row.sod ?? "",
      ]),
    ];
    const csv = csvRows
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `planning_${TODAY}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [filteredRows]);

  const hasData = data.rows.length > 0;

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
        fontFamily: "Inter, ui-sans-serif, system-ui, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
        fontSize: 12,
        background: "#F0EEE9",
        color: "#1A1917",
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #D8D6CE",
          height: 42,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "0 12px",
          overflowX: "auto",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <span style={{ color: "#5A5750", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
            Product
          </span>
          <select
            aria-label="Product category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
            style={{
              minWidth: 112,
              height: 26,
              padding: "2px 7px",
              borderRadius: 4,
              border: "1px solid #C2BFB5",
              background: "#E3F5EC",
              color: "#0A6A45",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <option value="sc">Seat Cover</option>
            <option value="cc">Car Cover</option>
            <option value="fm">Floor Mat</option>
          </select>
        </label>

        <div style={{ width: 1, height: 18, background: "#C2BFB5", margin: "0 2px", flexShrink: 0 }} />

        {(["all", "orig", "cust"] as ProductFilter[]).map((filter) => {
          const label = filter === "all" ? "All" : filter === "orig" ? "Original" : "Custom";
          const active = productFilter === filter;
          return (
            <button
              key={filter}
              type="button"
              onClick={() => handleProductFilter(filter)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: 10,
                border: "1px solid",
                borderColor: active ? "#aac0f0" : "#C2BFB5",
                cursor: "pointer",
                background: active ? "#E5EEFF" : "transparent",
                color: active ? "#1A4FC0" : "#5A5750",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {label}
            </button>
          );
        })}

        <div style={{ width: 1, height: 18, background: "#C2BFB5", margin: "0 2px", flexShrink: 0 }} />

        {(["crit", "warn", "bo"] as UrgencyFilter[]).map((filter) => {
          const active = urgencyFilter === filter;
          const label = filter === "crit" ? "Critical" : filter === "warn" ? "Warning" : "BackOrder";
          const activeStyle =
            filter === "crit"
              ? { background: "#FFEDED", color: "#C42020", borderColor: "#f0aaaa" }
              : filter === "warn"
                ? { background: "#FEF3D8", color: "#9A5200", borderColor: "#f0d0aa" }
                : { background: "#E5EEFF", color: "#1A4FC0", borderColor: "#aac0f0" };
          return (
            <button
              key={filter}
              type="button"
              onClick={() => handleUrgencyFilter(filter)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: 10,
                border: "1px solid",
                borderColor: active ? activeStyle.borderColor : "#C2BFB5",
                cursor: "pointer",
                background: active ? activeStyle.background : "transparent",
                color: active ? activeStyle.color : "#5A5750",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {label}
            </button>
          );
        })}

        <div style={{ width: 1, height: 18, background: "#C2BFB5", margin: "0 2px", flexShrink: 0 }} />

        <div style={{ position: "relative", width: 210, flexShrink: 0 }}>
          <Search
            aria-hidden="true"
            size={14}
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#7A766F",
              pointerEvents: "none",
            }}
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search SKU / container..."
            style={{
              padding: "5px 30px 5px 30px",
              border: "1px solid #C2BFB5",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              outline: "none",
              width: "100%",
              background: "#F5F4EF",
              color: "#1A1917",
              boxSizing: "border-box",
            }}
          />
          {search ? (
            <button
              type="button"
              aria-label="Reset search"
              title="Reset search"
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: 5,
                top: "50%",
                transform: "translateY(-50%)",
                width: 20,
                height: 20,
                border: "1px solid #C2BFB5",
                borderRadius: 10,
                background: "#fff",
                color: "#5A5750",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                lineHeight: "18px",
                padding: 0,
              }}
            >
              X
            </button>
          ) : null}
        </div>

        <StatusBar rows={filteredRows} inline />

        <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          {loadError && (
            <span style={{ color: "#C42020", fontSize: 11 }}>Error: {loadError}</span>
          )}
          <span suppressHydrationWarning style={{ color: "#7A766F", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 11 }}>
            {TODAY} | L-Min 5.13.2026
          </span>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!hasData}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid #C2BFB5",
              background: "#fff",
              cursor: hasData ? "pointer" : "default",
              color: hasData ? "#1A1917" : "#A8A49E",
              whiteSpace: "nowrap",
            }}
          >
            CSV
          </button>
          <div style={{ display: "flex", borderRadius: 4, border: "1px solid #C2BFB5", overflow: "hidden" }}>
            {(["link", "custom"] as VelocityMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setVelocityMode(m)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "5px 10px",
                  border: "none",
                  borderRight: m === "link" ? "1px solid #C2BFB5" : undefined,
                  background: velocityMode === m ? "#1A1917" : "#fff",
                  color: velocityMode === m ? "#fff" : "#1A1917",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {m === "link" ? "Link" : "Custom"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "5px 12px",
              borderRadius: 4,
              border: "1px solid #C2BFB5",
              background: loading ? "#F5F4EF" : "#1A1917",
              cursor: loading ? "default" : "pointer",
              color: loading ? "#7A766F" : "#fff",
              whiteSpace: "nowrap",
            }}
          >
            {loading ? "Loading…" : "Sync"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {!hasData && !loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#F0EEE9", zIndex: 5 }}>
            <span style={{ fontSize: 13, color: "#7A766F" }}>Press Sync to load planning data</span>
            <button
              type="button"
              onClick={reload}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "7px 20px",
                borderRadius: 4,
                border: "1px solid #C2BFB5",
                background: "#1A1917",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              Sync
            </button>
          </div>
        )}
        {!hasData && loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#F0EEE9", zIndex: 5, fontSize: 13, color: "#7A766F" }}>
            Loading…
          </div>
        )}
        <DemandPlanningGrid
          data={data}
          categoryFilter={categoryFilter}
          productFilter={productFilter}
          urgencyFilter={urgencyFilter}
          search={search}
          onSearchChange={setSearch}
          onProductFilterChange={handleProductFilter}
          onUrgencyFilterChange={setUrgencyFilter}
          onFilteredRowsChange={setFilteredRows}
          onLoadContainerDetails={loadContainerDetails}
          containerDetailsLoading={containerDetailsLoading}
          containerDetailsLoaded={containerDetailsLoaded}
        />
      </div>
    </div>
  );
}
