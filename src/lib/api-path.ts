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

export function authPath(path: string): string {
  return withBasePath(path);
}

export function externalAuthApiBaseUrl(): string | undefined {
  const origin = getExternalOrigin();
  return origin ? `${origin}${withBasePath("/api/auth")}` : undefined;
}

export function stripBasePath(path: string): string {
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || "/";
  return path;
}

function getExternalOrigin(): string | undefined {
  const rawUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL;

  if (!rawUrl) return undefined;

  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}
