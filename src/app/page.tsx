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
import { QuickLinks } from "@/components/home/quick-links";
import {
  navigationItems,
  sanitizeVisibleMenuIds,
  isAdminLikeRole,
} from "@/components/layout/navigation-config";

const quickLinks = [
  { href: "/skus", label: "Open Products" },
  { href: "/inventory", label: "Open Inventory" },
  { href: "/orders", label: "Open Orders" },
  { href: "/velocity", label: "Open Velocity" },
  { href: "/settings/integrations", label: "Open Integrations" },
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

  const links = quickLinks.filter((link) => visibleHrefs.has(link.href));

  return (
    <AppLayout>
      <div className="mx-auto flex min-h-[55vh] max-w-3xl flex-col items-center justify-center gap-6 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">Demand Pilot</h1>
          <p className="text-muted-foreground">
            Start from a lightweight home screen instead of auto-loading a heavy data page.
          </p>
        </div>
        <QuickLinks links={links} />
      </div>
    </AppLayout>
  );
}
