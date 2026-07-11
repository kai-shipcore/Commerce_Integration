/**
 * One-time / re-runnable build script.
 * Splits src/content/manual/index-source.html (the old combined manual)
 * into per-section HTML fragments so each can be served individually,
 * gated by the viewing user's permission for that menu.
 *
 * Usage: npx tsx scripts/extract-manual-sections.ts
 * Output: src/content/manual/sections.json — { [sectionId]: htmlFragment }
 */

import fs from "fs";
import path from "path";

const SOURCE = path.join(__dirname, "../src/content/manual/index-source.html");
const OUT = path.join(__dirname, "../src/content/manual/sections.json");

function extractBalanced(html: string, openTagStart: number): string {
  // openTagStart points at the `<section` of the opening tag we want to extract.
  // Advance past the opening tag itself first.
  const firstTagEnd = html.indexOf(">", openTagStart);
  let cursor = firstTagEnd + 1;
  let depth = 1;

  while (depth > 0) {
    const nextOpen = html.indexOf("<section", cursor);
    const nextClose = html.indexOf("</section>", cursor);
    if (nextClose === -1) throw new Error("Unbalanced <section> tags in source file");

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = html.indexOf(">", nextOpen) + 1;
    } else {
      depth -= 1;
      cursor = nextClose + "</section>".length;
    }
  }

  return html.slice(openTagStart, cursor);
}

function extractSectionById(html: string, id: string): string | null {
  const marker = `<section class="page-section" id="${id}"`;
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  return extractBalanced(html, idx);
}

function main() {
  const html = fs.readFileSync(SOURCE, "utf-8");

  const idMatches = [...html.matchAll(/<section class="page-section" id="([a-zA-Z0-9_-]+)"/g)];
  const ids = idMatches.map((m) => m[1]);

  const sections: Record<string, string> = {};
  for (const id of ids) {
    const fragment = extractSectionById(html, id);
    if (!fragment) {
      console.warn(`⚠️  Could not extract section: ${id}`);
      continue;
    }
    sections[id] = fragment;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(sections, null, 2), "utf-8");

  console.log(`✅ Extracted ${Object.keys(sections).length} sections → ${path.relative(process.cwd(), OUT)}`);
  console.log(Object.keys(sections).join(", "));
}

main();
