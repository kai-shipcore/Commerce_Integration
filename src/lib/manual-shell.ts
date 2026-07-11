/**
 * Code Guide:
 * Renders a single-topic help page (one manual section, ko/en toggle)
 * around the shared CSS pulled from the original combined manual, so
 * split-out pages keep the exact same look without a giant sidebar.
 */

import fs from "fs";
import path from "path";

const CONTENT_DIR = path.join(process.cwd(), "src/content/manual");

let cachedCss: string | null = null;

export function getSharedManualCss(): string {
  if (cachedCss) return cachedCss;
  cachedCss = fs.readFileSync(path.join(CONTENT_DIR, "shared.css"), "utf-8");
  return cachedCss;
}

export function rewriteScreenshotPaths(html: string, screenshotsBaseUrl: string): string {
  return html.replaceAll('src="screenshots/', `src="${screenshotsBaseUrl}/`);
}

export function rewriteMediaPaths(html: string, mediaBaseUrl: string): string {
  return html.replaceAll('src="media/', `src="${mediaBaseUrl}/`);
}

export function renderManualSectionPage(options: {
  koHtml: string;
  enHtml: string;
  initialLocale: "ko" | "en";
  homeHref: string;
}): string {
  const { koHtml, enHtml, initialLocale, homeHref } = options;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Demand Pilot – 도움말</title>
<style>
${getSharedManualCss()}
.manual-topbar {
  position: sticky; top: 0; z-index: 40;
  display: flex; align-items: center; justify-content: space-between;
  background: #111827; color: #e2e8f0; padding: 12px 24px;
}
.manual-topbar a { color: #93c5fd; text-decoration: none; font-size: 13px; font-weight: 600; }
.manual-topbar a:hover { text-decoration: underline; }
.section-wrap { display: none; }
.section-wrap.ko-only { display: block; }
body.lang-en .section-wrap.ko-only { display: none; }
body.lang-en .section-wrap.en-only { display: block; }
.main { max-width: none; }
.main .page-section { border-bottom: none; }
</style>
</head>
<body class="${initialLocale === "en" ? "lang-en" : ""}">
<div class="manual-topbar">
  <a href="${homeHref}">← Demand Pilot</a>
  <div class="language-toggle" aria-label="Language selector" style="position:static;box-shadow:none;background:transparent;border:none;padding:0;">
    <button type="button" data-lang-button="ko">KO</button>
    <button type="button" data-lang-button="en">EN</button>
  </div>
</div>
<main class="main">
  <div class="section-wrap ko-only">${koHtml}</div>
  <div class="section-wrap en-only">${enHtml}</div>
</main>
<script>
  document.querySelectorAll('[data-lang-button]').forEach(function (button) {
    button.addEventListener('click', function () {
      var language = button.getAttribute('data-lang-button') || 'ko';
      document.body.classList.toggle('lang-en', language === 'en');
    });
  });
</script>
</body>
</html>`;
}
