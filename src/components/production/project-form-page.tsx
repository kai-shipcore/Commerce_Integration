"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  PART_STATUS_OPTIONS,
  CHECKLIST_STATUS_OPTIONS,
  partStatusClass,
  checklistStatusClass,
  StatusPill,
} from "@/components/production/status-styles";

type AssignableUser = { id: string; name: string | null; email: string };
type ProductionPartRecord = { id: string; partName: string; seatRow: string | null };
type PartSkuRecord = { id: string; sku: string; partName: string; make: string; model: string; code: string; isActive: boolean };

type ProjectPartRecord = {
  id: string;
  projectId: string;
  cab: string | null;
  code: string | null;
  status: string;
  assignedToUserId: string | null;
  assignedTo: AssignableUser | null;
  photoCount: number;
  docUrl: string | null;
};

type ProductRecord = { id: string; make: string; model: string; fNumber: string | null; yearGeneration: string | null };

type ProjectRecord = {
  id: string;
  productId: string;
  seatRow: string;
  submodel: string | null;
  parts: ProjectPartRecord[];
};

type ChecklistItem = { id: string; description: string; status: string };

type DraftPart = {
  tempId: string;
  cab: string;
  code: string;
  status: string;
  assignedToUserId: string;
  photoCount: number;
  docUrl: string;
};

type DraftChecklistItem = { tempId: string; description: string; status: string };

const SEAT_ROW_OPTIONS = ["Front", "Rear", "Third Row"] as const;

function userLabel(u: AssignableUser): string {
  return u.name || u.email;
}

function rowAbbr(row: string): string {
  if (row === "Front") return "F";
  if (row === "Third Row") return "3R";
  if (row === "Second Row") return "2R";
  return "R";
}

function makeTempId(): string {
  return `draft-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

interface Props {
  mode: "create" | "edit";
  productId: string;
  projectId?: string;
}

export function ProjectFormPage({ mode, productId, projectId }: Props) {
  const { pick } = useI18n();
  const { can } = usePermissions();
  const router = useRouter();

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [seatRow, setSeatRow] = useState<string>("Front");
  const [submodel, setSubmodel] = useState("");

  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [productionParts, setProductionParts] = useState<ProductionPartRecord[]>([]);
  const [partSkuOptions, setPartSkuOptions] = useState<PartSkuRecord[]>([]);
  const [checkedSkuIds, setCheckedSkuIds] = useState<Set<string>>(new Set());

  const [draftParts, setDraftParts] = useState<DraftPart[]>([]);
  const [draftChecklist, setDraftChecklist] = useState<DraftChecklistItem[]>([]);
  const [draftChecklistDesc, setDraftChecklistDesc] = useState("");
  const [draftChecklistStatus, setDraftChecklistStatus] = useState("Pending");

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [loadingProject, setLoadingProject] = useState(mode === "edit");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [checklistDesc, setChecklistDesc] = useState("");
  const [checklistStatus, setChecklistStatus] = useState("Pending");
  const [savingChecklist, setSavingChecklist] = useState(false);

  const [addingSkus, setAddingSkus] = useState(false);
  const [savingHeader, setSavingHeader] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const userIdByLabel = useMemo(() => new Map(assignableUsers.map((u) => [userLabel(u), u.id])), [assignableUsers]);
  const userLabelById = useMemo(() => new Map(assignableUsers.map((u) => [u.id, userLabel(u)])), [assignableUsers]);
  const partNameToSeatRow = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of productionParts) map.set(p.partName, p.seatRow ?? "Front");
    return map;
  }, [productionParts]);

  const productName = product ? [product.yearGeneration ?? "", product.make, product.model].filter(Boolean).join(" ") : "";
  const rowNamePreview = [productName, [seatRow, submodel.trim()].filter(Boolean).join(" ")].filter(Boolean).join(" · ");

  async function fetchProduct() {
    const res = await fetch(apiPath("/api/production/products"));
    const json = await res.json();
    if (json.success) {
      const found: ProductRecord | undefined = json.data.find((p: ProductRecord) => p.id === productId);
      if (found) setProduct(found);
    }
  }

  async function fetchPartSkuOptions(forMake: string, forModel: string) {
    if (!forMake || !forModel) {
      setPartSkuOptions([]);
      return;
    }
    const res = await fetch(
      apiPath(`/api/production/part-skus?make=${encodeURIComponent(forMake)}&model=${encodeURIComponent(forModel)}&active=true`)
    );
    const json = await res.json();
    if (json.success) setPartSkuOptions(json.data);
  }

  async function fetchProject() {
    if (!projectId) return;
    setLoadingProject(true);
    try {
      const res = await fetch(apiPath(`/api/production/projects/${projectId}`));
      const json = await res.json();
      if (json.success) {
        setProject(json.data);
        setSeatRow(json.data.seatRow);
        setSubmodel(json.data.submodel ?? "");
      }
    } finally {
      setLoadingProject(false);
    }
  }

  async function fetchChecklist() {
    if (!projectId) return;
    setLoadingChecklist(true);
    try {
      const res = await fetch(apiPath(`/api/production/projects/${projectId}/checklist`));
      const json = await res.json();
      if (json.success) setChecklist(json.data);
    } finally {
      setLoadingChecklist(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProduct();
    fetch(apiPath("/api/production/assignable-users"))
      .then((res) => res.json())
      .then((json) => { if (json.success) setAssignableUsers(json.data); });
    fetch(apiPath("/api/production/parts?active=true"))
      .then((res) => res.json())
      .then((json) => { if (json.success) setProductionParts(json.data); });
    if (mode === "edit") {
      fetchProject();
      fetchChecklist();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (product) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchPartSkuOptions(product.make, product.model);
    }
  }, [product]);

  const zonePartSkuOptions = useMemo(
    () => partSkuOptions.filter((sku) => (partNameToSeatRow.get(sku.partName) ?? "Front") === seatRow),
    [partSkuOptions, partNameToSeatRow, seatRow]
  );

  const existingCodes = useMemo(() => {
    const source = mode === "create" ? draftParts.map((p) => p.code) : (project?.parts ?? []).map((p) => p.code ?? "");
    return new Set(source.filter(Boolean));
  }, [mode, draftParts, project]);

  function toggleSkuChecked(skuId: string) {
    setCheckedSkuIds((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  }

  async function handleAddSelectedSkus() {
    if (!can("project-list", "create")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    const toAdd = zonePartSkuOptions.filter((sku) => checkedSkuIds.has(sku.id) && !existingCodes.has(sku.code));
    if (toAdd.length === 0) return;

    if (mode === "create") {
      setDraftParts((prev) => [
        ...prev,
        ...toAdd.map((sku) => ({
          tempId: makeTempId(),
          cab: "",
          code: sku.code,
          status: "Pending",
          assignedToUserId: "",
          photoCount: 0,
          docUrl: "",
        })),
      ]);
      setCheckedSkuIds(new Set());
      return;
    }

    if (!projectId) return;
    setAddingSkus(true);
    try {
      for (const sku of toAdd) {
        const res = await fetch(apiPath(`/api/production/projects/${projectId}/parts`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: sku.code, status: "Pending" }),
        });
        const json = await res.json();
        if (json.success) {
          setProject((prev) => (prev ? { ...prev, parts: [...prev.parts, json.data] } : prev));
        }
      }
      setCheckedSkuIds(new Set());
    } finally {
      setAddingSkus(false);
    }
  }

  function updateDraftPart(tempId: string, patch: Partial<DraftPart>) {
    setDraftParts((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)));
  }

  function removeDraftPart(tempId: string) {
    setDraftParts((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  async function handlePatchLivePart(partId: string, patch: Partial<ProjectPartRecord>) {
    if (!can("project-list", "edit")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!projectId) return;
    setProject((prev) =>
      prev ? { ...prev, parts: prev.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)) } : prev
    );
    const res = await fetch(apiPath(`/api/production/projects/${projectId}/parts/${partId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (json.success) {
      setProject((prev) =>
        prev ? { ...prev, parts: prev.parts.map((p) => (p.id === partId ? json.data : p)) } : prev
      );
    } else {
      toast.error(json.error ?? pick("저장에 실패했습니다.", "Failed to save."));
      await fetchProject();
    }
  }

  async function handleDeleteLivePart(partId: string) {
    if (!can("project-list", "delete")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!projectId) return;
    if (!window.confirm(pick("이 구성을 삭제하시겠습니까?", "Delete this configuration?"))) return;
    const res = await fetch(apiPath(`/api/production/projects/${projectId}/parts/${partId}`), { method: "DELETE" });
    const json = await res.json();
    if (json.success) {
      setProject((prev) => (prev ? { ...prev, parts: prev.parts.filter((p) => p.id !== partId) } : prev));
    }
  }

  function addDraftChecklistItem() {
    if (!draftChecklistDesc.trim()) {
      window.alert(pick("설명을 입력하세요.", "Enter a description."));
      return;
    }
    setDraftChecklist((prev) => [...prev, { tempId: makeTempId(), description: draftChecklistDesc.trim(), status: draftChecklistStatus }]);
    setDraftChecklistDesc("");
    setDraftChecklistStatus("Pending");
  }

  function removeDraftChecklistItem(tempId: string) {
    setDraftChecklist((prev) => prev.filter((i) => i.tempId !== tempId));
  }

  async function addChecklistItem() {
    if (!can("project-list", "edit")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!projectId) return;
    if (!checklistDesc.trim()) {
      window.alert(pick("설명을 입력하세요.", "Enter a description."));
      return;
    }
    setSavingChecklist(true);
    try {
      const res = await fetch(apiPath(`/api/production/projects/${projectId}/checklist`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: checklistDesc.trim(), status: checklistStatus }),
      });
      const json = await res.json();
      if (!json.success) {
        window.alert(json.error ?? pick("추가에 실패했습니다.", "Failed to add."));
        return;
      }
      setChecklistDesc("");
      setChecklistStatus("Pending");
      setChecklist((prev) => [...prev, json.data]);
    } finally {
      setSavingChecklist(false);
    }
  }

  async function updateChecklistItemStatus(itemId: string, status: string) {
    if (!can("project-list", "edit") || !projectId) return;
    const res = await fetch(apiPath(`/api/production/projects/${projectId}/checklist/${itemId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();
    if (json.success) setChecklist((prev) => prev.map((i) => (i.id === itemId ? json.data : i)));
  }

  async function deleteChecklistItem(itemId: string) {
    if (!can("project-list", "edit") || !projectId) return;
    if (!window.confirm(pick("이 항목을 삭제하시겠습니까?", "Delete this item?"))) return;
    const res = await fetch(apiPath(`/api/production/projects/${projectId}/checklist/${itemId}`), { method: "DELETE" });
    const json = await res.json();
    if (json.success) setChecklist((prev) => prev.filter((i) => i.id !== itemId));
  }

  async function handleSaveHeader() {
    if (!projectId) return;
    setError("");
    setSavingHeader(true);
    try {
      const res = await fetch(apiPath(`/api/production/projects/${projectId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submodel: submodel.trim() || null }),
      });
      const json = await res.json();
      if (json.success) {
        setProject(json.data);
        toast.success(pick("저장되었습니다.", "Saved."));
      } else {
        setError(json.error ?? pick("저장에 실패했습니다.", "Save failed."));
      }
    } finally {
      setSavingHeader(false);
    }
  }

  async function handleCreate() {
    setError("");
    setCreating(true);
    try {
      const res = await fetch(apiPath(`/api/production/products/${productId}/projects`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatRow,
          submodel: submodel.trim() || undefined,
          parts: draftParts.map((part) => ({
            cab: part.cab,
            code: part.code,
            status: part.status,
            assignedToUserId: part.assignedToUserId || undefined,
            photoCount: part.photoCount,
            docUrl: part.docUrl || undefined,
          })),
          checklistItems: draftChecklist.map(({ description, status }) => ({ description, status })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        router.push(`/production/product-list/${productId}/projects/${json.data.id}`);
      } else {
        setError(json.error ?? pick("생성에 실패했습니다.", "Failed to create."));
      }
    } finally {
      setCreating(false);
    }
  }

  if (mode === "edit" && loadingProject) {
    return (
      <section className="flex min-h-[calc(100vh-7rem)] items-center justify-center rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0]">
        <div className="text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
      </section>
    );
  }

  if (mode === "edit" && !project) {
    return (
      <section className="flex min-h-[calc(100vh-7rem)] items-center justify-center rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0]">
        <div className="text-sm text-muted-foreground">{pick("열을 찾을 수 없습니다.", "Row not found.")}</div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex items-center gap-3 border-b border-[#e2dfd8] bg-white px-6 py-3.5">
        <Link href={`/production/product-list/${productId}`} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        {mode === "edit" && project ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef3fd] text-xs font-bold text-[#1a5cdb]">
              {rowAbbr(seatRow)}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-[0.06em] text-muted-foreground">
                {pick("열 상세", "Row Detail")}
              </p>
              <h1 className="truncate text-base font-bold leading-tight">{rowNamePreview || "—"}</h1>
            </div>
          </div>
        ) : (
          <h1 className="text-lg font-semibold">{pick("새 열", "New Row")}</h1>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex w-full flex-col gap-3.5">
          {mode === "create" ? (
            <div className="max-w-2xl rounded-lg border-2 border-[#1a5cdb] bg-[#eef3fd] px-4 py-2.5 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {pick("행 이름", "Row Name")}
              </div>
              <div className="mt-0.5 text-lg font-bold text-[#1a4db0]">{rowNamePreview || "—"}</div>
            </div>
          ) : null}

          <div className="max-w-2xl rounded-lg border border-[#e2dfd8] bg-white p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {pick("열 정보", "Row Info")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">{pick("열 (Row)", "Row")} <span className="text-[#c42b2b]">*</span></label>
                <select
                  className="form-input h-10 bg-white text-sm"
                  value={seatRow}
                  disabled={mode === "edit"}
                  onChange={(e) => { setSeatRow(e.target.value); setCheckedSkuIds(new Set()); }}
                >
                  {SEAT_ROW_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Submodel</label>
                <input
                  className="form-input h-10 bg-white text-sm"
                  value={submodel}
                  onChange={(e) => setSubmodel(e.target.value)}
                  placeholder={pick("자유 입력", "Free text")}
                />
              </div>
            </div>

            {error ? <p className="mt-3 text-sm text-[#c42b2b]">{error}</p> : null}

            {mode === "edit" && can("project-list", "edit") ? (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={savingHeader}
                  onClick={() => void handleSaveHeader()}
                  className="h-10 whitespace-nowrap rounded-md bg-[#1a5cdb] px-4 text-sm font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                >
                  {savingHeader ? pick("저장 중...", "Saving...") : pick("저장", "Save")}
                </button>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-[#e2dfd8] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                {pick("Part SKU 선택", "Select Part SKUs")}
              </div>
              {can("project-list", "create") ? (
                <button
                  type="button"
                  disabled={checkedSkuIds.size === 0 || addingSkus}
                  onClick={() => void handleAddSelectedSkus()}
                  className="h-9 whitespace-nowrap rounded-md bg-[#1a5cdb] px-3 text-sm font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                >
                  {addingSkus
                    ? pick("추가 중...", "Adding...")
                    : pick(`선택한 SKU 추가 (${checkedSkuIds.size})`, `Add selected SKUs (${checkedSkuIds.size})`)}
                </button>
              ) : null}
            </div>
            {!product ? (
              <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-sm text-muted-foreground">
                {pick("불러오는 중...", "Loading...")}
              </div>
            ) : zonePartSkuOptions.length === 0 ? (
              <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-sm text-muted-foreground">
                {pick(`${seatRow} 열에 해당하는 Part SKU가 없습니다.`, `No Part SKUs for the ${seatRow} row yet.`)}
              </div>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {zonePartSkuOptions.map((sku) => {
                  const alreadyAdded = existingCodes.has(sku.code);
                  return (
                    <label
                      key={sku.id}
                      className={`flex items-center gap-3 rounded-lg border border-[#e2dfd8] px-2.5 py-2 text-sm transition-colors ${alreadyAdded ? "opacity-40" : "hover:border-[#bcd3f7] hover:bg-[#f8f9fc]"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checkedSkuIds.has(sku.id) || alreadyAdded}
                        disabled={alreadyAdded}
                        onChange={() => toggleSkuChecked(sku.id)}
                      />
                      <span className="font-semibold">{sku.sku}</span>
                      <span className="truncate text-muted-foreground">{sku.partName}</span>
                      <span className="ml-auto shrink-0 rounded-md border border-[#e2dfd8] bg-[#f0eee9] px-1.5 py-0.5 text-xs text-muted-foreground">
                        {sku.code}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-[#e2dfd8] bg-white">
            <div className="border-b border-[#e2dfd8] px-4 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {pick(`구성 (Configurations) · ${(mode === "create" ? draftParts : project?.parts ?? []).length}`, `Configurations · ${(mode === "create" ? draftParts : project?.parts ?? []).length}`)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e2dfd8] bg-[#f8f7f4] text-left text-xs uppercase tracking-[0.04em] text-muted-foreground">
                    <th className="px-2 py-1.5 font-semibold">Cab</th>
                    <th className="px-2 py-1.5 font-semibold">Code</th>
                    <th className="px-2 py-1.5 font-semibold">Status</th>
                    <th className="px-2 py-1.5 font-semibold">{pick("담당자", "Assigned to")}</th>
                    <th className="px-2 py-1.5 font-semibold">Refs</th>
                    <th className="px-2 py-1.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {mode === "create"
                    ? draftParts.map((part) => (
                        <tr key={part.tempId} className="border-b border-[#e2dfd8] last:border-b-0 hover:bg-[#f8f7f4]">
                          <td className="px-2 py-1.5">
                            <input
                              className="form-input h-9 w-20 bg-white text-sm"
                              value={part.cab}
                              onChange={(e) => updateDraftPart(part.tempId, { cab: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex h-9 w-24 items-center rounded-md border border-[#e2dfd8] bg-[#f0eee9] px-2 text-sm text-muted-foreground">
                              {part.code}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              className={`form-input h-9 w-28 rounded-md text-sm font-semibold ${partStatusClass(part.status)}`}
                              value={part.status}
                              onChange={(e) => updateDraftPart(part.tempId, { status: e.target.value })}
                            >
                              {PART_STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <SearchableSelect
                              options={assignableUsers.map(userLabel)}
                              value={part.assignedToUserId ? userLabelById.get(part.assignedToUserId) ?? "" : ""}
                              onChange={(next) => updateDraftPart(part.tempId, { assignedToUserId: userIdByLabel.get(next) ?? "" })}
                              placeholder={pick("선택", "Select")}
                              searchPlaceholder={pick("이름 검색...", "Search name...")}
                              className="h-9 w-44 text-sm"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                className="form-input h-9 w-14 bg-white text-sm"
                                value={part.photoCount}
                                onChange={(e) => updateDraftPart(part.tempId, { photoCount: Number(e.target.value) || 0 })}
                              />
                              <span className="text-xs text-muted-foreground">{pick("사진", "pics")}</span>
                            </div>
                            <input
                              className="form-input mt-1 h-8 w-28 bg-white text-xs"
                              value={part.docUrl}
                              placeholder={pick("URL", "URL")}
                              onChange={(e) => updateDraftPart(part.tempId, { docUrl: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <button type="button" onClick={() => removeDraftPart(part.tempId)} className="text-sm text-[#c42b2b] hover:underline">
                              {pick("삭제", "Delete")}
                            </button>
                          </td>
                        </tr>
                      ))
                    : (project?.parts ?? []).map((part) => (
                        <tr key={part.id} className="border-b border-[#e2dfd8] last:border-b-0 hover:bg-[#f8f7f4]">
                          <td className="px-2 py-1.5">
                            <input
                              className="form-input h-9 w-20 bg-white text-sm"
                              defaultValue={part.cab ?? ""}
                              disabled={!can("project-list", "edit")}
                              onBlur={(e) => {
                                if (e.target.value !== (part.cab ?? "")) handlePatchLivePart(part.id, { cab: e.target.value });
                              }}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex h-9 w-24 items-center rounded-md border border-[#e2dfd8] bg-[#f0eee9] px-2 text-sm text-muted-foreground">
                              {part.code ?? "—"}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              className={`form-input h-9 w-28 rounded-md text-sm font-semibold ${partStatusClass(part.status)}`}
                              value={part.status}
                              disabled={!can("project-list", "edit")}
                              onChange={(e) => handlePatchLivePart(part.id, { status: e.target.value })}
                            >
                              {PART_STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <SearchableSelect
                              options={assignableUsers.map(userLabel)}
                              value={part.assignedTo ? userLabel(part.assignedTo) : ""}
                              onChange={(next) => handlePatchLivePart(part.id, { assignedToUserId: userIdByLabel.get(next) ?? null })}
                              placeholder={pick("선택", "Select")}
                              searchPlaceholder={pick("이름 검색...", "Search name...")}
                              disabled={!can("project-list", "edit")}
                              className="h-9 w-44 text-sm"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                className="form-input h-9 w-14 bg-white text-sm"
                                defaultValue={part.photoCount}
                                disabled={!can("project-list", "edit")}
                                onBlur={(e) => {
                                  const next = Number(e.target.value) || 0;
                                  if (next !== part.photoCount) handlePatchLivePart(part.id, { photoCount: next });
                                }}
                              />
                              {part.docUrl ? (
                                <a href={part.docUrl} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-sm text-[#1a5cdb] hover:underline">
                                  {pick("보기", "View")}
                                </a>
                              ) : null}
                            </div>
                            {can("project-list", "edit") ? (
                              <input
                                className="form-input mt-1 h-8 w-28 bg-white text-xs"
                                defaultValue={part.docUrl ?? ""}
                                placeholder={pick("URL", "URL")}
                                onBlur={(e) => {
                                  if (e.target.value !== (part.docUrl ?? "")) handlePatchLivePart(part.id, { docUrl: e.target.value || null });
                                }}
                              />
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5">
                            {can("project-list", "delete") ? (
                              <button type="button" onClick={() => handleDeleteLivePart(part.id)} className="text-sm text-[#c42b2b] hover:underline">
                                {pick("삭제", "Delete")}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                  {(mode === "create" ? draftParts.length === 0 : (project?.parts.length ?? 0) === 0) ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        {pick("Part SKU를 선택해서 구성을 추가하세요.", "Select Part SKUs above to add configurations.")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-[#e2dfd8] bg-white p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {pick(`체크리스트 · ${(mode === "create" ? draftChecklist : checklist).length}`, `Checklist · ${(mode === "create" ? draftChecklist : checklist).length}`)}
            </div>

            {mode === "create" ? (
              <div className="space-y-2">
                {draftChecklist.length === 0 ? (
                  <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-sm text-muted-foreground">
                    {pick("체크리스트 항목이 없습니다.", "No checklist items yet.")}
                  </div>
                ) : (
                  draftChecklist.map((item) => (
                    <div key={item.tempId} className="flex items-center gap-2 rounded-lg border border-[#e2dfd8] bg-white p-3">
                      <span className="flex-1 text-sm">{item.description}</span>
                      <StatusPill label={item.status} className={checklistStatusClass(item.status)} />
                      <button type="button" onClick={() => removeDraftChecklistItem(item.tempId)} className="text-sm text-[#c42b2b] hover:underline">
                        {pick("삭제", "Delete")}
                      </button>
                    </div>
                  ))
                )}
                <div className="mt-3 flex items-center gap-2">
                  <input
                    className="form-input h-10 flex-1 bg-white text-sm"
                    value={draftChecklistDesc}
                    onChange={(e) => setDraftChecklistDesc(e.target.value)}
                    placeholder={pick("설명 입력...", "Enter description...")}
                  />
                  <select className="form-input h-10 w-32 bg-white text-sm" value={draftChecklistStatus} onChange={(e) => setDraftChecklistStatus(e.target.value)}>
                    {CHECKLIST_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!draftChecklistDesc.trim()}
                    onClick={addDraftChecklistItem}
                    className="h-10 whitespace-nowrap rounded-md bg-[#1a5cdb] px-3 text-sm font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                  >
                    {pick("추가", "Add")}
                  </button>
                </div>
              </div>
            ) : loadingChecklist ? (
              <div className="text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
            ) : (
              <div className="space-y-2">
                {checklist.length === 0 ? (
                  <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-sm text-muted-foreground">
                    {pick("체크리스트 항목이 없습니다.", "No checklist items yet.")}
                  </div>
                ) : (
                  checklist.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg border border-[#e2dfd8] bg-white p-3">
                      <span className="flex-1 text-sm">{item.description}</span>
                      {can("project-list", "edit") ? (
                        <select
                          className={`form-input h-9 w-36 rounded-md text-sm font-semibold ${checklistStatusClass(item.status)}`}
                          value={item.status}
                          onChange={(e) => updateChecklistItemStatus(item.id, e.target.value)}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusPill label={item.status} className={checklistStatusClass(item.status)} />
                      )}
                      {can("project-list", "edit") ? (
                        <button type="button" onClick={() => deleteChecklistItem(item.id)} className="text-sm text-[#c42b2b] hover:underline">
                          {pick("삭제", "Delete")}
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
                {can("project-list", "edit") ? (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      className="form-input h-10 flex-1 bg-white text-sm"
                      value={checklistDesc}
                      onChange={(e) => setChecklistDesc(e.target.value)}
                      placeholder={pick("설명 입력...", "Enter description...")}
                    />
                    <select className="form-input h-10 w-32 bg-white text-sm" value={checklistStatus} onChange={(e) => setChecklistStatus(e.target.value)}>
                      {CHECKLIST_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={savingChecklist || !checklistDesc.trim()}
                      onClick={() => void addChecklistItem()}
                      className="h-10 whitespace-nowrap rounded-md bg-[#1a5cdb] px-3 text-sm font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                    >
                      {pick("추가", "Add")}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {mode === "create" ? (
            <div className="flex justify-end pb-4">
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate()}
                className="h-11 whitespace-nowrap rounded-md bg-[#1a5cdb] px-6 text-base font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
              >
                {creating ? pick("생성 중...", "Creating...") : pick("열 생성", "Create Row")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
