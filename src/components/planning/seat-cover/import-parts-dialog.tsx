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

const TEMPLATE_HEADERS = [
  "Request Received Date",
  "Order Number",
  "Part Number",
  "í•´ë‹¹SKU",
  "QTY",
  "Order Request",
  "PART SKU",
  "PART SKU(VALUE)",
  "Note",
  "Order Status",
  "Shiphero Order",
  "Shipping Status",
];

const VALID_SHIPPING = ["Ready", "Not Ready", "Shipped", "Canceled", ""];

const HEADER_ALIASES: Record<string, string> = {
  "request received date": "Request Received Date",
  "requestreceivedat": "Request Received Date",
  "order number": "Order Number",
  "ordernumber": "Order Number",
  "part number": "Part Number",
  "partnumber": "Part Number",
  "í•´ë‹¹sku": "í•´ë‹¹SKU",
  "correspondingsku": "í•´ë‹¹SKU",
  "qty": "QTY",
  "order request": "Order Request",
  "orderrequest": "Order Request",
  "part sku": "PART SKU",
  "partsku": "PART SKU",
  "part sku(value)": "PART SKU(VALUE)",
  "partskuvalue": "PART SKU(VALUE)",
  "note": "Note",
  "order status": "Order Status",
  "orderstatus": "Order Status",
  "shiphero order": "Shiphero Order",
  "shipheroorder": "Shiphero Order",
  "shipping status": "Shipping Status",
  "shippingstatus": "Shipping Status",
};

interface ValidationError {
  rowNum: number;
  field: string;
  message: string;
}

function validateRows(rows: Record<string, string>[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Map<string, number>();

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const date = r["Request Received Date"];
    if (!date) {
      errors.push({ rowNum, field: "Request Received Date", message: "Required" });
    } else if (isNaN(new Date(String(date)).getTime())) {
      errors.push({ rowNum, field: "Request Received Date", message: "Invalid date" });
    }
    if (!r["Order Number"]) errors.push({ rowNum, field: "Order Number", message: "Required" });
    if (!r["Part Number"]) errors.push({ rowNum, field: "Part Number", message: "Required" });
    if (r["Shipping Status"] && !VALID_SHIPPING.includes(r["Shipping Status"])) {
      errors.push({
        rowNum,
        field: "Shipping Status",
        message: `"${r["Shipping Status"]}" is not valid. Must be: Ready, Not Ready, Shipped, Canceled`,
      });
    }
    if (r["QTY"] && isNaN(Number(r["QTY"]))) {
      errors.push({ rowNum, field: "QTY", message: "Must be a number" });
    }

    const d = r["Request Received Date"];
    const o = r["Order Number"];
    const p = r["Part Number"];
    if (d && o && p) {
      const key = `${d}||${o}||${p}`;
      if (seen.has(key)) {
        errors.push({
          rowNum,
          field: "Duplicate",
          message: `Row ${seen.get(key)}ì™€ Request Received Date Â· Order Number Â· Part Number ì¡°í•©ì´ ì¤‘ë³µë©ë‹ˆë‹¤`,
        });
      } else {
        seen.set(key, rowNum);
      }
    }
  });

  return errors;
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Parts");
  XLSX.writeFile(wb, "parts_import_template.xlsx");
}

function parseRows(sheet: XLSX.WorkSheet): Record<string, string>[] {
  const raw = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  return raw.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const canonical = HEADER_ALIASES[k.toLowerCase().trim()] ?? k;
      normalized[canonical] = v;
    }
    return normalized;
  });
}

interface ImportPartsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ImportPartsDialog({ open, onOpenChange, onSuccess }: ImportPartsDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ upserted: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFileName(null);
    setParsedRows([]);
    setValidationErrors([]);
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose(val: boolean) {
    if (!loading) {
      if (!val) reset();
      onOpenChange(val);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);
    setValidationErrors([]);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = parseRows(ws);
        const errors = validateRows(rows);
        setParsedRows(rows);
        setValidationErrors(errors);
      } catch {
        setError("Failed to parse file. Please use the template.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleUpload() {
    if (!parsedRows.length || validationErrors.length) return;
    setLoading(true);
    setError(null);
    try {
      const mapped = parsedRows.map((r) => ({
        requestReceivedAt: r["Request Received Date"] ?? "",
        orderNumber: r["Order Number"] ?? "",
        partNumber: r["Part Number"] ?? "",
        correspondingSku: r["í•´ë‹¹SKU"] ?? "",
        qty: r["QTY"] ?? "0",
        orderRequest: r["Order Request"] ?? "",
        partSku: r["PART SKU"] ?? "",
        partSkuValue: r["PART SKU(VALUE)"] ?? "",
        note: r["Note"] ?? "",
        orderStatus: r["Order Status"] ?? "",
        shipheroOrder: r["Shiphero Order"] ?? "",
        shippingStatus: r["Shipping Status"] || "Not Ready",
      }));

      const res = await fetch(apiPath("/api/planning/seat-cover/parts/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: mapped }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Import failed.");
        return;
      }
      setResult({ upserted: json.upserted });
      onSuccess();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const hasErrors = validationErrors.length > 0;
  const isReady = parsedRows.length > 0 && !hasErrors;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent style={{ maxWidth: 520 }}>
        <DialogHeader>
          <DialogTitle>Bulk Import Parts</DialogTitle>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#7A766F" }}>1. Download template</span>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
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
          </div>

          {/* Validation errors */}
          {hasErrors && (
            <div style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 6,
              padding: "10px 12px",
              maxHeight: 200,
              overflowY: "auto",
            }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#c0392b", marginBottom: 6 }}>
                {validationErrors.length} error{validationErrors.length > 1 ? "s" : ""} found â€” fix the Excel file and re-upload.
              </p>
              {validationErrors.map((e, i) => (
                <p key={i} style={{ fontSize: 12, color: "#c0392b", margin: "2px 0" }}>
                  Row {e.rowNum} Â· {e.field}: {e.message}
                </p>
              ))}
            </div>
          )}

          {/* Ready state */}
          {isReady && (
            <p style={{ fontSize: 13, color: "#2A7A2A", fontWeight: 600 }}>
              âœ“ {parsedRows.length} rows ready to upload.
            </p>
          )}

          {/* Upload result */}
          {result && (
            <p style={{ fontSize: 13, color: "#2A7A2A", fontWeight: 600 }}>
              âœ“ {result.upserted} rows upserted successfully.
            </p>
          )}

          {error && (
            <p style={{ fontSize: 13, color: "#e53e3e" }}>{error}</p>
          )}
        </div>

        {/* Loading overlay */}
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
            <span style={{ fontSize: 13, color: "#1A1917", fontWeight: 600 }}>Uploadingâ€¦</span>
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
