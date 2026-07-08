"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileUp, History, Pencil, Plus, RefreshCcw, ScrollText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiPath, withBasePath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { InvoiceStepper, type InvoiceStatus } from "@/components/production/invoice-stepper";

type Factory = { id: string; factoryName: string; factoryCode: string | null };

type Bucket = "pending_review" | "hold" | "reviewed";

const BUCKETS: Array<{ key: Bucket; ko: string; en: string; color: string }> = [
  { key: "pending_review", ko: "미검수", en: "Pending Review", color: "#9b9189" },
  { key: "hold", ko: "보류", en: "On Hold", color: "#c07a1e" },
  { key: "reviewed", ko: "검수완료", en: "Reviewed", color: "#16a34a" },
];

const STATUS_TO_BUCKET: Record<InvoiceStatus, Bucket> = {
  received: "pending_review",
  price_review: "pending_review",
  discrepancy_found: "pending_review",
  factory_confirmation: "hold",
  approved: "reviewed",
  signed: "reviewed",
  sent_to_factory: "reviewed",
};

const BUCKET_BADGE_CLASS: Record<Bucket, string> = {
  pending_review: "bg-[#f0eee9] text-[#57534a]",
  hold: "bg-[#fef3e2] text-[#8a5300]",
  reviewed: "bg-[#e6f7ee] text-[#166534]",
};

const STATUS_OPTIONS: Array<{ value: InvoiceStatus; ko: string; en: string }> = [
  { value: "price_review", ko: "미검수", en: "Pending Review" },
  { value: "factory_confirmation", ko: "보류", en: "On Hold" },
  { value: "approved", ko: "검수완료", en: "Reviewed" },
];

function normalizeReviewStatus(status: InvoiceStatus): InvoiceStatus {
  if (status === "factory_confirmation") return "factory_confirmation";
  if (status === "approved" || status === "signed" || status === "sent_to_factory") return "approved";
  return "price_review";
}

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

type InvoiceImportBatch = {
  sourceFileId: string;
  originalName: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
  rowCount: number;
  skuCount: number;
  totalQty: number;
  invoiceTotal: number;
  errorCount: number;
};

type InvoiceImportImpact = {
  sourceFileId: string;
  originalName: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
  items: InvoiceItemRow[];
};

type InvoiceAuditEntry = {
  id: string;
  action: string;
  userName: string | null;
  userEmail: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  createdAt: string;
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

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return value.slice(0, 16).replace("T", " ");
}

const RESULT_BADGE: Record<InvoiceItemRow["result"], string> = {
  match: "bg-[#e6f7ee] text-[#166534]",
  price_error: "bg-[#fef3e2] text-[#8a5300]",
  overcharged: "bg-[#fff5f5] text-[#c42b2b]",
  no_price_history: "bg-[#f0eee9] text-[#6b6359]",
};

function isExportableDifference(item: InvoiceItemRow) {
  return item.result === "price_error" || item.result === "overcharged" || item.result === "no_price_history";
}

const AUDIT_ACTION_LABEL: Record<string, { ko: string; en: string }> = {
  create: { ko: "생성", en: "Created" },
  delete: { ko: "삭제", en: "Deleted" },
  status_change: { ko: "상태 변경", en: "Status changed" },
  details_update: { ko: "정보 수정", en: "Details updated" },
  items_update: { ko: "라인 수정", en: "Line updated" },
  recompare: { ko: "재검수", en: "Recompared" },
  credit_update: { ko: "Credit 상태 변경", en: "Credit status changed" },
  factory_confirm_update: { ko: "공장 확인 상태 변경", en: "Factory confirmation changed" },
  attachment_update: { ko: "첨부파일 변경", en: "Attachment updated" },
};

function auditValueText(value: unknown) {
  if (value == null || value === "") return "-";
  return String(value);
}

function summarizeAuditEntry(entry: InvoiceAuditEntry) {
  switch (entry.action) {
    case "status_change":
      return `${auditValueText(entry.before?.status)} → ${auditValueText(entry.after?.status)}`;
    case "credit_update":
      return `Credit: ${auditValueText(entry.after?.creditStatus)}`;
    case "factory_confirm_update":
      return `공장 확인: ${auditValueText(entry.after?.action)}`;
    case "attachment_update":
      return entry.after?.signed ? "서명본 첨부" : "원본 첨부";
    case "details_update":
    case "items_update": {
      const keys = Object.keys(entry.after ?? {}).filter(
        (key) => key !== "itemId" && auditValueText(entry.before?.[key]) !== auditValueText(entry.after?.[key])
      );
      const first = keys[0];
      if (!first) return "-";
      return `${first}: ${auditValueText(entry.before?.[first])} → ${auditValueText(entry.after?.[first])}`;
    }
    case "recompare":
      return "재검수 완료";
    case "create":
      return "Invoice 생성";
    case "delete":
      return "Invoice 삭제";
    default:
      return "-";
  }
}

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
  const [showEditForm, setShowEditForm] = useState(false);
  const [editInvoice, setEditInvoice] = useState<NewInvoiceForm>(emptyNewInvoice);
  const [showLineForm, setShowLineForm] = useState(false);
  const [newLine, setNewLine] = useState<NewLineForm>(emptyNewLine);
  const [recomparing, setRecomparing] = useState(false);
  const [uploadingImport, setUploadingImport] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [showImportHistory, setShowImportHistory] = useState(false);
  const [loadingImportHistory, setLoadingImportHistory] = useState(false);
  const [importBatches, setImportBatches] = useState<InvoiceImportBatch[]>([]);
  const [importImpact, setImportImpact] = useState<InvoiceImportImpact | null>(null);
  const [deletingImportBatch, setDeletingImportBatch] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  const [loadingAuditHistory, setLoadingAuditHistory] = useState(false);
  const [auditEntries, setAuditEntries] = useState<InvoiceAuditEntry[]>([]);

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
      if (!json.success) {
        console.error("Failed to load invoices", json.error);
        throw new Error(pick("Invoice 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "Failed to load invoices. Please try again shortly."));
      }
      setInvoices(json.data.invoices);
      setBucketCounts(json.data.bucketCounts);
      setExpandedId((current) => {
        if (current && json.data.invoices.some((inv: InvoiceListItem) => inv.id === current)) return current;
        return json.data.invoices[0]?.id ?? null;
      });
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
    setSelectedItemIds(new Set());
    setShowEditForm(false);
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

  function toggleSelectItem(id: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllDifferenceItems() {
    const selectableIds = (detail?.items ?? []).filter(isExportableDifference).map((item) => item.id);
    setSelectedItemIds((prev) => {
      const allSelected = selectableIds.length > 0 && selectableIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(selectableIds);
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

  async function deleteInvoice() {
    if (!detail) return;
    if (!canDelete) return toast.error(pick("Invoice를 삭제할 권한이 없습니다.", "No permission to delete invoices"));
    if (!window.confirm(pick(`${detail.invoiceNumber} Invoice를 삭제할까요? 등록된 라인도 함께 삭제됩니다.`, `Delete invoice ${detail.invoiceNumber}? Its line items will also be deleted.`))) return;
    const res = await fetch(apiPath(`/api/production/invoices/${detail.id}`), { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("Invoice 삭제에 실패했습니다.", "Failed to delete invoice"));
      return;
    }
    toast.success(pick("Invoice가 삭제되었습니다.", "Invoice deleted"));
    setExpandedId(null);
    await loadInvoices();
  }

  function openEditForm() {
    if (!detail) return;
    setEditInvoice({
      factoryId: detail.factoryId,
      containerNumber: detail.containerNumber ?? "",
      invoiceNumber: detail.invoiceNumber,
      invoiceDate: detail.invoiceDate ?? new Date().toISOString().slice(0, 10),
    });
    setShowEditForm(true);
  }

  async function updateInvoiceDetails() {
    if (!detail) return;
    if (!canEdit) return toast.error(pick("Invoice를 수정할 권한이 없습니다.", "No permission to edit invoices"));
    if (!editInvoice.invoiceNumber.trim() || !editInvoice.invoiceDate) {
      toast.error(pick("Invoice 번호와 Invoice 날짜는 필수입니다.", "Invoice number and invoice date are required"));
      return;
    }
    const res = await fetch(apiPath(`/api/production/invoices/${detail.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceNumber: editInvoice.invoiceNumber.trim(),
        invoiceDate: editInvoice.invoiceDate,
        containerNumber: editInvoice.containerNumber.trim() || undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("Invoice 수정에 실패했습니다.", "Failed to update invoice"));
      return;
    }
    toast.success(pick("Invoice가 수정되었습니다.", "Invoice updated"));
    setShowEditForm(false);
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
      if (showImportHistory) await loadImportBatches(detail.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("가져오기에 실패했습니다.", "Import failed"));
    } finally {
      setUploadingImport(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  function exportSelectedItems() {
    if (!detail) return;
    const selected = detail.items.filter((item) => selectedItemIds.has(item.id) && isExportableDifference(item));
    if (selected.length === 0) {
      toast.error(pick("내보낼 SKU를 선택하세요.", "Select SKU rows to export."));
      return;
    }

    const rows = selected.map((item) => ({
      SKU: item.sku,
      Qty: item.qty,
      "Invoice Price": item.invoiceUnitPrice,
      "Expected Price": item.expectedUnitPrice,
      "Expected Effective Date": item.expectedEffectiveDate,
      "Diff (Unit)": item.diffUnitPrice,
      "Diff (Total)": item.diffUnitPrice == null ? null : item.qty * item.diffUnitPrice,
      Result:
        item.result === "price_error"
          ? "Price Error"
          : item.result === "overcharged"
            ? "Overcharged"
            : "No Price History",
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Selected SKU Differences");
    XLSX.writeFile(workbook, `invoice-${detail.invoiceNumber}-selected-skus-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(pick(`${selected.length}개 SKU를 내보냈습니다.`, `Exported ${selected.length} SKU row(s).`));
  }

  async function loadImportBatches(invoiceId = detail?.id) {
    if (!invoiceId) return;
    setLoadingImportHistory(true);
    try {
      const res = await fetch(apiPath(`/api/production/invoices/${invoiceId}/items/imports`), { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("업로드 이력을 불러오지 못했습니다.", "Failed to load import history"));
      setImportBatches(json.data ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("업로드 이력을 불러오지 못했습니다.", "Failed to load import history"));
    } finally {
      setLoadingImportHistory(false);
    }
  }

  async function openImportHistory() {
    if (!detail) return;
    setShowImportHistory(true);
    setImportImpact(null);
    await loadImportBatches(detail.id);
  }

  async function loadAuditHistory(invoiceId = detail?.id) {
    if (!invoiceId) return;
    setLoadingAuditHistory(true);
    try {
      const params = new URLSearchParams({ entityType: "invoice", entityId: invoiceId, limit: "100" });
      const res = await fetch(apiPath(`/api/admin/audit-log?${params.toString()}`), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || pick("변경 이력을 불러오지 못했습니다.", "Failed to load change history"));
      setAuditEntries(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("변경 이력을 불러오지 못했습니다.", "Failed to load change history"));
    } finally {
      setLoadingAuditHistory(false);
    }
  }

  async function openAuditHistory() {
    if (!detail) return;
    setShowAuditHistory(true);
    await loadAuditHistory(detail.id);
  }

  async function loadImportImpact(sourceFileId: string) {
    if (!detail) return;
    try {
      const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/items/imports/${sourceFileId}`), { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("영향 row를 불러오지 못했습니다.", "Failed to load affected rows"));
      setImportImpact(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("영향 row를 불러오지 못했습니다.", "Failed to load affected rows"));
    }
  }

  async function deleteImportBatch() {
    if (!detail || !importImpact) return;
    if (!canDelete) return toast.error(pick("업로드분을 삭제할 권한이 없습니다.", "No permission to delete import batches"));
    const confirmed = window.confirm(
      pick(
        `${importImpact.originalName} 업로드분을 삭제할까요?\n\n연결된 Invoice 라인 ${importImpact.items.length}개가 함께 삭제됩니다.`,
        `Delete import ${importImpact.originalName}?\n\n${importImpact.items.length} linked invoice line(s) will also be deleted.`,
      ),
    );
    if (!confirmed) return;
    setDeletingImportBatch(true);
    try {
      const res = await fetch(apiPath(`/api/production/invoices/${detail.id}/items/imports/${importImpact.sourceFileId}`), { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("업로드분 삭제에 실패했습니다.", "Failed to delete import batch"));
      toast.success(pick(`${json.data?.deletedRows ?? 0}개 라인을 삭제했습니다.`, `Deleted ${json.data?.deletedRows ?? 0} line(s).`));
      setImportImpact(null);
      await refreshBoth();
      await loadImportBatches(detail.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("업로드분 삭제에 실패했습니다.", "Failed to delete import batch"));
    } finally {
      setDeletingImportBatch(false);
    }
  }

  function downloadInvoiceImportTemplate() {
    const rows = [
      {
        sku: "CA-SC-10-B-10-BK-1TO",
        quantity: 105,
        unit_price: 20.72,
      },
      {
        sku: "CA-SC-10-B-10-GR-1TO",
        quantity: 25,
        unit_price: 20.72,
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Lines");
    XLSX.writeFile(workbook, "invoice-line-import-template.xlsx");
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
    if (!detail) {
      return {
        invoiceTotal: 0,
        expectedTotal: 0,
        netDiff: 0,
        overchargedTotal: 0,
        underchargedTotal: 0,
        mismatchCount: 0,
        noPriceCount: 0,
        matchCount: 0,
      };
    }
    return detail.items.reduce(
      (acc, item) => {
        acc.invoiceTotal += item.qty * item.invoiceUnitPrice;
        if (item.expectedUnitPrice != null) acc.expectedTotal += item.qty * item.expectedUnitPrice;
        if (item.diffUnitPrice != null) {
          const lineDiff = item.qty * item.diffUnitPrice;
          acc.netDiff += lineDiff;
          if (lineDiff > 0) acc.overchargedTotal += lineDiff;
          if (lineDiff < 0) acc.underchargedTotal += Math.abs(lineDiff);
        }
        if (item.result === "match") acc.matchCount += 1;
        if (item.result === "price_error" || item.result === "overcharged") acc.mismatchCount += 1;
        if (item.result === "no_price_history") acc.noPriceCount += 1;
        return acc;
      },
      {
        invoiceTotal: 0,
        expectedTotal: 0,
        netDiff: 0,
        overchargedTotal: 0,
        underchargedTotal: 0,
        mismatchCount: 0,
        noPriceCount: 0,
        matchCount: 0,
      },
    );
  }, [detail]);

  return (
    <div className="flex h-full min-h-0 bg-[#f6f7f9] px-5 py-5 text-[#1a1917]">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{pick("Invoices", "Invoices")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {pick(
                "Invoice의 SKU별 가격을 적용 시점의 기준 단가와 비교하여 검수하고 관리합니다.",
                "Review and manage invoice SKU prices by comparing them with the standard unit price effective at the applicable date.",
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
                <button type="button" onClick={() => void createInvoice()} className="h-9 rounded-md bg-[#111827] px-3 text-sm font-medium text-white">
                  {pick("저장", "Save")}
                </button>
                <button type="button" onClick={() => setShowCreateForm(false)} className="h-9 rounded-md border px-3 text-sm">
                  {pick("취소", "Cancel")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          {/* Left: invoice list */}
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-white shadow-sm">
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
            <div className="min-h-0 flex-1 overflow-auto">
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
                      <th className="whitespace-nowrap px-3 py-2">{pick("컨테이너", "Container")}</th>
                      <th className="px-3 py-2">{pick("날짜", "Date")}</th>
                      <th className="px-3 py-2">{pick("상태", "Status")}</th>
                      <th className="px-3 py-2 text-center">{pick("오류", "Errors")}</th>
                      <th className="px-3 py-2 text-right">{pick("금액", "Price")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => {
                      const bucket = STATUS_TO_BUCKET[normalizeReviewStatus(invoice.status)];
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
          <div className="min-h-0 min-w-0 overflow-auto rounded-lg border bg-white shadow-sm">
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
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${BUCKET_BADGE_CLASS[STATUS_TO_BUCKET[normalizeReviewStatus(detail.status)]]}`}>
                      {(() => {
                        const b = BUCKETS.find((x) => x.key === STATUS_TO_BUCKET[normalizeReviewStatus(detail.status)]);
                        return b ? pick(b.ko, b.en) : detail.status;
                      })()}
                    </span>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => (showEditForm ? setShowEditForm(false) : openEditForm())}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Pencil className="h-3.5 w-3.5" /> {pick("Invoice 수정", "Edit Invoice")}
                    </button>
                    <button
                      type="button"
                      disabled={!canDelete}
                      onClick={() => void deleteInvoice()}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {pick("Invoice 삭제", "Delete Invoice")}
                    </button>
                  </div>
                </div>

                {showEditForm ? (
                  <div className="rounded-lg border bg-white p-4 shadow-sm">
                    <div className="grid gap-3 md:grid-cols-5">
                      <label className="block text-xs font-medium md:col-span-1">
                        {pick("공장", "Factory")}
                        <input
                          value={detail.factoryName}
                          disabled
                          className="mt-1 h-9 w-full rounded-md border bg-slate-50 px-2 text-muted-foreground"
                        />
                      </label>
                      <label className="block text-xs font-medium">
                        {pick("Invoice 번호", "Invoice Number")}
                        <input
                          value={editInvoice.invoiceNumber}
                          onChange={(e) => setEditInvoice((cur) => ({ ...cur, invoiceNumber: e.target.value }))}
                          className="mt-1 h-9 w-full rounded-md border px-2 font-mono"
                          placeholder="INV-20260910-A"
                        />
                      </label>
                      <label className="block text-xs font-medium">
                        {pick("컨테이너 번호", "Container Number")}
                        <input
                          value={editInvoice.containerNumber}
                          onChange={(e) => setEditInvoice((cur) => ({ ...cur, containerNumber: e.target.value }))}
                          className="mt-1 h-9 w-full rounded-md border px-2 font-mono"
                          placeholder="190CA-0912"
                        />
                      </label>
                      <label className="block text-xs font-medium">
                        {pick("Invoice 날짜", "Invoice Date")}
                        <input
                          type="date"
                          value={editInvoice.invoiceDate}
                          onChange={(e) => setEditInvoice((cur) => ({ ...cur, invoiceDate: e.target.value }))}
                          className="mt-1 h-9 w-full rounded-md border px-2"
                        />
                      </label>
                      <div className="flex items-end gap-2">
                        <button type="button" onClick={() => void updateInvoiceDetails()} className="h-9 flex-1 rounded-md bg-[#111827] px-3 text-sm font-medium text-white">
                          {pick("수정", "Update")}
                        </button>
                        <button type="button" onClick={() => setShowEditForm(false)} className="h-9 rounded-md border px-3 text-sm">
                          {pick("취소", "Cancel")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">{pick("상태 변경", "Change status")}</label>
                  <select
                    value={normalizeReviewStatus(detail.status)}
                    disabled={!canEdit}
                    onChange={(e) => void changeStatus(e.target.value as InvoiceStatus)}
                    className="h-8 rounded-md border px-2 text-xs disabled:opacity-50"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{pick(option.ko, option.en)}</option>
                    ))}
                  </select>
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
                      onClick={downloadInvoiceImportTemplate}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" /> {pick("양식", "Template")}
                    </button>
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
                      onClick={() => void openImportHistory()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50"
                    >
                      <History className="h-3.5 w-3.5" /> {pick("업로드 이력", "Import History")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openAuditHistory()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50"
                    >
                      <ScrollText className="h-3.5 w-3.5" /> {pick("변경 이력", "Change History")}
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
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold">{pick("SKU별 가격 검수", "SKU Price Review")}</div>
                      <div className="text-xs text-muted-foreground">
                        {pick(`Invoice Date(${detail.invoiceDate}) 기준 Price History와 자동 대조`, `Auto-compared against Price History as of ${detail.invoiceDate}`)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <div className="w-[320px] max-w-full">
                        <InvoiceStepper status={detail.status} compact />
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
                  </div>

                  {detail.items.length > 0 ? (
                    <div className="grid gap-3 border-b bg-[#fafaf7] p-4 sm:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-md border bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("총 차액", "Net Difference")}</div>
                        <div className={`mt-1 text-lg font-bold ${totals.netDiff > 0 ? "text-[#c42b2b]" : totals.netDiff < 0 ? "text-[#8a5300]" : ""}`}>{signedMoney(totals.netDiff)}</div>
                      </div>
                      <div className="rounded-md border bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("과청구", "Overcharged")}</div>
                        <div className="mt-1 text-lg font-bold text-[#c42b2b]">{money(totals.overchargedTotal)}</div>
                      </div>
                      <div className="rounded-md border bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("미청구/낮은 단가", "Underbilled")}</div>
                        <div className="mt-1 text-lg font-bold text-[#8a5300]">{money(totals.underchargedTotal)}</div>
                      </div>
                      <div className="rounded-md border bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("차이 SKU", "Mismatch SKUs")}</div>
                        <div className="mt-1 text-lg font-bold">{totals.mismatchCount}</div>
                      </div>
                      <div className="rounded-md border bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase text-muted-foreground">{pick("가격 이력 없음", "No Price History")}</div>
                        <div className="mt-1 text-lg font-bold">{totals.noPriceCount}</div>
                      </div>
                    </div>
                  ) : null}

                  {selectedItemIds.size > 0 ? (
                    <div className="flex items-center justify-between gap-3 border-b bg-[#ebf0fd] px-4 py-2.5">
                      <span className="text-xs font-medium text-[#1a4db0]">
                        {pick(`${selectedItemIds.size}개 SKU 선택됨`, `${selectedItemIds.size} SKU row(s) selected`)}
                      </span>
                      <button
                        type="button"
                        onClick={exportSelectedItems}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#1a5cdb] px-2.5 text-xs font-semibold text-white hover:bg-[#174fbf]"
                      >
                        <Download className="h-3.5 w-3.5" /> {pick("선택 항목 내보내기", "Export Selected")}
                      </button>
                    </div>
                  ) : null}

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
                          <th className="w-8 px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={pick("차이가 있는 SKU 전체 선택", "Select all SKU rows with differences")}
                              checked={
                                detail.items.some(isExportableDifference) &&
                                detail.items.filter(isExportableDifference).every((item) => selectedItemIds.has(item.id))
                              }
                              onChange={() => toggleSelectAllDifferenceItems()}
                            />
                          </th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2 text-right">{pick("수량", "Qty")}</th>
                          <th className="px-3 py-2 text-right">{pick("Invoice 가격", "Invoice Price")}</th>
                          <th className="px-3 py-2 text-right">{pick("기대 가격", "Expected Price")}</th>
                          <th className="px-3 py-2 text-right">{pick("단가 차액", "Unit Diff")}</th>
                          <th className="px-3 py-2 text-right">{pick("토탈 차액", "Total Diff")}</th>
                          <th className="px-3 py-2">{pick("결과", "Result")}</th>
                          <th className="px-3 py-2 text-right">{pick("작업", "Action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item) => (
                          <tr
                            key={item.id}
                            title={pick("더블클릭하여 가격 이력 조회", "Double-click to view price history")}
                            onDoubleClick={() =>
                              window.open(
                                withBasePath(`/production/invoice-price-control?tab=price-history&sku=${encodeURIComponent(item.sku)}`),
                                "_blank"
                              )
                            }
                            className="cursor-pointer border-t hover:bg-[#faf8f2]"
                          >
                            <td className="px-3 py-2" onDoubleClick={(e) => e.stopPropagation()}>
                              {isExportableDifference(item) ? (
                                <input
                                  type="checkbox"
                                  aria-label={pick(`${item.sku} 선택`, `Select ${item.sku}`)}
                                  checked={selectedItemIds.has(item.id)}
                                  onChange={() => toggleSelectItem(item.id)}
                                />
                              ) : null}
                            </td>
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
                            <td
                              className={`px-3 py-2 text-right font-semibold ${
                                item.diffUnitPrice == null ? "text-muted-foreground" : item.diffUnitPrice > 0 ? "text-[#c42b2b]" : item.diffUnitPrice < 0 ? "text-[#8a5300]" : ""
                              }`}
                            >
                              {item.diffUnitPrice == null ? "-" : signedMoney(item.qty * item.diffUnitPrice)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-bold ${RESULT_BADGE[item.result]}`}>
                                {item.result === "match" && pick("일치", "Match")}
                                {item.result === "price_error" && pick("가격 오류", "Price Error")}
                                {item.result === "overcharged" && pick("과청구", "Overcharged")}
                                {item.result === "no_price_history" && pick("가격 이력 없음", "No Price History")}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right" onDoubleClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
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
                            <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                              {pick("라인이 없습니다. 라인 추가 또는 Excel 업로드로 SKU를 등록하세요.", "No lines yet. Add a line or upload an Excel file.")}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                      {detail.items.length > 0 ? (
                        <tfoot>
                          <tr className="border-t bg-[#fafaf7] font-semibold">
                            <td className="px-3 py-2" colSpan={3}>{pick("합계", "Total")}</td>
                            <td className="px-3 py-2 text-right">{money(totals.invoiceTotal)}</td>
                            <td className="px-3 py-2 text-right">{money(totals.expectedTotal)}</td>
                            <td />
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
                        `순차액 ${signedMoney(totals.netDiff)}은 과청구 합계에서 미청구/낮은 단가 합계를 뺀 금액입니다. 가격 이력 없음 항목은 재검수로 다시 대조할 수 있습니다.`,
                        `Net difference ${signedMoney(totals.netDiff)} is overcharged total minus underbilled total. Lines with no price history can be re-checked via Recompare.`,
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {showImportHistory ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <div className="text-lg font-semibold">{pick("Invoice Excel 업로드 이력", "Invoice Excel Import History")}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {pick("원본 파일 기준으로 입력된 라인을 확인하고, 잘못 올린 업로드분을 삭제할 수 있습니다.", "Review line items by source file and delete a mistaken import batch.")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowImportHistory(false);
                  setImportImpact(null);
                }}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                {pick("닫기", "Close")}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {!importImpact ? (
                <>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{pick("업로드 파일", "Uploaded Files")}</div>
                    <button
                      type="button"
                      onClick={() => void loadImportBatches()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-medium hover:bg-slate-50"
                    >
                      <RefreshCcw className={`h-3.5 w-3.5 ${loadingImportHistory ? "animate-spin" : ""}`} /> {pick("새로고침", "Refresh")}
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[860px] text-left text-sm">
                      <thead className="bg-[#fafaf7] text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">{pick("파일명", "File")}</th>
                          <th className="px-3 py-2">{pick("업로드일", "Uploaded")}</th>
                          <th className="px-3 py-2">{pick("업로드 ID", "Uploaded By")}</th>
                          <th className="px-3 py-2 text-right">{pick("행", "Rows")}</th>
                          <th className="px-3 py-2 text-right">SKU</th>
                          <th className="px-3 py-2 text-right">{pick("수량", "Qty")}</th>
                          <th className="px-3 py-2 text-right">{pick("금액", "Amount")}</th>
                          <th className="px-3 py-2 text-right">{pick("오류", "Errors")}</th>
                          <th className="px-3 py-2 text-right">{pick("작업", "Action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importBatches.map((batch) => (
                          <tr key={batch.sourceFileId} className="border-t">
                            <td className="max-w-72 px-3 py-2">
                              <a
                                href={apiPath(`/api/production/price-history/files/${batch.sourceFileId}`)}
                                className="block truncate font-semibold text-[#1a5cdb] hover:underline"
                                title={batch.originalName}
                              >
                                {batch.originalName}
                              </a>
                              <div className="text-[11px] text-muted-foreground">source_file_id: {batch.sourceFileId} - {formatBytes(batch.sizeBytes)}</div>
                            </td>
                            <td className="px-3 py-2">{formatDateTime(batch.createdAt)}</td>
                            <td className="px-3 py-2">{batch.uploadedBy || "-"}</td>
                            <td className="px-3 py-2 text-right">{batch.rowCount}</td>
                            <td className="px-3 py-2 text-right">{batch.skuCount}</td>
                            <td className="px-3 py-2 text-right">{batch.totalQty}</td>
                            <td className="px-3 py-2 text-right">{money(batch.invoiceTotal)}</td>
                            <td className="px-3 py-2 text-right">{batch.errorCount}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => void loadImportImpact(batch.sourceFileId)}
                                className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
                              >
                                {pick("영향 row 확인", "Review Rows")}
                              </button>
                            </td>
                          </tr>
                        ))}
                        {importBatches.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                              {loadingImportHistory ? pick("업로드 이력을 불러오는 중입니다.", "Loading import history.") : pick("Excel 업로드 이력이 없습니다.", "No Excel import history.")}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{pick("삭제 전 영향 row 확인", "Review Rows Before Delete")}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {importImpact.originalName} - source_file_id: {importImpact.sourceFileId} - {importImpact.items.length}{pick("개 라인", " rows")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setImportImpact(null)} className="rounded-md border px-3 py-1.5 text-sm">
                        {pick("목록으로", "Back")}
                      </button>
                      <button
                        type="button"
                        disabled={!canDelete || deletingImportBatch}
                        onClick={() => void deleteImportBatch()}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {deletingImportBatch ? pick("삭제 중...", "Deleting...") : pick("이 업로드분 삭제", "Delete This Import")}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-[#fafaf7] text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2 text-right">{pick("수량", "Qty")}</th>
                          <th className="px-3 py-2 text-right">{pick("Invoice 가격", "Invoice Price")}</th>
                          <th className="px-3 py-2 text-right">{pick("기대 가격", "Expected Price")}</th>
                          <th className="px-3 py-2 text-right">{pick("단가 차액", "Unit Diff")}</th>
                          <th className="px-3 py-2 text-right">{pick("토탈 차액", "Total Diff")}</th>
                          <th className="px-3 py-2">{pick("결과", "Result")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importImpact.items.map((item) => (
                          <tr key={item.id} className="border-t">
                            <td className="px-3 py-2 font-mono font-semibold">{item.sku}</td>
                            <td className="px-3 py-2 text-right">{item.qty}</td>
                            <td className="px-3 py-2 text-right">{money(item.invoiceUnitPrice)}</td>
                            <td className="px-3 py-2 text-right">{money(item.expectedUnitPrice)}</td>
                            <td className="px-3 py-2 text-right">{item.diffUnitPrice == null ? "-" : signedMoney(item.diffUnitPrice)}</td>
                            <td className="px-3 py-2 text-right">{item.diffUnitPrice == null ? "-" : signedMoney(item.qty * item.diffUnitPrice)}</td>
                            <td className="px-3 py-2">{item.result}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showAuditHistory ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6">
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <div className="text-lg font-semibold">{pick("Invoice 변경 이력", "Invoice Change History")}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {pick("이 Invoice에 대한 상태/정보 변경 기록입니다.", "Change log for this invoice.")}
                </div>
              </div>
              <button type="button" onClick={() => setShowAuditHistory(false)} className="rounded-md border px-3 py-1.5 text-sm">
                {pick("닫기", "Close")}
              </button>
            </div>
            <div className="overflow-auto p-5">
              {loadingAuditHistory ? (
                <div className="p-6 text-center text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
              ) : auditEntries.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">{pick("변경 이력이 없습니다.", "No change history found.")}</div>
              ) : (
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-[#fafaf7] text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">{pick("일시", "Date")}</th>
                      <th className="px-3 py-2">{pick("사용자", "User")}</th>
                      <th className="px-3 py-2">{pick("변경 유형", "Action")}</th>
                      <th className="px-3 py-2">{pick("내용", "Detail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries.map((entry) => (
                      <tr key={entry.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{formatDateTime(entry.createdAt)}</td>
                        <td className="px-3 py-2">{entry.userName || entry.userEmail || "-"}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex rounded bg-[#f0eee9] px-2 py-0.5 text-[11px] font-semibold text-[#57534a]">
                            {pick(AUDIT_ACTION_LABEL[entry.action]?.ko ?? entry.action, AUDIT_ACTION_LABEL[entry.action]?.en ?? entry.action)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{summarizeAuditEntry(entry)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
