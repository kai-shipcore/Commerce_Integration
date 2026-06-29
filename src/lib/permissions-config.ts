export const PERM_SECTIONS = [
  { id: "demand-planning",    nameKo: "수요계획",         nameEn: "Demand Planning" },
  { id: "container-planning", nameKo: "컨테이너 계획",    nameEn: "Container Planning" },
  { id: "available-stock",    nameKo: "가용재고관리",      nameEn: "Available Inventory" },
  { id: "sku-master",         nameKo: "SKU 기준정보",     nameEn: "SKU Master" },
  { id: "parts",              nameKo: "부품",             nameEn: "Parts" },
  { id: "factory",            nameKo: "공장",             nameEn: "Factory" },
  { id: "warehouse",          nameKo: "창고",             nameEn: "Warehouse" },
  { id: "integrations",       nameKo: "마켓플레이스 API",  nameEn: "Marketplace API" },
  { id: "user-permissions",   nameKo: "사용자 권한",       nameEn: "User Permissions" },
] as const;

export const PERM_ACTIONS = [
  { id: "read",   labelKo: "조회",     labelEn: "View" },
  { id: "create", labelKo: "생성",     labelEn: "Create" },
  { id: "edit",   labelKo: "수정",     labelEn: "Edit" },
  { id: "status", labelKo: "상태변경", labelEn: "Status" },
  { id: "delete", labelKo: "삭제",     labelEn: "Delete" },
] as const;

export type PermSection = (typeof PERM_SECTIONS)[number]["id"];
export type PermAction  = (typeof PERM_ACTIONS)[number]["id"];
export type RolePermMatrix = Record<PermSection, Record<PermAction, boolean>>;
export type ManagedRole = "admin" | "dev" | "planner" | "operation" | "production" | "user";

export const MANAGED_ROLES: ManagedRole[] = ["admin", "planner", "operation", "production", "user"];
export const ROLE_LABEL: Record<ManagedRole, string> = {
  admin:      "Admin",
  dev:        "Dev",
  planner:    "Planner",
  operation:  "Operation",
  production: "Production",
  user:       "User",
};

const ALL_ON:   Record<PermAction, boolean> = { read: true,  create: true,  edit: true,  status: true,  delete: true  };
const READ_ONLY: Record<PermAction, boolean> = { read: true,  create: false, edit: false, status: false, delete: false };
const NONE:     Record<PermAction, boolean> = { read: false, create: false, edit: false, status: false, delete: false };

function makeMatrix(
  overrides: Partial<Record<PermSection, Partial<Record<PermAction, boolean>>>>
): RolePermMatrix {
  const result = {} as RolePermMatrix;
  for (const sec of PERM_SECTIONS) {
    const id = sec.id as PermSection;
    const ov = overrides[id] ?? {};
    result[id] = {
      read:   ov.read   ?? false,
      create: ov.create ?? false,
      edit:   ov.edit   ?? false,
      status: ov.status ?? false,
      delete: ov.delete ?? false,
    };
  }
  return result;
}

export const DEFAULT_ROLE_PERMISSIONS: Record<ManagedRole, RolePermMatrix> = {
  admin: makeMatrix({
    "demand-planning":    ALL_ON,
    "container-planning": ALL_ON,
    "available-stock":    ALL_ON,
    "sku-master":         ALL_ON,
    "parts":              ALL_ON,
    "factory":            ALL_ON,
    "warehouse":          ALL_ON,
    "integrations":       ALL_ON,
    "user-permissions":   ALL_ON,
  }),
  dev: makeMatrix({
    "demand-planning":    ALL_ON,
    "container-planning": ALL_ON,
    "available-stock":    ALL_ON,
    "sku-master":         ALL_ON,
    "parts":              ALL_ON,
    "factory":            ALL_ON,
    "warehouse":          ALL_ON,
    "integrations":       ALL_ON,
    "user-permissions":   ALL_ON,
  }),
  planner: makeMatrix({
    "demand-planning":    { read: true,  create: true,  edit: true,  status: true,  delete: false },
    "container-planning": { read: true,  create: true,  edit: true,  status: true,  delete: false },
    "available-stock":    { read: true,  create: false, edit: true,  status: false, delete: false },
    "sku-master":         { read: true,  create: false, edit: true,  status: false, delete: false },
    "parts":              READ_ONLY,
    "factory":            READ_ONLY,
    "warehouse":          READ_ONLY,
    "integrations":       READ_ONLY,
    "user-permissions":   NONE,
  }),
  operation: makeMatrix({
    "demand-planning":    READ_ONLY,
    "container-planning": { read: true,  create: false, edit: false, status: true,  delete: false },
    "available-stock":    { read: true,  create: false, edit: true,  status: false, delete: false },
    "sku-master":         READ_ONLY,
    "parts":              READ_ONLY,
    "factory":            READ_ONLY,
    "warehouse":          { read: true,  create: false, edit: true,  status: false, delete: false },
    "integrations":       NONE,
    "user-permissions":   NONE,
  }),
  production: makeMatrix({
    "demand-planning":    NONE,
    "container-planning": NONE,
    "available-stock":    NONE,
    "sku-master":         NONE,
    "parts":              NONE,
    "factory":            NONE,
    "warehouse":          NONE,
    "integrations":       NONE,
    "user-permissions":   NONE,
  }),
  user: makeMatrix({
    "demand-planning":    READ_ONLY,
    "container-planning": READ_ONLY,
    "available-stock":    READ_ONLY,
    "sku-master":         READ_ONLY,
    "parts":              NONE,
    "factory":            NONE,
    "warehouse":          NONE,
    "integrations":       NONE,
    "user-permissions":   NONE,
  }),
};

export function blendRolePermissions(
  base: RolePermMatrix,
  dbRows: { section: string; action: string; allowed: boolean }[]
): RolePermMatrix {
  const result = JSON.parse(JSON.stringify(base)) as RolePermMatrix;
  for (const row of dbRows) {
    const sec = row.section as PermSection;
    const act = row.action as PermAction;
    if (result[sec]) result[sec][act] = row.allowed;
  }
  return result;
}
