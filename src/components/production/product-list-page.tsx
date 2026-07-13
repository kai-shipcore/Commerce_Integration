"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";

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

function productName(product: ProductRecord): string {
  return [product.yearGeneration ?? "", product.make, product.model].filter(Boolean).join(" ");
}

function summarizeProduct(projects: ProjectSummary[]): string {
  if (projects.length === 0) return "0 rows";
  const parts = projects.flatMap((p) => p.parts);
  const checklistCount = projects.reduce((sum, p) => sum + p._count.checklistItems, 0);
  const counts: Record<string, number> = {};
  for (const part of parts) counts[part.status] = (counts[part.status] ?? 0) + 1;
  const pieces = Object.entries(counts).map(([status, count]) => `${status} ${count}`);
  const rowsLabel = `${projects.length} row${projects.length === 1 ? "" : "s"}`;
  const partsLabel = `${parts.length} configs${pieces.length ? ` · ${pieces.join(" · ")}` : ""}`;
  return `${rowsLabel} · ${partsLabel} · Checklist ${checklistCount}`;
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
      [product.make, product.model, product.fNumber].some((f) => f.toLowerCase().includes(normalizedQuery))
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
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4">
        <div className="flex items-start gap-2">
          <FolderKanban className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">{pick("제품 목록", "Product List")}</h1>
          </div>
        </div>
        {can("project-list", "create") ? (
          <Link
            href="/production/product-list/new"
            className="h-10 whitespace-nowrap rounded-md bg-[#1a5cdb] px-4 text-sm font-medium leading-10 text-white hover:bg-[#1650c4]"
          >
            {pick("+ 새 제품", "+ New Product")}
          </Link>
        ) : null}
      </header>

      <div className="border-b border-[#e2dfd8] bg-white px-6 py-3">
        <input
          className="form-input h-10 max-w-sm bg-white text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={pick("차종/F Number 검색...", "Search make, model, F number...")}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="text-5xl opacity-50">📁</div>
            <div className="text-base font-medium">{pick("제품이 없습니다", "No products yet")}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-[#e2dfd8] bg-white px-5 py-3 hover:border-[#1a5cdb]"
              >
                <Link href={`/production/product-list/${product.id}`} className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">
                    {productName(product)} · {product.fNumber}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {summarizeProduct(product.projects)}
                  </div>
                </Link>
                {can("project-list", "delete") ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteProduct(product)}
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
    </section>
  );
}
