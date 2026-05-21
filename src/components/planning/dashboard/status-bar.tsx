import { urgStatus } from "./columns";
import type { DemandRow } from "@/types/demand-planning";

interface StatusBarProps {
  rows: DemandRow[];
}

export function StatusBar({ rows }: StatusBarProps) {
  const crit  = rows.filter((r) => urgStatus(r) === "crit").length;
  const warn  = rows.filter((r) => urgStatus(r) === "warn").length;
  const stock = rows.reduce((a, r) => a + (r.total_stock || 0), 0);
  const bo    = rows.reduce((a, r) => a + Math.abs(Math.min(r.back || 0, 0)), 0);
  const s30   = rows.reduce((a, r) => a + (r.total_30d || 0), 0);
  const inb   = rows.reduce((a, r) => a + (r.total_inbound_qty || 0), 0);

  return (
    <div
      style={{
        background: "#2A2825",
        height: 24,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        fontFamily: "monospace",
        fontSize: 10,
      }}
    >
      <SbItem label="SKU"     value={rows.length}              color="#78AAFF" />
      <SbItem label="🔴긴급"  value={crit}                     color="#FF7070" />
      <SbItem label="⚠주의"   value={warn}                     color="#F0B060" />
      <SbItem label="Stock"   value={stock.toLocaleString()}   color="#78AAFF" />
      <SbItem label="BackOrd" value={bo.toLocaleString()}      color="#FF7070" />
      <SbItem label="30D"     value={s30.toLocaleString()}     color="#50C090" />
      <SbItem label="Inbound" value={inb.toLocaleString()}     color="#78AAFF" />
    </div>
  );
}

function SbItem({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: "0 10px",
        height: "100%",
        borderRight: "1px solid #3a3835",
      }}
    >
      <span style={{ fontSize: 9, color: "rgba(255,255,255,.32)" }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 10, color }}>{value}</span>
    </div>
  );
}
