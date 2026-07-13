"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";

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
  fNumber: string;
  yearGeneration: string | null;
  projects: ProjectSummary[];
};

function rowLabel(project: ProjectSummary): string {
  return project.submodel ? `${project.seatRow} · ${project.submodel}` : project.seatRow;
}

function summarizeRow(project: ProjectSummary): string {
  if (project.parts.length === 0) return "0 configs ·";
  const counts: Record<string, number> = {};
  for (const part of project.parts) counts[part.status] = (counts[part.status] ?? 0) + 1;
  const pieces = Object.entries(counts).map(([status, count]) => `${status} ${count}`);
  return `${project.parts.length} configs · ${pieces.join(" · ")} ·`;
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
          setFNumber(found.fNumber);
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
    if (!make.trim() || !model.trim() || !fNumber.trim()) {
      setError(pick("Make, Model, F Number는 필수입니다.", "Make, Model, and F Number are required."));
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
          fNumber: fNumber.trim(),
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
    if (!make.trim() || !model.trim() || !fNumber.trim()) {
      setError(pick("Make, Model, F Number는 필수입니다.", "Make, Model, and F Number are required."));
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
          fNumber: fNumber.trim(),
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

  const title = mode === "create" ? pick("새 제품", "New Product") : pick("제품 상세", "Product Detail");

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
      <header className="flex items-center gap-3 border-b border-[#e2dfd8] bg-white px-6 py-4">
        <Link href="/production/product-list" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold">{title}</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          <div className="mx-auto w-full max-w-2xl rounded-lg border-2 border-[#1a5cdb] bg-[#eef3fd] px-4 py-3 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {pick("제품 이름", "Product Name")}
            </div>
            <div className="mt-1 text-xl font-bold text-[#1a4db0]">{productNamePreview || "—"}</div>
          </div>

          <div className="mx-auto w-full max-w-2xl rounded-lg border border-[#e2dfd8] bg-white p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">F Number <span className="text-[#c42b2b]">*</span></label>
                <input className="form-input h-10 bg-white text-sm" value={fNumber} onChange={(e) => setFNumber(e.target.value)} placeholder="F-218" />
              </div>
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
            <div className="mx-auto w-full max-w-2xl rounded-lg border border-[#e2dfd8] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">{pick("열 (Rows)", "Rows")}</div>
                {can("project-list", "create") ? (
                  <Link
                    href={`/production/product-list/${productId}/projects/new`}
                    className="h-9 whitespace-nowrap rounded-md bg-[#1a5cdb] px-3 text-sm font-medium leading-9 text-white hover:bg-[#1650c4]"
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
                  {product.projects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between gap-4 rounded-lg border border-[#e2dfd8] px-4 py-3 hover:border-[#1a5cdb]"
                    >
                      <Link
                        href={`/production/product-list/${productId}/projects/${project.id}`}
                        className="min-w-0 flex-1"
                      >
                        <div className="truncate text-sm font-semibold">{rowLabel(project)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {summarizeRow(project)} Checklist {project._count.checklistItems}
                        </div>
                      </Link>
                      {can("project-list", "delete") ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(project)}
                          className="whitespace-nowrap text-sm text-[#c42b2b] hover:underline"
                        >
                          {pick("삭제", "Delete")}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
