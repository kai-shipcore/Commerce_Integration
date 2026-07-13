// Code Guide: Serves demo video/media files embedded in a manual section,
// gated by the same permission as the doc page itself (see manual-docs'
// MANUAL_VIDEO_BY_MENU_ID + manual-access's checkManualAccess). Supports
// HTTP Range requests since browsers need them to seek/scrub <video>.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { checkManualAccess } from "@/lib/manual-access";
import { MANUAL_VIDEO_BY_MENU_ID } from "@/lib/manual-docs";

const MEDIA_DIR = path.join(process.cwd(), "src/content/manual/media");

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const filename = MANUAL_VIDEO_BY_MENU_ID[menuId];
  if (!filename) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const denied = await checkManualAccess(menuId);
  if (denied) return denied;

  const filePath = path.join(MEDIA_DIR, filename);
  const stat = fs.statSync(filePath);
  const contentType = CONTENT_TYPE_BY_EXT[path.extname(filename)] ?? "application/octet-stream";

  const range = request.headers.get("range");
  if (!range) {
    const body = fs.readFileSync(filePath);
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const match = /bytes=(\d+)-(\d+)?/.exec(range);
  const start = match?.[1] ? parseInt(match[1], 10) : 0;
  const end = match?.[2] ? Math.min(parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
  const chunkSize = end - start + 1;

  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(chunkSize);
  fs.readSync(fd, buffer, 0, chunkSize, start);
  fs.closeSync(fd);

  return new NextResponse(buffer, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": String(chunkSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
