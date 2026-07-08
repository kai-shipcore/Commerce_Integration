"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, RefreshCcw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { apiPath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useI18n } from "@/lib/i18n/i18n-provider";

type Factory = {
  id: string;
  factoryName: string;
  factoryCode: string | null;
};

type PriceRow = {
  id: string;
  factoryId: string;
  factoryName: string;
  sku: string;
  effectiveDate: string;
  unitPrice: number;
  currency: string;
  reason: string | null;
  sourceFileId: string | null;
  sourceFileName: string | null;
  previousPrice: number | null;
  changeAmount: number | null;
  changeRate: number | null;
};

type PriceForm = {
  id: string | null;
  factoryId: string;
  effectiveDate: string;
  unitPrice: string;
  currency: string;
  reason: string;
};

type SkuPriceHistoryDrawerProps = {
  open: boolean;
  sku: string | null;
  productLabel?: string;
  onClose: () => void;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(factoryId = ""): PriceForm {
  return {
    id: null,
    factoryId,
    effectiveDate: today(),
    unitPrice: "",
    currency: "USD",
    reason: "",
  };
}

function money(value: number | null | undefined, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
}

function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function signedMoney(value: number | null | undefined, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${money(value, currency)}`;
}

export function SkuPriceHistoryDrawer({ open, sku, productLabel, onClose }: SkuPriceHistoryDrawerProps) {
  const normalizedSku = sku?.trim().toUpperCase() ?? "";
  const { pick } = useI18n();
  const { can, ready } = usePermissions();
  const canRead = ready && can("invoice-price-control", "read");
  const canCreate = ready && can("invoice-price-control", "create");
  const canEdit = ready && can("invoice-price-control", "edit");
  const canDelete = ready && can("invoice-price-control", "delete");
  const [factories, setFactories] = useState<Factory[]>([]);
  const [factoryId, setFactoryId] = useState("");
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState(today());
  const [form, setForm] = useState<PriceForm>(emptyForm());
  const [effectiveSort, setEffectiveSort] = useState<"asc" | "desc">("desc");

  const chronologicalRows = useMemo(
    () => [...rows].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
    [rows]
  );

  const sortedRows = useMemo(
    () => (effectiveSort === "asc" ? chronologicalRows : [...chronologicalRows].reverse()),
    [chronologicalRows, effectiveSort]
  );

  const latestRow = useMemo(() => chronologicalRows[chronologicalRows.length - 1] ?? null, [chronologicalRows]);

  const asOfRow = useMemo(() => {
    if (!asOfDate) return null;
    return [...chronologicalRows].reverse().find((row) => row.effectiveDate <= asOfDate) ?? null;
  }, [asOfDate, chronologicalRows]);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  async function loadFactories() {
    try {
      const res = await fetch(apiPath("/api/production/price-history?mode=factories&active=true"), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || pick("공장 목록을 불러오지 못했습니다.", "Failed to load factories"));
      setFactories(json.data);
      const nextFactoryId = factoryId || json.data[0]?.id || "";
      setFactoryId(nextFactoryId);
      setForm((current) => ({ ...current, factoryId: current.factoryId || nextFactoryId }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("공장 목록을 불러오지 못했습니다.", "Failed to load factories"));
    }
  }

  async function loadRows(nextFactoryId = factoryId) {
    if (!normalizedSku || !canRead) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ sku: normalizedSku });
      if (nextFactoryId) params.set("factoryId", nextFactoryId);
      const res = await fetch(apiPath(`/api/production/price-history?${params.toString()}`), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || pick("가격 이력을 불러오지 못했습니다.", "Failed to load price history"));
      setRows(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("가격 이력을 불러오지 못했습니다.", "Failed to load price history"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !ready || !canRead) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFactories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, canRead]);

  useEffect(() => {
    if (!open || !ready || !canRead) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(emptyForm(factoryId));
    void loadRows(factoryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, normalizedSku, factoryId, ready, canRead]);

  function editRow(row: PriceRow) {
    setForm({
      id: row.id,
      factoryId: row.factoryId,
      effectiveDate: row.effectiveDate,
      unitPrice: String(row.unitPrice),
      currency: "USD",
      reason: row.reason ?? "",
    });
  }

  async function saveForm() {
    if (!normalizedSku) return;
    if (!form.id && !canCreate) return toast.error(pick("가격 이력을 추가할 권한이 없습니다.", "No permission to create price history"));
    if (form.id && !canEdit) return toast.error(pick("가격 이력을 수정할 권한이 없습니다.", "No permission to edit price history"));
    const unitPrice = Number(form.unitPrice);
    if (!form.factoryId || !form.effectiveDate || !Number.isFinite(unitPrice)) {
      toast.error(pick("공장, 적용 시작일, 단가는 필수입니다.", "Factory, effective date, and unit price are required"));
      return;
    }
    const res = await fetch(apiPath("/api/production/price-history"), {
      method: form.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.id,
        factoryId: form.factoryId,
        sku: normalizedSku,
        effectiveDate: form.effectiveDate,
        unitPrice,
        currency: "USD",
        reason: form.reason,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("가격 이력 저장에 실패했습니다.", "Failed to save price history"));
      return;
    }
    toast.success(pick("가격 이력이 저장되었습니다.", "Price history saved"));
    setForm(emptyForm(form.factoryId));
    await loadRows(form.factoryId);
  }

  async function deleteRow(id: string) {
    if (!canDelete) return toast.error(pick("가격 이력을 삭제할 권한이 없습니다.", "No permission to delete price history"));
    if (!window.confirm(pick("이 가격 이력을 삭제할까요?", "Delete this price history row?"))) return;
    const res = await fetch(apiPath(`/api/production/price-history?id=${encodeURIComponent(id)}`), { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("가격 이력 삭제에 실패했습니다.", "Failed to delete price history"));
      return;
    }
    toast.success(pick("가격 이력이 삭제되었습니다.", "Price history deleted"));
    await loadRows();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end overflow-hidden bg-black/30" onClick={onClose}>
      <aside
        className="flex h-dvh max-h-dvh w-full max-w-[760px] flex-col overflow-hidden border-l border-[#dedbd2] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[#e6e1d8] px-5 py-5">
          <div className="min-w-0">
            <h2 className="font-mono text-lg font-bold text-[#121212]">{normalizedSku}</h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {productLabel || "SKU"} · {pick("현재가", "current")} {latestRow ? money(latestRow.unitPrice, latestRow.currency) : "-"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-[#1d3fb7] hover:bg-slate-100" aria-label={pick("닫기", "Close")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {!canRead ? (
          <div className="p-6 text-sm text-muted-foreground">{pick("SKU 가격 이력을 볼 권한이 없습니다.", "You do not have permission to view SKU price history.")}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-[#f7f6f2] pb-6">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e6e1d8] bg-white px-5 py-3">
              <select
                value={factoryId}
                onChange={(event) => setFactoryId(event.target.value)}
                className="h-9 min-w-44 rounded-md border px-2 text-sm"
              >
                {factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>
                    {factory.factoryName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void loadRows()}
                disabled={loading}
                title={pick("선택한 공장의 가격 이력을 다시 불러옵니다.", "Reload price history for the selected factory.")}
                className="ml-auto rounded-md border bg-white p-2 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={pick("새로고침", "Refresh")}
              >
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            <section className="m-4 shrink-0 overflow-hidden rounded-xl border border-[#d8d2c6] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e6e1d8] bg-[#fbfaf7] px-5 py-3">
                <div className="text-sm font-semibold text-[#111827]">{pick("가격 변경 이력", "Price Change History")}</div>
                <div className="text-xs text-muted-foreground">
                  {pick("Invoice 검수 시 Invoice Date 이하의 가장 최근 Effective Date 가격을 적용합니다.", "Invoice validation uses the latest effective date that is less than or equal to the invoice date.")}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-[#f8f7f3] text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => setEffectiveSort((current) => (current === "desc" ? "asc" : "desc"))}
                          className="inline-flex items-center gap-1 font-semibold hover:text-[#1a5cdb]"
                        >
                          {pick("적용일", "Effective")}
                          <span aria-hidden="true">{effectiveSort === "desc" ? "↓" : "↑"}</span>
                        </button>
                      </th>
                      <th className="px-4 py-2 text-right">{pick("가격", "Price")}</th>
                      <th className="px-4 py-2 text-right">{pick("변동액", "Change")}</th>
                      <th className="px-4 py-2 text-right">{pick("변동률", "Rate")}</th>
                      {canEdit || canDelete ? <th className="px-4 py-2">{pick("작업", "Actions")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => (
                      <tr key={row.id} className="border-t border-[#eee9df] hover:bg-[#f8f7f3]">
                        <td className="px-4 py-2 font-mono text-xs font-semibold">{row.effectiveDate}</td>
                        <td className="px-4 py-2 text-right font-semibold">{money(row.unitPrice, row.currency)}</td>
                        <td className={`px-4 py-2 text-right ${row.changeAmount && row.changeAmount > 0 ? "text-red-700" : row.changeAmount && row.changeAmount < 0 ? "text-emerald-700" : ""}`}>
                          {signedMoney(row.changeAmount, row.currency)}
                        </td>
                        <td className="px-4 py-2 text-right">{pct(row.changeRate)}</td>
                        {canEdit || canDelete ? (
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1">
                              {canEdit ? (
                                <button type="button" onClick={() => editRow(row)} className="rounded border p-1.5 hover:bg-white" aria-label={pick("수정", "Edit")}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                              {canDelete ? (
                                <button type="button" onClick={() => void deleteRow(row.id)} className="rounded border p-1.5 text-red-600 hover:bg-white" aria-label={pick("삭제", "Delete")}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {!sortedRows.length ? (
                      <tr>
                        <td colSpan={canEdit || canDelete ? 5 : 4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                          {pick("이 SKU의 가격 이력이 없습니다.", "No price history found for this SKU.")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mx-4 mb-4 shrink-0 overflow-hidden rounded-xl border border-[#d8d2c6] bg-white shadow-sm">
              <div className="border-b border-[#e6e1d8] bg-[#fbfaf7] px-5 py-3">
                <div className="text-sm font-semibold text-[#111827]">{pick("특정 날짜 가격 조회", "Lookup Price By Date")}</div>
              </div>
              <div className="px-5 py-4">
              <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} className="h-9 rounded-md border px-2 text-sm" />
              <div className="mt-3 rounded-lg border border-[#e0d8ca] bg-[#fffdf8] px-3 py-3 text-sm">
                {asOfRow ? (
                  <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                    <span className="font-mono font-semibold">{asOfDate}</span> {pick("기준 적용 가격:", "applicable price:")}{" "}
                    <span className="font-bold">{money(asOfRow.unitPrice, asOfRow.currency)}</span>
                    <span className="text-muted-foreground"> {pick("적용 시작일", "since")} {asOfRow.effectiveDate}</span>
                    {asOfRow.reason ? <span className="min-w-0 truncate text-xs text-muted-foreground">· {asOfRow.reason}</span> : null}
                  </div>
                ) : (
                  <span className="text-muted-foreground">{pick("이 날짜에 적용되는 가격이 없습니다.", "No effective price exists on this date.")}</span>
                )}
              </div>
              </div>
            </section>

            {canCreate || (canEdit && form.id) ? (
            <section className="mx-4 mb-6 shrink-0 overflow-hidden rounded-xl border border-[#d8d2c6] bg-white shadow-sm">
              <div className="border-b border-[#e6e1d8] bg-[#fbfaf7] px-5 py-3">
                <div className="text-sm font-semibold text-[#111827]">{form.id ? pick("가격 수정", "Edit Price") : pick("가격 추가", "Add Price")}</div>
              </div>
              <div className="px-5 py-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block text-xs font-medium">
                  {pick("적용 시작일", "Effective Date")}
                  <input type="date" value={form.effectiveDate} onChange={(event) => setForm((current) => ({ ...current, effectiveDate: event.target.value }))} className="mt-1 h-9 w-full rounded-md border px-2" />
                </label>
                <label className="block text-xs font-medium">
                  {pick("단가 ($)", "Unit Price ($)")}
                  <input type="number" step="0.0001" value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} className="mt-1 h-9 w-full rounded-md border px-2" />
                </label>
                <label className="block text-xs font-medium md:col-span-2">
                  {pick("변경 사유", "Reason")}
                  <textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} className="mt-1 min-h-16 w-full rounded-md border px-2 py-2" />
                </label>
              </div>
              </div>
              <div className="flex justify-end gap-2 px-5 pb-5 pt-1">
                <button type="button" onClick={() => setForm(emptyForm(factoryId))} className="rounded-md border px-3 py-2 text-sm">
                  {pick("초기화", "Clear")}
                </button>
                <button type="button" disabled={form.id ? !canEdit : !canCreate} onClick={() => void saveForm()} className="inline-flex items-center gap-2 rounded-md bg-[#111827] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                  <Save className="h-4 w-4" /> {pick("저장", "Save")}
                </button>
              </div>
            </section>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  );
}
