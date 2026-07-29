import { withBasePath } from "@/lib/api-path";
import { SwaggerDocs } from "./swagger-docs";

export const metadata = {
  title: "API Docs | Demand Pilot",
  description: "Swagger UI for the application API routes",
};

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="border-b bg-slate-950 px-6 py-4 text-white">
        <h1 className="text-xl font-semibold">Demand Pilot API Docs</h1>
        <p className="mt-1 text-sm text-slate-300">
          Swagger UI for the current Next.js API routes.
        </p>
      </div>
      <SwaggerDocs
        cssHref={withBasePath("/api/swagger-ui/swagger-ui.css")}
        bundleSrc={withBasePath("/api/swagger-ui/swagger-ui-bundle.js")}
        openApiUrl={withBasePath("/api/openapi")}
      />
    </div>
  );
}
