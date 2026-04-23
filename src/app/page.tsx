/**
 * Code Guide:
 * Lightweight landing route for the application.
 * Keep this page intentionally simple so the app can open without immediately
 * triggering heavier dashboard, inventory, or product data requests.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";

const quickLinks = [
  { href: "/skus", label: "Open Products" },
  { href: "/inventory", label: "Open Inventory" },
  { href: "/orders", label: "Open Orders" },
  { href: "/settings/integrations", label: "Open Integrations" },
];

export default async function HomePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  return (
    <AppLayout>
      <div className="mx-auto flex min-h-[55vh] max-w-3xl flex-col items-center justify-center gap-6 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">Demand Pilot</h1>
          <p className="text-muted-foreground">
            Start from a lightweight home screen instead of auto-loading a heavy data page.
          </p>
        </div>
        <div className="grid w-full gap-3 sm:grid-cols-2">
          {quickLinks.map((link) => (
            <Button key={link.href} asChild variant="outline" className="h-12">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
