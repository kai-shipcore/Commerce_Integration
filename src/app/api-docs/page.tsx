import Script from "next/script";

export const metadata = {
  title: "API Docs | Demand Pilot",
  description: "Swagger UI for the application API routes",
};

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-white">
      <link
        rel="stylesheet"
        href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"
      />
      <div className="border-b bg-slate-950 px-6 py-4 text-white">
        <h1 className="text-xl font-semibold">Demand Pilot API Docs</h1>
        <p className="mt-1 text-sm text-slate-300">
          Swagger UI for the current Next.js API routes.
        </p>
      </div>
      <div id="swagger-ui" className="min-h-[calc(100vh-81px)]" />
      <Script
        src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"
        strategy="afterInteractive"
      />
      <Script
        id="swagger-ui-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.addEventListener('load', function () {
              if (!window.SwaggerUIBundle) return;
              window.SwaggerUIBundle({
                url: '/api/openapi',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [window.SwaggerUIBundle.presets.apis],
                layout: 'BaseLayout',
              });
            });
          `,
        }}
      />
    </div>
  );
}
