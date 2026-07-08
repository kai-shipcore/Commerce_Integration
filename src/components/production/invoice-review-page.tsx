"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Plus, RefreshCcw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiPath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { InvoiceStepper, type InvoiceStatus } from "@/components/production/invoice-stepper";

type Factory = { id: string; factoryName: string; factoryCode: string | null };

type Bucket = "pending_review" | "issue_found" | "waiting_factory" | "approved" | "signed" | "sent";

const BUCKETS: Array<{ key: Bucket; ko: string; en: string; color: string }> = [
  { key: "pending_review", ko: "Pending Review", en: "Pending Review", color: "#9b9189" },
  { key: "issue_found", ko: "Issue Found", en: "Issue Found", color: "#c42b2b" },
  { key: "waiting_factory", ko: "Waiting Factory", en: "Waiting Factory", color: "#c07a1e" },
  { key: "approved", ko: "Approved", en: "Approved", color: "#1a5cdb" },
  { key: "signed", ko: "Signed", en: "Signed", color: "#16a34a" },
  { key: "sent", ko: "Sent", en: "Sent", color: "#0a8f5b" },
];

const STATUS_TO_BUCKET: Record<InvoiceStatus, Bucket> = {
  received: "pending_review",
  price_review: "pending_review",
  discrepancy_found: "issue_found",
  factory_confirmation: "waiting_factory",
  approved: "approved",
  signed: "signed",
  sent_to_factory: "sent",
};

const BUCKET_BADGE_CLASS: Record<Bucket, string> = {
  pending_review: "bg-[#f0eee9] text-[#57534a]",
  issue_found: "bg-[#fff5f5] text-[#c42b2b]",
  waiting_factory: "bg-[#fef3e2] text-[#8a5300]",
  approved: "bg-[#ebf0fd] text-[#1a4db0]",
  signed: "bg-[#e6f7ee] text-[#166534]",
  sent: "bg-[#e6f7ee] text-[#0a5e45]",
};

const STATUS_OPTIONS: Array<{ value: InvoiceStatus; ko: string; en: string }> = [
  { value: "received", ko: "수신", en: "Received" },
  { value: "price_review", ko: "가격 검수", en: "Price Review" },
  { value: "discrepancy_found", ko: "오류 발견", en: "Discrepancy Found" },
  { value: "factory_confirmation", ko: "공장 확인 대기", en: "Factory Confirmation" },
  { value: "approved", ko: "승인", en: "Approved" },
  { value: "signed", ko: "서명 완료", en: "Signed" },
  { value: "sent_to_factory", ko: "공장 전달 완료", en: "Sent to Factory" },
];

type InvoiceListItem = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  status: InvoiceStatus;
  factoryName: string;
  containerNumber: string | null;
  errorCount: number;
  invoicePriceTotal: number;
};

type InvoiceItemRow = {
  id: string;
  sku: string;
  qty: number;
  invoiceUnitPrice: number;
  expectedUnitPrice: number | null;
  expectedEffectiveDate: string | null;
  diffUnitPrice: number | null;
  result: "match" | "price_error" | "overcharged" | "no_price_history";
  creditStatus: "requested" | "confirmed" | "applied" | null;
  creditAmount: number | null;
  factoryConfirmRequestedAt: string | null;
  factoryConfirmConfirmedAt: string | null;
};

type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  factoryId: string;
  factoryName: string;
  containerId: string | null;
  containerNumber: string | null;
  invoiceDate: string | null;
  status: InvoiceStatus;
  attachmentFileId: string | null;
  signedAttachmentFileId: string | null;
  signedBy: string | null;
  signedAt: string | null;
  lastComparedAt: string | null;
  note: string | null;
  items: InvoiceItemRow[];
};

type NewInvoiceForm = {
  factoryId: string;
  containerNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
};

const emptyNewInvoice: NewInvoiceForm = {
  factoryId: "",
  containerNumber: "",
  invoiceNumber: "",
  invoiceDate: new Date().toISOString().slice(0, 10),
};

type NewLineForm = { sku: string; qty: string; unitPrice: string };
const emptyNewLine: NewLineForm = { sku: "", qty: "1", unitPrice: "" };

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function signedMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${money(value)}`;
}

const RESULT_BADGE: Record<InvoiceItemRow["result"], string> = {
  match: "bg-[#e6f7ee] text-[#166534]",
  price_error: "bg-[#fef3e2] text-[#8a5300]",
  overcharged: "bg-[#fff5f5] text-[#c42b2b]",
  no_price_history: "bg-[#f0eee9] text-[#6b6359]",
};

export function InvoiceReviewPage() {
  const { pick } = useI18n();
  const { can, ready } = usePermissions();
  const canCreate = ready && can("invoice-price-control", "create");
  const canEdit = ready && can("invoice-price-control", "edit");
  const canDelete = ready && can("invoice-price-control", "delete");

  const [factories, setFactories] = useState<Factory[]>([]);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [bucketCounts, setBucketCounts] = useState<Record<string, number>>({});
  const [bucketFilter, setBucketFilter] = useState<Set<Bucket>>(new Set());
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newInvoice, setNewInvoice] = useState<NewInvoiceForm>(emptyNewInvoice);
  const [showLineForm, setShowLineForm] = useState(false);
  const [newLine, setNewLine] = useState<NewLineForm>(emptyNewLine);
  const [recomparing, setRecomparing] = useState(false);
  const [uploadingImport, setUploadingImport] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const importFileRef = useRef<HTMLInputElement>(null);
  const attachmentFileRef = useRef<HTMLInputElement>(null);

  async function loadFactories() {
    const res = await fetch(apiPath("/api/production/price-history?mode=factories&active=true"), { cache: "no-store" });
    const json = await res.json();
    if (json.success) {
      setFactories(json.data);
      setNewInvoice((cur) => ({ ...cur, factoryId: cur.factoryId || json.data[0]?.id || "" }));
    }
  }

  async function loadInvoices() {
    setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (bucketFilter.size > 0) params.set("buckets", [...bucketFilter].join(","));
      const res = await fetch(apiPath(`/api/production/invoices?${params.toString()}`), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || pick("Invoice 목록을 불러오지 못했습니다.", "Failed to load invoices"));
      setInvoices(json.data.invoices);
      setBucketCounts(json.data.bucketCounts);
      setExpandedId((current) => (current && json.data.invoices.some((inv: InvoiceListItem) => inv.id === current) ? current : null));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("Invoice 목록을 불러오지 못했습니다.", "Failed to load invoices"));
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(id: string) {
    setLoadingDetail(true);
    try {
      const res = await fetch(apiPath(`/api/production/invoices/${id}`), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || pick("Invoice 상세를 불러오지 못했습니다.", "Failed to load invoice detail"));
      setDetail(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("Invoice 상세를 불러오지 못했습니다.", "Failed to load invoice detail"));
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFactories();
  }, []);

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, bucketFilter]);

  useEffect(() => {
    if (expandedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDetail(expandedId);
    } else {
      setDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId]);

  function toggleBucket(bucket: Bucket) {
    setBucketFilter((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }

  async function refreshBoth() {
    await loadInvoices();
    if (expandedId) await loadDetail(expandedId);
  }

  async function createInvoice() {
    if (!canCreate) return toast.error(pick("Invoice를 등록할 권한이 없습니다.", "No permission to create invoices"));
    if (!newInvoice.factoryId || !newInvoice.invoiceNumber.trim() || !newInvoice.invoiceDate) {
      toast.error(pick("공장, Invoice 번호, Invoice 날짜는 필수입니다.", "Factory, invoice number, and invoice date are required"));
      return;
    }
    const res = await fetch(apiPath("/api/production/invoices"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        factoryId: newInvoice.factoryId,
        containerNumber: newInvoice.containerNumber.trim() || undefined,
        invoiceNumber: newInvoice.invoiceNumber.trim(),
        invoiceDate: newInvoice.invoiceDate,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("Invoice 등록에 실패했습니다.", "Failed to create invoice"));
      return;
    }
    toast.success(pick("Invoice가 등록되었습니다.", "Invoice created"));
    setShowCreateForm(false);
    setNewInvoice({ ...emptyNewInvoice, factoryId: newInvoice.factoryId });
    await loadInvoices();
    setExpandedId(json.data.id);
  }

  async function addLine() {
    if (!detail) return;
    if (!canCreate) return toast.error(pick("라인을 추가할 권한이 없습니다.", "No permission to add lines"));
    const qty = Number.parseInt(newLine.qty, 10);
    const unitPrice = Number(newLine.unitPrice);
    if (!newLine.sku.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error(pick("SKU, 수량, 단가를 올바르게 입력하세요.", "Enter a valid SKU, quantity, and unit price"));
      return;
    }
    const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/items`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: newLine.sku.trim().toUpperCase(), qty, unitPrice }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("라인 추가에 실패했습니다.", "Failed to add line"));
      return;
    }
    toast.success(pick("라인이 추가되었습니다.", "Line added"));
    setNewLine(emptyNewLine);
    setShowLineForm(false);
    await refreshBoth();
  }

  async function deleteLine(itemId: string) {
    if (!detail) return;
    if (!canDelete) return toast.error(pick("라인을 삭제할 권한이 없습니다.", "No permission to delete lines"));
    if (!window.confirm(pick("이 라인을 삭제할까요?", "Delete this line?"))) return;
    const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/items/${itemId}`), { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("삭제에 실패했습니다.", "Failed to delete"));
      return;
    }
    await refreshBoth();
  }

  async function updateCreditStatus(itemId: string, creditStatus: "requested" | "confirmed" | "applied") {
    if (!detail) return;
    if (!canEdit) return toast.error(pick("Credit 상태를 변경할 권한이 없습니다.", "No permission to update credit status"));
    const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/items/${itemId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creditStatus }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("Credit 상태 변경에 실패했습니다.", "Failed to update credit status"));
      return;
    }
    await refreshBoth();
  }

  async function updateFactoryConfirm(itemId: string, factoryConfirmAction: "request" | "confirm") {
    if (!detail) return;
    if (!canEdit) return toast.error(pick("공장 확인 상태를 변경할 권한이 없습니다.", "No permission to update factory confirmation"));
    const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/items/${itemId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factoryConfirmAction }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("공장 확인 상태 변경에 실패했습니다.", "Failed to update factory confirmation"));
      return;
    }
    await refreshBoth();
  }

  async function changeStatus(status: InvoiceStatus) {
    if (!detail) return;
    if (!canEdit) return toast.error(pick("상태를 변경할 권한이 없습니다.", "No permission to change status"));
    const res = await fetch(apiPath(`/api/production/invoices/${detail.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("상태 변경에 실패했습니다.", "Failed to change status"));
      return;
    }
    toast.success(pick("상태가 변경되었습니다.", "Status updated"));
    await refreshBoth();
  }

  async function recompare() {
    if (!detail) return;
    if (!canEdit) return toast.error(pick("재검수할 권한이 없습니다.", "No permission to recompare"));
    setRecomparing(true);
    try {
      const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/recompare`), { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("재검수에 실패했습니다.", "Recompare failed"));
      toast.success(pick("Price History와 다시 대조했습니다.", "Recompared against price history"));
      await refreshBoth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("재검수에 실패했습니다.", "Recompare failed"));
    } finally {
      setRecomparing(false);
    }
  }

  async function importExcel(file: File) {
    if (!detail) return;
    if (!canCreate) return toast.error(pick("가져오기 권한이 없습니다.", "No permission to import"));
    setUploadingImport(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/items/import`), { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("가져오기에 실패했습니다.", "Import failed"));
      const errors = json.data?.errors ?? [];
      toast.success(pick(
        `${json.data?.imported ?? 0}개 라인을 가져왔습니다${errors.length ? `, ${errors.length}개 건너뜀` : ""}`,
        `Imported ${json.data?.imported ?? 0} lines${errors.length ? `, ${errors.length} skipped` : ""}`
      ));
      if (errors.length) console.warn("Invoice import errors", errors);
      await refreshBoth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("가져오기에 실패했습니다.", "Import failed"));
    } finally {
      setUploadingImport(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  async function uploadAttachment(file: File, signed: boolean) {
    if (!detail) return;
    if (!canEdit) return toast.error(pick("첨부 권한이 없습니다.", "No permission to attach files"));
    setUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/attachment?signed=${signed}`), { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("첨부에 실패했습니다.", "Attachment upload failed"));
      toast.success(pick("파일이 첨부되었습니다.", "File attached"));
      await refreshBoth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("첨부에 실패했습니다.", "Attachment upload failed"));
    } finally {
      setUploadingAttachment(false);
      if (attachmentFileRef.current) attachmentFileRef.current.value = "";
    }
  }

  const totals = useMemo(() => {
    if (!detail) return { invoiceTotal: 0, expectedTotal: 0, netDiff: 0 };
    return detail.items.reduce(
      (acc, item) => {
        acc.invoiceTotal += item.qty * item.invoiceUnitPrice;
        if (item.expectedUnitPrice != null) acc.expectedTotal += item.qty * item.expectedUnitPrice;
        if (item.diffUnitPrice != null) acc.netDiff += item.qty * item.diffUnitPrice;
        return acc;
      },
      { invoiceTotal: 0, expectedTotal: 0, netDiff: 0 },
    );
  }, [detail]);

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#f6f7f9] px-5 py-5 text-[#1a1917]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{pick("Invoices", "Invoices")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {pick(
                "공장에서 수신한 Invoice를 검수 상태로 관리합니다. Packing List는 가격 정보 없이 별도로 조회할 수 있습니다.",
                "Track factory-received invoices through the review workflow. Packing lists without pricing can be viewed separately.",
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#174fbf] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {pick("Invoice 추가", "Add Invoice")}
          </button>
        </div>

        {showCreateForm ? (
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-5">
              <label className="block text-xs font-medium md:col-span-1">
                {pick("공장", "Factory")}
                <select
                  value={newInvoice.factoryId}
                  onChange={(e) => setNewInvoice((cur) => ({ ...cur, factoryId: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border px-2"
                >
                  <option value="">{pick("선택", "Select")}</option>
                  {factories.map((factory) => (
                    <option key={factory.id} value={factory.id}>{factory.factoryName}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium">
                {pick("Invoice 번호", "Invoice Number")}
                <input
                  value={newInvoice.invoiceNumber}
                  onChange={(e) => setNewInvoice((cur) => ({ ...cur, invoiceNumber: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border px-2 font-mono"
                  placeholder="INV-20260910-A"
                />
              </label>
              <label className="block text-xs font-medium">
                {pick("컨테이너 번호", "Container Number")}
                <input
                  value={newInvoice.containerNumber}
                  onChange={(e) => setNewInvoice((cur) => ({ ...cur, containerNumber: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border px-2 font-mono"
                  placeholder="190CA-0912"
                />
              </label>
              <label className="block text-xs font-medium">
                {pick("Invoice 날짜", "Invoice Date")}
                <input
                  type="date"
                  value={newInvoice.invoiceDate}
                  onChange={(e) => setNewInvoice((cur) => ({ ...cur, invoiceDate: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border px-2"
                />
              </label>
              <div className="flex items-end gap-2">
                <button type="button" onClick={() => void createInvoice()} className="h-9 flex-1 rounded-md bg-[#111827] px-3 text-sm font-medium text-white">
                  {pick("저장", "Save")}
                </button>
                <button type="button" onClick={() => setShowCreateForm(false)} className="h-9 rounded-md border px-3 text-sm">
                  {pick("취소", "Cancel")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          {/* Left: invoice list */}
          <div className="flex min-w-0 flex-col rounded-lg border bg-white shadow-sm">
            <div className="border-b p-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void loadInvoices(); }}
                placeholder={pick("Invoice, 공장, 컨테이너 검색", "Search invoice, factory, container")}
                className="h-9 w-full rounded-md border px-3 text-sm"
              />
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setBucketFilter(new Set())}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    bucketFilter.size === 0 ? "bg-[#1a1917] text-white" : "bg-[#f0eee9] text-[#57534a] hover:bg-[#e7e4dc]"
                  }`}
                >
                  {pick("전체", "All")} {bucketCounts.all ?? 0}
                </button>
                {BUCKETS.map((bucket) => (
                  <button
                    key={bucket.key}
                    type="button"
                    onClick={() => toggleBucket(bucket.key)}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      bucketFilter.has(bucket.key) ? "ring-1 ring-inset ring-[#1a5cdb]" : "hover:bg-[#f0eee9]"
                    } ${BUCKET_BADGE_CLASS[bucket.key]}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: bucket.color }} />
                    {pick(bucket.ko, bucket.en)} {bucketCounts[bucket.key] ?? 0}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[720px] overflow-y-auto">
              {loadingList ? (
                <div className="p-6 text-center text-xs text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
              ) : invoices.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">{pick("Invoice가 없습니다.", "No invoices found.")}</div>
              ) : (
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="sticky top-0 bg-[#fafaf7] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">{pick("Invoice", "Invoice")}</th>
                      <th className="px-3 py-2">{pick("공장", "Factory")}</th>
                      <th className="px-3 py-2">{pick("컨테이너", "Container")}</th>
                      <th className="px-3 py-2">{pick("날짜", "Date")}</th>
                      <th className="px-3 py-2">{pick("상태", "Status")}</th>
                      <th className="px-3 py-2 text-center">{pick("오류", "Errors")}</th>
                      <th className="px-3 py-2 text-right">{pick("금액", "Price")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => {
                      const bucket = STATUS_TO_BUCKET[invoice.status];
                      const bucketLabel = BUCKETS.find((b) => b.key === bucket);
                      return (
                        <tr
                          key={invoice.id}
                          onClick={() => setExpandedId(invoice.id)}
                          className={`cursor-pointer border-t hover:bg-[#faf8f2] ${expandedId === invoice.id ? "bg-[#ebf0fd]" : ""}`}
                        >
                          <td className="px-3 py-2 font-mono font-semibold">{invoice.invoiceNumber}</td>
                          <td className="max-w-28 truncate px-3 py-2">{invoice.factoryName}</td>
                          <td className="px-3 py-2 font-mono">{invoice.containerNumber || "-"}</td>
                          <td className="px-3 py-2 font-mono">{invoice.invoiceDate}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${BUCKET_BADGE_CLASS[bucket]}`}>
                              {bucketLabel ? pick(bucketLabel.ko, bucketLabel.en) : invoice.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {invoice.errorCount > 0 ? (
                              <span className="inline-flex rounded-full bg-[#fff5f5] px-2 py-0.5 font-bold text-[#c42b2b]">{invoice.errorCount}건</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{money(invoice.invoicePriceTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div className="min-w-0 rounded-lg border bg-white shadow-sm">
            {!detail ? (
              <div className="flex h-full min-h-[400px] items-center justify-center text-sm text-muted-foreground">
                {loadingDetail ? pick("불러오는 중...", "Loading...") : pick("왼쪽 목록에서 Invoice를 선택하세요.", "Select an invoice from the list on the left.")}
              </div>
            ) : (
              <div className="flex flex-col gap-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{detail.invoiceNumber}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {detail.factoryName} · {detail.containerNumber ? `Container ${detail.containerNumber}` : pick("컨테이너 없음", "No container")} · {pick("Invoice Date", "Invoice Date")} {detail.invoiceDate}
                    </p>
                  </div>
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${BUCKET_BADGE_CLASS[STATUS_TO_BUCKET[detail.status]]}`}>
                    {(() => {
                      const b = BUCKETS.find((x) => x.key === STATUS_TO_BUCKET[detail.status]);
                      return b ? pick(b.ko, b.en) : detail.status;
                    })()}
                  </span>
                </div>

                <div className="rounded-lg border bg-[#fafaf7] p-4">
                  <div className="mb-3 text-xs font-semibold uppercase text-muted-foreground">{pick("검수 진행 상태", "Review Progress")}</div>
                  <InvoiceStepper status={detail.status} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">{pick("상태 변경", "Change status")}</label>
                  <select
                    value={detail.status}
                    disabled={!canEdit}
                    onChange={(e) => void changeStatus(e.target.value as InvoiceStatus)}
                    className="h-8 rounded-md border px-2 text-xs disabled:opacity-50"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{pick(option.ko, option.en)}</option>
                    ))}
                  </select>
                  {detail.signedBy ? (
                    <span className="text-xs text-muted-foreground">
                      {pick("서명자", "Signed by")}: {detail.signedBy}{detail.signedAt ? ` (${detail.signedAt.slice(0, 10)})` : ""}
                    </span>
                  ) : null}
                  {detail.lastComparedAt ? (
                    <span className="text-xs text-muted-foreground">
                      {pick("최근 재검수", "Last recompared")}: {detail.lastComparedAt.slice(0, 16).replace("T", " ")}
                    </span>
                  ) : null}

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void importExcel(f); }}
                    />
                    <button
                      type="button"
                      disabled={uploadingImport || !canCreate}
                      onClick={() => importFileRef.current?.click()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      <FileUp className="h-3.5 w-3.5" /> {uploadingImport ? pick("업로드 중...", "Uploading...") : pick("Excel 업로드", "Excel Upload")}
                    </button>
                    <button
                      type="button"
                      disabled={recomparing}
                      onClick={() => void recompare()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCcw className={`h-3.5 w-3.5 ${recomparing ? "animate-spin" : ""}`} /> {pick("재검수", "Recompare")}
                    </button>
                    <input
                      ref={attachmentFileRef}
                      type="file"
                      accept=".pdf,.xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAttachment(f, detail.status === "signed" || detail.status === "sent_to_factory"); }}
                    />
                    <button
                      type="button"
                      disabled={uploadingAttachment || !canEdit}
                      onClick={() => attachmentFileRef.current?.click()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Upload className="h-3.5 w-3.5" /> {pick("파일 첨부", "Attach File")}
                    </button>
                    {detail.attachmentFileId ? (
                      <a
                        className="text-xs text-[#1a5cdb] hover:underline"
                        href={apiPath(`/api/production/price-history/files/${detail.attachmentFileId}`)}
                      >
                        {pick("원본 다운로드", "Download original")}
                      </a>
                    ) : null}
                    {detail.signedAttachmentFileId ? (
                      <a
                        className="text-xs text-[#1a5cdb] hover:underline"
                        href={apiPath(`/api/production/price-history/files/${detail.signedAttachmentFileId}`)}
                      >
                        {pick("서명본 다운로드", "Download signed")}
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold">{pick("SKU별 가격 검수", "SKU Price Review")}</div>
                      <div className="text-xs text-muted-foreground">
                        {pick(`Invoice Date(${detail.invoiceDate}) 기준 Price History와 자동 대조`, `Auto-compared against Price History as of ${detail.invoiceDate}`)}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canCreate}
                      onClick={() => setShowLineForm((v) => !v)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> {pick("라인 추가", "Add Line")}
                    </button>
                  </div>

                  {showLineForm ? (
                    <div className="flex flex-wrap items-end gap-2 border-b bg-[#fafaf7] px-4 py-3">
                      <label className="text-xs font-medium">
                        SKU
                        <input
                          value={newLine.sku}
                          onChange={(e) => setNewLine((cur) => ({ ...cur, sku: e.target.value.toUpperCase() }))}
                          className="mt-1 block h-8 w-36 rounded-md border px-2 font-mono text-xs"
                        />
                      </label>
                      <label className="text-xs font-medium">
                        {pick("수량", "Qty")}
                        <input
                          type="number"
                          value={newLine.qty}
                          onChange={(e) => setNewLine((cur) => ({ ...cur, qty: e.target.value }))}
                          className="mt-1 block h-8 w-20 rounded-md border px-2 text-xs"
                        />
                      </label>
                      <label className="text-xs font-medium">
                        {pick("Invoice 단가", "Invoice Price")}
                        <input
                          type="number"
                          step="0.0001"
                          value={newLine.unitPrice}
                          onChange={(e) => setNewLine((cur) => ({ ...cur, unitPrice: e.target.value }))}
                          className="mt-1 block h-8 w-28 rounded-md border px-2 text-xs"
                        />
                      </label>
                      <button type="button" onClick={() => void addLine()} className="h-8 rounded-md bg-[#111827] px-3 text-xs font-medium text-white">
                        {pick("추가", "Add")}
                      </button>
                    </div>
                  ) : null}

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-[#fafaf7] text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2 text-right">{pick("수량", "Qty")}</th>
                          <th className="px-3 py-2 text-right">{pick("Invoice 가격", "Invoice Price")}</th>
                          <th className="px-3 py-2 text-right">{pick("기대 가격", "Expected Price")}</th>
                          <th className="px-3 py-2 text-right">{pick("차액", "Diff")}</th>
                          <th className="px-3 py-2">{pick("결과", "Result")}</th>
                          <th className="px-3 py-2 text-right">{pick("작업", "Action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item) => (
                          <tr key={item.id} className="border-t hover:bg-[#faf8f2]">
                            <td className="px-3 py-2 font-mono font-semibold">{item.sku}</td>
                            <td className="px-3 py-2 text-right">{item.qty}</td>
                            <td className="px-3 py-2 text-right">{money(item.invoiceUnitPrice)}</td>
                            <td className="px-3 py-2 text-right">{money(item.expectedUnitPrice)}</td>
                            <td
                              className={`px-3 py-2 text-right font-semibold ${
                                item.diffUnitPrice == null ? "text-muted-foreground" : item.diffUnitPrice > 0 ? "text-[#c42b2b]" : item.diffUnitPrice < 0 ? "text-[#8a5300]" : ""
                              }`}
                            >
                              {item.diffUnitPrice == null ? "-" : signedMoney(item.diffUnitPrice)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-bold ${RESULT_BADGE[item.result]}`}>
                                {item.result === "match" && pick("일치", "Match")}
                                {item.result === "price_error" && pick("가격 오류", "Price Error")}
                                {item.result === "overcharged" && pick("과청구", "Overcharged")}
                                {item.result === "no_price_history" && pick("가격 이력 없음", "No Price History")}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {item.result === "price_error" ? (
                                  item.factoryConfirmConfirmedAt ? (
                                    <span className="rounded bg-[#e6f7ee] px-2 py-1 text-[11px] font-semibold text-[#166534]">{pick("공장 확인 완료", "Factory confirmed")}</span>
                                  ) : item.factoryConfirmRequestedAt ? (
                                    <button
                                      type="button"
                                      disabled={!canEdit}
                                      onClick={() => void updateFactoryConfirm(item.id, "confirm")}
                                      className="rounded border px-2 py-1 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      {pick("확인 완료로 표시", "Mark confirmed")}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={!canEdit}
                                      onClick={() => void updateFactoryConfirm(item.id, "request")}
                                      className="rounded border px-2 py-1 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      {pick("공장 확인 요청", "Request factory confirmation")}
                                    </button>
                                  )
                                ) : null}
                                {item.result === "overcharged" ? (
                                  item.creditStatus === "applied" ? (
                                    <span className="rounded bg-[#e6f7ee] px-2 py-1 text-[11px] font-semibold text-[#166534]">
                                      {pick("Credit 적용 완료", "Credit applied")} {money(item.creditAmount)}
                                    </span>
                                  ) : item.creditStatus === "confirmed" ? (
                                    <button
                                      type="button"
                                      disabled={!canEdit}
                                      onClick={() => void updateCreditStatus(item.id, "applied")}
                                      className="rounded border border-[#1a5cdb] px-2 py-1 text-[11px] font-medium text-[#1a5cdb] hover:bg-[#ebf0fd] disabled:opacity-50"
                                    >
                                      {pick("적용 완료로 표시", "Mark applied")} {money(item.creditAmount)}
                                    </button>
                                  ) : item.creditStatus === "requested" ? (
                                    <button
                                      type="button"
                                      disabled={!canEdit}
                                      onClick={() => void updateCreditStatus(item.id, "confirmed")}
                                      className="rounded border border-[#1a5cdb] px-2 py-1 text-[11px] font-medium text-[#1a5cdb] hover:bg-[#ebf0fd] disabled:opacity-50"
                                    >
                                      {pick("Credit 확정", "Confirm credit")} {money(item.creditAmount)}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={!canEdit}
                                      onClick={() => void updateCreditStatus(item.id, "requested")}
                                      className="rounded bg-[#1a5cdb] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#174fbf] disabled:opacity-50"
                                    >
                                      {pick("Credit 확인 요청", "Request credit")} {money(item.creditAmount)}
                                    </button>
                                  )
                                ) : null}
                                <button
                                  type="button"
                                  disabled={!canDelete}
                                  onClick={() => void deleteLine(item.id)}
                                  className="rounded border px-1.5 py-1 text-red-600 disabled:opacity-40"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {detail.items.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                              {pick("라인이 없습니다. 라인 추가 또는 Excel 업로드로 SKU를 등록하세요.", "No lines yet. Add a line or upload an Excel file.")}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                      {detail.items.length > 0 ? (
                        <tfoot>
                          <tr className="border-t bg-[#fafaf7] font-semibold">
                            <td className="px-3 py-2" colSpan={2}>{pick("합계", "Total")}</td>
                            <td className="px-3 py-2 text-right">{money(totals.invoiceTotal)}</td>
                            <td className="px-3 py-2 text-right">{money(totals.expectedTotal)}</td>
                            <td className={`px-3 py-2 text-right ${totals.netDiff > 0 ? "text-[#c42b2b]" : totals.netDiff < 0 ? "text-[#8a5300]" : ""}`}>
                              {signedMoney(totals.netDiff)}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      ) : null}
                    </table>
                  </div>
                  {detail.items.length > 0 ? (
                    <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                      {pick(
                        `순차액 ${signedMoney(totals.netDiff)}은 당사에 유리합니다 (과청구 - 미청구). 가격 이력 없음 항목은 재검수로 다시 대조할 수 있습니다.`,
                        `Net difference ${signedMoney(totals.netDiff)} favors us (overcharged - underbilled). Lines with no price history can be re-checked via Recompare.`,
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
