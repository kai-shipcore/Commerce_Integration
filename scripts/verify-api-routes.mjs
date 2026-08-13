#!/usr/bin/env node
/**
 * Check that every internal API URL the app calls still has a route file.
 *
 *   node scripts/verify-api-routes.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-13 the Demand Forecast page, SKU Planning's forecast tab and
 * fourteen proxy routes under /api/forecast/ were deleted. TypeScript cannot
 * catch what that breaks: a fetch URL is a string, so removing the route it
 * points at compiles cleanly and fails at runtime, on whichever screen someone
 * opens next week.
 *
 * This walks src/app/api for the routes that exist, collects every "/api/..."
 * string literal in the app, and reports any that no longer resolve. Dynamic
 * segments are matched by shape, so `/api/planning/sku/${sku}` matches
 * src/app/api/planning/sku/[sku]/route.ts.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not check external URLs, or URLs assembled from variables with no
 * literal prefix. A URL built entirely at runtime is invisible here, and the
 * only defence against that is not doing it.
 *
 * Exit code 0 if everything resolves, 1 otherwise.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const API_DIR = join(ROOT, "src", "app", "api");
const SRC = join(ROOT, "src");

/** Every route the app actually serves, as a path with [dynamic] segments. */
function collectRoutes(dir, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...collectRoutes(full, `${prefix}/${e.name}`));
    } else if (e.name === "route.ts" || e.name === "route.tsx") {
      out.push(prefix || "/");
    }
  }
  return out;
}

/**
 * A route path as a regex.
 *
 *   [slug]     matches exactly one URL segment
 *   [...slug]  matches zero or more, INCLUDING zero
 *
 * The zero case is not a technicality. NextAuth is mounted at
 * src/app/api/auth/[...nextauth]/route.ts and the app passes "/api/auth" as its
 * basePath, with the library appending /signin, /session and the rest itself.
 * Requiring at least one segment reports that bare basePath as a broken call,
 * which is how the first version of this script produced three false failures.
 */
function routeToRegex(route) {
  const segs = route.split("/").filter(Boolean);
  let body = "";
  for (const seg of segs) {
    if (/^\[\.\.\..+\]$/.test(seg)) {
      body += "(?:/[^/]+)*";
    } else if (/^\[.+\]$/.test(seg)) {
      body += "/[^/]+";
    } else {
      body += "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${body}$`);
}

function walkFiles(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walkFiles(full, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(full);
    }
  }
  return out;
}

const routes = collectRoutes(API_DIR, "/api");
const matchers = routes.map((r) => ({ route: r, re: routeToRegex(r) }));

// "/api/..." inside a string or template literal, up to the first ? or backtick.
// A ${...} becomes a wildcard segment, so template literals are checked by shape.
const URL_RE = /["'`](\/api\/[^"'`\s]*)["'`]/g;

const problems = [];
const checked = new Set();

for (const file of walkFiles(SRC, [".ts", ".tsx"])) {
  // Route files describe themselves; their own comments mention sibling paths.
  if (file.includes(join("src", "app", "api"))) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(URL_RE)) {
    let url = m[1];
    url = url.split("?")[0].replace(/\$\{[^}]*\}/g, "X").replace(/\/+$/, "");
    if (!url.startsWith("/api/")) continue;
    const key = `${relative(ROOT, file)}::${url}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (!matchers.some(({ re }) => re.test(url))) {
      problems.push(`${relative(ROOT, file)} calls ${url}, which has no route`);
    }
  }
}

console.log(`${routes.length} API routes found under src/app/api`);
console.log(`${checked.size} distinct internal API calls checked\n`);

// Negative control: a URL that cannot exist must be reported, or this script is
// asserting nothing. A check that cannot fail is worse than no check.
const controlMatched = matchers.some(({ re }) => re.test("/api/__verify_control__"));
if (controlMatched) {
  console.error("FAIL  a nonexistent path matched a route; this check is not working");
  process.exit(1);
}

if (problems.length) {
  console.error(`FAIL  ${problems.length} unresolved API call(s):`);
  for (const p of problems) console.error(`        ${p}`);
  process.exit(1);
}

console.log("ok    every internal API call resolves to a route");
