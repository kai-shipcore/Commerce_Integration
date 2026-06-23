"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

type TransitStockImportRow = {
  masterSku: string;
  transitStock: number;
};

const TEMPLATE_HEADERS = ["Master SKU", "Transit Stock"];

function normalizeImportHeader(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseTransitStockCell(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function downloadTransitStockTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transit Stock");
  XLSX.writeFile(wb, "transit_stock_import_template.xlsx");
}

function extractTransitStockRows(workbook: XLSX.WorkBook): TransitStockImportRow[] {
  const rowsBySku = new Map<string, TransitStockImportRow>();
  const skuHeaders = new Set(["sku", "mastersku", "master"]);
  const transitHeaders = new Set(["transit", "transitstock", "intransit", "intransitstock"]);

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: "",
      raw: true,
    });

    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      const headers = matrix[rowIndex].map(normalizeImportHeader);
      const skuIndex = headers.findIndex((header) => skuHeaders.has(header) || header.includes("mastersku"));
      const transitIndex = headers.findIndex((header) => transitHeaders.has(header));

      if (skuIndex < 0 || transitIndex < 0) continue;

      for (let dataRowIndex = rowIndex + 1; dataRowIndex < matrix.length; dataRowIndex += 1) {
        const row = matrix[dataRowIndex];
        const masterSku = String(row[skuIndex] ?? "").trim().toUpperCase();
        const transitStock = parseTransitStockCell(row[transitIndex]);
        if (!masterSku || !masterSku.includes("-") || transitStock === null) continue;
        rowsBySku.set(masterSku, { masterSku, transitStock });
      }
      break;
    }
  }

  return [...rowsBySku.values()];
}

interface ImportTransitStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ImportTransitStockDialog({ open, onOpenChange, onSuccess }: ImportTransitStockDialogProps) {
  const { pick } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsedRows, setParsedRows] = useState<TransitStockImportRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; updated: number; inserted: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setParsedRows([]);
    setFileName(null);
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose(nextOpen: boolean) {
    if (loading) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = extractTransitStockRows(workbook);
      setParsedRows(rows);
      if (rows.length === 0) setError(pick("유효한 SKU / Transit Stock 행을 찾지 못했습니다. 템플릿을 사용하세요.", "No valid SKU / Transit Stock rows found. Please use the template."));
    } catch {
      setParsedRows([]);
      setError(pick("파일을 파싱하지 못했습니다. 템플릿을 사용하세요.", "Failed to parse file. Please use the template."));
    }
  }

  async function handleUpload() {
    if (!parsedRows.length) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(apiPath("/api/planning/transit-stock/import"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        imported?: number;
        updated?: number;
        inserted?: number;
      };
      if (!json.success) {
        setError(json.error ?? pick("가져오기에 실패했습니다.", "Import failed."));
        return;
      }
      setResult({
        imported: json.imported ?? parsedRows.length,
        updated: json.updated ?? 0,
        inserted: json.inserted ?? 0,
      });
      onSuccess();
    } catch {
      setError(pick("네트워크 오류가 발생했습니다.", "Network error."));
    } finally {
      setLoading(false);
    }
  }

  const isReady = parsedRows.length > 0 && !error;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent style={{ maxWidth: 520 }}>
        <DialogHeader>
          <DialogTitle>Bulk Import Transit Stock</DialogTitle>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#7A766F" }}>1. Download template</span>
            <Button variant="outline" size="sm" onClick={downloadTransitStockTemplate}>
              Download Template
            </Button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#7A766F" }}>2. Upload filled file (.xlsx / .csv)</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFile}
              style={{ fontSize: 13 }}
            />
            {fileName ? <span style={{ fontSize: 12, color: "#7A766F" }}>{fileName}</span> : null}
          </div>

          {isReady && (
            <p style={{ fontSize: 13, color: "#2A7A2A", fontWeight: 600 }}>
              {parsedRows.length} rows ready to upload.
            </p>
          )}

          {result && (
            <p style={{ fontSize: 13, color: "#2A7A2A", fontWeight: 600 }}>
              Imported {result.imported} rows ({result.updated} updated, {result.inserted} inserted).
            </p>
          )}

          {error && <p style={{ fontSize: 13, color: "#e53e3e" }}>{error}</p>}
        </div>

        {loading && (
          <div style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.75)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            zIndex: 10,
            gap: 12,
          }}>
            <div style={{
              width: 36,
              height: 36,
              border: "3px solid #D8D6CE",
              borderTop: "3px solid #2A2825",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <span style={{ fontSize: 13, color: "#1A1917", fontWeight: 600 }}>Uploading...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleUpload} disabled={!isReady || loading}>
                Upload
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
