"use client";

import { RotateCcw, Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_SEASONAL_FACTORS,
  SEASONAL_FACTOR_FIELDS,
  type SeasonalFactorKey,
  type SeasonalFactors,
} from "@/lib/planning/seasonal-factors";
import {
  DEFAULT_GRADIENT,
  DEFAULT_GRADIENT_SC,
  type GradientTier,
} from "@/lib/planning/gradient-config";
import { urgStatus } from "./columns";
import type { DemandRow } from "@/types/demand-planning";

interface StatusBarProps {
  rows: DemandRow[];
  inline?: boolean;
  seasonalFactors: SeasonalFactors;
  onSeasonalFactorsChange: (next: SeasonalFactors) => void;
  gradient?: GradientTier[];
  gradientSC?: GradientTier[];
  onGradientChange?: (next: GradientTier[]) => void;
  onGradientSCChange?: (next: GradientTier[]) => void;
}

export function StatusBar({ rows, inline = false, seasonalFactors, onSeasonalFactorsChange, gradient, gradientSC, onGradientChange, onGradientSCChange }: StatusBarProps) {
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
      <SbItem label="🔴긴급"  value={crit}                     color="#DC2626" />
      <SbItem label="⚠주의"   value={warn}                     color="#B45309" />
      <SbItem label="Stock"   value={stock.toLocaleString()}   color="#1D4ED8" />
      <SbItem label="BackOrd" value={bo.toLocaleString()}      color="#DC2626" />
      <SbItem label="30D"     value={s30.toLocaleString()}     color="#047857" />
      <SbItem label="Inbound" value={inb.toLocaleString()}     color="#1D4ED8" />
      <SeasonalFactorSettings
        factors={seasonalFactors}
        onChange={onSeasonalFactorsChange}
        gradient={gradient ?? DEFAULT_GRADIENT}
        gradientSC={gradientSC ?? DEFAULT_GRADIENT_SC}
        onGradientChange={onGradientChange ?? (() => {})}
        onGradientSCChange={onGradientSCChange ?? (() => {})}
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
  gradient,
  gradientSC,
  onGradientChange,
  onGradientSCChange,
}: {
  factors: SeasonalFactors;
  onChange: (next: SeasonalFactors) => void;
  gradient: GradientTier[];
  gradientSC: GradientTier[];
  onGradientChange: (next: GradientTier[]) => void;
  onGradientSCChange: (next: GradientTier[]) => void;
}) {
  function updateFactor(key: SeasonalFactorKey, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return;
    onChange({ ...factors, [key]: value });
  }

  const gradientSections = [
    { label: "Car Cover", tiers: gradient, defaults: DEFAULT_GRADIENT, onChange: onGradientChange },
    { label: "Seat Cover", tiers: gradientSC, defaults: DEFAULT_GRADIENT_SC, onChange: onGradientSCChange },
  ] as const;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Seasonal factor settings"
          title="Seasonal factor & gradient settings"
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
      <PopoverContent align="end" style={{ width: 720, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B" }}>Planning Settings</div>
          <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.4, color: "#64748B" }}>
            Seasonal multipliers and auto-fill gradient tiers.
          </div>
        </div>

        <div style={{ display: "flex", gap: 0 }}>
          {/* Seasonal Factors */}
          <div style={{ flex: "0 0 auto", padding: "14px 16px", borderRight: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1E293B", marginBottom: 10 }}>Seasonal Factors</div>
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
                Restore Defaults
              </button>
            </div>
          </div>

          {/* Gradient Tiers */}
          <div style={{ flex: 1, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1E293B", marginBottom: 10 }}>Gradient Tiers</div>
            <div style={{ display: "flex", gap: 20 }}>
              {gradientSections.map((section) => (
                <div key={section.label} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>{section.label}</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "4px 6px", color: "#7A766F", fontWeight: 600, fontSize: 11 }}>Tier</th>
                        <th style={{ textAlign: "right", padding: "4px 6px", color: "#7A766F", fontWeight: 600, fontSize: 11 }}>Min Sales</th>
                        <th style={{ textAlign: "right", padding: "4px 6px", color: "#7A766F", fontWeight: 600, fontSize: 11 }}>Bonus (days)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.tiers.map((tier, i) => (
                        <tr key={tier.tier} style={{ borderTop: "1px solid #E8E6E0" }}>
                          <td style={{ padding: "4px 6px", fontWeight: 700, color: "#1A1917", width: 40 }}>{tier.tier}</td>
                          <td style={{ padding: "4px 6px" }}>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={tier.min_sales}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!Number.isFinite(val)) return;
                                section.onChange(section.tiers.map((t, j) => j === i ? { ...t, min_sales: val } : t));
                              }}
                              style={{ width: 72, height: 28, textAlign: "right", border: "1px solid #C2BFB5", borderRadius: 4, padding: "2px 6px", fontSize: 12, background: "#FAFAF8", boxSizing: "border-box" }}
                            />
                          </td>
                          <td style={{ padding: "4px 6px" }}>
                            <input
                              type="number"
                              step="1"
                              value={tier.bonus}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                if (!Number.isFinite(val)) return;
                                section.onChange(section.tiers.map((t, j) => j === i ? { ...t, bonus: val } : t));
                              }}
                              style={{ width: 72, height: 28, textAlign: "right", border: "1px solid #C2BFB5", borderRadius: 4, padding: "2px 6px", fontSize: 12, background: "#FAFAF8", boxSizing: "border-box" }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    onClick={() => section.onChange([...section.defaults])}
                    style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid #C2BFB5", background: "#F5F4EF", cursor: "pointer", color: "#5A5750", alignSelf: "flex-end" }}
                  >
                    Reset
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
