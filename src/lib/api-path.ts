const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const basePath = normalizeBasePath(rawBasePath);

export function withBasePath(path: string): string {
  if (!basePath) return path;
  if (!path.startsWith("/")) return `${basePath}/${path}`;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}

export function apiPath(path: string): string {
  return withBasePath(path);
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}
