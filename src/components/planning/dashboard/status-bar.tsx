"use client";

import { useState, type CSSProperties } from "react";
import { RotateCcw, Settings, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { apiPath } from "@/lib/api-path";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_SEASONAL_FACTORS,
  SEASONAL_FACTOR_FIELDS,
  type SeasonalFactorKey,
  type SeasonalFactors,
} from "@/lib/planning/seasonal-factors";
import {
  DEFAULT_SALES_WINDOW_WEIGHTS,
  SALES_WINDOW_WEIGHT_FIELDS,
  type SalesWindowWeightKey,
  type SalesWindowWeights,
} from "@/lib/planning/sales-window-weights";
import {
  DEFAULT_OOS_LOST_DEMAND_WEIGHTS,
  OOS_LOST_DEMAND_CATEGORIES,
  OOS_LOST_DEMAND_MARKETPLACES,
  type CategoryKey,
  type Marketplace,
  type OosLostDemandWeights,
} from "@/lib/planning/oos-lost-demand-weights";
import type { GradientTier } from "@/lib/planning/gradient-config";
import { urgStatus } from "./columns";
import type { DemandRow } from "@/types/demand-planning";

interface StatusBarProps {
  rows: DemandRow[];
  inline?: boolean;
  seasonalFactors: SeasonalFactors;
  onSeasonalFactorsChange: (next: SeasonalFactors) => void;
  salesWindowWeights: SalesWindowWeights;
  onSalesWindowWeightsChange: (next: SalesWindowWeights) => void;
  oosLostDemandWeights?: OosLostDemandWeights;
  onOosLostDemandWeightsChange?: (next: OosLostDemandWeights) => void;
  onApplyAndSync?: () => void;
  gradient?: GradientTier[];
  gradientSC?: GradientTier[];
  onGradientChange?: (next: GradientTier[]) => void;
  onGradientSCChange?: (next: GradientTier[]) => void;
}

export function StatusBar({
  rows,
  inline = false,
  seasonalFactors,
  onSeasonalFactorsChange,
  salesWindowWeights,
  onSalesWindowWeightsChange,
  oosLostDemandWeights = DEFAULT_OOS_LOST_DEMAND_WEIGHTS,
  onOosLostDemandWeightsChange,
  onApplyAndSync,
}: StatusBarProps) {
  const { pick } = useI18n();
  const crit  = rows.filter((r) => urgStatus(r) === "crit").length;
  const warn  = rows.filter((r) => urgStatus(r) === "warn").length;
  const stock = rows.reduce((a, r) => a + (r.total_stock || 0), 0);
  const bo    = rows.reduce((a, r) => a + Math.abs(Math.min(r.back || 0, 0)), 0);
  const s30   = rows.reduce((a, r) => a + (r.total_30d || 0), 0);
  const inb   = rows.reduce((a, r) => a + (r.total_inbound_qty || 0), 0);

  return (
    <div
      style={{
        background: "#fff",
        height: inline ? 30 : 32,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1,
        border: "1px solid #C2BFB5",
        borderRadius: inline ? 4 : 0,
        overflow: "hidden",
      }}
    >
      <SbItem label="SKU"     value={rows.length.toLocaleString()} color="#1D4ED8" />
      <SbItem label={pick("🔴긴급", "🔴Critical")}  value={crit}                     color="#DC2626" />
      <SbItem label={pick("⚠주의", "⚠Warning")}    value={warn}                     color="#B45309" />
      <SbItem label="Stock"                          value={stock.toLocaleString()}   color="#1D4ED8" />
      <SbItem label={pick("백오더", "BackOrd")}      value={bo.toLocaleString()}      color="#DC2626" />
      <SbItem label="30D"                            value={s30.toLocaleString()}     color="#047857" />
      <SbItem label={pick("입고", "Inbound")}        value={inb.toLocaleString()}     color="#1D4ED8" />
      <SeasonalFactorSettings
        factors={seasonalFactors}
        onChange={onSeasonalFactorsChange}
        salesWindowWeights={salesWindowWeights}
        onSalesWindowWeightsChange={onSalesWindowWeightsChange}
        oosLostDemandWeights={oosLostDemandWeights}
        onOosLostDemandWeightsChange={onOosLostDemandWeightsChange}
        onApplyAndSync={onApplyAndSync}
      />
    </div>
  );
}

function SbItem({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 11px",
        height: "100%",
        borderRight: "1px solid #D8D6CE",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 650, lineHeight: "14px", color: "#3F3D38" }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", fontWeight: 800, fontSize: 12, lineHeight: "14px", color }}>{value}</span>
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: 64,
  height: 28,
  boxSizing: "border-box",
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  background: "#F8FAFC",
  color: "#1E293B",
  padding: "2px 6px",
  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
  fontSize: 12,
};

const restoreButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid #CBD5E1",
  borderRadius: 4,
  background: "#fff",
  color: "#475569",
  cursor: "pointer",
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
};

function SeasonalFactorSettings({
  factors,
  onChange,
  salesWindowWeights,
  onSalesWindowWeightsChange,
  oosLostDemandWeights,
  onOosLostDemandWeightsChange,
  onApplyAndSync,
}: {
  factors: SeasonalFactors;
  onChange: (next: SeasonalFactors) => void;
  salesWindowWeights: SalesWindowWeights;
  onSalesWindowWeightsChange: (next: SalesWindowWeights) => void;
  oosLostDemandWeights: OosLostDemandWeights;
  onOosLostDemandWeightsChange?: (next: OosLostDemandWeights) => void;
  onApplyAndSync?: () => void;
}) {
  const { pick } = useI18n();

  // Pending edits — inputs write here, not to the committed props. Changes only
  // take effect (persist + trigger a re-sync) when "적용 및 동기화" is clicked.
  const [pendingFactors, setPendingFactors] = useState(factors);
  const [pendingSalesWeights, setPendingSalesWeights] = useState(salesWindowWeights);
  const [pendingOosWeights, setPendingOosWeights] = useState(oosLostDemandWeights);
  // Live preview of what the server would auto-compute for any non-overridden
  // (null) OOS weight cell — refetched every time the popover opens.
  const [autoOosWeights, setAutoOosWeights] = useState<Record<CategoryKey, Record<Marketplace, number>> | null>(null);
  const [justApplied, setJustApplied] = useState(false);

  function handleOpenChange(open: boolean) {
    if (!open) return;
    // Discard any unapplied edits from the last time this was open, and pull fresh committed values.
    setPendingFactors(factors);
    setPendingSalesWeights(salesWindowWeights);
    setPendingOosWeights(oosLostDemandWeights);
    setJustApplied(false);
    fetch(apiPath("/api/planning/stats/oos-lost-demand-weights"))
      .then((res) => res.json())
      .then((json: { success: boolean; weights?: Record<CategoryKey, Record<Marketplace, number>> }) => {
        if (json.success && json.weights) setAutoOosWeights(json.weights);
      })
      .catch(() => {});
  }

  function updateFactor(key: SeasonalFactorKey, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    setPendingFactors({ ...pendingFactors, [key]: value });
  }
  function updateSalesWeight(key: SalesWindowWeightKey, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    setPendingSalesWeights({ ...pendingSalesWeights, [key]: value / 100 });
  }
  const salesWeightTotal = SALES_WINDOW_WEIGHT_FIELDS.reduce((sum, { key }) => sum + pendingSalesWeights[key], 0);

  function updateOosLostDemandWeight(category: CategoryKey, marketplace: Marketplace, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    setPendingOosWeights({
      ...pendingOosWeights,
      [category]: { ...pendingOosWeights[category], [marketplace]: value / 100 },
    });
  }
  function displayedOosWeight(category: CategoryKey, marketplace: Marketplace): number {
    const override = pendingOosWeights[category][marketplace];
    if (override !== null) return override;
    return autoOosWeights?.[category]?.[marketplace] ?? 0;
  }

  function handleApplyAndSync() {
    onChange(pendingFactors);
    onSalesWindowWeightsChange(pendingSalesWeights);
    onOosLostDemandWeightsChange?.(pendingOosWeights);
    setJustApplied(true);
    onApplyAndSync?.();
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Seasonal factor settings"
          title="Seasonal factor settings"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: "100%",
            border: "none",
            borderRight: "1px solid #D8D6CE",
            background: "#fff",
            color: "#64748B",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Settings size={14} strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" style={{ width: "min(560px, calc(100vw - 32px))", padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 16px 10px", borderBottom: "1px solid #E2E8F0" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B" }}>{pick("시즌지수 설정", "Planning Settings")}</div>
            <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.4, color: "#64748B" }}>
              {pick("수요예측 계산에 사용되는 시즌 지수입니다.", "Seasonal multipliers used for planning calculations.")}
            </div>
          </div>
          <PopoverClose asChild>
            <button
              type="button"
              aria-label="Close"
              style={{
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                borderRadius: 4,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "#94A3B8",
                fontSize: 14,
                lineHeight: 1,
                fontWeight: 700,
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "#F1F5F9";
                event.currentTarget.style.color = "#475569";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
                event.currentTarget.style.color = "#94A3B8";
              }}
            >
              X
            </button>
          </PopoverClose>
        </div>

        <div style={{ maxHeight: "min(680px, calc(100vh - 96px))", overflowY: "auto" }}>
          {/* Seasonal Factors */}
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1E293B", marginBottom: 10 }}>{pick("시즌 지수", "Seasonal Factors")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {SEASONAL_FACTOR_FIELDS.map(({ key, label }) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 38, fontSize: 12, fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>{label}</span>
                  <span style={{ fontSize: 12, color: "#94A3B8" }}>x</span>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={pendingFactors[key]}
                    onChange={(event) => updateFactor(key, event.target.value)}
                    style={inputStyle}
                  />
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={() => setPendingFactors(DEFAULT_SEASONAL_FACTORS)} style={restoreButtonStyle}>
                <RotateCcw size={13} />
                {pick("기본값 복원", "Restore Defaults")}
              </button>
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderTop: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1E293B" }}>{pick("판매 비중 기간별 가중치", "Sales Window Weights")}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: Math.abs(salesWeightTotal - 1) < 0.0001 ? "#047857" : "#B45309" }}>
                {pick("합계", "Total")} {(salesWeightTotal * 100).toFixed(0)}%
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {SALES_WINDOW_WEIGHT_FIELDS.map(({ key, label }) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 38, fontSize: 12, fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={Number((pendingSalesWeights[key] * 100).toFixed(2))}
                    onChange={(event) => updateSalesWeight(key, event.target.value)}
                    style={inputStyle}
                  />
                  <span style={{ fontSize: 12, color: "#64748B" }}>%</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={() => setPendingSalesWeights(DEFAULT_SALES_WINDOW_WEIGHTS)} style={restoreButtonStyle}>
                <RotateCcw size={13} />
                {pick("판매 비중 기본값 복원", "Restore Sales Defaults")}
              </button>
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderTop: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1E293B", marginBottom: 4 }}>
              {pick("OOS 손실수요 마켓 비중", "OOS Lost-Demand Marketplace Weights")}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: "#64748B", marginBottom: 10 }}>
              {pick(
                "비워두면(자동) 최근 90일 판매량 기준으로 매 동기화 시 자동 계산됩니다. 직접 값을 입력하면 그 값을 그대로 씁니다.",
                "Left as auto, this is recomputed every sync from trailing 90-day sales. Enter a value to override it.",
              )}
            </div>
            {OOS_LOST_DEMAND_CATEGORIES.map(({ key: category, label: categoryLabel }) => (
              <div key={category} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 6 }}>{categoryLabel} ({category})</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {OOS_LOST_DEMAND_MARKETPLACES.map(({ key: marketplace, label: marketplaceLabel }) => {
                    const isOverridden = pendingOosWeights[category][marketplace] !== null;
                    return (
                      <label key={marketplace} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 48, fontSize: 12, fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>{marketplaceLabel}</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={Number((displayedOosWeight(category, marketplace) * 100).toFixed(2))}
                          onChange={(event) => updateOosLostDemandWeight(category, marketplace, event.target.value)}
                          style={{ ...inputStyle, width: 78, color: isOverridden ? "#1E293B" : "#94A3B8" }}
                          title={isOverridden ? pick("수동 오버라이드", "Manual override") : pick("자동 계산값", "Auto-computed")}
                        />
                        <span style={{ fontSize: 12, color: "#64748B" }}>%</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 4 }}>
              <button type="button" onClick={() => setPendingOosWeights(DEFAULT_OOS_LOST_DEMAND_WEIGHTS)} style={restoreButtonStyle}>
                <RotateCcw size={13} />
                {pick("자동계산으로 복원", "Restore to Auto")}
              </button>
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderTop: "1px solid #E2E8F0" }}>
            <PopoverClose asChild>
              <button
                type="button"
                onClick={handleApplyAndSync}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  width: "100%",
                  border: "none",
                  borderRadius: 4,
                  background: "#1A1917",
                  color: "#fff",
                  cursor: "pointer",
                  padding: "9px 10px",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {justApplied ? <Check size={14} /> : null}
                {pick("적용 및 동기화", "Apply & Sync")}
              </button>
            </PopoverClose>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
