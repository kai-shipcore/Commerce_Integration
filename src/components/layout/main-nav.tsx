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
  filterToRenderableMenuIds,
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  navigationItems,
  sanitizeVisibleMenuIds,
} from "./navigation-config";
import { apiPath, stripBasePath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages";

let cachedVisibleMenuIds: string[] | null = null;
const MENU_FETCH_TIMEOUT_MS = 2000;

const navigationGroups = [
  { name: "Commerce", labelKey: "nav.commerce" as const, itemIds: ["inventory", "orders", "velocity"] },
  { name: "Planning", labelKey: "nav.planning" as const, itemIds: ["demand-planning", "sku-forecasts", "demand-forecast", "container-planning", "container-timeline", "available-stock", "transit-stock"] },
  { name: "Production", labelKey: "nav.production" as const, itemIds: ["seat-cover-sizes", "production-vehicles"] },
  { name: "Master Data", labelKey: "nav.masterData" as const, itemIds: ["sku-master", "seat-cover-parts", "factories", "warehouse-admin"] },
  { name: "Admin", labelKey: "nav.admin" as const, itemIds: ["integrations", "audit-log", "user-access", "shiphero-credentials"] },
];

const navigationLabelKeys: Record<string, MessageKey> = {
  dashboard: "nav.commandCenter",
  products: "nav.products",
  inventory: "nav.inventory",
  orders: "nav.orders",
  signals: "nav.demandSignals",
  collections: "nav.collections",
  analytics: "nav.analytics",
  velocity: "nav.velocity",
  "demand-planning": "nav.demandPlanning",
  "sku-forecasts": "nav.skuPlanning",
  "container-planning": "nav.containerPlanning",
  "container-timeline": "nav.containerTimeline",
  "available-stock": "nav.availableStock",
  "transit-stock": "nav.transitStock",
  "purchase-orders": "nav.purchaseOrders",
  "sku-master": "nav.skuMaster",
  "seat-cover-parts": "nav.parts",
  "seat-cover-sizes": "nav.seatCoverParts",
  factories: "nav.factories",
  integrations: "nav.marketplaceApis",
  "audit-log": "nav.auditLog",
  "warehouse-admin": "nav.warehouse",
  "user-access": "nav.userAccess",
  "shiphero-credentials": "nav.shipHeroCredentials",
};

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
    const sanitized = role === undefined
      ? filterToRenderableMenuIds(parsed)
      : sanitizeVisibleMenuIds(parsed, role);
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

interface MainNavProps {
  showDashboard?: boolean;
}

export function MainNav({ showDashboard = true }: MainNavProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const appPathname = stripBasePath(pathname);
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
        const response = await fetch(apiPath("/api/settings/menu"), {
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
          const sanitized = filterToRenderableMenuIds(result.data?.visibleMenuIds);
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
      !item.hidden &&
      (!item.adminOnly || isAdmin || visibleMenuIds.includes(item.id)) &&
      (item.hideable === false || visibleMenuIds.includes(item.id))
  );

  if (!preferencesReady) {
    return <nav className="h-9 flex-1" aria-hidden="true" />;
  }

  const isItemActive = (href: string) =>
    appPathname === href || appPathname?.startsWith(`${href}/`) || false;
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
    items: group.itemIds
      .map((itemId) => visibleNavigation.find((item) => item.id === itemId))
      .filter((item): item is (typeof visibleNavigation)[number] => Boolean(item)),
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
        {navigationLabelKeys[item.id] ? t(navigationLabelKeys[item.id]) : item.name}
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
            {t(group.labelKey)}
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
                  {navigationLabelKeys[item.id] ? t(navigationLabelKeys[item.id]) : item.name}
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
      {showDashboard && dashboardItem ? renderNavigationLink(dashboardItem) : null}
      {renderNavigationGroup(groupedNavigation[0])}
      {renderNavigationGroup(groupedNavigation[1])}
      {renderNavigationGroup(groupedNavigation[2])}
      {renderNavigationGroup(groupedNavigation[3])}
      {renderNavigationGroup(groupedNavigation[4])}
    </nav>
  );
}
