/**
 * Code Guide:
 * Lightweight landing route for the application.
 * Keep this page intentionally simple so the app can open without immediately
 * triggering heavier dashboard, inventory, or product data requests.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { AppLayout } from "@/components/layout/app-layout";
import { HomeDashboard } from "@/components/home/home-dashboard";
import {
  navigationItems,
  sanitizeVisibleMenuIds,
  isAdminLikeRole,
} from "@/components/layout/navigation-config";

const quickLinks = [
  { href: "/planning/sku-forecasts", label: "SKU Planning", labelKo: "SKU 계획", labelEn: "SKU Planning" },
  { href: "/planning/container-planning", label: "Container Planning", labelKo: "컨테이너 계획", labelEn: "Container Planning" },
  { href: "/inventory", label: "Open Inventory", labelKo: "재고 현황 열기", labelEn: "Open Inventory" },
  { href: "/velocity", label: "Open Velocity", labelKo: "판매 속도 열기", labelEn: "Open Velocity" },
];

export default async function HomePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const role = (session.user as { role?: string }).role ?? "user";
  const name = (session.user as { name?: string }).name ?? session.user.email ?? "";

  if (role === "user" || role === "guest") {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f0ede8]">
            <svg className="h-7 w-7 text-[#6b6359]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </div>
          <div className="space-y-1">
            <h1 className="text-[22px] font-bold tracking-tight text-[#1a1917]">
              Welcome{name ? `, ${name}` : ""}
            </h1>
            <p className="text-[13px] text-[#9b9189]">
              If you need access to additional menus, please contact your administrator.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  let visibleIds: string[];
  if (isAdminLikeRole(role)) {
    visibleIds = navigationItems.map((item) => item.id);
  } else {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { menuVisibility: true },
    });
    visibleIds = sanitizeVisibleMenuIds(dbUser?.menuVisibility, role);
  }

  const visibleHrefs = new Set(
    navigationItems
      .filter((item) => visibleIds.includes(item.id))
      .map((item) => item.href)
  );

  const allowedHrefs = Array.from(visibleHrefs);

  return (
    <AppLayout>
      <HomeDashboard links={quickLinks} allowedHrefs={allowedHrefs} />
    </AppLayout>
  );
}
