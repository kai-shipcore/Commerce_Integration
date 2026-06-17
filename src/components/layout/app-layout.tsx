/**
 * Code Guide:
 * Shared layout component used across app screens.
 * Navigation, shell structure, and client-side access gates are kept here so
 * individual pages stay focused on their own content.
 */

"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";
import { MainNav } from "./main-nav";
import { UserMenu } from "./user-menu";
import {
  getDefaultLandingPath,
  isAdminLikeRole,
  navigationItems,
} from "./navigation-config";
import { apiPath, withBasePath } from "@/lib/api-path";

interface AppLayoutProps {
  children: React.ReactNode;
}

function isItemMatch(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname === "/dashboard";
  if (href === "/planning/dashboard-ag-grid") {
    return pathname === href || pathname === "/planning/dashboard" || pathname.startsWith(`${href}/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [accessState, setAccessState] = useState<"checking" | "allowed" | "denied">("checking");

  const matchedItem = useMemo(() => {
    return navigationItems
      .filter((item) => isItemMatch(pathname, item.href))
      .sort((left, right) => right.href.length - left.href.length)[0] ?? null;
  }, [pathname]);

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
        const allowed =
          (!matchedItem.adminOnly || isAdminLikeRole(role)) &&
          (matchedItem.hideable === false || visibleMenuIds.includes(matchedItem.id));

        if (cancelled) return;

        if (allowed) {
          setAccessState("allowed");
          return;
        }

        setAccessState("denied");
        toast.error("ì´ íŽ˜ì´ì§€ì— ì ‘ê·¼ ê¶Œí•œì´ ì—†ìŠµë‹ˆë‹¤. ê´€ë¦¬ìžì—ê²Œ ê¶Œí•œì„ ìš”ì²­í•˜ì„¸ìš”.");
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

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-[#c2d0db] bg-[#dde6ee] dark:border-[#4e6473] dark:bg-[#607786]">
        <div className="container flex h-14 items-center bg-[#dde6ee] dark:bg-[#607786]">
          <div className="mr-4 flex">
            <Link className="mr-6 flex items-center" href="/">
              <Image
                src="/DemandPilot_Logo_NSlogan_S_transparent.png"
                alt="Demand Pilot"
                width={140}
                height={32}
                className="h-8 w-auto"
                priority
              />
            </Link>
          </div>
          <MainNav />
          <div className="ml-auto flex items-center space-x-4">
            <a
              href={withBasePath("/manual/index.html")}
              target="_blank"
              rel="noopener noreferrer"
              title="사용자 매뉴얼"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary dark:text-slate-200 dark:hover:text-white"
            >
              <BookOpen className="h-4 w-4" />
              <span className="hidden sm:inline">매뉴얼</span>
            </a>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container mx-auto py-6">
        {accessState === "allowed" ? (
          children
        ) : (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
            {accessState === "denied" ? "Redirecting..." : "Checking access..."}
          </div>
        )}
      </main>
    </div>
  );
}
