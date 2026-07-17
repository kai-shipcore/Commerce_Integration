"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FolderKanban, Search } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
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

type ProductSummary = {
  rowsLabel: string;
  configsLabel: string;
  pieces: [string, number][];
  checklistCount: number;
};

function productName(product: ProductRecord): string {
  return [product.yearGeneration ?? "", product.make, product.model].filter(Boolean).join(" ");
}

function summarizeProduct(projects: ProjectSummary[]): ProductSummary {
  const parts = projects.flatMap((p) => p.parts);
  const checklistCount = projects.reduce((sum, p) => sum + p._count.checklistItems, 0);
  const counts: Record<string, number> = {};
  for (const part of parts) counts[part.status] = (counts[part.status] ?? 0) + 1;
  return {
    rowsLabel: `${projects.length} row${projects.length === 1 ? "" : "s"}`,
    configsLabel: `${parts.length} configs`,
    pieces: Object.entries(counts),
    checklistCount,
  };
}

export function ProductListPage() {
  const { pick } = useI18n();
  const { can } = usePermissions();

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  async function fetchProducts() {
    setLoading(true);
    try {
      const res = await fetch(apiPath("/api/production/products"));
      const json = await res.json();
      if (json.success) setProducts(json.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProducts();
  }, []);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return products;
    return products.filter((product) =>
      [product.make, product.model, product.fNumber ?? ""].some((f) => f.toLowerCase().includes(normalizedQuery))
    );
  }, [products, query]);

  async function handleDeleteProduct(product: ProductRecord) {
    if (!can("project-list", "delete")) return;
    if (!window.confirm(pick(`${productName(product)} 제품을 삭제하시겠습니까?`, `Delete the ${productName(product)} product?`))) return;
    const res = await fetch(apiPath(`/api/production/products/${product.id}`), { method: "DELETE" });
    const json = await res.json();
    if (json.success) setProducts((prev) => prev.filter((p) => p.id !== product.id));
  }

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef3fd] text-[#1a5cdb]">
            <FolderKanban className="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">{pick("제품 목록", "Product List")}</h1>
            <p className="text-xs text-muted-foreground">
              {loading ? pick("불러오는 중...", "Loading...") : pick(`${products.length}개 제품`, `${products.length} products`)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="form-input h-9 w-64 bg-white pl-8 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={pick("차종/F Number 검색...", "Search make, model, F number...")}
            />
          </div>
          {can("project-list", "create") ? (
            <Link
              href="/production/product-list/new"
              className="h-9 whitespace-nowrap rounded-md bg-[#1a5cdb] px-3.5 text-sm font-medium leading-9 text-white hover:bg-[#1650c4]"
            >
              {pick("+ 새 제품", "+ New Product")}
            </Link>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="text-5xl opacity-50">📁</div>
            <div className="text-base font-medium">{pick("제품이 없습니다", "No products yet")}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredProducts.map((product) => {
              const summary = summarizeProduct(product.projects);
              return (
                <div
                  key={product.id}
                  className="flex items-center gap-4 rounded-xl border border-[#e2dfd8] border-l-4 border-l-[#1a5cdb] bg-white px-4 py-3 transition-shadow hover:shadow-md"
                >
                  <Link href={`/production/product-list/${product.id}`} className="flex min-w-0 flex-1 items-center gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eef3fd] text-[#1a5cdb]">
                      <FolderKanban className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-semibold">{productName(product)}</span>
                        <StatusPill
                          label={product.fNumber ?? pick("미완료", "Not yet")}
                          className={
                            product.fNumber
                              ? "border-[#bcd3f7] bg-[#eaf1fd] text-[#1a4db0]"
                              : "border-[#e2dfd8] bg-[#f0eee9] text-muted-foreground"
                          }
                        />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{summary.rowsLabel}</span>
                        <span className="text-[#cccac4]">·</span>
                        <span>{summary.configsLabel}</span>
                        {summary.pieces.map(([status, count]) => (
                          <StatusPill key={status} label={`${status} ${count}`} className={partStatusClass(status)} />
                        ))}
                        {summary.checklistCount > 0 ? (
                          <span>{pick(`체크리스트 ${summary.checklistCount}`, `Checklist ${summary.checklistCount}`)}</span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                  {can("project-list", "delete") ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteProduct(product)}
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
    </section>
  );
}
