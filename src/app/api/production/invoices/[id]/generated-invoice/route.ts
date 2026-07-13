// Code Guide: Generates a commercial invoice workbook for a selected Invoice,
// matching the factory-provided sample layout used by Invoice Price Control.

import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

type InvoiceHeader = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  factoryName: string;
  containerNumber: string | null;
};

type InvoiceLine = {
  sku: string;
  qty: number;
  unitPrice: number;
};

type AppliedCredit = {
  sourceInvoiceNumber: string | null;
  sku: string;
  qty: number;
  invoiceUnitPrice: number | null;
  expectedUnitPrice: number | null;
  creditAmount: number;
  appliedDate: string | null;
};

function serializeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function excelDate(value: string | null) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `${month}.${date.getUTCDate()},${date.getUTCFullYear()}`;
}

function safeSheetName(name: string) {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "invoice";
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function downloadStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
}

function moneyNumber(value: number) {
  return Number(value.toFixed(2));
}

async function loadInvoice(id: string) {
  const pool = getPrimaryPool();
  const [headerResult, itemsResult, creditsResult] = await Promise.all([
    pool.query(
      `SELECT
         i.id::text AS id,
         i.invoice_number,
         i.invoice_date::text AS invoice_date,
         i.container_number,
         f.factory_name
       FROM shipcore.fc_invoices i
       JOIN shipcore.fc_factories f ON f.id = i.factory_id
       WHERE i.id = $1::bigint`,
      [id],
    ),
    pool.query(
      `SELECT sku, qty, invoice_unit_price
       FROM shipcore.fc_invoice_items
       WHERE invoice_id = $1::bigint
       ORDER BY id ASC`,
      [id],
    ),
    pool.query(
      `SELECT
         source.invoice_number AS source_invoice_number,
         cn.sku,
         cn.qty,
         cn.invoice_unit_price,
         cn.expected_unit_price,
         cn.credit_amount,
         cn.applied_date::text AS applied_date
       FROM shipcore.fc_credit_notes cn
       LEFT JOIN shipcore.fc_invoices source ON source.id = cn.source_invoice_id
       WHERE cn.applied_invoice_id = $1::bigint
         AND cn.status = 'applied'
       ORDER BY cn.applied_date DESC NULLS LAST, cn.id ASC`,
      [id],
    ),
  ]);

  if (headerResult.rowCount === 0) return null;
  const headerRow = headerResult.rows[0];
  return {
    header: {
      id: headerRow.id as string,
      invoiceNumber: headerRow.invoice_number as string,
      invoiceDate: serializeDate(headerRow.invoice_date),
      factoryName: headerRow.factory_name as string,
      containerNumber: headerRow.container_number as string | null,
    } satisfies InvoiceHeader,
    items: itemsResult.rows.map((row) => ({
      sku: row.sku as string,
      qty: Number(row.qty),
      unitPrice: Number(row.invoice_unit_price),
    })) satisfies InvoiceLine[],
    credits: creditsResult.rows.map((row) => ({
      sourceInvoiceNumber: row.source_invoice_number as string | null,
      sku: row.sku as string,
      qty: Number(row.qty),
      invoiceUnitPrice: row.invoice_unit_price == null ? null : Number(row.invoice_unit_price),
      expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price),
      creditAmount: Number(row.credit_amount),
      appliedDate: serializeDate(row.applied_date),
    })) satisfies AppliedCredit[],
  };
}

function productGroup(items: InvoiceLine[]) {
  const skuText = items.map((item) => item.sku.toUpperCase()).join(" ");
  if (skuText.includes("SEAT") || skuText.includes("-SC-")) return "SEAT COVER";
  if (skuText.includes("FLOOR")) return "FLOOR MAT";
  return "CAR COVER";
}

function styleWorksheet(ws: ExcelJS.Worksheet) {
  ws.properties.defaultRowHeight = 15.5;
  ws.columns = [
    { key: "A", width: 10.25 },
    { key: "B", width: 10.83 },
    { key: "C", width: 24.75 },
    { key: "D", width: 18.25 },
    { key: "E", width: 6 },
    { key: "F", width: 4.08 },
    { key: "G", width: 3.58 },
    { key: "H", width: 12.75 },
    { key: "I", width: 15.75 },
    { key: "J", width: 10.5 },
  ];

  for (const row of [2, 8, 9, 10, 11, 20, 21, 22, 23, 24]) {
    ws.getRow(row).height = row === 21 ? 37 : row === 2 ? 20.5 : 15.5;
  }

  const merges = ["A2:I2", "A3:I3", "A4:I4", "A5:I5", "D11:G11", "D12:G12", "A18:C18", "A20:B21", "C20:G21", "H20:H21", "I20:I21", "H22:I22"];
  for (const range of merges) ws.mergeCells(range);

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "middle" };
    });
  });

  for (const row of [2, 3, 4, 5]) {
    const cell = ws.getCell(`A${row}`);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { name: "Arial", size: row === 2 ? 14 : 10, bold: row <= 3 };
  }

  for (const addr of ["D11", "D12"]) {
    ws.getCell(addr).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(addr).font = { name: "Arial", size: 12, bold: true };
  }
}

function borderRange(ws: ExcelJS.Worksheet, fromRow: number, toRow: number) {
  const border = { style: "thin" as const };
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let col = 1; col <= 9; col += 1) {
      ws.getCell(row, col).border = { top: border, left: border, right: border, bottom: border };
    }
  }
}

function styleCreditDetailTable(ws: ExcelJS.Worksheet, headerRow: number, lastRow: number) {
  const border = { style: "thin" as const };
  for (let row = headerRow; row <= lastRow; row += 1) {
    for (let col = 1; col <= 9; col += 1) {
      const cell = ws.getCell(row, col);
      cell.border = { top: border, left: border, right: border, bottom: border };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (row === headerRow) {
        cell.font = { name: "Arial", size: 10, bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      }
    }
  }
}

function fillCreditDetails(ws: ExcelJS.Worksheet, startRow: number, credits: AppliedCredit[]) {
  ws.getCell(startRow, 1).value = "Credit Applied Details";
  ws.getCell(startRow, 1).font = { name: "Arial", size: 11, bold: true };
  ws.mergeCells(startRow, 1, startRow, 9);

  const headerRow = startRow + 1;
  const headers = ["원본 Invoice", "SKU", "Qty", "Invoice 가격", "기준 가격", "Credit", "적용일"];
  ws.getCell(headerRow, 1).value = headers[0];
  ws.getCell(headerRow, 3).value = headers[1];
  ws.getCell(headerRow, 5).value = headers[2];
  ws.getCell(headerRow, 6).value = headers[3];
  ws.getCell(headerRow, 7).value = headers[4];
  ws.getCell(headerRow, 8).value = headers[5];
  ws.getCell(headerRow, 9).value = headers[6];

  if (credits.length === 0) {
    const emptyRow = headerRow + 1;
    ws.getCell(emptyRow, 1).value = "No applied credits";
    ws.mergeCells(emptyRow, 1, emptyRow, 9);
    ws.getCell(emptyRow, 1).alignment = { vertical: "middle", horizontal: "center" };
    ws.getCell(emptyRow, 1).font = { name: "Arial", size: 10, italic: true, color: { argb: "FF6B7280" } };
    styleCreditDetailTable(ws, headerRow, emptyRow);
    return emptyRow + 2;
  }

  credits.forEach((credit, index) => {
    const row = headerRow + 1 + index;
    ws.getCell(row, 1).value = credit.sourceInvoiceNumber ?? "-";
    ws.getCell(row, 3).value = credit.sku;
    ws.getCell(row, 5).value = credit.qty;
    ws.getCell(row, 6).value = credit.invoiceUnitPrice == null ? "-" : moneyNumber(credit.invoiceUnitPrice);
    ws.getCell(row, 7).value = credit.expectedUnitPrice == null ? "-" : moneyNumber(credit.expectedUnitPrice);
    ws.getCell(row, 8).value = -moneyNumber(credit.creditAmount);
    ws.getCell(row, 9).value = credit.appliedDate ?? "-";
    for (const col of [6, 7, 8]) ws.getCell(row, col).numFmt = "$#,##0.00;-$#,##0.00";
    ws.getCell(row, 1).font = { name: "Arial", size: 10, bold: true };
    ws.getCell(row, 8).font = { name: "Arial", size: 10, bold: true, color: { argb: "FFB91C1C" } };
  });

  const lastRow = headerRow + credits.length;
  styleCreditDetailTable(ws, headerRow, lastRow);
  return lastRow + 2;
}

function fillHeader(ws: ExcelJS.Worksheet, header: InvoiceHeader) {
  ws.getCell("A2").value = "浙江天鸿汽车用品有限公司";
  ws.getCell("A3").value = "ZHEJIANG TIANHONG AUTO ACCESSORIES  CO.,LTD";
  ws.getCell("A4").value = "地址：中国浙江省天台县坦头镇西工业区";
  ws.getCell("A5").value = "ADDRESS:Tantou West Industrial Zone,Tiantai,Zhejiang,China";
  ws.getCell("B6").value = "Tel：0086-576-3723666  3723888   Fax：0086-576-3723688 3723788";

  ws.getCell("A8").value = "TO: iCarCover, Inc ";
  ws.getCell("A9").value = "Address: 16111 CANARY AVE.LA MIRADA,";
  ws.getCell("A10").value = "CA 90638 ";
  ws.getCell("H8").value = "编号";
  ws.getCell("H9").value = `NO.:${header.invoiceNumber}`;
  ws.getCell("H10").value = "合约号：";
  ws.getCell("D11").value = "商业发票";
  ws.getCell("H11").value = "";
  ws.getCell("D12").value = "COMMERCIAL INVOICE";
  ws.getCell("H12").value = "日期:";
  ws.getCell("H13").value = `DATE:${excelDate(header.invoiceDate)}`;

  ws.getCell("A15").value = "装船口岸";
  ws.getCell("B15").value = "NINGBO,CHINA";
  ws.getCell("E15").value = "目的地";
  ws.getCell("F15").value = "LOS ANGELES,CA";
  ws.getCell("A16").value = "From ";
  ws.getCell("E16").value = "To";
  ws.getCell("A17").value = "信用证号数";
  ws.getCell("E17").value = "开证银行";
  ws.getCell("A18").value = "Letter Of Credit No.";
  ws.getCell("E18").value = "Issued By";

  ws.getCell("A20").value = "唛头与号码              Shipping Marks & Numbers";
  ws.getCell("C20").value = "货名与数量                Description & Quantities";
  ws.getCell("H20").value = "单价           unit price";
  ws.getCell("I20").value = "总额                    Amount";
  ws.getCell("H22").value = "FOB NINGBO";
  ws.getCell("C23").value = `CONTAINER FOR 1X45'HQ,CONTAINER/SEAL NUMBER:${header.containerNumber ?? ""}`;
}

function fillBankDetails(ws: ExcelJS.Worksheet, startRow: number) {
  const lines = [
    "TIANHONG’S USD BANK DETAILS:",
    "Beneficiary account number: 362358358971",
    "Swift code:BKCHCNBJ92J",
    "Beneficiary name:Zhejiang Tianhong Auto Accessories Co., Ltd.",
    "Beneficiary address:Tantou west industrial zone,Tiantai,Zhejiang,China",
    "Beneficiary bank:Bank of China,Zhejiang Branch,Tiantai SUB-Branch",
    "Beneficiary bank address: RENMING WEST ROAD NO.167,TIANTAI,ZHEJIANG,CHINA.",
  ];
  lines.forEach((line, index) => {
    ws.getCell(startRow + index, 3).value = line;
  });
}

function addInvoiceSheet(workbook: ExcelJS.Workbook, name: string, header: InvoiceHeader, items: InvoiceLine[], credits: AppliedCredit[]) {
  const ws = workbook.addWorksheet(safeSheetName(name), { views: [{ showGridLines: false }] });
  styleWorksheet(ws);
  fillHeader(ws, header);

  const startRow = 25;
  const totalRow = startRow + items.length;
  ws.getCell("A24").value = "CAR COVER";
  ws.getCell("C24").value = productGroup(items);

  items.forEach((item, index) => {
    const row = startRow + index;
    ws.getCell(row, 3).value = item.sku;
    ws.getCell(row, 5).value = item.qty;
    ws.getCell(row, 6).value = "PCS";
    ws.getCell(row, 8).value = moneyNumber(item.unitPrice);
    ws.getCell(row, 9).value = { formula: `E${row}*H${row}` };
    ws.getCell(row, 8).numFmt = "$#,##0.00";
    ws.getCell(row, 9).numFmt = "$#,##0.00";
  });

  ws.getCell(totalRow, 3).value = "TTL:";
  ws.getCell(totalRow, 5).value = { formula: `SUM(E${startRow}:E${totalRow - 1})` };
  ws.getCell(totalRow, 6).value = "PCS";
  ws.getCell(totalRow, 9).value = { formula: `SUM(I${startRow}:I${totalRow - 1})` };
  ws.getCell(totalRow, 9).numFmt = "$#,##0.00";

  const depositRow = totalRow + 1;
  const reduceRow = totalRow + 2;
  const balanceRow = totalRow + 3;
  const creditTotal = credits.reduce((sum, credit) => sum + credit.creditAmount, 0);
  ws.getCell(depositRow, 8).value = "GOT DEPOSIT:";
  ws.getCell(depositRow, 9).value = 0;
  ws.getCell(reduceRow, 8).value = "REDUCE";
  ws.getCell(reduceRow, 9).value = moneyNumber(creditTotal);
  ws.getCell(balanceRow, 8).value = "Balance";
  ws.getCell(balanceRow, 9).value = { formula: `I${totalRow}-I${depositRow}-I${reduceRow}` };
  for (const row of [depositRow, reduceRow, balanceRow]) ws.getCell(row, 9).numFmt = "$#,##0.00";

  const footerStart = fillCreditDetails(ws, balanceRow + 3, credits);

  borderRange(ws, 20, totalRow);
  fillBankDetails(ws, footerStart);
  ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  const { id } = await params;
  const loaded = await loadInvoice(id);
  if (!loaded) return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });

  const { header, items, credits } = loaded;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ShipCore";
  workbook.created = new Date();

  addInvoiceSheet(workbook, "payment invoice", header, items, credits);
  for (const worksheet of [...workbook.worksheets]) {
    if (worksheet.name !== "payment invoice") workbook.removeWorksheet(worksheet.id);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = safeFileName(`${header.invoiceNumber || "invoice"} payment invoice ${downloadStamp()}.xlsx`);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
