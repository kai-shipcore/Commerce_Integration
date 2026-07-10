"use client";

import { RotateCcw, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";
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

function SeasonalFactorSettings({
  factors,
  onChange,
  salesWindowWeights,
  onSalesWindowWeightsChange,
}: {
  factors: SeasonalFactors;
  onChange: (next: SeasonalFactors) => void;
  salesWindowWeights: SalesWindowWeights;
  onSalesWindowWeightsChange: (next: SalesWindowWeights) => void;
}) {
  const { pick } = useI18n();
  function updateFactor(key: SeasonalFactorKey, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    onChange({ ...factors, [key]: value });
  }
  function updateSalesWeight(key: SalesWindowWeightKey, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    onSalesWindowWeightsChange({ ...salesWindowWeights, [key]: value / 100 });
  }
  const salesWeightTotal = SALES_WINDOW_WEIGHT_FIELDS.reduce((sum, { key }) => sum + salesWindowWeights[key], 0);

  return (
    <Popover>
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
      <PopoverContent align="end" style={{ width: "min(380px, calc(100vw - 32px))", padding: 0, overflow: "hidden" }}>
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
                    value={factors[key]}
                    onChange={(event) => updateFactor(key, event.target.value)}
                    style={{
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
                    }}
                  />
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => onChange(DEFAULT_SEASONAL_FACTORS)}
                style={{
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
                }}
              >
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
                    value={Number((salesWindowWeights[key] * 100).toFixed(2))}
                    onChange={(event) => updateSalesWeight(key, event.target.value)}
                    style={{
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
                    }}
                  />
                  <span style={{ fontSize: 12, color: "#64748B" }}>%</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => onSalesWindowWeightsChange(DEFAULT_SALES_WINDOW_WEIGHTS)}
                style={{
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
                }}
              >
                <RotateCcw size={13} />
                {pick("판매 비중 기본값 복원", "Restore Sales Defaults")}
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
