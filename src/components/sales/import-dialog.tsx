"use client";

/**
 * Code Guide:
 * Sales management component.
 * It helps users create, import, or inspect sales records before those records are sent to API routes.
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  FileSpreadsheet,
  Download,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface ImportResult {
  row: number;
  sku_code: string;
  success: boolean;
  error?: string;
  skuCreated?: boolean;
}

interface ImportSummary {
  total: number;
  imported: number;
  failed: number;
  skipped: number;
  skusCreated: number;
}

interface ParsedRow {
  sku_code: string;
  sale_date: string;
  quantity: string;
  unit_price: string;
  platform?: string;
  order_id?: string;
  order_type?: string;
  fulfilled?: string;
  fulfilled_date?: string;
  notes?: string;
}

interface SalesImportDialogProps {
  onImportComplete?: () => void;
}

export function SalesImportDialog({ onImportComplete }: SalesImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"upload" | "preview" | "importing" | "results">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [createdSkus, setCreatedSkus] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const resetState = () => {
    setStep("upload");
    setFile(null);
    setParsedRows([]);
    setParseError(null);
    setImporting(false);
    setSummary(null);
    setResults([]);
    setCreatedSkus([]);
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(resetState, 300);
  };

  const parseCSV = (text: string): ParsedRow[] => {
    const lines = text.split("\n").filter((line) => line.trim());
    if (lines.length < 2) {
      throw new Error("CSV must have a header row and at least one data row");
    }

    // Parse header
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));

    // Check required columns
    const requiredCols = ["sku_code", "sale_date", "quantity", "unit_price"];
    const missingCols = requiredCols.filter((col) => !header.includes(col));
    if (missingCols.length > 0) {
      throw new Error(`Missing required columns: ${missingCols.join(", ")}`);
    }

    // Parse data rows
    const rows: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length !== header.length) {
        continue; // Skip malformed rows
      }

      const row: any = {};
      header.forEach((col, idx) => {
        row[col] = values[idx]?.trim().replace(/^"|"$/g, "") || "";
      });
      rows.push(row as ParsedRow);
    }

    return rows;
  };

  // Handle CSV values with commas inside quotes
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSV(text);
        setParsedRows(rows);
        setStep("preview");
      } catch (error: any) {
        setParseError(error.message);
      }
    };
    reader.onerror = () => {
      setParseError("Failed to read file");
    };
    reader.readAsText(selectedFile);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith(".csv")) {
      handleFileSelect(droppedFile);
    } else {
      setParseError("Please upload a CSV file");
    }
  }, [handleFileSelect]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleImport = async () => {
    setImporting(true);
    setStep("importing");

    try {
      const res = await fetch("/api/sales/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });

      const data = await res.json();

      if (!data.success) {
        setParseError(data.error || "Import failed");
        setStep("preview");
        return;
      }

      setSummary(data.summary);
      setResults(data.results || []);
      setCreatedSkus(data.createdSkus || []);
      setStep("results");

      if (data.summary.imported > 0 && onImportComplete) {
        onImportComplete();
      }
    } catch (error: any) {
      setParseError(error.message || "Import failed");
      setStep("preview");
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    window.location.href = "/api/sales/import";
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleClose();
      else setOpen(true);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Sales Data</DialogTitle>
          <DialogDescription>
            Upload a CSV file with historical sales data for channel reporting and analysis
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto py-4">
          {/* Upload Step */}
          {step === "upload" && (
            <div className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
                onDrop={handleDrop}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
              >
                <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">
                  Drop your CSV file here
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  or click to browse
                </p>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="csv-upload"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />
                <Button asChild variant="secondary">
                  <label htmlFor="csv-upload" className="cursor-pointer">
                    Select File
                  </label>
                </Button>
              </div>

              {parseError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{parseError}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">Need a template?</p>
                  <p className="text-sm text-muted-foreground">
                    Download our CSV template with all supported columns
                  </p>
                </div>
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="mr-2 h-4 w-4" />
                  Template
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-2">Required columns:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><code>sku_code</code> - SKU identifier (auto-created if not in system)</li>
                  <li><code>sale_date</code> - Date in YYYY-MM-DD format</li>
                  <li><code>quantity</code> - Number of units sold</li>
                  <li><code>unit_price</code> - Price per unit</li>
                </ul>
                <p className="font-medium mt-4 mb-2">Optional columns:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><code>platform</code> - Sales channel (shopify, amazon, etc.)</li>
                  <li><code>order_id</code> - Order reference number</li>
                  <li><code>order_type</code> - actual_sale or pre_order</li>
                  <li><code>fulfilled</code> - yes/no</li>
                  <li><code>fulfilled_date</code> - Fulfillment date</li>
                  <li><code>notes</code> - Additional notes</li>
                </ul>
              </div>
            </div>
          )}

          {/* Preview Step */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{file?.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {parsedRows.length} rows ready to import
                  </p>
                </div>
                <Button variant="outline" onClick={resetState}>
                  Choose Different File
                </Button>
              </div>

              {parseError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{parseError}</AlertDescription>
                </Alert>
              )}

              <div className="border rounded-lg overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>SKU Code</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>Platform</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.slice(0, 50).map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {row.sku_code}
                        </TableCell>
                        <TableCell>{row.sale_date}</TableCell>
                        <TableCell className="text-right">{row.quantity}</TableCell>
                        <TableCell className="text-right">
                          ${parseFloat(row.unit_price || "0").toFixed(2)}
                        </TableCell>
                        <TableCell>{row.platform || "manual"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {parsedRows.length > 50 && (
                <p className="text-sm text-muted-foreground text-center">
                  Showing first 50 of {parsedRows.length} rows
                </p>
              )}
            </div>
          )}

          {/* Importing Step */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-lg font-medium">Importing sales data...</p>
              <p className="text-sm text-muted-foreground">
                Processing {parsedRows.length} rows
              </p>
            </div>
          )}

          {/* Results Step */}
          {step === "results" && summary && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
                  <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-green-600">
                    {summary.imported}
                  </p>
                  <p className="text-sm text-muted-foreground">Imported</p>
                </div>
                <div className="text-center p-4 bg-red-50 dark:bg-red-950/30 rounded-lg">
                  <XCircle className="h-8 w-8 text-red-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-red-600">
                    {summary.failed}
                  </p>
                  <p className="text-sm text-muted-foreground">Failed</p>
                </div>
                <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                  <FileSpreadsheet className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-blue-600">
                    {summary.skusCreated}
                  </p>
                  <p className="text-sm text-muted-foreground">SKUs Created</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <FileSpreadsheet className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-2xl font-bold">{summary.total}</p>
                  <p className="text-sm text-muted-foreground">Total Rows</p>
                </div>
              </div>

              {createdSkus.length > 0 && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    <span className="font-medium">New SKUs created:</span>{" "}
                    {createdSkus.slice(0, 10).join(", ")}
                    {createdSkus.length > 10 && ` and ${createdSkus.length - 10} more`}
                  </AlertDescription>
                </Alert>
              )}

              {results.filter((r) => !r.success).length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-destructive">
                    Errors ({results.filter((r) => !r.success).length})
                  </p>
                  <div className="border rounded-lg overflow-auto max-h-[200px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Row</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results
                          .filter((r) => !r.success)
                          .slice(0, 50)
                          .map((result, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{result.row}</TableCell>
                              <TableCell className="font-mono text-sm">
                                {result.sku_code}
                              </TableCell>
                              <TableCell className="text-destructive">
                                {result.error}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={importing || parsedRows.length === 0}>
                Import {parsedRows.length} Rows
              </Button>
            </>
          )}
          {step === "results" && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
