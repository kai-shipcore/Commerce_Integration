// Code Guide: Serves per-menu help documentation, gated by the same
// permission the underlying page itself requires. Replaces the old
// public/manual/*.html static files, which any visitor could load
// directly regardless of role or menu permission.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { checkManualAccess } from "@/lib/manual-access";
import { MANUAL_DOC_BY_MENU_ID, DEFAULT_MANUAL_MENU_ID } from "@/lib/manual-docs";
import { renderManualSectionPage, rewriteScreenshotPaths, rewriteMediaPaths } from "@/lib/manual-shell";
import { withBasePath } from "@/lib/api-path";

const CONTENT_DIR = path.join(process.cwd(), "src/content/manual");

function applyCurrentManualCorrections(sectionId: string, html: string): string {
  if (sectionId === "sku-master") {
    return html
      .replace(
        "CBM 일괄 업로드 (.xlsx)",
        "CBM·MOQ·발주 배수 일괄 업로드 (.xlsx / .xls / .csv, 적용 전 미리보기)",
      )
      .replace(
        "<tr><th style=\"width:140px\">항목</th><th>설명</th><th style=\"width:120px\">예시</th></tr>",
        "<tr><th style=\"width:140px\">항목</th><th>설명</th><th style=\"width:220px\">예시</th></tr>",
      )
      .replace(
        "<div><b>일괄 CBM 업데이트:</b> <span class=\"btn-label\">엑셀 가져오기</span>로 여러 SKU의 CBM을 한 번에 업데이트할 수 있습니다. Master SKU·CBM 두 컬럼이 있는 .xlsx 파일을 업로드하면 됩니다.</div>",
        "<div><b>엑셀/CSV 일괄 업데이트:</b> <span class=\"btn-label\">엑셀 가져오기</span>에서 템플릿을 다운로드하거나 <code>.xlsx</code>, <code>.xls</code>, <code>.csv</code> 파일을 선택합니다. 지원 컬럼은 <strong>Master SKU(필수) · CBM · MOQ · Order Multiple</strong>이며, 값이 입력된 컬럼만 업데이트됩니다. 파일 선택 후 <strong>신규 추가 · 기존 수정 · 변경 없음</strong> 건수와 필드별 <strong>기존값 → 새 값</strong>을 검토하고, <span class=\"btn-label\">확인 후 적용</span>을 눌러야 데이터베이스에 반영됩니다. CBM은 0보다 큰 숫자, MOQ와 Order Multiple은 1 이상의 정수여야 합니다.</div>",
      )
      .replace(
        "Bulk CBM upload (.xlsx)",
        "Bulk CBM, MOQ, and Order Multiple upload (.xlsx / .xls / .csv) with change preview",
      )
      .replace(
        "<tr><th style=\"width:160px\">Item</th><th>Description</th><th style=\"width:160px\">Example</th></tr>",
        "<tr><th style=\"width:160px\">Item</th><th>Description</th><th style=\"width:220px\">Example</th></tr>",
      )
      .replace(
        "<div><b>Bulk CBM Update:</b> Use <span class=\"btn-label\">Excel Import</span> to update CBM for multiple SKUs at once. Upload an .xlsx file with Master SKU and CBM columns.</div>",
        "<div><b>Bulk Excel/CSV Update:</b> Download the template or choose a <code>.xlsx</code>, <code>.xls</code>, or <code>.csv</code> file from <span class=\"btn-label\">Excel Import</span>. Supported columns are <strong>Master SKU (required), CBM, MOQ, and Order Multiple</strong>; only populated value columns are updated. After choosing a file, review the <strong>New · Updated · Unchanged</strong> counts and each field's <strong>current → new</strong> value. Nothing is written until you click <span class=\"btn-label\">Confirm &amp; Apply</span>. CBM must be greater than zero, while MOQ and Order Multiple must be integers of at least 1.</div>",
      );
  }

  if (sectionId !== "demand-planning") return html;

  return html
    .replace(
      "모드 · 서부 재고 · 동부 재고 · 운송 중 재고 · 전체 재고",
      "Fullerton · Canary · TTM · TTM Jeff · 서부 재고 · 동부 재고 · 운송 중 재고 · 전체 재고",
    )
    .replace(
      "재고 현황. <strong>모드</strong>: 재고 계산 기준을 전환합니다. <strong>현재고</strong>: 실물 재고 수량 기준. <strong>가용 재고</strong>: 가용 재고 관리에서 배정된 수량을 차감한 기준.",
      "창고별 가용 재고 현황입니다. <strong>서부 재고</strong>는 Fullerton + Canary, <strong>동부 재고</strong>는 TTM + TTM Jeff이며, <strong>전체 재고</strong>는 서부 가용재고 + 동부 가용재고 + 운송 중 재고입니다.",
    )
    .replace(
      "Mode · West Stock · East Stock · Transit Stock · Total Stock",
      "Fullerton · Canary · TTM · TTM Jeff · West Stock · East Stock · Transit Stock · Total Stock",
    )
    .replace(
      "Inventory figures. <strong>Mode</strong> switches the calculation basis: <strong>Onhand</strong> = raw warehouse stock count; <strong>Available</strong> = on-hand minus quantities allocated from Available Stock.",
      "Available inventory by warehouse. <strong>West Stock</strong> is Fullerton + Canary, <strong>East Stock</strong> is TTM + TTM Jeff, and <strong>Total Stock</strong> is West available + East available + Transit Stock.",
    );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ menuId: string }> }) {
  const { menuId: requestedMenuId } = await params;
  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("lang") === "en" ? "en" : "ko";

  const knownEntry = MANUAL_DOC_BY_MENU_ID[requestedMenuId];
  const menuId = knownEntry ? requestedMenuId : DEFAULT_MANUAL_MENU_ID;
  const entry = knownEntry ?? MANUAL_DOC_BY_MENU_ID[DEFAULT_MANUAL_MENU_ID];

  const denied = await checkManualAccess(menuId);
  if (denied) return denied;

  const screenshotsUrl = withBasePath("/manual/screenshots");
  const mediaUrl = withBasePath("/manual/media");
  const homeHref = withBasePath("/");
  const overviewHref = withBasePath(`/manual/${DEFAULT_MANUAL_MENU_ID}?lang=${locale}`);

  const sections: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(CONTENT_DIR, "sections.json"), "utf-8"),
  );
  const fallback = "<section class=\"page-section\"><p>이 페이지의 도움말이 아직 준비되지 않았습니다.</p></section>";
  const koHtml = applyCurrentManualCorrections(entry.sectionId, sections[entry.sectionId] ?? fallback);
  const enHtml = applyCurrentManualCorrections(entry.sectionId, sections[`en-${entry.sectionId}`] ?? koHtml);

  const prepare = (html: string) => rewriteMediaPaths(rewriteScreenshotPaths(html, screenshotsUrl), mediaUrl);

  const html = renderManualSectionPage({
    koHtml: prepare(koHtml),
    enHtml: prepare(enHtml),
    initialLocale: locale,
    homeHref,
    overviewHref,
    isOverview: menuId === DEFAULT_MANUAL_MENU_ID,
  });

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
