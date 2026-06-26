import {
  BarChart3,
  Boxes,
  Building2,
  CalendarRange,
  ClipboardList,
  Database,
  FileSpreadsheet,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  Package,
  Plug,
  ScrollText,
  ShieldCheck,
  Ship,
  ShoppingCart,
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
  group?: string;
  hideable?: boolean;
  adminOnly?: boolean;
  hidden?: boolean;
}

export const navigationItems: NavigationItem[] = [
  {
    id: "dashboard",
    name: "Command Center",
    href: "/",
    icon: LayoutDashboard,
    group: "Commerce",
    hideable: false,
  },
  {
    id: "products",
    name: "Products",
    href: "/skus",
    icon: Package,
    group: "Commerce",
    hideable: true,
    hidden: true,
  },
  {
    id: "inventory",
    name: "Inventory",
    href: "/inventory",
    icon: Warehouse,
    group: "Commerce",
    hideable: true,
  },
  {
    id: "orders",
    name: "Orders",
    href: "/orders",
    icon: ClipboardList,
    group: "Commerce",
    hideable: true,
  },
  {
    id: "signals",
    name: "Demand Signals",
    href: "/sales",
    icon: ShoppingCart,
    group: "Commerce",
    hideable: true,
    hidden: true,
  },
  {
    id: "collections",
    name: "Collections",
    href: "/collections",
    icon: FolderKanban,
    group: "Commerce",
    hideable: true,
    hidden: true,
  },
  {
    id: "analytics",
    name: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    group: "Analytics",
    hideable: true,
    hidden: true,
  },
  {
    id: "velocity",
    name: "Velocity",
    href: "/velocity",
    icon: Gauge,
    group: "Analytics",
    hideable: true,
  },
  {
    id: "demand-planning",
    name: "Demand Planning",
    href: "/planning/dashboard-ag-grid",
    icon: LayoutDashboard,
    group: "Planning",
    hideable: true,
  },
  {
    id: "sku-forecasts",
    name: "SKU Planning",
    href: "/planning/sku-forecasts",
    icon: TrendingUp,
    group: "Planning",
    hideable: true,
  },
  {
    id: "container-planning",
    name: "Container Planning",
    href: "/planning/container-planning",
    icon: Ship,
    group: "Planning",
    hideable: true,
  },
  {
    id: "container-timeline",
    name: "Container Timeline",
    href: "/planning/container-timeline",
    icon: CalendarRange,
    group: "Planning",
    hideable: true,
  },
  {
    id: "available-stock",
    name: "Available Stock",
    href: "/planning/available-stock",
    icon: Boxes,
    group: "Planning",
    hideable: true,
  },
  {
    id: "purchase-orders",
    name: "Purchase Orders",
    href: "/planning/purchase-orders",
    icon: FileSpreadsheet,
    group: "Planning",
    hideable: true,
    hidden: true,
  },
  {
    id: "sku-master",
    name: "SKU Master",
    href: "/planning/sku-master",
    icon: Database,
    group: "Planning",
    hideable: true,
  },
  {
    id: "seat-cover-parts",
    name: "Parts",
    href: "/planning/seat-cover/parts",
    icon: Package,
    group: "Planning",
    hideable: true,
  },
  {
    id: "factories",
    name: "Factories",
    href: "/planning/factories",
    icon: Building2,
    group: "Planning",
    hideable: true,
  },
  {
    id: "integrations",
    name: "Marketplace APIs",
    href: "/settings/integrations",
    icon: Plug,
    group: "Operations",
    hideable: true,
  },
  {
    id: "audit-log",
    name: "Audit Log",
    href: "/admin/audit-log",
    icon: ScrollText,
    hideable: true,
  },
  {
    id: "warehouse-admin",
    name: "Warehouse",
    href: "/warehouse",
    icon: Warehouse,
    group: "Operations",
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
  .filter((item) => item.hideable !== false && !item.hidden)
  .map((item) => item.id);

export const userDefaultVisibleMenuIds = [
  "velocity",
  "demand-planning",
  "sku-forecasts",
  "container-planning",
  "container-timeline",
  "available-stock",
  "inventory",
  "orders",
];

export function isAdminLikeRole(role?: string | null): boolean {
  return role === "admin" || role === "dev";
}

export function isPOApproverRole(role?: string | null): boolean {
  return role === "admin" || role === "dev" || role === "planner";
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
      .filter((item) => item.hideable !== false && !item.hidden)
      .map((item) => item.id)
  );

  const filtered = value.filter(
    (entry): entry is string => typeof entry === "string" && allowedIds.has(entry)
  );

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
    navigationItems.filter((item) => item.hideable !== false && !item.hidden).map((item) => item.id)
  );
  return value.filter((id): id is string => typeof id === "string" && allowedIds.has(id));
}

export function getDefaultLandingPath(
  value: unknown,
  role?: string | null
): string {
  return "/";
}
