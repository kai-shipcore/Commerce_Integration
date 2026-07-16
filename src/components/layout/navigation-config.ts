import {
  BarChart3,
  Barcode,
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
  Container,
} from "lucide-react";
import type { ComponentType } from "react";
import type { PermSection, RolePermMatrix } from "@/lib/permissions-config";

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
  requireRole?: string[];
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
    id: "demand-forecast",
    name: "Demand Forecast",
    href: "/planning/demand-forecast",
    icon: BarChart3,
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
    id: "transit-stock",
    name: "Transit Stock",
    href: "/planning/transit-stock",
    icon: Ship,
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
    id: "seat-cover-sizes",
    name: "Seat Cover Parts",
    href: "/production/seat-cover-parts",
    icon: Package,
    group: "Production",
    hideable: true,
  },
  {
    id: "production-vehicles",
    name: "Vehicles",
    href: "/production/vehicles",
    icon: Database,
    group: "Production",
    hideable: true,
  },
  {
    id: "production-parts-codes",
    name: "Parts & Codes",
    href: "/production/parts-codes",
    icon: Package,
    group: "Production",
    hideable: true,
  },
  {
    id: "part-sku-generator",
    name: "Part SKU",
    href: "/production/part-sku-generator",
    icon: Barcode,
    group: "Production",
    hideable: true,
  },
  {
    id: "project-list",
    name: "Product List",
    href: "/production/product-list",
    icon: FolderKanban,
    group: "Production",
    hideable: true,
  },
  {
    id: "invoice-price-control",
    name: "Invoice & Price Control",
    href: "/production/invoice-price-control",
    icon: FileSpreadsheet,
    group: "Admin",
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
  {
    id: "shiphero-credentials",
    name: "ShipHero Credentials",
    href: "/admin/shiphero",
    icon: Ship,
    hideable: true,
    adminOnly: true,
  },
  {
    id: "container-import",
    name: "Container Import",
    href: "/admin/containers",
    icon: Container,
    hideable: true,
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
  "demand-forecast",
  "container-planning",
  "container-timeline",
  "available-stock",
  "transit-stock",
  "inventory",
  "orders",
];

export const permissionMenuIdsBySection: Record<PermSection, string[]> = {
  "inventory":           ["inventory"],
  "orders":              ["orders"],
  "velocity":            ["velocity"],
  "demand-planning":     ["demand-planning"],
  "demand-forecast":     ["demand-forecast"],
  "container-planning":  ["container-planning"],
  "available-stock":     ["available-stock"],
  "transit-stock":       ["transit-stock"],
  "sku-master":          ["sku-master"],
  "sku-forecasts":       ["sku-forecasts"],
  "container-timeline":  ["container-timeline"],
  "parts":               ["seat-cover-parts"],
  "seat-cover-parts":    ["seat-cover-sizes"],
  "production-vehicles": ["production-vehicles"],
  "invoice-price-control": ["invoice-price-control"],
  "parts-codes":         ["production-parts-codes"],
  "part-sku-generator":  ["part-sku-generator"],
  "project-list":        ["project-list"],
  "factory":             ["factories"],
  "warehouse":           ["warehouse-admin"],
  "integrations":        ["integrations"],
  "audit-log":           ["audit-log"],
  "user-permissions":    ["user-access"],
  "shiphero":            ["shiphero-credentials"],
};

export function getPermissionSectionForMenuId(menuId: string): PermSection | null {
  for (const [section, menuIds] of Object.entries(permissionMenuIdsBySection) as Array<[PermSection, string[]]>) {
    if (menuIds.includes(menuId)) return section;
  }
  return null;
}

export function isAdminLikeRole(role?: string | null): boolean {
  return role === "admin" || role === "dev";
}

export function isPOApproverRole(role?: string | null): boolean {
  return role === "admin" || role === "dev" || role === "planner";
}

export function getDefaultVisibleMenuIds(role?: string | null): string[] {
  if (isAdminLikeRole(role)) return adminDefaultVisibleMenuIds;
  if (role === "production") return [];
  if (role === "operation") return [];
  if (role === "guest") return [];
  return userDefaultVisibleMenuIds;
}

export function sanitizeVisibleMenuIds(
  value: unknown,
  role?: string | null
): string[] {
  const defaultVisibleMenuIds = getDefaultVisibleMenuIds(role);

  // Roles with empty defaults are permission-gated: ignore saved prefs entirely
  // so only mergeVisibleMenuIdsWithPermissions controls what appears.
  if (defaultVisibleMenuIds.length === 0) {
    return [];
  }

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

  // Auto-merge newly added default items so existing users see new menu items
  const filteredSet = new Set(filtered);
  for (const id of defaultVisibleMenuIds) {
    if (!filteredSet.has(id)) filtered.push(id);
  }

  return filtered;
}

export function filterToRenderableMenuIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowedIds = new Set(
    navigationItems.filter((item) => !item.hidden).map((item) => item.id)
  );
  return value.filter((id): id is string => typeof id === "string" && allowedIds.has(id));
}

export function getReadablePermissionMenuIds(permissions: RolePermMatrix): string[] {
  const validIds = new Set(navigationItems.filter((item) => !item.hidden).map((item) => item.id));
  const ids = new Set<string>();

  for (const [section, menuIds] of Object.entries(permissionMenuIdsBySection) as Array<[PermSection, string[]]>) {
    if (!permissions[section]?.read) continue;
    for (const id of menuIds) {
      if (validIds.has(id)) ids.add(id);
    }
  }

  return [...ids];
}

export function mergeVisibleMenuIdsWithPermissions(
  value: unknown,
  role: string | null | undefined,
  permissions: RolePermMatrix
): string[] {
  const blockedPermissionMenuIds = new Set<string>();
  for (const [section, menuIds] of Object.entries(permissionMenuIdsBySection) as Array<[PermSection, string[]]>) {
    if (permissions[section]?.read) continue;
    for (const id of menuIds) {
      blockedPermissionMenuIds.add(id);
    }
  }

  const visibleMenuIds = sanitizeVisibleMenuIds(value, role)
    .filter((id) => !blockedPermissionMenuIds.has(id));

  return [...new Set([
    ...visibleMenuIds,
    ...getReadablePermissionMenuIds(permissions),
  ])];
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

export function getDefaultLandingPath(value: unknown, role?: string | null): string {
  void value;
  void role;
  return "/";
}
