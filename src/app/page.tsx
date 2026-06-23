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
