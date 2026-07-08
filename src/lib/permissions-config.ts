export const PERM_SECTIONS = [
  // Commerce
  { id: "inventory",           group: "Commerce",    nameKo: "재고",              nameEn: "Inventory" },
  { id: "orders",              group: "Commerce",    nameKo: "주문",              nameEn: "Orders" },
  { id: "velocity",            group: "Commerce",    nameKo: "판매 속도",          nameEn: "Velocity" },
  // Planning
  { id: "demand-planning",     group: "Planning",    nameKo: "수요계획",           nameEn: "Demand Planning" },
  { id: "container-planning",  group: "Planning",    nameKo: "컨테이너 계획",       nameEn: "Container Planning" },
  { id: "available-stock",     group: "Planning",    nameKo: "가용재고관리",         nameEn: "Available Inventory" },
  { id: "sku-master",          group: "Planning",    nameKo: "SKU 기준정보",        nameEn: "SKU Master" },
  { id: "invoice-price-control", group: "Planning",  nameKo: "Invoice 가격 관리", nameEn: "Invoice Price Control" },
  { id: "sku-forecasts",       group: "Planning",    nameKo: "SKU 계획",           nameEn: "SKU Planning" },
  { id: "container-timeline",  group: "Planning",    nameKo: "컨테이너 타임라인",    nameEn: "Container Timeline" },
  { id: "parts",               group: "Planning",    nameKo: "부품",              nameEn: "Parts" },
  { id: "transit-stock",       group: "Planning",    nameKo: "재고이동",           nameEn: "Transit Stock" },
  // Production
  { id: "seat-cover-parts",    group: "Production",  nameKo: "시트커버 부품",       nameEn: "Seat Cover Parts" },
  { id: "production-vehicles", group: "Production",  nameKo: "차종 관리",          nameEn: "Vehicles" },
  { id: "parts-codes",         group: "Production",  nameKo: "부품/코드/이니셜",     nameEn: "Parts / Codes / Initials" },
  // Master Data
  { id: "factory",             group: "Master Data", nameKo: "공장",              nameEn: "Factory" },
  { id: "warehouse",           group: "Master Data", nameKo: "창고",              nameEn: "Warehouse" },
  // Admin
  { id: "integrations",        group: "Admin",       nameKo: "마켓플레이스 API",    nameEn: "Marketplace API" },
  { id: "audit-log",           group: "Admin",       nameKo: "감사 로그",          nameEn: "Audit Log" },
  { id: "user-permissions",    group: "Admin",       nameKo: "사용자 권한",         nameEn: "User Permissions" },
  { id: "shiphero",            group: "Admin",       nameKo: "ShipHero 연동",      nameEn: "ShipHero Credentials" },
] as const;

export const PERM_SECTION_GROUP_LABELS: Record<string, { ko: string; en: string }> = {
  "Commerce":    { ko: "커머스",    en: "Commerce" },
  "Planning":    { ko: "계획",      en: "Planning" },
  "Production":  { ko: "생산",      en: "Production" },
  "Master Data": { ko: "기준 정보", en: "Master Data" },
  "Admin":       { ko: "관리",      en: "Admin" },
};

export const PERM_ACTIONS = [
  { id: "read",   labelKo: "조회",     labelEn: "View" },
  { id: "create", labelKo: "생성",     labelEn: "Create" },
  { id: "edit",   labelKo: "수정",     labelEn: "Edit" },
  { id: "status", labelKo: "상태변경", labelEn: "Status" },
  { id: "delete", labelKo: "삭제",     labelEn: "Delete" },
] as const;

export type PermSection = (typeof PERM_SECTIONS)[number]["id"];
export type PermAction  = (typeof PERM_ACTIONS)[number]["id"];

// Cross-references a permission section to another feature it also gates, so admin screens
// can surface the connection inline instead of relying on the manual.
export const PERM_SECTION_HINTS: Partial<Record<PermSection, { ko: string; en: string }>> = {
  "invoice-price-control": {
    ko: "SKU 기준정보 화면의 \"가격 이력\" 버튼도 이 권한으로 켜고 끕니다",
    en: "Also controls the \"Price History\" button on the SKU Master screen",
  },
};
export type RolePermMatrix = Record<PermSection, Record<PermAction, boolean>>;
export type ManagedRole = "admin" | "dev" | "planner" | "operation" | "production" | "user" | "guest";

export const MANAGED_ROLES: ManagedRole[] = ["admin", "planner", "operation", "production", "user", "guest"];
export const ROLE_LABEL: Record<ManagedRole, string> = {
  admin:      "Admin",
  dev:        "Dev",
  planner:    "Planner",
  operation:  "Operation",
  production: "Production",
  user:       "User",
  guest:      "Guest",
};

const ALL_ON:    Record<PermAction, boolean> = { read: true,  create: true,  edit: true,  status: true,  delete: true  };
const READ_ONLY: Record<PermAction, boolean> = { read: true,  create: false, edit: false, status: false, delete: false };
const NONE:      Record<PermAction, boolean> = { read: false, create: false, edit: false, status: false, delete: false };

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
    "inventory":           ALL_ON,
    "orders":              ALL_ON,
    "velocity":            ALL_ON,
    "demand-planning":     ALL_ON,
    "container-planning":  ALL_ON,
    "available-stock":     ALL_ON,
    "sku-master":          ALL_ON,
    "sku-forecasts":       ALL_ON,
    "container-timeline":  ALL_ON,
    "parts":               ALL_ON,
    "seat-cover-parts":    ALL_ON,
    "production-vehicles": ALL_ON,
    "invoice-price-control": ALL_ON,
    "parts-codes":         ALL_ON,
    "factory":             ALL_ON,
    "warehouse":           ALL_ON,
    "transit-stock":       ALL_ON,
    "integrations":        ALL_ON,
    "audit-log":           ALL_ON,
    "user-permissions":    ALL_ON,
    "shiphero":            ALL_ON,
  }),
  dev: makeMatrix({
    "inventory":           ALL_ON,
    "orders":              ALL_ON,
    "velocity":            ALL_ON,
    "demand-planning":     ALL_ON,
    "container-planning":  ALL_ON,
    "available-stock":     ALL_ON,
    "sku-master":          ALL_ON,
    "sku-forecasts":       ALL_ON,
    "container-timeline":  ALL_ON,
    "parts":               ALL_ON,
    "seat-cover-parts":    ALL_ON,
    "production-vehicles": ALL_ON,
    "invoice-price-control": ALL_ON,
    "parts-codes":         ALL_ON,
    "factory":             ALL_ON,
    "warehouse":           ALL_ON,
    "transit-stock":       ALL_ON,
    "integrations":        ALL_ON,
    "audit-log":           ALL_ON,
    "user-permissions":    ALL_ON,
    "shiphero":            ALL_ON,
  }),
  planner: makeMatrix({
    "inventory":           READ_ONLY,
    "orders":              READ_ONLY,
    "velocity":            READ_ONLY,
    "demand-planning":     { read: true,  create: true,  edit: true,  status: true,  delete: false },
    "container-planning":  { read: true,  create: true,  edit: true,  status: true,  delete: false },
    "available-stock":     { read: true,  create: false, edit: true,  status: false, delete: false },
    "sku-master":          { read: true,  create: false, edit: true,  status: false, delete: false },
    "sku-forecasts":       READ_ONLY,
    "container-timeline":  { read: true, create: false, edit: true, status: false, delete: false },
    "parts":               READ_ONLY,
    "transit-stock":       { read: true,  create: true,  edit: true,  status: true,  delete: false },
    "seat-cover-parts":    NONE,
    "production-vehicles": NONE,
    "invoice-price-control": { read: true, create: true, edit: true, status: false, delete: false },
    "factory":             READ_ONLY,
    "warehouse":           READ_ONLY,
    "integrations":        READ_ONLY,
    "audit-log":           NONE,
    "user-permissions":    NONE,
    "shiphero":            NONE,
  }),
  operation: makeMatrix({
    "parts": READ_ONLY,
  }),
  production: makeMatrix({
    "seat-cover-parts":    READ_ONLY,
    "production-vehicles": READ_ONLY,
    "invoice-price-control": READ_ONLY,
    "parts-codes":         READ_ONLY,
  }),
  user: makeMatrix({
    "inventory":          READ_ONLY,
    "orders":             READ_ONLY,
    "velocity":           READ_ONLY,
    "demand-planning":    READ_ONLY,
    "container-planning": READ_ONLY,
    "available-stock":    READ_ONLY,
    "sku-master":         READ_ONLY,
    "sku-forecasts":      READ_ONLY,
    "container-timeline": READ_ONLY,
    "transit-stock":      READ_ONLY,
  }),
  guest: makeMatrix({}),
};

// Which actions are actually available per section (drives UI toggle visibility)
export const PERM_SECTION_ACTIONS: Record<PermSection, readonly PermAction[]> = {
  "inventory":           ["read"],
  "orders":              ["read"],
  "velocity":            ["read"],
  "demand-planning":     ["read", "edit"],
  "container-planning":  ["read", "create", "edit", "delete"],
  "available-stock":     ["read", "create", "edit", "delete"],
  "sku-master":          ["read", "create", "edit", "delete"],
  "sku-forecasts":       ["read"],
  "container-timeline":  ["read", "create", "edit"],
  "parts":               ["read", "create", "edit", "delete"],
  "transit-stock":       ["read", "create", "edit", "status", "delete"],
  "seat-cover-parts":    ["read", "create", "edit"],
  "production-vehicles": ["read", "create", "edit"],
  "invoice-price-control": ["read", "create", "edit", "delete"],
  "parts-codes":         ["read", "create", "edit", "delete"],
  "factory":             ["read", "create", "edit"],
  "warehouse":           ["read", "create", "edit", "delete"],
  "integrations":        ["read", "create", "edit", "delete"],
  "audit-log":           ["read"],
  "user-permissions":    ["read", "edit"],
  "shiphero":            ["read", "edit", "delete"],
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
