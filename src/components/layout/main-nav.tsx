"use client";

/**
 * Code Guide:
 * Shared layout component used across app screens.
 * Navigation, shell structure, and session-aware controls are kept here so individual pages stay focused on their own content.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MENU_VISIBILITY_STORAGE_KEY,
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  navigationItems,
  sanitizeVisibleMenuIds,
} from "./navigation-config";

let cachedVisibleMenuIds: string[] | null = null;
const MENU_FETCH_TIMEOUT_MS = 2000;

const navigationGroups = [
  { name: "Catalog", itemIds: ["products", "inventory", "collections"] },
  { name: "Operations", itemIds: ["orders", "signals"] },
  { name: "Forecasting", itemIds: ["analytics", "velocity", "sales-link-report", "reconciliation", "compare"] },
  { name: "Planning", itemIds: ["demand-planning", "sku-forecasts", "container-planning", "purchase-orders", "sku-master"] },
  { name: "Admin", itemIds: ["integrations", "warehouse-admin", "user-access"] },
];

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
          setIsAdmin(isAdminLikeRole(result.data?.role));
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

  const isItemActive = (href: string) =>
    pathname === href || pathname?.startsWith(`${href}/`) || false;
  const navItemClassName = (isActive: boolean) =>
    cn(
      "flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:text-primary dark:hover:text-white",
      isActive
        ? "bg-white/45 text-sky-900 shadow-sm dark:bg-slate-900/55 dark:text-white"
        : "text-muted-foreground dark:text-slate-200"
    );

  const dashboardItem = visibleNavigation.find((item) => item.id === "dashboard");
  const groupedNavigation = navigationGroups.map((group) => ({
    ...group,
    items: visibleNavigation.filter((item) => group.itemIds.includes(item.id)),
  }));

  const renderNavigationLink = (item: (typeof visibleNavigation)[number]) => {
    const Icon = item.icon;
    const isActive = isItemActive(item.href);

    return (
      <Link
        key={item.id}
        href={item.href}
        className={navItemClassName(isActive)}
      >
        <Icon className="h-4 w-4" />
        {item.name}
      </Link>
    );
  };

  const renderNavigationGroup = (group: (typeof groupedNavigation)[number]) => {
    if (group.items.length === 0) {
      return null;
    }

    const isGroupActive = group.items.some((item) => isItemActive(item.href));

    return (
      <DropdownMenu key={group.name}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={navItemClassName(isGroupActive)}>
            {group.name}
            <ChevronDown className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          {group.items.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem key={item.id} asChild>
                <Link href={item.href}>
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <nav className="flex items-center space-x-4 lg:space-x-6">
      {dashboardItem ? renderNavigationLink(dashboardItem) : null}
      {renderNavigationGroup(groupedNavigation[0])}
      {renderNavigationGroup(groupedNavigation[1])}
      {renderNavigationGroup(groupedNavigation[2])}
      {renderNavigationGroup(groupedNavigation[3])}
      {renderNavigationGroup(groupedNavigation[4])}
    </nav>
  );
}
