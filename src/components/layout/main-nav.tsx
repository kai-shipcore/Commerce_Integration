"use client";

/**
 * Code Guide:
 * Shared layout component used across app screens.
 * Navigation, shell structure, and session-aware controls are kept here so individual pages stay focused on their own content.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MENU_VISIBILITY_STORAGE_KEY,
  getDefaultVisibleMenuIds,
  navigationItems,
  sanitizeVisibleMenuIds,
} from "./navigation-config";

let cachedVisibleMenuIds: string[] | null = null;
const MENU_FETCH_TIMEOUT_MS = 2000;

function readStoredVisibleMenuIds(role?: string | null): string[] | null {
  if (typeof window === "undefined") {
    return cachedVisibleMenuIds;
  }

  if (cachedVisibleMenuIds) {
    return cachedVisibleMenuIds;
  }

  const stored = window.sessionStorage.getItem(MENU_VISIBILITY_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored);
    const sanitized = sanitizeVisibleMenuIds(parsed, role);
    cachedVisibleMenuIds = sanitized;
    return sanitized;
  } catch {
    window.sessionStorage.removeItem(MENU_VISIBILITY_STORAGE_KEY);
    return null;
  }
}

function storeVisibleMenuIds(visibleMenuIds: string[]) {
  cachedVisibleMenuIds = visibleMenuIds;

  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    MENU_VISIBILITY_STORAGE_KEY,
    JSON.stringify(visibleMenuIds)
  );
}

export function MainNav() {
  const pathname = usePathname();
  const fallbackVisibleMenuIds = getDefaultVisibleMenuIds();
  const [visibleMenuIds, setVisibleMenuIds] = useState<string[]>(
    fallbackVisibleMenuIds
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    const loadPreferences = async () => {
      const storedVisibleMenuIds = readStoredVisibleMenuIds();
      const defaults = getDefaultVisibleMenuIds();

      if (storedVisibleMenuIds) {
        setVisibleMenuIds(storedVisibleMenuIds);
        setPreferencesReady(true);
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        MENU_FETCH_TIMEOUT_MS
      );

      try {
        const response = await fetch("/api/settings/menu", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          setVisibleMenuIds(defaults);
          storeVisibleMenuIds(defaults);
          setIsAdmin(false);
          setPreferencesReady(true);
          return;
        }

        const result = await response.json();
        if (result.success) {
          const sanitized = sanitizeVisibleMenuIds(
            result.data?.visibleMenuIds,
            result.data?.role
          );
          setVisibleMenuIds(sanitized);
          storeVisibleMenuIds(sanitized);
          setIsAdmin(result.data?.role === "admin");
        }
        setPreferencesReady(true);
      } catch {
        setVisibleMenuIds(defaults);
        storeVisibleMenuIds(defaults);
        setIsAdmin(false);
        setPreferencesReady(true);
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    void loadPreferences();

    window.addEventListener("menu-visibility-changed", loadPreferences);

    return () => {
      window.removeEventListener("menu-visibility-changed", loadPreferences);
    };
  }, []);

  const visibleNavigation = navigationItems.filter(
    (item) =>
      (!item.adminOnly || isAdmin) &&
      (item.hideable === false || visibleMenuIds.includes(item.id))
  );

  if (!preferencesReady) {
    return <nav className="h-9 flex-1" aria-hidden="true" />;
  }

  return (
    <nav className="flex items-center space-x-4 lg:space-x-6">
      {visibleNavigation.map((item) => {
        const Icon = item.icon;
        const isActive = item.href.startsWith("/settings")
          ? pathname?.startsWith(item.href)
          : pathname?.startsWith(item.href);

        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:text-primary dark:hover:text-white",
              isActive
                ? "bg-white/45 text-sky-900 shadow-sm dark:bg-slate-900/55 dark:text-white"
                : "text-muted-foreground dark:text-slate-200"
            )}
          >
            <Icon className="h-4 w-4" />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
