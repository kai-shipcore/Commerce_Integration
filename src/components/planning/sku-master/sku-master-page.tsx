"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductKey } from "@/features/planning/mock-data";

type SkuMasterRow = {
  masterSku: string;
  productName: string;
  productKey: ProductKey;
  category: string;
  categoryCode: string;
  moq: number;
  orderMultiple: number;
  cbmPerUnit: number;
  caseQty: number;
  weightKg: number;
};

const productMeta: Record<
  ProductKey,
  { label: string; icon: string; badgeClass: string; cbmClass: string }
> = {
  cc: {
    label: "Car Cover",
    icon: "CC",
    badgeClass: "bg-[#dcefe8] text-[#047857]",
    cbmClass: "text-[#b56a00]",
  },
  fm: {
    label: "Floor Mat",
    icon: "FM",
    badgeClass: "bg-[#f5ead8] text-[#b56a00]",
    cbmClass: "text-[#d21f1f]",
  },
  sc: {
    label: "Seat Cover",
    icon: "SC",
    badgeClass: "bg-[#e5e9ff] text-[#2855d9]",
    cbmClass: "text-[#b56a00]",
  },
};

export function SkuMasterPage() {
  const [rows, setRows] = useState<SkuMasterRow[]>([]);
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<ProductKey | "all">("all");
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
  });

  async function fetchRows() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (product !== "all") params.set("product", product);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/planning/sku-master?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load SKU master");
      setRows(json.data);
      setPagination(json.pagination ?? { page, limit, total: json.data.length, totalPages: 1 });
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "Failed to load SKU master");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchRows();
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, product, page, limit]);

  const visibleSkus = useMemo(
    () => rows,
    [rows]
  );

  const stats = useMemo(() => {
    const missingCbm = rows.filter((sku) => !sku.cbmPerUnit || sku.cbmPerUnit <= 0).length;
    const averageCbm = rows.length
      ? rows.reduce((sum, sku) => sum + sku.cbmPerUnit, 0) / rows.length
      : 0;
    const productTypes = new Set(rows.map((sku) => sku.productKey)).size;
    return { missingCbm, averageCbm, productTypes };
  }, [rows]);

  function updateRow(
    masterSku: string,
    patch: Partial<Pick<SkuMasterRow, "cbmPerUnit" | "moq" | "caseQty" | "weightKg">>
  ) {
    setRows((current) => current.map((sku) => (sku.masterSku === masterSku ? { ...sku, ...patch } : sku)));
  }

  async function saveRow(row: SkuMasterRow) {
    const res = await fetch("/api/planning/sku-master", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error ?? "Failed to save SKU");
  }

  async function deleteRow(masterSku: string) {
    if (!window.confirm(`Delete ${masterSku} from SKU Master?`)) return;
    const res = await fetch(`/api/planning/sku-master?masterSku=${encodeURIComponent(masterSku)}`, {
      method: "DELETE",
    });
    const json = await res.json();
    if (!json.success) {
      window.alert(json.error ?? "Failed to delete SKU");
      return;
    }
    setRows((current) => current.filter((sku) => sku.masterSku !== masterSku));
    if (editingSku === masterSku) setEditingSku(null);
  }

  async function syncFromInventory() {
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch("/api/planning/sku-master", { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to sync SKU master");
      setMessage(`Synced ${json.upserted ?? 0} SKUs from coverland_inventory`);
      await fetchRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to sync SKU master");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="sku-master-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4">
        <div>
          <h1 className="text-lg font-semibold">SKU Master Management</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage SKU-level CBM, MOQ, and case quantity. Click Edit to update values inline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search SKU..."
            className="form-input h-9 w-52 bg-white"
          />
          <select
            value={product}
            onChange={(event) => {
              setProduct(event.target.value as ProductKey | "all");
              setPage(1);
            }}
            className="form-input h-9 w-36 bg-white text-xs"
          >
            <option value="all">All</option>
            {(Object.keys(productMeta) as ProductKey[]).map((key) => (
              <option key={key} value={key}>
                {productMeta[key].label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="h-9 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9]"
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={syncFromInventory}
            disabled={syncing}
            className="h-9 rounded-md bg-[#1a5cdb] px-4 text-xs font-semibold text-white hover:bg-[#1650c4]"
          >
            {syncing ? "Syncing..." : "Sync Inventory"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 border-b border-[#e2dfd8] bg-[#f0eee9] md:grid-cols-4">
        <SkuStat label="Total SKUs" value={pagination.total.toString()} sub={loading ? "Loading..." : `${visibleSkus.length} on this page`} />
        <SkuStat
          label="Missing CBM"
          value={stats.missingCbm.toString()}
          sub={stats.missingCbm ? "Needs review" : "All entered"}
        />
        <SkuStat label="Average CBM" value={stats.averageCbm.toFixed(4)} sub="m3 / unit" />
        <SkuStat label="Product Types" value={stats.productTypes.toString()} sub="types" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2dfd8] bg-white px-5 py-2 text-xs text-muted-foreground">
        <div>
          Showing{" "}
          <span className="font-semibold text-foreground">
            {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1}
            {" - "}
            {Math.min(pagination.page * pagination.limit, pagination.total)}
          </span>{" "}
          of <span className="font-semibold text-foreground">{pagination.total}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <select
            value={limit}
            onChange={(event) => {
              setLimit(Number(event.target.value));
              setPage(1);
            }}
            className="h-8 rounded-md border border-[#cccac4] bg-white px-2 text-xs outline-none focus:border-[#1a5cdb]"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
          <button
            type="button"
            disabled={loading || pagination.page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-md border border-[#cccac4] bg-white px-3 py-1.5 font-medium text-foreground hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <span className="min-w-20 text-center">
            Page <span className="font-semibold text-foreground">{pagination.page}</span> / {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
            className="rounded-md border border-[#cccac4] bg-white px-3 py-1.5 font-medium text-foreground hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <div className="grid min-w-[1040px] grid-cols-[230px_360px_150px_110px_210px_130px_160px] border-b border-[#e2dfd8] bg-white text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          <div className="px-4 py-3">Product</div>
          <div className="px-4 py-3">Master SKU</div>
          <div className="px-4 py-3">CBM / Unit</div>
          <div className="px-4 py-3">MOQ</div>
          <div className="px-4 py-3">
            <div>Units per Case</div>
            <div className="mt-0.5 text-[10px] font-normal text-[#b8b5ae]">Car cover only</div>
          </div>
          <div className="px-4 py-3">Weight</div>
          <div className="px-4 py-3 text-right">Actions</div>
        </div>

        {visibleSkus.map((sku) => (
          <div
            key={sku.masterSku}
            className="grid min-w-[1040px] grid-cols-[230px_360px_150px_110px_210px_130px_160px] items-center border-b border-[#e2dfd8] text-sm last:border-b-0"
          >
            <div className="px-4 py-3">
              <ProductBadge product={sku.productKey} />
            </div>
            <div className="px-4 py-3 font-mono text-xs font-semibold">{sku.masterSku}</div>
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.cbmPerUnit}
              decimals={4}
              className={`font-mono font-semibold ${productMeta[sku.productKey].cbmClass}`}
              onChange={(value) => updateRow(sku.masterSku, { cbmPerUnit: value })}
            />
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.moq}
              decimals={0}
              onChange={(value) => updateRow(sku.masterSku, { moq: value })}
            />
            <div className="px-4 py-3">
              {sku.productKey === "cc" ? (
                <EditableNumber
                  active={editingSku === sku.masterSku}
                  value={sku.caseQty}
                  decimals={0}
                  suffix="pcs/case"
                  className="font-semibold"
                  onChange={(value) => updateRow(sku.masterSku, { caseQty: value })}
                  compact
                />
              ) : (
                <span className="text-xs text-[#b8b5ae]">N/A</span>
              )}
            </div>
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.weightKg}
              decimals={1}
              suffix="kg"
              onChange={(value) => updateRow(sku.masterSku, { weightKg: value })}
            />
            <div className="flex min-w-0 flex-nowrap justify-end gap-1.5 px-4 py-3">
              <button
                type="button"
                onClick={async () => {
                  if (editingSku === sku.masterSku) {
                    try {
                      await saveRow(sku);
                      setEditingSku(null);
                      setMessage(`Saved ${sku.masterSku}`);
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "Failed to save SKU");
                    }
                  } else {
                    setEditingSku(sku.masterSku);
                  }
                }}
                className="whitespace-nowrap rounded-md border border-[#cccac4] bg-white px-2.5 py-1 text-xs hover:bg-[#f0eee9]"
              >
                {editingSku === sku.masterSku ? "Done" : "Edit"}
              </button>
              <button
                type="button"
                onClick={() => void deleteRow(sku.masterSku)}
                className="whitespace-nowrap rounded-md border border-[#cccac4] bg-white px-2.5 py-1 text-xs hover:bg-[#f0eee9]"
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {visibleSkus.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <div className="text-4xl opacity-50">⌕</div>
            <div className="text-sm font-medium">{loading ? "Loading SKU master..." : "No matching SKUs"}</div>
            <div className="text-xs">
              {loading ? "Reading fc_products" : "Click Sync Inventory or change the SKU search term."}
            </div>
          </div>
        ) : null}
      </div>
      {message ? (
        <div className="border-t border-[#e2dfd8] bg-white px-5 py-2 text-xs text-muted-foreground">{message}</div>
      ) : null}
    </section>
  );
}

function SkuStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ProductBadge({ product }: { product: ProductKey }) {
  const meta = productMeta[product];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}>
      <span className="font-mono text-[10px]">{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function EditableNumber({
  active,
  value,
  decimals,
  suffix,
  className = "",
  compact = false,
  onChange,
}: {
  active: boolean;
  value: number;
  decimals: number;
  suffix?: string;
  className?: string;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  if (active) {
    return (
      <div className={`${compact ? "" : "px-4 py-3"} inline-flex min-w-0 items-center whitespace-nowrap`}>
        <input
          type="number"
          step={decimals === 0 ? 1 : 0.0001}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-8 w-20 shrink-0 rounded-md border border-[#cccac4] bg-white px-2 text-sm outline-none focus:border-[#1a5cdb]"
        />
        {suffix ? <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    );
  }

  return (
    <div className={`${compact ? "" : "px-4 py-3"} whitespace-nowrap`}>
      <span className={className}>{value.toFixed(decimals)}</span>
      {suffix ? <span className="ml-0.5 whitespace-nowrap text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}
