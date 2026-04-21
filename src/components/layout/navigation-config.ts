import {
  BarChart3,
  FolderKanban,
  LayoutDashboard,
  Package,
  Plug,
  ShieldCheck,
  ShoppingCart,
  Store,
  Warehouse,
} from "lucide-react";
import type { ComponentType } from "react";

export const MENU_VISIBILITY_STORAGE_KEY = "menu-visibility-preferences";

export interface NavigationItem {
  id: string;
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  hideable?: boolean;
  adminOnly?: boolean;
}

export const navigationItems: NavigationItem[] = [
  {
    id: "dashboard",
    name: "Command Center",
    href: "/dashboard",
    icon: LayoutDashboard,
    hideable: true,
  },
  {
    id: "products",
    name: "Products",
    href: "/skus",
    icon: Package,
    hideable: true,
  },
  {
    id: "inventory",
    name: "Inventory",
    href: "/inventory",
    icon: Warehouse,
    hideable: true,
  },
  {
    id: "orders",
    name: "Orders",
    href: "/orders",
    icon: Store,
    hideable: true,
  },
  {
    id: "signals",
    name: "Demand Signals",
    href: "/sales",
    icon: ShoppingCart,
    hideable: true,
  },
  {
    id: "collections",
    name: "Collections",
    href: "/collections",
    icon: FolderKanban,
    hideable: true,
  },
  {
    id: "analytics",
    name: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    hideable: true,
  },
  {
    id: "integrations",
    name: "Marketplace APIs",
    href: "/settings/integrations",
    icon: Plug,
    hideable: true,
  },
  {
    id: "user-access",
    name: "User Access",
    href: "/settings/users",
    icon: ShieldCheck,
    hideable: false,
    adminOnly: true,
  },
];

export const adminDefaultVisibleMenuIds = navigationItems
  .filter((item) => item.hideable !== false)
  .map((item) => item.id);

export const userDefaultVisibleMenuIds = ["products", "inventory", "orders", "signals"];

export function getDefaultVisibleMenuIds(role?: string | null): string[] {
  return role === "admin" ? adminDefaultVisibleMenuIds : userDefaultVisibleMenuIds;
}

export function sanitizeVisibleMenuIds(
  value: unknown,
  role?: string | null
): string[] {
  const defaultVisibleMenuIds = getDefaultVisibleMenuIds(role);

  if (!Array.isArray(value)) {
    return defaultVisibleMenuIds;
  }

  const allowedIds = new Set(
    navigationItems
      .filter((item) => item.hideable !== false)
      .map((item) => item.id)
  );

  const filtered = value.filter(
    (entry): entry is string => typeof entry === "string" && allowedIds.has(entry)
  );

  // Older saved preferences used "inventory" for the products page. Preserve
  // product visibility when those preferences are loaded after the new
  // dedicated inventory page is introduced.
  if (filtered.includes("inventory") && !filtered.includes("products")) {
    filtered.unshift("products");
  }

  return filtered.length > 0 ? filtered : defaultVisibleMenuIds;
}

export function getDefaultLandingPath(
  value: unknown,
  role?: string | null
): string {
  const visibleMenuIds = sanitizeVisibleMenuIds(value, role);
  const visibleMenuIdSet = new Set(visibleMenuIds);

  if (visibleMenuIdSet.has("dashboard")) {
    return "/dashboard";
  }

  if (visibleMenuIdSet.has("products")) {
    return "/skus";
  }

  if (visibleMenuIdSet.has("inventory")) {
    return "/inventory";
  }

  if (visibleMenuIdSet.has("orders")) {
    return "/orders";
  }

  const fallbackItem = navigationItems.find(
    (item) => item.hideable !== false && visibleMenuIdSet.has(item.id)
  );

  return fallbackItem?.href ?? "/skus";
}
