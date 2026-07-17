"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Car } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatusPill, partStatusClass } from "@/components/production/status-styles";

type ProjectSummary = {
  id: string;
  seatRow: string;
  submodel: string | null;
  parts: { status: string }[];
  _count: { checklistItems: number };
};

type ProductRecord = {
  id: string;
  make: string;
  model: string;
  fNumber: string | null;
  yearGeneration: string | null;
  projects: ProjectSummary[];
};

function isRowComplete(project: ProjectSummary): boolean {
  return project.parts.length > 0 && project.parts.every((part) => part.status === "Scanned");
}

function rowLabel(project: ProjectSummary): string {
  return project.submodel ? `${project.seatRow} · ${project.submodel}` : project.seatRow;
}

function rowAbbr(seatRow: string): string {
  if (seatRow === "Front") return "F";
  if (seatRow === "Third Row") return "3R";
  if (seatRow === "Second Row") return "2R";
  return "R";
}

function summarizeRow(project: ProjectSummary): [string, number][] {
  const counts: Record<string, number> = {};
  for (const part of project.parts) counts[part.status] = (counts[part.status] ?? 0) + 1;
  return Object.entries(counts);
}

interface Props {
  mode: "create" | "edit";
  productId?: string;
}

export function ProductFormPage({ mode, productId }: Props) {
  const { pick } = useI18n();
  const { can } = usePermissions();
  const router = useRouter();

  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [fNumber, setFNumber] = useState("");
  const [yearGeneration, setYearGeneration] = useState("");

  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(mode === "edit");
  const [savingHeader, setSavingHeader] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const productNamePreview = [yearGeneration.trim(), make.trim(), model.trim()].filter(Boolean).join(" ");

  const allProjectsComplete = !!product && product.projects.length > 0 && product.projects.every(isRowComplete);
  const fNumberEditable = allProjectsComplete || !!product?.fNumber;

  async function fetchMakes() {
    const res = await fetch(apiPath("/api/production/vehicle-options"));
    const json = await res.json();
    if (json.success) setMakes(json.data);
  }

  async function fetchModels(forMake: string) {
    if (!forMake) {
      setModels([]);
      return;
    }
    const res = await fetch(apiPath(`/api/production/vehicle-options?make=${encodeURIComponent(forMake)}`));
    const json = await res.json();
    if (json.success) setModels(json.data);
  }

  async function fetchProduct() {
    if (!productId) return;
    setLoadingProduct(true);
    try {
      const res = await fetch(apiPath("/api/production/products"));
      const json = await res.json();
      if (json.success) {
        const found: ProductRecord | undefined = json.data.find((p: ProductRecord) => p.id === productId);
        if (found) {
          setProduct(found);
          setMake(found.make);
          setModel(found.model);
          setFNumber(found.fNumber ?? "");
          setYearGeneration(found.yearGeneration ?? "");
        }
      }
    } finally {
      setLoadingProduct(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMakes();
    if (mode === "edit") fetchProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchModels(make);
  }, [make]);

  async function handleSaveHeader() {
    if (!productId) return;
    setError("");
    if (!make.trim() || !model.trim()) {
      setError(pick("Make, Model은 필수입니다.", "Make and Model are required."));
      return;
    }
    setSavingHeader(true);
    try {
      const res = await fetch(apiPath(`/api/production/products/${productId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          make: make.trim(),
          model: model.trim(),
          ...(fNumberEditable ? { fNumber: fNumber.trim() || null } : {}),
          yearGeneration: yearGeneration.trim() || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProduct((prev) => (prev ? { ...prev, ...json.data } : prev));
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
    if (!make.trim() || !model.trim()) {
      setError(pick("Make, Model은 필수입니다.", "Make and Model are required."));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(apiPath("/api/production/products"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          make: make.trim(),
          model: model.trim(),
          yearGeneration: yearGeneration.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        router.push(`/production/product-list/${json.data.id}`);
      } else {
        setError(json.error ?? pick("생성에 실패했습니다.", "Failed to create."));
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteRow(project: ProjectSummary) {
    if (!can("project-list", "delete")) return;
    if (!window.confirm(pick(`${rowLabel(project)} 열을 삭제하시겠습니까?`, `Delete the ${rowLabel(project)} row?`))) return;
    const res = await fetch(apiPath(`/api/production/projects/${project.id}`), { method: "DELETE" });
    const json = await res.json();
    if (json.success) {
      setProduct((prev) => (prev ? { ...prev, projects: prev.projects.filter((p) => p.id !== project.id) } : prev));
    }
  }

  if (mode === "edit" && loadingProduct) {
    return (
      <section className="flex min-h-[calc(100vh-7rem)] items-center justify-center rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0]">
        <div className="text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
      </section>
    );
  }

  if (mode === "edit" && !product) {
    return (
      <section className="flex min-h-[calc(100vh-7rem)] items-center justify-center rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0]">
        <div className="text-sm text-muted-foreground">{pick("제품을 찾을 수 없습니다.", "Product not found.")}</div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex items-center gap-3 border-b border-[#e2dfd8] bg-white px-6 py-3.5">
        <Link href="/production/product-list" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        {mode === "edit" && product ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef3fd] text-[#1a5cdb]">
              <Car className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-[0.06em] text-muted-foreground">
                {pick("제품 상세", "Product Detail")}
              </p>
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-bold leading-tight">{productNamePreview}</h1>
                <StatusPill
                  label={fNumber || pick("미완료", "Not yet")}
                  className={fNumber ? "border-[#bcd3f7] bg-[#eaf1fd] text-[#1a4db0]" : "border-[#e2dfd8] bg-[#f0eee9] text-muted-foreground"}
                />
              </div>
            </div>
          </div>
        ) : (
          <h1 className="text-lg font-semibold">{pick("새 제품", "New Product")}</h1>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex w-full flex-col gap-3.5">
          {mode === "create" ? (
            <div className="max-w-4xl rounded-lg border-2 border-[#1a5cdb] bg-[#eef3fd] px-4 py-2.5 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {pick("제품 이름", "Product Name")}
              </div>
              <div className="mt-0.5 text-lg font-bold text-[#1a4db0]">{productNamePreview || "—"}</div>
            </div>
          ) : null}

          <div className="max-w-4xl rounded-lg border border-[#e2dfd8] bg-white p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {pick("차량 정보", "Vehicle Info")}
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Make <span className="text-[#c42b2b]">*</span></label>
                <SearchableSelect
                  options={makes}
                  value={make}
                  onChange={(next) => { setMake(next); setModel(""); }}
                  placeholder={pick("선택", "Select")}
                  searchPlaceholder={pick("Make 검색...", "Search Make...")}
                  className="h-10 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Model <span className="text-[#c42b2b]">*</span></label>
                <SearchableSelect
                  options={models}
                  value={model}
                  onChange={setModel}
                  placeholder={pick("선택", "Select")}
                  searchPlaceholder={pick("Model 검색...", "Search Model...")}
                  disabled={!make}
                  className="h-10 text-sm"
                />
              </div>
              {mode === "edit" ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">F Number</label>
                  <input
                    className="form-input h-10 bg-white text-sm disabled:bg-[#f0eee9] disabled:text-muted-foreground"
                    value={fNumber}
                    onChange={(e) => setFNumber(e.target.value)}
                    placeholder="F-218"
                    disabled={!fNumberEditable}
                  />
                  {!fNumberEditable ? (
                    <p className="text-xs text-muted-foreground">
                      {pick("모든 열의 Part가 Scanned 상태가 되면 입력할 수 있습니다.", "Enter once every row's parts are all Scanned.")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">{pick("연식/세대", "Year / Generation")}</label>
                <input className="form-input h-10 bg-white text-sm" value={yearGeneration} onChange={(e) => setYearGeneration(e.target.value)} placeholder="2019-2025" />
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

            {mode === "create" ? (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => void handleCreate()}
                  className="h-10 whitespace-nowrap rounded-md bg-[#1a5cdb] px-4 text-sm font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                >
                  {creating ? pick("생성 중...", "Creating...") : pick("제품 생성", "Create Product")}
                </button>
              </div>
            ) : null}
          </div>

          {mode === "edit" && product ? (
            <div className="rounded-lg border border-[#e2dfd8] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  {pick(`열 (Rows) · ${product.projects.length}`, `Rows · ${product.projects.length}`)}
                </div>
                {can("project-list", "create") ? (
                  <Link
                    href={`/production/product-list/${productId}/projects/new`}
                    className="h-8 whitespace-nowrap rounded-md bg-[#1a5cdb] px-3 text-sm font-medium leading-8 text-white hover:bg-[#1650c4]"
                  >
                    {pick("+ 열 추가", "+ Add Row")}
                  </Link>
                ) : null}
              </div>
              {product.projects.length === 0 ? (
                <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-sm text-muted-foreground">
                  {pick("열이 없습니다. 열을 추가하세요.", "No rows yet. Add one to get started.")}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {product.projects.map((project) => {
                    const complete = isRowComplete(project);
                    return (
                      <div
                        key={project.id}
                        className={`flex items-center gap-3.5 rounded-xl border border-[#e2dfd8] border-l-4 px-4 py-2.5 transition-shadow hover:shadow-md ${
                          complete ? "border-l-[#1f9d6c]" : "border-l-[#1a5cdb]"
                        }`}
                      >
                        <Link href={`/production/product-list/${productId}/projects/${project.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                              complete ? "bg-[#e6f5f0] text-[#0a5e45]" : "bg-[#eef3fd] text-[#1a5cdb]"
                            }`}
                          >
                            {rowAbbr(project.seatRow)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{rowLabel(project)}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span>{pick(`${project.parts.length} 구성`, `${project.parts.length} configs`)}</span>
                              {summarizeRow(project).map(([status, count]) => (
                                <StatusPill key={status} label={`${status} ${count}`} className={partStatusClass(status)} />
                              ))}
                              {project._count.checklistItems > 0 ? (
                                <span>{pick(`체크리스트 ${project._count.checklistItems}`, `Checklist ${project._count.checklistItems}`)}</span>
                              ) : null}
                            </div>
                          </div>
                        </Link>
                        {can("project-list", "delete") ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(project)}
                            className="shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-[#c42b2b] hover:bg-[#fdeceb]"
                          >
                            {pick("삭제", "Delete")}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
