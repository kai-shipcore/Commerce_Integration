"use client";

import { urgStatus } from "./columns";
import type { DemandRow } from "@/types/demand-planning";

interface SkuMasterTableProps {
  rows: DemandRow[];
}

export function SkuMasterTable({ rows }: SkuMasterTableProps) {
  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: 14,
        background: "#F0EEE9",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: 12,
          width: "100%",
          background: "#fff",
        }}
      >
        <thead>
          <tr>
            {[
              "Master SKU", "West", "East", "Total", "Back",
              "30D Total", "Avg/Day", "S.O.D", "Status",
              "Containers List",
            ].map((h) => (
              <th
                key={h}
                style={{
                  background: "#F5F4EF",
                  padding: "7px 10px",
                  border: "1px solid #D8D6CE",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#9A9790",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const u = urgStatus(r);
            const sodCls =
              u === "crit" ? "#C42020" : u === "warn" ? "#9A5200" : "#5A5750";
            return (
              <tr
                key={r.sku}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#F5F4EF")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "")
                }
              >
                <td
                  style={{
                    padding: "7px 10px",
                    border: "1px solid #D8D6CE",
                    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#1238A0",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.sku}
                </td>
                <NumCell>{r.west_stock || 0}</NumCell>
                <NumCell>{r.east_stock || 0}</NumCell>
                <NumCell bold>{r.total_stock || 0}</NumCell>
                <NumCell>{r.back || 0}</NumCell>
                <NumCell bold>{r.total_30d || 0}</NumCell>
                <NumCell>{r.total_avg_curr || ""}</NumCell>
                <td
                  style={{
                    padding: "7px 10px",
                    border: "1px solid #D8D6CE",
                    textAlign: "center",
                    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                    fontSize: 11,
                    color: sodCls,
                    fontWeight: u !== "ok" ? 700 : 400,
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.sod || ""}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #D8D6CE",
                    textAlign: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 5px",
                      borderRadius: 8,
                      background:
                        r.sales_status === "Custom"       ? "#E3F5EC" :
                        r.sales_status === "Hold"         ? "#FEF3D8" :
                        r.sales_status === "Part"         ? "#EDE9FE" :
                        r.sales_status === "Discontinued" ? "#FEE2E2" :
                        r.sales_status === "TBD"          ? "#F1F5F9" :
                        r.sales_status === "SWC"          ? "#FFF7ED" : "#E5EEFF",
                      color:
                        r.sales_status === "Custom"       ? "#0A6A45" :
                        r.sales_status === "Hold"         ? "#9A5200" :
                        r.sales_status === "Part"         ? "#5B21B6" :
                        r.sales_status === "Discontinued" ? "#B91C1C" :
                        r.sales_status === "TBD"          ? "#64748B" :
                        r.sales_status === "SWC"          ? "#C2410C" : "#1238A0",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.sales_status}
                  </span>
                </td>
                <td
                  style={{
                    padding: "7px 10px",
                    border: "1px solid #D8D6CE",
                    fontSize: 11,
                    color: "#5A5750",
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.containers_list || ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NumCell({
  children,
  bold,
}: {
  children: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <td
      style={{
        padding: "7px 10px",
        border: "1px solid #D8D6CE",
        textAlign: "right",
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        fontSize: 12,
        fontWeight: bold ? 700 : 400,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
