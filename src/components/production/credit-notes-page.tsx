"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiPath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { SearchableSelect } from "@/components/ui/searchable-select";

type Factory = { id: string; factoryName: string; factoryCode: string | null };

type InvoiceOption = { id: string; invoiceNumber: string; invoiceDate: string | null };

type CreditNoteStatus = "pending" | "confirmed" | "applied";

type CreditNote = {
  id: string;
  factoryId: string;
  factoryName: string;
  containerNumber: string | null;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string;
  sku: string;
  expectedUnitPrice: number | null;
  invoiceUnitPrice: number;
  qty: number;
  creditAmount: number;
  status: CreditNoteStatus;
  appliedInvoiceId: string | null;
  appliedInvoiceNumber: string | null;
  appliedDate: string | null;
  note: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  appliedAt: string | null;
  createdBy: string | null;
};

type Summary = Record<CreditNoteStatus, { count: number; amount: number }>;

type ApplyMode = "existing" | "new";

type NewAppliedInvoiceForm = {
  invoiceNumber: string;
  invoiceDate: string;
  containerNumber: string;
  note: string;
};

const STATUS_CHIPS: Array<{ key: CreditNoteStatus; ko: string; en: string; badgeClass: string }> = [
  { key: "pending", ko: "Pending", en: "Pending", badgeClass: "bg-[#fef3e2] text-[#8a5300]" },
  { key: "confirmed", ko: "Confirmed", en: "Confirmed", badgeClass: "bg-[#ebf0fd] text-[#1a4db0]" },
  { key: "applied", ko: "Applied", en: "Applied", badgeClass: "bg-[#e6f7ee] text-[#166534]" },
];

const emptySummary: Summary = {
  pending: { count: 0, amount: 0 },
  confirmed: { count: 0, amount: 0 },
  applied: { count: 0, amount: 0 },
};

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyNewAppliedInvoice(): NewAppliedInvoiceForm {
  return {
    invoiceNumber: "",
    invoiceDate: today(),
    containerNumber: "",
    note: "",
  };
}

export function CreditNotesPage() {
  const { pick } = useI18n();
  const { can, ready } = usePermissions();
  const canCreate = ready && can("invoice-price-control", "create");
  const canStatus = ready && can("invoice-price-control", "status");
  const canDelete = ready && can("invoice-price-control", "delete");

  const [factories, setFactories] = useState<Factory[]>([]);
  const [factoryId, setFactoryId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<CreditNoteStatus>>(new Set());
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);

  const [applyTargets, setApplyTargets] = useState<CreditNote[]>([]);
  const [applyMode, setApplyMode] = useState<ApplyMode>("existing");
  const [applyInvoiceOptions, setApplyInvoiceOptions] = useState<InvoiceOption[]>([]);
  const [applyInvoiceLabel, setApplyInvoiceLabel] = useState("");
  const [newApplyInvoice, setNewApplyInvoice] = useState<NewAppliedInvoiceForm>(() => emptyNewAppliedInvoice());
  const [applyDate, setApplyDate] = useState(today());
  const [applying, setApplying] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addFactoryId, setAddFactoryId] = useState("");
  const [addInvoiceOptions, setAddInvoiceOptions] = useState<InvoiceOption[]>([]);
  const [addInvoiceLabel, setAddInvoiceLabel] = useState("");
  const [addSku, setAddSku] = useState("");
  const [addExpectedPrice, setAddExpectedPrice] = useState("");
  const [addInvoicePrice, setAddInvoicePrice] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addCreditAmount, setAddCreditAmount] = useState("");
  const [addNote, setAddNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadFactories() {
    const res = await fetch(apiPath("/api/production/price-history?mode=factories&active=true"), { cache: "no-store" });
    const json = await res.json();
    if (json.success) setFactories(json.data);
  }

  async function loadCreditNotes() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (factoryId) params.set("factoryId", factoryId);
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter.size > 0) params.set("status", [...statusFilter].join(","));
      const res = await fetch(apiPath(`/api/production/credit-notes?${params.toString()}`), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || pick("Credit 목록을 불러오지 못했습니다.", "Failed to load credit notes"));
      setCreditNotes(json.data.creditNotes);
      setSummary(json.data.summary);
      setPage(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("Credit 목록을 불러오지 못했습니다.", "Failed to load credit notes"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFactories();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void loadCreditNotes();
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, factoryId, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(creditNotes.length / pageSize));
  const pagedRows = useMemo(
    () => creditNotes.slice((page - 1) * pageSize, page * pageSize),
    [creditNotes, page, pageSize]
  );

  function toggleStatusChip(status: CreditNoteStatus) {
    setSelectedIds(new Set());
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const ids = creditNotes.map((note) => note.id);
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }

  async function loadInvoiceOptions(forFactoryId: string): Promise<InvoiceOption[]> {
    if (!forFactoryId) return [];
    const params = new URLSearchParams({ factoryId: forFactoryId });
    const res = await fetch(apiPath(`/api/production/invoices?${params.toString()}`), { cache: "no-store" });
    const json = await res.json();
    if (!json.success) return [];
    return (json.data.invoices as Array<{ id: string; invoiceNumber: string; invoiceDate: string | null }>).map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
    }));
  }

  function invoiceLabel(option: InvoiceOption) {
    return `${option.invoiceNumber} · ${option.invoiceDate ?? "-"}`;
  }

  async function confirmCreditNote(note: CreditNote) {
    if (!canStatus) return toast.error(pick("Credit 상태를 변경할 권한이 없습니다.", "No permission to update credit status"));
    const res = await fetch(apiPath(`/api/production/credit-notes/${note.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("상태 변경에 실패했습니다.", "Failed to update status"));
      return;
    }
    toast.success(pick("공장 확인 완료로 표시했습니다.", "Marked as confirmed by factory"));
    await loadCreditNotes();
  }

  async function openApplyModal(notes: CreditNote[]) {
    if (!notes.length) return;
    const factorySet = new Set(notes.map((note) => note.factoryId));
    if (factorySet.size > 1) {
      toast.error(pick("같은 공장의 Credit만 함께 적용할 수 있습니다.", "Only credits from the same factory can be applied together"));
      return;
    }
    setApplyTargets(notes);
    setApplyMode("existing");
    setApplyInvoiceLabel("");
    setNewApplyInvoice(emptyNewAppliedInvoice());
    setApplyDate(today());
    const excludedInvoiceIds = new Set(notes.map((note) => note.sourceInvoiceId));
    const options = await loadInvoiceOptions(notes[0].factoryId);
    setApplyInvoiceOptions(options.filter((option) => !excludedInvoiceIds.has(option.id)));
  }

  async function createAppliedInvoice(notes: CreditNote[]) {
    if (!canCreate) {
      throw new Error(pick("Invoice를 생성할 권한이 없습니다.", "No permission to create invoices"));
    }
    if (!newApplyInvoice.invoiceNumber.trim() || !newApplyInvoice.invoiceDate) {
      throw new Error(pick("새 Invoice 번호와 날짜를 입력하세요.", "Enter the new invoice number and date"));
    }

    const summaryLabel = notes.length === 1
      ? `${notes[0].sku} ${money(notes[0].creditAmount)}`
      : pick(`Credit ${notes.length}건 · 합계 ${money(notes.reduce((sum, n) => sum + n.creditAmount, 0))}`,
             `${notes.length} credit note(s) · total ${money(notes.reduce((sum, n) => sum + n.creditAmount, 0))}`);

    const res = await fetch(apiPath("/api/production/invoices"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        factoryId: notes[0].factoryId,
        invoiceNumber: newApplyInvoice.invoiceNumber.trim(),
        invoiceDate: newApplyInvoice.invoiceDate,
        containerNumber: newApplyInvoice.containerNumber.trim() || undefined,
        note: newApplyInvoice.note.trim() || pick(
          `Credit 적용 Invoice로 생성됨: ${summaryLabel}`,
          `Created as a credit-applied invoice: ${summaryLabel}`,
        ),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || pick("Invoice 생성에 실패했습니다.", "Failed to create invoice"));
    }
    return json.data.id as string;
  }

  async function submitApply() {
    if (!applyTargets.length) return;
    if (!canStatus) return toast.error(pick("Credit 상태를 변경할 권한이 없습니다.", "No permission to update credit status"));
    if (!applyDate) {
      toast.error(pick("적용일을 선택하세요.", "Select the applied date"));
      return;
    }
    setApplying(true);
    try {
      let appliedInvoiceId: string;
      if (applyMode === "new") {
        appliedInvoiceId = await createAppliedInvoice(applyTargets);
      } else {
        const selected = applyInvoiceOptions.find((option) => invoiceLabel(option) === applyInvoiceLabel);
        if (!selected) {
          throw new Error(pick("적용할 Invoice를 선택하세요.", "Select the invoice to apply against"));
        }
        appliedInvoiceId = selected.id;
      }

      const results = await Promise.allSettled(
        applyTargets.map(async (target) => {
          const res = await fetch(apiPath(`/api/production/credit-notes/${target.id}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "applied", appliedInvoiceId, appliedDate: applyDate }),
          });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error || pick("적용 처리에 실패했습니다.", "Failed to apply credit"));
        }),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.length - failed;

      if (succeeded > 0) {
        toast.success(applyMode === "new"
          ? pick(`새 Invoice를 생성하고 Credit ${succeeded}건을 적용했습니다.`, `Created a new invoice and applied ${succeeded} credit note(s)`)
          : pick(`Credit ${succeeded}건이 Invoice에 적용되었습니다.`, `${succeeded} credit note(s) applied to invoice`));
      }
      if (failed > 0) {
        toast.error(pick(`${failed}건 적용에 실패했습니다.`, `Failed to apply ${failed} item(s)`));
      }
      setApplyTargets([]);
      setApplyMode("existing");
      setNewApplyInvoice(emptyNewAppliedInvoice());
      setSelectedIds(new Set());
      await loadCreditNotes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("적용 처리에 실패했습니다.", "Failed to apply credit"));
    } finally {
      setApplying(false);
    }
  }

  async function bulkConfirmSelected() {
    if (!canStatus) return toast.error(pick("Credit 상태를 변경할 권한이 없습니다.", "No permission to update credit status"));
    const targets = creditNotes.filter((note) => selectedIds.has(note.id) && note.status === "pending");
    if (!targets.length) {
      toast.error(pick("Pending 상태의 선택된 Credit이 없습니다.", "No selected credit notes are pending"));
      return;
    }
    setBulkConfirming(true);
    try {
      const results = await Promise.allSettled(
        targets.map(async (target) => {
          const res = await fetch(apiPath(`/api/production/credit-notes/${target.id}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "confirmed" }),
          });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error || pick("상태 변경에 실패했습니다.", "Failed to update status"));
        }),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.length - failed;
      if (succeeded > 0) {
        toast.success(pick(`${succeeded}건을 공장 확인 완료로 표시했습니다.`, `Marked ${succeeded} item(s) as confirmed`));
      }
      if (failed > 0) {
        toast.error(pick(`${failed}건 처리에 실패했습니다.`, `Failed to update ${failed} item(s)`));
      }
      setSelectedIds(new Set());
      await loadCreditNotes();
    } finally {
      setBulkConfirming(false);
    }
  }

  async function revertCreditNote(note: CreditNote) {
    if (!canStatus) return toast.error(pick("Credit 상태를 변경할 권한이 없습니다.", "No permission to update credit status"));
    const message = note.status === "applied"
      ? pick("Applied 상태를 Confirmed로 되돌릴까요? Applied Invoice 연결이 해제됩니다.", "Revert this credit from Applied back to Confirmed? The applied invoice link will be cleared.")
      : pick("Confirmed 상태를 Pending으로 되돌릴까요?", "Revert this credit from Confirmed back to Pending?");
    if (!window.confirm(message)) return;
    const res = await fetch(apiPath(`/api/production/credit-notes/${note.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revert: true }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("되돌리기에 실패했습니다.", "Failed to revert status"));
      return;
    }
    toast.success(pick("상태를 되돌렸습니다.", "Status reverted"));
    await loadCreditNotes();
  }
  async function deleteCreditNote(note: CreditNote) {
    if (!canDelete) return toast.error(pick("Credit을 삭제할 권한이 없습니다.", "No permission to delete credit notes"));
    if (!window.confirm(pick(`${note.sku} Credit 레코드를 삭제할까요?`, `Delete the credit note for ${note.sku}?`))) return;
    const res = await fetch(apiPath(`/api/production/credit-notes/${note.id}`), { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("삭제에 실패했습니다.", "Failed to delete"));
      return;
    }
    toast.success(pick("Credit 레코드가 삭제되었습니다.", "Credit note deleted"));
    await loadCreditNotes();
  }

  async function onAddFactoryChange(nextFactoryId: string) {
    setAddFactoryId(nextFactoryId);
    setAddInvoiceLabel("");
    const options = await loadInvoiceOptions(nextFactoryId);
    setAddInvoiceOptions(options);
  }

  const addCreditPreview = useMemo(() => {
    const expected = Number(addExpectedPrice);
    const invoicePrice = Number(addInvoicePrice);
    const qty = Number(addQty);
    if (!Number.isFinite(expected) || !Number.isFinite(invoicePrice) || !Number.isFinite(qty)) return null;
    return Number((qty * (invoicePrice - expected)).toFixed(4));
  }, [addExpectedPrice, addInvoicePrice, addQty]);

  function resetAddForm() {
    setAddFactoryId("");
    setAddInvoiceOptions([]);
    setAddInvoiceLabel("");
    setAddSku("");
    setAddExpectedPrice("");
    setAddInvoicePrice("");
    setAddQty("1");
    setAddCreditAmount("");
    setAddNote("");
  }

  async function submitAdd() {
    if (!canCreate) return toast.error(pick("Credit을 추가할 권한이 없습니다.", "No permission to add credit notes"));
    const selected = addInvoiceOptions.find((option) => invoiceLabel(option) === addInvoiceLabel);
    const invoicePrice = Number(addInvoicePrice);
    const qty = Number.parseInt(addQty, 10);
    const expected = addExpectedPrice.trim() ? Number(addExpectedPrice) : null;
    const manualCreditAmount = addCreditAmount.trim() ? Number(addCreditAmount) : undefined;

    if (!selected || !addSku.trim() || !Number.isFinite(invoicePrice) || !Number.isFinite(qty) || qty <= 0) {
      toast.error(pick("Invoice, SKU, 수량, Invoice 가격을 올바르게 입력하세요.", "Enter a valid invoice, SKU, quantity, and invoice price"));
      return;
    }
    if (expected == null && manualCreditAmount === undefined) {
      toast.error(pick("Expected Price가 없으면 Credit Amount를 직접 입력해야 합니다.", "Enter Credit Amount manually when Expected Price is unknown"));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(apiPath("/api/production/credit-notes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceInvoiceId: selected.id,
          sku: addSku.trim(),
          expectedUnitPrice: expected,
          invoiceUnitPrice: invoicePrice,
          qty,
          creditAmount: manualCreditAmount,
          note: addNote.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("Credit 추가에 실패했습니다.", "Failed to add credit note"));
      toast.success(pick("Credit이 Pending으로 등록되었습니다.", "Credit note registered as pending"));
      setShowAddForm(false);
      resetAddForm();
      await loadCreditNotes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("Credit 추가에 실패했습니다.", "Failed to add credit note"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-[#f6f7f9] px-5 py-5 text-[#1a1917]">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select value={factoryId} onChange={(e) => { setSelectedIds(new Set()); setFactoryId(e.target.value); }} className="h-9 w-[210px] shrink-0 truncate rounded-md border bg-white px-2 text-sm">
          <option value="">{pick("전체 공장", "All factories")}</option>
          {factories.map((factory) => (
            <option key={factory.id} value={factory.id}>{factory.factoryName}</option>
          ))}
        </select>
        <div className="flex h-9 min-w-[220px] max-w-[320px] flex-1 items-center rounded-md border bg-white px-2">
          <input value={search} onChange={(e) => { setSelectedIds(new Set()); setSearch(e.target.value); }} className="w-full text-sm outline-none" placeholder={pick("Invoice, Container, SKU 검색", "Search invoice, container, SKU")} />
        </div>
        <button
          type="button"
          onClick={() => { setSelectedIds(new Set()); setStatusFilter(new Set()); }}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            statusFilter.size === 0 ? "bg-[#1a1917] text-white" : "bg-[#f0eee9] text-[#57534a] hover:bg-[#e7e4dc]"
          }`}
        >
          {pick("전체", "All")} {summary.pending.count + summary.confirmed.count + summary.applied.count}
        </button>
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => toggleStatusChip(chip.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              statusFilter.has(chip.key) ? "ring-1 ring-inset ring-[#1a5cdb]" : "hover:opacity-80"
            } ${chip.badgeClass}`}
          >
            {pick(chip.ko, chip.en)} {summary[chip.key].count}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-xs font-semibold text-[#1a4db0]">{pick(`${selectedIds.size}건 선택됨`, `${selectedIds.size} selected`)}</span>
              <button
                type="button"
                disabled={!canStatus || bulkConfirming}
                onClick={() => void bulkConfirmSelected()}
                className="inline-flex h-9 items-center rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                {bulkConfirming ? pick("처리 중...", "Processing...") : pick(`일괄 공장 확인 (${selectedIds.size})`, `Bulk Confirm (${selectedIds.size})`)}
              </button>
              <button
                type="button"
                disabled={!canStatus}
                onClick={() => void openApplyModal(creditNotes.filter((note) => selectedIds.has(note.id) && note.status === "confirmed"))}
                className="inline-flex h-9 items-center rounded-md bg-[#1a5cdb] px-2.5 text-xs font-medium text-white hover:bg-[#174fbf] disabled:opacity-40"
              >
                {pick(`일괄 Invoice 적용 (${selectedIds.size})`, `Bulk Apply (${selectedIds.size})`)}
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#1a5cdb] px-3 text-sm font-medium text-white hover:bg-[#174fbf] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {pick("Credit 추가", "Add Credit")}
          </button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border bg-white p-3">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("Pending 총액", "Pending Total")}</div>
          <div className="mt-1 text-lg font-bold text-[#8a5300]">{money(summary.pending.amount)}</div>
          <div className="text-xs text-muted-foreground">{pick(`${summary.pending.count}건 · 공장 확인 대기`, `${summary.pending.count} item(s) awaiting factory confirmation`)}</div>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("Confirmed 총액", "Confirmed Total")}</div>
          <div className="mt-1 text-lg font-bold text-[#1a4db0]">{money(summary.confirmed.amount)}</div>
          <div className="text-xs text-muted-foreground">{pick(`${summary.confirmed.count}건 · 차감 대기`, `${summary.confirmed.count} item(s) awaiting deduction`)}</div>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("Applied 총액", "Applied Total")}</div>
          <div className="mt-1 text-lg font-bold text-[#166534]">{money(summary.applied.amount)}</div>
          <div className="text-xs text-muted-foreground">{pick(`${summary.applied.count}건 · 차감 완료`, `${summary.applied.count} item(s) deducted`)}</div>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("전체 Credit", "All Credits")}</div>
          <div className="mt-1 text-lg font-bold">{summary.pending.count + summary.confirmed.count + summary.applied.count}{pick("건", "")}</div>
          <div className="text-xs text-muted-foreground">{money(summary.pending.amount + summary.confirmed.amount + summary.applied.amount)} {pick("누적", "cumulative")}</div>
        </div>
      </div>

      {showAddForm ? (
        <div className="shrink-0 rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold">{pick("Credit 수동 추가", "Add Credit Manually")}</div>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-xs font-medium">
              {pick("공장", "Factory")}
              <select value={addFactoryId} onChange={(e) => void onAddFactoryChange(e.target.value)} className="mt-1 h-9 w-full rounded-md border px-2">
                <option value="">{pick("공장 선택", "Select factory")}</option>
                {factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>{factory.factoryName}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              {pick("원본 Invoice", "Source Invoice")}
              <SearchableSelect
                options={addInvoiceOptions.map(invoiceLabel)}
                value={addInvoiceLabel}
                onChange={setAddInvoiceLabel}
                placeholder={pick("Invoice 검색", "Search invoice")}
                disabled={!addFactoryId}
                className="mt-1 w-full"
              />
            </label>
            <label className="block text-xs font-medium">
              SKU
              <input value={addSku} onChange={(e) => setAddSku(e.target.value.toUpperCase())} className="mt-1 h-9 w-full rounded-md border px-2 font-mono" />
            </label>
            <label className="block text-xs font-medium">
              {pick("수량", "Qty")}
              <input type="number" value={addQty} onChange={(e) => setAddQty(e.target.value)} className="mt-1 h-9 w-full rounded-md border px-2" />
            </label>
            <label className="block text-xs font-medium">
              {pick("Expected Price", "Expected Price")}
              <input type="number" step="0.0001" value={addExpectedPrice} onChange={(e) => setAddExpectedPrice(e.target.value)} className="mt-1 h-9 w-full rounded-md border px-2" />
            </label>
            <label className="block text-xs font-medium">
              {pick("Invoice Price", "Invoice Price")}
              <input type="number" step="0.0001" value={addInvoicePrice} onChange={(e) => setAddInvoicePrice(e.target.value)} className="mt-1 h-9 w-full rounded-md border px-2" />
            </label>
            <label className="block text-xs font-medium">
              {pick("Credit Amount (자동계산, 수정 가능)", "Credit Amount (auto, editable)")}
              <input
                type="number"
                step="0.0001"
                value={addCreditAmount}
                onChange={(e) => setAddCreditAmount(e.target.value)}
                placeholder={addCreditPreview != null ? String(addCreditPreview) : ""}
                className="mt-1 h-9 w-full rounded-md border px-2"
              />
            </label>
            <label className="block text-xs font-medium md:col-span-2">
              {pick("메모", "Note")}
              <input value={addNote} onChange={(e) => setAddNote(e.target.value)} className="mt-1 h-9 w-full rounded-md border px-2" />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setShowAddForm(false); resetAddForm(); }} className="rounded-md border px-3 py-2 text-sm">
              {pick("취소", "Cancel")}
            </button>
            <button type="button" disabled={saving} onClick={() => void submitAdd()} className="rounded-md bg-[#111827] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {saving ? pick("저장 중...", "Saving...") : pick("Pending으로 등록", "Register as Pending")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-white shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">{pick("Credit 목록", "Credit Notes")}</div>
            <div className="text-xs text-muted-foreground">{loading ? pick("불러오는 중...", "Loading...") : pick(`${creditNotes.length}개 행`, `${creditNotes.length} rows`)}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{pick("행", "Rows")}</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-8 rounded-md border bg-white px-2 text-foreground">
              {[25, 50, 100].map((size) => (<option key={size} value={size}>{size}</option>))}
            </select>
          </div>
          <span>
            {pick("페이지", "Page")} <span className="font-semibold text-foreground">{creditNotes.length === 0 ? 0 : page}</span> / {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page <= 1} onClick={() => setPage(1)} className="rounded-md border bg-white p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label={pick("첫 페이지", "First page")}>
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button type="button" disabled={page <= 1} onClick={() => setPage((c) => Math.max(1, c - 1))} className="rounded-md border bg-white p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label={pick("이전 페이지", "Previous page")}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((c) => Math.min(totalPages, c + 1))} className="rounded-md border bg-white p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label={pick("다음 페이지", "Next page")}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="rounded-md border bg-white p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label={pick("마지막 페이지", "Last page")}>
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-9 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={pick("전체 선택", "Select all")}
                    checked={creditNotes.length > 0 && creditNotes.every((note) => selectedIds.has(note.id))}
                    onChange={() => toggleSelectAllVisible()}
                  />
                </th>
                <th className="px-3 py-2">Factory</th>
                <th className="px-3 py-2">Container</th>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Invoice 가격</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Applied Invoice</th>
                <th className="px-3 py-2">Applied Date</th>
                <th className="px-3 py-2 text-right">{pick("작업", "Action")}</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((note) => {
                const chip = STATUS_CHIPS.find((c) => c.key === note.status);
                return (
                  <tr
                    key={note.id}
                    onClick={() => toggleSelect(note.id)}
                    className={`cursor-pointer border-t hover:bg-slate-50 ${selectedIds.has(note.id) ? "bg-[#f5f8fe]" : ""}`}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={pick(`${note.sku} 선택`, `Select ${note.sku}`)}
                        checked={selectedIds.has(note.id)}
                        onChange={() => toggleSelect(note.id)}
                      />
                    </td>
                    <td className="max-w-32 truncate px-3 py-2">{note.factoryName}</td>
                    <td className="px-3 py-2 font-mono">{note.containerNumber || "-"}</td>
                    <td className="px-3 py-2 font-mono">{note.sourceInvoiceNumber}</td>
                    <td className="px-3 py-2 font-mono font-semibold">{note.sku}</td>
                    <td className="px-3 py-2 text-right">{money(note.expectedUnitPrice)}</td>
                    <td className="px-3 py-2 text-right">{money(note.invoiceUnitPrice)}</td>
                    <td className="px-3 py-2 text-right">{note.qty}</td>
                    <td className="px-3 py-2 text-right font-semibold">{money(note.creditAmount)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${chip?.badgeClass ?? ""}`}>
                        {chip ? pick(chip.ko, chip.en) : note.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">{note.appliedInvoiceNumber || "-"}</td>
                    <td className="px-3 py-2 font-mono">{note.appliedDate || "-"}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {note.status === "pending" ? (
                          <button type="button" disabled={!canStatus} onClick={() => void confirmCreditNote(note)} className="rounded border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40">
                            {pick("공장 확인 완료", "Mark Confirmed")}
                          </button>
                        ) : null}
                        {note.status === "confirmed" ? (
                          <button type="button" disabled={!canStatus} onClick={() => void openApplyModal([note])} className="rounded bg-[#1a5cdb] px-2 py-1 text-xs font-medium text-white hover:bg-[#174fbf] disabled:opacity-40">
                            {pick("Invoice에 적용", "Apply to Invoice")}
                          </button>
                        ) : null}
                        {note.status === "applied" ? (
                          <span className="text-xs text-muted-foreground">{pick("완료", "Done")}</span>
                        ) : null}
                        {note.status === "confirmed" || note.status === "applied" ? (
                          <button type="button" disabled={!canStatus} onClick={() => void revertCreditNote(note)} className="rounded border px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40">
                            {pick("되돌리기", "Revert")}
                          </button>
                        ) : null}
                        <button type="button" disabled={!canDelete} onClick={() => void deleteCreditNote(note)} className="rounded border px-2 py-1 text-xs text-red-600 disabled:opacity-40">
                          {pick("삭제", "Delete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!creditNotes.length ? (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-muted-foreground">{pick("Credit 레코드가 없습니다.", "No credit notes found.")}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {applyTargets.length > 0 ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setApplyTargets([])}>
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold">{pick("Invoice에 적용", "Apply to Invoice")}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {applyTargets.length === 1
                ? <>{applyTargets[0].sku} · {money(applyTargets[0].creditAmount)} · {applyTargets[0].factoryName}</>
                : pick(
                    `${applyTargets.length}건 선택 · 합계 ${money(applyTargets.reduce((sum, n) => sum + n.creditAmount, 0))} · ${applyTargets[0].factoryName}`,
                    `${applyTargets.length} selected · total ${money(applyTargets.reduce((sum, n) => sum + n.creditAmount, 0))} · ${applyTargets[0].factoryName}`,
                  )}
            </div>
            <div className="mt-4 space-y-3">
              <div className="inline-flex rounded-md border bg-[#f7f6f2] p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setApplyMode("existing")}
                  className={`rounded px-3 py-1.5 ${applyMode === "existing" ? "bg-white text-[#1a5cdb] shadow-sm" : "text-muted-foreground"}`}
                >
                  {pick("기존 Invoice 선택", "Select Existing Invoice")}
                </button>
                <button
                  type="button"
                  disabled={!canCreate}
                  onClick={() => setApplyMode("new")}
                  className={`rounded px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${applyMode === "new" ? "bg-white text-[#1a5cdb] shadow-sm" : "text-muted-foreground"}`}
                >
                  {pick("새 Invoice 생성 후 적용", "Create New Invoice")}
                </button>
              </div>

              {applyMode === "existing" ? (
                <label className="block text-xs font-medium">
                  {pick("적용할 Invoice (같은 공장)", "Invoice to apply against (same factory)")}
                  <SearchableSelect
                    options={applyInvoiceOptions.map(invoiceLabel)}
                    value={applyInvoiceLabel}
                    onChange={setApplyInvoiceLabel}
                    placeholder={pick("Invoice 검색", "Search invoice")}
                    className="mt-1 w-full"
                  />
                </label>
              ) : (
                <div className="rounded-lg border bg-[#fafaf7] p-3">
                  <div className="mb-3 text-xs font-semibold text-muted-foreground">
                    {pick("같은 공장의 Invoice를 새로 만들고 이 Credit을 바로 적용합니다.", "Create a same-factory invoice and apply this credit immediately.")}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block text-xs font-medium">
                      Invoice
                      <input
                        value={newApplyInvoice.invoiceNumber}
                        onChange={(e) => setNewApplyInvoice((cur) => ({ ...cur, invoiceNumber: e.target.value }))}
                        className="mt-1 h-9 w-full rounded-md border bg-white px-2"
                        placeholder={pick("Invoice 번호", "Invoice number")}
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Invoice Date
                      <input
                        type="date"
                        value={newApplyInvoice.invoiceDate}
                        onChange={(e) => setNewApplyInvoice((cur) => ({ ...cur, invoiceDate: e.target.value }))}
                        className="mt-1 h-9 w-full rounded-md border bg-white px-2"
                      />
                    </label>
                    <label className="block text-xs font-medium md:col-span-2">
                      Container
                      <input
                        value={newApplyInvoice.containerNumber}
                        onChange={(e) => setNewApplyInvoice((cur) => ({ ...cur, containerNumber: e.target.value }))}
                        className="mt-1 h-9 w-full rounded-md border bg-white px-2"
                        placeholder={pick("선택 입력", "Optional")}
                      />
                    </label>
                    <label className="block text-xs font-medium md:col-span-2">
                      {pick("메모", "Note")}
                      <textarea
                        value={newApplyInvoice.note}
                        onChange={(e) => setNewApplyInvoice((cur) => ({ ...cur, note: e.target.value }))}
                        className="mt-1 min-h-20 w-full rounded-md border bg-white px-2 py-2"
                        placeholder={pick("Credit 적용 관련 메모", "Credit application note")}
                      />
                    </label>
                  </div>
                </div>
              )}
              <label className="block text-xs font-medium">
                Applied Date
                <input type="date" value={applyDate} onChange={(e) => setApplyDate(e.target.value)} className="mt-1 h-9 w-full rounded-md border px-2" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setApplyTargets([])} className="rounded-md border px-3 py-2 text-sm">
                {pick("취소", "Cancel")}
              </button>
              <button type="button" disabled={applying} onClick={() => void submitApply()} className="rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#174fbf] disabled:opacity-50">
                {applying ? pick("처리 중...", "Applying...") : applyMode === "new" ? pick("생성 후 적용", "Create & Apply") : pick("적용 완료", "Apply")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
