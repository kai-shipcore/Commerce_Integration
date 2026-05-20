import {
  BarChart3,
  FileSpreadsheet,
  FolderKanban,
  GitCompareArrows,
  LayoutDashboard,
  Package,
  Plug,
  Scale,
  ShieldCheck,
  ShoppingCart,
  Store,
  TrendingUp,
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
    id: "velocity",
    name: "Velocity",
    href: "/velocity",
    icon: TrendingUp,
    hideable: true,
  },
  {
    id: "sales-link-report",
    name: "Sales Link Report",
    href: "/sales-link-report",
    icon: FileSpreadsheet,
    hideable: true,
  },
  {
    id: "reconciliation",
    name: "Reconciliation",
    href: "/reconciliation",
    icon: Scale,
    hideable: true,
  },
  {
    id: "compare",
    name: "Compare",
    href: "/compare",
    icon: GitCompareArrows,
    hideable: true,
  },
  {
    id: "demand-planning",
    name: "Dashboard",
    href: "/planning/dashboard",
    icon: LayoutDashboard,
    hideable: true,
  },
  {
    id: "sku-forecasts",
    name: "SKU Forecasts",
    href: "/planning/sku-forecasts",
    icon: TrendingUp,
    hideable: true,
  },
  {
    id: "container-planning",
    name: "Container Planning",
    href: "/planning/container-planning",
    icon: Warehouse,
    hideable: true,
  },
  {
    id: "purchase-orders",
    name: "Purchase Orders",
    href: "/planning/purchase-orders",
    icon: FileSpreadsheet,
    hideable: true,
  },
  {
    id: "sku-master",
    name: "SKU Master",
    href: "/planning/sku-master",
    icon: Package,
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
  {
    id: "warehouse-admin",
    name: "Warehouse",
    href: "/warehouse",
    icon: Warehouse,
    hideable: true,
    adminOnly: true,
  },
];

export const adminDefaultVisibleMenuIds = navigationItems
  .filter((item) => item.hideable !== false)
  .map((item) => item.id);

export const userDefaultVisibleMenuIds = ["velocity"];

export function isAdminLikeRole(role?: string | null): boolean {
  return role === "admin" || role === "dev";
}

export function getDefaultVisibleMenuIds(role?: string | null): string[] {
  return isAdminLikeRole(role)
    ? adminDefaultVisibleMenuIds
    : userDefaultVisibleMenuIds;
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

  // Merge any newly added default items that are missing from saved preferences
  // so existing users automatically see new menu items without clearing storage.
  const filteredSet = new Set(filtered);
  for (const id of defaultVisibleMenuIds) {
    if (!filteredSet.has(id)) {
      filtered.push(id);
    }
  }

  return filtered;
}

// Validates menu IDs against the known navigation items without merging role defaults.
// Use this on the save path so explicit unchecks are preserved for all roles.
// sanitizeVisibleMenuIds (which auto-merges defaults) is only for the read/render path.
export function filterToValidMenuIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowedIds = new Set(
    navigationItems.filter((item) => item.hideable !== false).map((item) => item.id)
  );
  return value.filter((id): id is string => typeof id === "string" && allowedIds.has(id));
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
