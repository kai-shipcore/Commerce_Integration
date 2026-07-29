"use client";

// Code Guide: Client half of /api-docs. Split out from page.tsx (a Server
// Component, so it can keep the `metadata` export) because initializing
// Swagger UI needs an onLoad callback, which only works from a Client
// Component. Using Script's onLoad (instead of a second inline script that
// runs the moment it's inserted) avoids a race where the init code could run
// before swagger-ui-bundle.js has finished loading and defined the global.

import { useEffect, useState } from "react";
import Script from "next/script";

interface SwaggerUIBundleOptions {
  url: string;
  dom_id: string;
  deepLinking: boolean;
  presets: unknown[];
  layout: string;
}

declare global {
  interface Window {
    SwaggerUIBundle?: ((options: SwaggerUIBundleOptions) => void) & {
      presets: { apis: unknown };
    };
  }
}

export function SwaggerDocs({
  cssHref,
  bundleSrc,
  openApiUrl,
}: {
  cssHref: string;
  bundleSrc: string;
  openApiUrl: string;
}) {
  const [bundleReady, setBundleReady] = useState(false);

  useEffect(() => {
    if (!bundleReady || !window.SwaggerUIBundle) return;
    window.SwaggerUIBundle({
      url: openApiUrl,
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [window.SwaggerUIBundle.presets.apis],
      layout: "BaseLayout",
    });
  }, [bundleReady, openApiUrl]);

  return (
    <>
      <link rel="stylesheet" href={cssHref} />
      <div id="swagger-ui" className="min-h-[calc(100vh-81px)]" />
      <Script src={bundleSrc} strategy="afterInteractive" onLoad={() => setBundleReady(true)} />
    </>
  );
}
