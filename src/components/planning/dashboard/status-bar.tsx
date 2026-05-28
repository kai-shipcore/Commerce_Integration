import { urgStatus } from "./columns";
import type { DemandRow } from "@/types/demand-planning";

interface StatusBarProps {
  rows: DemandRow[];
  inline?: boolean;
}

export function StatusBar({ rows, inline = false }: StatusBarProps) {
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
