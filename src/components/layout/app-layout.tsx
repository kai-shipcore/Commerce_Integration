/**
 * Code Guide:
 * Shared layout component used across app screens.
 * Navigation, shell structure, and client-side access gates are kept here so
 * individual pages stay focused on their own content.
 */

"use client";

import Link from "next/link";
import Image from "next/image";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, ChevronsDown, ChevronsUp, GripVertical, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MainNav } from "./main-nav";
import { UserMenu } from "./user-menu";
import { LanguageToggle } from "./language-toggle";
import {
  getDefaultLandingPath,
  getPermissionSectionForMenuId,
  isAdminLikeRole,
  navigationItems,
} from "./navigation-config";
import type { RolePermMatrix } from "@/lib/permissions-config";
import { apiPath, authPath, stripBasePath, withBasePath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

interface AppLayoutProps {
  children: React.ReactNode;
}

const TOP_NAV_COLLAPSED_PREF_KEY = "layout.topNavCollapsed";
const TOP_NAV_COLLAPSED_STORAGE_KEY = "demandpilot-top-nav-collapsed";
const TOP_NAV_LAUNCHER_STORAGE_KEY = "demandpilot-top-nav-launcher-position";
const TOP_NAV_LAUNCHER_EDGE_GAP = 4;
const DEFAULT_MANUAL_SECTION = "overview";

const manualSectionByNavigationId: Record<string, string> = {
  dashboard: "command-center",
  inventory: "inventory",
  orders: "orders",
  velocity: "velocity",
  "demand-planning": "demand-planning",
  "sku-forecasts": "sku-planning",
  "container-planning": "container-planning",
  "container-timeline": "container-timeline",
  "transit-stock": "transit-stock",
  "available-stock": "available-stock",
  "sku-master": "sku-master",
  "seat-cover-parts": "parts",
  factories: "factories",
  "warehouse-admin": "warehouse",
  integrations: "integrations",
  "audit-log": "audit-log",
};

const skuForecastManualSectionByTab: Record<string, string> = {
  sales: "sp-analysis",
  inventory: "sp-inventory",
  history: "sp-inbound-history",
  purchase: "sp-recommend",
  forecast: "sp-forecast",
};

interface LauncherPosition {
  x: number;
  y: number;
}

interface PreviewPosition {
  left: number;
  top: number;
}

function isItemMatch(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname === "/dashboard";
  if (href === "/planning/dashboard-ag-grid") {
    return pathname === href || pathname === "/planning/dashboard" || pathname.startsWith(`${href}/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function readStoredTopNavCollapsed() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(TOP_NAV_COLLAPSED_STORAGE_KEY) === "true";
}

function storeTopNavCollapsed(collapsed: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(TOP_NAV_COLLAPSED_STORAGE_KEY, String(collapsed));
}

function readStoredLauncherPosition(): LauncherPosition | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(TOP_NAV_LAUNCHER_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<LauncherPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return null;
    }

    return {
      x: Math.max(TOP_NAV_LAUNCHER_EDGE_GAP, Math.min(parsed.x, window.innerWidth - 80)),
      y: Math.max(TOP_NAV_LAUNCHER_EDGE_GAP, Math.min(parsed.y, window.innerHeight - 48)),
    };
  } catch {
    window.localStorage.removeItem(TOP_NAV_LAUNCHER_STORAGE_KEY);
    return null;
  }
}

function storeLauncherPosition(position: LauncherPosition) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(TOP_NAV_LAUNCHER_STORAGE_KEY, JSON.stringify(position));
}

export function AppLayout({ children }: AppLayoutProps) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const appPathname = useMemo(() => stripBasePath(pathname), [pathname]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [accessState, setAccessState] = useState<"checking" | "allowed" | "denied">("checking");
  const [topNavCollapsed, setTopNavCollapsed] = useState(false);
  const [topNavPreviewOpen, setTopNavPreviewOpen] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState<LauncherPosition | null>(null);
  const [previewPosition, setPreviewPosition] = useState<PreviewPosition | null>(null);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewCloseTimerRef = useRef<number | null>(null);
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const matchedItem = useMemo(() => {
    return navigationItems
      .filter((item) => isItemMatch(appPathname, item.href))
      .sort((left, right) => right.href.length - left.href.length)[0] ?? null;
  }, [appPathname]);
  const manualHref = useMemo(() => {
    let section = DEFAULT_MANUAL_SECTION;
    if (matchedItem?.id === "sku-forecasts") {
      section = skuForecastManualSectionByTab[searchParams.get("tab") ?? "sales"] ?? manualSectionByNavigationId["sku-forecasts"];
    } else if (matchedItem) {
      section = manualSectionByNavigationId[matchedItem.id] ?? DEFAULT_MANUAL_SECTION;
    }

    return withBasePath(`/manual/index.html?lang=${locale}&section=${section}`);
  }, [locale, matchedItem, searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      setAccessState("checking");

      if (!matchedItem) {
        setAccessState("allowed");
        return;
      }

      try {
        const response = await fetch(apiPath("/api/settings/menu"), { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/auth/signin");
          return;
        }

        const result = await response.json();
        const visibleMenuIds = Array.isArray(result.data?.visibleMenuIds)
          ? result.data.visibleMenuIds as string[]
          : [];
        const role = typeof result.data?.role === "string" ? result.data.role : null;
        const permissions = result.data?.permissions as RolePermMatrix | undefined;
        const permissionSection = getPermissionSectionForMenuId(matchedItem.id);
        const hasReadPermission = permissionSection
          ? permissions?.[permissionSection]?.read === true
          : true;
        const allowed =
          hasReadPermission &&
          (!matchedItem.adminOnly || isAdminLikeRole(role) || visibleMenuIds.includes(matchedItem.id)) &&
          (matchedItem.hideable === false || visibleMenuIds.includes(matchedItem.id));

        if (cancelled) return;

        if (allowed) {
          setAccessState("allowed");
          return;
        }

        setAccessState("denied");
        toast.error(tRef.current("common.accessDenied"));
        router.replace(getDefaultLandingPath(visibleMenuIds, role));
      } catch {
        if (!cancelled) {
          setAccessState("allowed");
        }
      }
    }

    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, [matchedItem, router]);

  useEffect(() => {
    let cancelled = false;

    async function loadTopNavPreference() {
      await Promise.resolve();

      if (!cancelled) {
        setTopNavCollapsed(readStoredTopNavCollapsed());
        setLauncherPosition(readStoredLauncherPosition());
      }

      try {
        const response = await fetch(apiPath("/api/user/preferences"), { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const result = await response.json();
        const savedValue = result.data?.[TOP_NAV_COLLAPSED_PREF_KEY];
        if (!cancelled && typeof savedValue === "boolean") {
          setTopNavCollapsed(savedValue);
          storeTopNavCollapsed(savedValue);
        }
      } catch {
        // Local storage keeps the layout usable if the preference API is unavailable.
      }
    }

    void loadTopNavPreference();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewCloseTimerRef.current) {
        window.clearTimeout(previewCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const preview = previewRef.current;
    if (!topNavPreviewOpen || !preview || !previewPosition) {
      return;
    }

    const rect = preview.getBoundingClientRect();
    const nextLeft = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
    if (Math.abs(nextLeft - previewPosition.left) > 0.5) {
      setPreviewPosition((current) => current ? { ...current, left: nextLeft } : current);
    }
  }, [previewPosition, topNavPreviewOpen]);

  const updateTopNavCollapsed = (collapsed: boolean) => {
    setTopNavCollapsed(collapsed);
    storeTopNavCollapsed(collapsed);
    setTopNavPreviewOpen(false);

    void fetch(apiPath("/api/user/preferences"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: {
          [TOP_NAV_COLLAPSED_PREF_KEY]: collapsed,
        },
      }),
    }).catch(() => {
      // The local state already reflects the user's choice; DB sync can retry next time.
    });
  };

  const openTopNavPreview = () => {
    if (previewCloseTimerRef.current) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }

    const launcher = launcherRef.current;
    if (launcher) {
      const rect = launcher.getBoundingClientRect();
      const preferredTop = rect.bottom + 8;
      const top = preferredTop + 56 <= window.innerHeight
        ? preferredTop
        : Math.max(8, rect.top - 64);

      setPreviewPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 8)),
        top,
      });
    }

    setTopNavPreviewOpen(true);
  };

  const scheduleTopNavPreviewClose = () => {
    if (previewCloseTimerRef.current) {
      window.clearTimeout(previewCloseTimerRef.current);
    }

    previewCloseTimerRef.current = window.setTimeout(() => {
      const dropdownOpen = document.querySelector(
        '[data-slot="dropdown-menu-content"][data-state="open"], [data-slot="dropdown-menu-sub-content"][data-state="open"]',
      );

      if (dropdownOpen) {
        scheduleTopNavPreviewClose();
        return;
      }

      setTopNavPreviewOpen(false);
      previewCloseTimerRef.current = null;
    }, 250);
  };

  const startLauncherDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const launcher = launcherRef.current;
    if (!launcher) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const rect = launcher.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const handleMove = (moveEvent: PointerEvent) => {
      const maxX = Math.max(TOP_NAV_LAUNCHER_EDGE_GAP, window.innerWidth - rect.width - TOP_NAV_LAUNCHER_EDGE_GAP);
      const maxY = Math.max(TOP_NAV_LAUNCHER_EDGE_GAP, window.innerHeight - rect.height - TOP_NAV_LAUNCHER_EDGE_GAP);
      const nextPosition = {
        x: Math.max(TOP_NAV_LAUNCHER_EDGE_GAP, Math.min(moveEvent.clientX - offsetX, maxX)),
        y: Math.max(TOP_NAV_LAUNCHER_EDGE_GAP, Math.min(moveEvent.clientY - offsetY, maxY)),
      };
      setLauncherPosition(nextPosition);
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);

      const latestRect = launcher.getBoundingClientRect();
      storeLauncherPosition({
        x: latestRect.left,
        y: latestRect.top,
      });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const handleSignOut = async () => {
    const callbackUrl = authPath("/auth/signin");
    try {
      const csrfResponse = await fetch(apiPath("/api/auth/csrf"), {
        credentials: "same-origin",
      });
      const csrfData = (await csrfResponse.json()) as { csrfToken?: string };

      await fetch(apiPath("/api/auth/signout"), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Auth-Return-Redirect": "1",
        },
        body: new URLSearchParams({
          csrfToken: csrfData.csrfToken ?? "",
          callbackUrl,
        }),
        credentials: "same-origin",
      });
    } finally {
      window.location.assign(callbackUrl);
    }
  };

  const renderTopNavigation = (preview = false) => (
    <div
      className={cn(
        "flex h-14 items-center bg-[#dde6ee] dark:bg-[#607786]",
        preview ? "w-max px-2" : "w-full px-4",
        preview && "shadow-lg",
      )}
    >
      {!preview ? (
        <div className="mr-4 flex">
          <Link className="mr-6 flex items-center" href="/">
            <Image
              src={withBasePath("/DemandPilot_Logo_NSlogan_S_transparent.png")}
              alt="Demand Pilot"
              width={140}
              height={32}
              className="h-8 w-auto"
              priority
            />
          </Link>
        </div>
      ) : null}
      <MainNav showDashboard={!preview} />
      {!preview ? (
        <div className="ml-auto flex items-center space-x-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t("common.hideNavigation")}
            aria-label={t("common.hideNavigation")}
            className="text-muted-foreground hover:text-primary dark:text-slate-200 dark:hover:text-white"
            onClick={() => updateTopNavCollapsed(true)}
          >
            <ChevronsUp className="h-4 w-4" />
          </Button>
          <a
            href={manualHref}
            target="_blank"
            rel="noopener noreferrer"
            title={t("common.help")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary dark:text-slate-200 dark:hover:text-white"
          >
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">{t("common.help")}</span>
          </a>
          <LanguageToggle />
          <UserMenu />
        </div>
      ) : (
        <div className="ml-auto flex items-center gap-1 pl-4">
          <a
            href={manualHref}
            target="_blank"
            rel="noopener noreferrer"
            title={t("common.help")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary dark:text-slate-200 dark:hover:text-white"
          >
            <BookOpen className="h-4 w-4" />
            {t("common.help")}
          </a>
          <LanguageToggle />
          {session?.user ? (
            <>
              <Link
                href="/settings#profile"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary dark:text-slate-200 dark:hover:text-white"
              >
                <User className="h-4 w-4" />
                {t("common.profile")}
              </Link>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary dark:text-slate-200 dark:hover:text-white"
                onClick={() => void handleSignOut()}
              >
                <LogOut className="h-4 w-4" />
                {t("common.signOut")}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="min-h-screen bg-background"
      style={{ "--app-header-height": topNavCollapsed ? "0px" : "56px" } as CSSProperties}
    >
      <header
        className={cn(
          "sticky top-0 z-50 w-full border-[#c2d0db] bg-[#dde6ee] dark:border-[#4e6473] dark:bg-[#607786]",
          topNavCollapsed ? "h-0 border-b-0" : "border-b",
        )}
      >
        {topNavCollapsed ? null : renderTopNavigation()}
      </header>
      {topNavCollapsed ? (
        <div
          data-top-nav-launcher
          ref={launcherRef}
          className="fixed z-40 flex h-10 items-center gap-1 rounded-md border border-[#c2d0db] bg-white/95 px-1.5 shadow-lg backdrop-blur dark:border-[#4e6473] dark:bg-slate-900/95"
          style={
            launcherPosition
              ? { left: launcherPosition.x, top: launcherPosition.y }
              : { right: 16, top: 32 }
          }
          onMouseEnter={openTopNavPreview}
          onMouseLeave={scheduleTopNavPreviewClose}
        >
          <button
            type="button"
            aria-label={t("common.moveLauncher")}
            title={t("common.dragToMove")}
            className="flex h-7 w-5 cursor-grab items-center justify-center rounded text-slate-500 hover:bg-slate-100 active:cursor-grabbing dark:text-slate-300 dark:hover:bg-slate-800"
            onPointerDown={startLauncherDrag}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <Link className="flex h-8 items-center rounded px-1 hover:bg-slate-100 dark:hover:bg-slate-800" href="/">
            <span className="relative block h-7 w-7 overflow-hidden">
              <Image
                src={withBasePath("/DemandPilot_Logo_NSlogan_S_transparent.png")}
                alt="Demand Pilot"
                width={104}
                height={24}
                className="h-7 w-auto max-w-none"
                priority
              />
            </span>
          </Link>
          <button
            type="button"
            aria-label={t("common.restoreNavigation")}
            title={t("common.restoreNavigation")}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-sky-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
            onClick={() => updateTopNavCollapsed(false)}
          >
            <ChevronsDown className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {topNavCollapsed && topNavPreviewOpen ? (
        <div
          ref={previewRef}
          data-top-nav-preview
          className="fixed z-50 w-max max-w-[calc(100vw-16px)] overflow-visible rounded-md border border-[#c2d0db] shadow-xl dark:border-[#4e6473]"
          style={{
            left: previewPosition?.left ?? 8,
            top: previewPosition?.top ?? 80,
          }}
          onMouseEnter={openTopNavPreview}
          onMouseLeave={scheduleTopNavPreviewClose}
        >
          {renderTopNavigation(true)}
        </div>
      ) : null}

      <main
        className={cn(
          "container mx-auto transition-[padding] duration-150",
          topNavCollapsed ? "py-1" : "py-6",
        )}
      >
        {accessState === "allowed" ? (
          children
        ) : (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
            {accessState === "denied" ? t("common.redirecting") : t("common.checkingAccess")}
          </div>
        )}
      </main>
    </div>
  );
}
