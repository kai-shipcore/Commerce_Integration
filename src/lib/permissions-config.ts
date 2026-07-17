export const PERM_SECTIONS = [
  // Commerce
  { id: "inventory",           group: "Commerce",    nameKo: "재고",              nameEn: "Inventory" },
  { id: "orders",              group: "Commerce",    nameKo: "주문",              nameEn: "Orders" },
  { id: "velocity",            group: "Commerce",    nameKo: "판매 속도",          nameEn: "Velocity" },
  // Planning
  { id: "demand-planning",     group: "Planning",    nameKo: "수요 계획",          nameEn: "Demand Planning" },
  { id: "sku-forecasts",       group: "Planning",    nameKo: "SKU 계획",           nameEn: "SKU Planning" },
  { id: "demand-forecast",     group: "Planning",    nameKo: "수요 예측",          nameEn: "Demand Forecast" },
  { id: "container-planning",  group: "Planning",    nameKo: "컨테이너 계획",       nameEn: "Container Planning" },
  { id: "container-timeline",  group: "Planning",    nameKo: "컨테이너 일정",       nameEn: "Container Timeline" },
  { id: "available-stock",     group: "Planning",    nameKo: "가용 재고",          nameEn: "Available Stock" },
  { id: "transit-stock",       group: "Planning",    nameKo: "재고 이동",          nameEn: "Transit Stock" },
  // Production
  { id: "seat-cover-parts",    group: "Production",  nameKo: "시트 커버 부품",      nameEn: "Seat Cover Parts" },
  { id: "production-vehicles", group: "Production",  nameKo: "차종 관리",          nameEn: "Vehicles" },
  { id: "parts-codes",         group: "Production",  nameKo: "부품·코드",          nameEn: "Parts & Codes" },
  { id: "part-sku-generator",  group: "Production",  nameKo: "Part SKU",           nameEn: "Part SKU" },
  { id: "project-list",        group: "Production",  nameKo: "제품 목록",          nameEn: "Product List" },
  // Master Data
  { id: "sku-master",          group: "Master Data", nameKo: "SKU 기준 정보",       nameEn: "SKU Master" },
  { id: "parts",               group: "Master Data", nameKo: "부품",              nameEn: "Parts" },
  { id: "factory",             group: "Master Data", nameKo: "공장",              nameEn: "Factories" },
  { id: "warehouse",           group: "Master Data", nameKo: "창고",              nameEn: "Warehouse" },
  // Admin
  { id: "integrations",        group: "Admin",       nameKo: "마켓플레이스 API",    nameEn: "Marketplace APIs" },
  { id: "invoice-price-control", group: "Admin",     nameKo: "Invoice·가격 검수", nameEn: "Invoice & Price Control" },
  { id: "audit-log",           group: "Admin",       nameKo: "감사 로그",          nameEn: "Audit Log" },
  { id: "user-permissions",    group: "Admin",       nameKo: "사용자 권한",         nameEn: "User Access" },
  { id: "shiphero",            group: "Admin",       nameKo: "ShipHero 계정",      nameEn: "ShipHero Credentials" },
  { id: "container-import",    group: "Admin",       nameKo: "컨테이너 가져오기",    nameEn: "Container Import" },
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
    "demand-forecast":     ALL_ON,
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
    "part-sku-generator":  ALL_ON,
    "project-list":        ALL_ON,
    "factory":             ALL_ON,
    "warehouse":           ALL_ON,
    "transit-stock":       ALL_ON,
    "integrations":        ALL_ON,
    "audit-log":           ALL_ON,
    "user-permissions":    ALL_ON,
    "shiphero":            ALL_ON,
    "container-import":    ALL_ON,
  }),
  dev: makeMatrix({
    "inventory":           ALL_ON,
    "orders":              ALL_ON,
    "velocity":            ALL_ON,
    "demand-planning":     ALL_ON,
    "demand-forecast":     ALL_ON,
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
    "part-sku-generator":  ALL_ON,
    "project-list":        ALL_ON,
    "factory":             ALL_ON,
    "warehouse":           ALL_ON,
    "transit-stock":       ALL_ON,
    "integrations":        ALL_ON,
    "audit-log":           ALL_ON,
    "user-permissions":    ALL_ON,
    "shiphero":            ALL_ON,
    "container-import":    ALL_ON,
  }),
  planner: makeMatrix({
    "inventory":           READ_ONLY,
    "orders":              READ_ONLY,
    "velocity":            READ_ONLY,
    "demand-planning":     { read: true,  create: true,  edit: true,  status: true,  delete: false },
    "demand-forecast":     READ_ONLY,
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
    "project-list":        NONE,
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
    "part-sku-generator":  READ_ONLY,
    "project-list":        ALL_ON,
  }),
  user: makeMatrix({
    "inventory":          READ_ONLY,
    "orders":             READ_ONLY,
    "velocity":           READ_ONLY,
    "demand-planning":    READ_ONLY,
    "demand-forecast":    READ_ONLY,
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
  "demand-forecast":     ["read"],
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
  "part-sku-generator":  ["read", "create", "edit", "delete"],
  "project-list":        ["read", "create", "edit", "delete"],
  "factory":             ["read", "create", "edit"],
  "warehouse":           ["read", "create", "edit", "delete"],
  "integrations":        ["read", "create", "edit", "delete"],
  "audit-log":           ["read"],
  "user-permissions":    ["read", "edit"],
  "shiphero":            ["read", "edit", "delete"],
  "container-import":    ["read", "create"],
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
