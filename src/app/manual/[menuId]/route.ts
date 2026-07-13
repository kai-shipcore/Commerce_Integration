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
  const koHtml = sections[entry.sectionId] ?? fallback;
  const enHtml = sections[`en-${entry.sectionId}`] ?? koHtml;

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
