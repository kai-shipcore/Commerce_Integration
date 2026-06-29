"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { PermSection, PermAction } from "@/lib/permissions-config";
import { apiPath } from "@/lib/api-path";

type PermMatrix = Record<string, Record<string, boolean>>;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — matches server-side Redis TTL

type CacheEntry = { matrix: PermMatrix; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function getCached(userId: string): PermMatrix | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(userId);
    return null;
  }
  return entry.matrix;
}

export function usePermissions() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const [matrix, setMatrix] = useState<PermMatrix | null>(() =>
    userId ? (getCached(userId) ?? null) : null
  );

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    const cached = getCached(userId);
    if (cached) {
      Promise.resolve().then(() => setMatrix(cached));
    }
    fetch(apiPath("/api/user/permissions"), { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data) {
          cache.set(userId, { matrix: json.data as PermMatrix, expiresAt: Date.now() + CACHE_TTL_MS });
          setMatrix(json.data as PermMatrix);
        } else {
          setMatrix({});
        }
      })
      .catch(() => setMatrix({}));
  }, [userId, status]);

  const can = useCallback((section: PermSection, action: PermAction): boolean => {
    if (matrix === null) return true; // still loading — API enforces server-side
    return matrix[section]?.[action] ?? false;
  }, [matrix]);

  return { can, ready: matrix !== null };
}
