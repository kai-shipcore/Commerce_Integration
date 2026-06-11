/**
 * Code Guide:
 * Framework-level Next.js configuration.
 * Build and runtime options that affect the whole app are defined here.
 */

import type { NextConfig } from "next";

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? "");

const nextConfig: NextConfig = {
  basePath,
};

export default nextConfig;

function normalizeBasePath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return undefined;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}
