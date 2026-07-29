/**
 * Code Guide:
 * GET /api/swagger-ui/[...file] — Serves swagger-ui-dist's static assets
 * (CSS/JS) straight from node_modules so /api-docs no longer depends on an
 * external CDN (unpkg.com), which is blocked on some corporate networks.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DIST_DIR = path.join(process.cwd(), "node_modules", "swagger-ui-dist");

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ file: string[] }> },
) {
  const { file } = await context.params;
  const requested = path.normalize(path.join(DIST_DIR, ...file));

  if (requested !== DIST_DIR && !requested.startsWith(DIST_DIR + path.sep)) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  try {
    const data = await readFile(requested);
    const contentType = CONTENT_TYPES[path.extname(requested)] ?? "application/octet-stream";
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
}
