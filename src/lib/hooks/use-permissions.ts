"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { PermSection, PermAction } from "@/lib/permissions-config";

type PermMatrix = Record<string, Record<string, boolean>>;

const cache = new Map<string, PermMatrix>();

export function usePermissions() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const [matrix, setMatrix] = useState<PermMatrix | null>(() =>
    userId ? (cache.get(userId) ?? null) : null
  );

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    if (cache.has(userId)) {
      setMatrix(cache.get(userId)!);
      return;
    }
    fetch("/api/user/permissions")
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data) {
          cache.set(userId, json.data as PermMatrix);
          setMatrix(json.data as PermMatrix);
        }
      })
      .catch(() => {});
  }, [userId, status]);

  function can(section: PermSection, action: PermAction): boolean {
    if (!matrix) return false;
    return matrix[section]?.[action] ?? false;
  }

  return { can, ready: matrix !== null };
}
