"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, PackageOpen, Warehouse } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { apiPath, withBasePath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";

type WarehouseType = "own" | "fba" | "3pl" | "transit";

type WarehouseRecord = {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseType: WarehouseType;
  country: string | null;
  stateRegion: string | null;
  city: string | null;
  timezone: string | null;
  isActive: boolean;
};

type WarehouseForm = {
  warehouseCode: string;
  warehouseName: string;
  warehouseType: WarehouseType;
  country: string;
  stateRegion: string;
  city: string;
  timezone: string;
  isActive: boolean;
};

type WarehouseContainer = {
  id: string;
  containerNumber: string;
  etaDate: string | null;
  actualArrivalDate: string | null;
  status: string;
  cbmCapacity: number;
  factoryName: string | null;
  origin: string | null;
  destWarehouse: string | null;
  itemCount: number;
  totalQty: number;
  totalCbm: number;
};

const warehouseTypes: Record<WarehouseType, { label: string; icon: string; badge: string; iconBg: string }> = {
  own: {
    label: "Owned Warehouse",
    icon: "🏢",
    badge: "bg-[#ebf0fd] text-[#1a4db0]",
    iconBg: "#ebf0fd",
  },
  fba: {
    label: "Amazon FBA",
    icon: "📦",
    badge: "bg-[#e6f5f0] text-[#0a5e45]",
    iconBg: "#e6f5f0",
  },
  "3pl": {
    label: "3PL External",
    icon: "🚛",
    badge: "bg-[#fef3e2] text-[#8a5300]",
    iconBg: "#fef3e2",
  },
  transit: {
    label: "In Transit",
    icon: "🚢",
    badge: "bg-[#fce4ec] text-[#880e4f]",
    iconBg: "#fce4ec",
  },
};

const emptyForm: WarehouseForm = {
  warehouseCode: "",
  warehouseName: "",
  warehouseType: "own",
  country: "United States",
  stateRegion: "",
  city: "",
  timezone: "America/Los_Angeles",
  isActive: true,
};

function toForm(w: WarehouseRecord): WarehouseForm {
  return {
    warehouseCode: w.warehouseCode,
    warehouseName: w.warehouseName,
    warehouseType: w.warehouseType as WarehouseType,
    country: w.country ?? "",
    stateRegion: w.stateRegion ?? "",
    city: w.city ?? "",
    timezone: w.timezone ?? "America/Los_Angeles",
    isActive: w.isActive,
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function WarehousePage() {
  const { pick } = useI18n();
  const { can } = usePermissions();
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<WarehouseType | "">("");
  const [showInactive, setShowInactive] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<WarehouseForm>(emptyForm);
  const [savedMessage, setSavedMessage] = useState("");
  const [warehouseContainers, setWarehouseContainers] = useState<WarehouseContainer[]>([]);
  const [containersLoading, setContainersLoading] = useState(false);

  async function fetchWarehouses() {
    setLoading(true);
    try {
      const res = await fetch(apiPath("/api/warehouses"));
      const json = await res.json();
      if (json.success) {
        setWarehouses(json.data);
        if (!selectedId && json.data.length > 0) {
          setSelectedId(json.data[0].id);
          setForm(toForm(json.data[0]));
        }
      }
    } catch {
      // silently fail — page will show empty list
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchWarehouses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchWarehouseContainers(warehouse: WarehouseRecord | null) {
    if (!warehouse) {
      setWarehouseContainers([]);
      return;
    }

    setContainersLoading(true);
    try {
      const params = new URLSearchParams({
        warehouseCode: warehouse.warehouseCode,
        warehouseName: warehouse.warehouseName,
      });
      if (warehouse.city) params.set("city", warehouse.city);

      const res = await fetch(apiPath(`/api/containers?${params.toString()}`), { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setWarehouseContainers(json.data);
      } else {
        setWarehouseContainers([]);
      }
    } catch {
      setWarehouseContainers([]);
    } finally {
      setContainersLoading(false);
    }
  }

  const filteredWarehouses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return warehouses.filter((w) => {
      if (!showInactive && !w.isActive) return false;
      if (typeFilter && w.warehouseType !== typeFilter) return false;
      if (
        normalizedQuery &&
        !w.warehouseCode.toLowerCase().includes(normalizedQuery) &&
        !w.warehouseName.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });
  }, [query, showInactive, typeFilter, warehouses]);

  const selectedWarehouse = warehouses.find((w) => w.id === selectedId) ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchWarehouseContainers(selectedWarehouse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWarehouse?.id]);

  const stats = {
    total: warehouses.length,
    active: warehouses.filter((w) => w.isActive).length,
    own3pl: warehouses.filter((w) => w.warehouseType === "own" || w.warehouseType === "3pl").length,
    fba: warehouses.filter((w) => w.warehouseType === "fba").length,
  };

  function selectWarehouse(w: WarehouseRecord) {
    setSelectedId(w.id);
    setForm(toForm(w));
    setEditMode(false);
    setIsNew(false);
    setSavedMessage("");
  }

  function startNewWarehouse() {
    setSelectedId(null);
    setForm(emptyForm);
    setEditMode(true);
    setIsNew(true);
    setSavedMessage("");
  }

  function updateForm<K extends keyof WarehouseForm>(key: K, value: WarehouseForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function cancelEdit() {
    if (isNew) {
      setIsNew(false);
      setEditMode(false);
      setSelectedId(null);
      setForm(emptyForm);
      return;
    }
    if (selectedWarehouse) setForm(toForm(selectedWarehouse));
    setEditMode(false);
  }

  async function saveWarehouse() {
    const requiredAction = isNew ? "create" : "edit";
    if (!can("warehouse", requiredAction)) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    const code = form.warehouseCode.trim().toUpperCase();
    const name = form.warehouseName.trim();

    if (!code) { window.alert(pick("창고 코드를 입력하세요.", "Enter a warehouse code.")); return; }
    if (!name) { window.alert(pick("창고명을 입력하세요.", "Enter a warehouse name.")); return; }

    setSaving(true);
    try {
      const payload = { ...form, warehouseCode: code, warehouseName: name };

      if (isNew) {
        const res = await fetch(apiPath("/api/warehouses"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) { window.alert(json.error ?? pick("창고 생성에 실패했습니다.", "Failed to create warehouse.")); return; }
        setSelectedId(json.data.id);
        setIsNew(false);
      } else if (selectedId) {
        const res = await fetch(apiPath(`/api/warehouses/${selectedId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) { window.alert(json.error ?? pick("창고 수정에 실패했습니다.", "Failed to update warehouse.")); return; }
      }

      setEditMode(false);
      setSavedMessage(pick("✓ 저장됨", "✓ Saved"));
      window.setTimeout(() => setSavedMessage(""), 2500);
      await fetchWarehouses();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!selectedWarehouse) return;
    const nextActive = !selectedWarehouse.isActive;
    const requiredAction = nextActive ? "status" : "delete";
    if (!can("warehouse", requiredAction)) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(apiPath(`/api/warehouses/${selectedWarehouse.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const json = await res.json();
      if (!json.success) { window.alert(json.error ?? pick("상태 변경에 실패했습니다.", "Failed to update status.")); return; }
      await fetchWarehouses();
      setForm((current) => ({ ...current, isActive: nextActive }));
    } finally {
      setSaving(false);
    }
  }

  async function deleteWarehouse() {
    if (!selectedWarehouse) return;
    if (!can("warehouse", "delete")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!window.confirm(pick(
      `창고 "${selectedWarehouse.warehouseCode}"을(를) 삭제하시겠습니까? PO 및 컨테이너 목적지 옵션에서 숨겨집니다.`,
      `Delete warehouse "${selectedWarehouse.warehouseCode}"? It will be hidden from PO and container destination options.`
    ))) return;
    setSaving(true);
    try {
      const res = await fetch(apiPath(`/api/warehouses/${selectedWarehouse.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const json = await res.json();
      if (!json.success) { window.alert(json.error ?? pick("창고 삭제에 실패했습니다.", "Failed to delete warehouse.")); return; }
      setSelectedId(null);
      setEditMode(false);
      setIsNew(false);
      setForm(emptyForm);
      await fetchWarehouses();
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout>
      <section className="warehouse-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4">
          <div className="flex items-start gap-2">
            <Warehouse className="mt-1 h-5 w-5" />
            <div>
              <h1 className="text-lg font-semibold">{pick("창고 관리", "Warehouse Management")}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {pick("구매 주문 및 컨테이너 워크플로에 사용되는 창고 정보를 관리합니다", "Manage warehouse master records used across purchase order and container workflows")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="form-input h-9 w-64 bg-white"
              placeholder={pick("창고코드/이름 검색...", "Search warehouse code/name...")}
            />
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as WarehouseType | "")}
              className="form-input h-9 w-36 bg-white text-xs"
            >
              <option value="">{pick("전체 유형", "All Types")}</option>
              <option value="own">{pick("자사 창고", "Owned Warehouse")}</option>
              <option value="fba">Amazon FBA</option>
              <option value="3pl">3PL</option>
              <option value="transit">{pick("운송 중", "In Transit")}</option>
            </select>
            <button
              type="button"
              onClick={startNewWarehouse}
              className="rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
            >
              {pick("+ 창고 추가", "Add Warehouse")}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 border-b border-[#e2dfd8] bg-[#f0eee9] md:grid-cols-4">
          <WarehouseStat label={pick("전체 창고", "Total Warehouses")} value={stats.total} sub={pick("등록된 창고", "Registered warehouses")} />
          <WarehouseStat label={pick("활성 창고", "Active Warehouses")} value={stats.active} sub={pick("현재 사용 중", "Currently in use")} />
          <WarehouseStat label={pick("자사 / 3PL", "Owned / 3PL")} value={stats.own3pl} sub="own + 3pl" />
          <WarehouseStat label={pick("FBA 창고", "FBA Warehouses")} value={stats.fba} sub="Amazon FBA" />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[380px_1fr]">
          <aside className="border-r border-[#e2dfd8] bg-white">
            <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
              <span className="text-sm font-semibold text-muted-foreground">
                {loading ? "..." : `${filteredWarehouses.length} ${pick("개 창고", "Warehouses")}`}
              </span>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                {pick("비활성 포함", "Include inactive")}
              </label>
            </div>

            <div className="h-full overflow-y-auto">
              {loading ? (
                <div className="p-5 text-center text-xs text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
              ) : filteredWarehouses.length > 0 ? (
                filteredWarehouses.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => selectWarehouse(w)}
                    className={`flex w-full items-start gap-3 border-b border-[#e2dfd8] px-4 py-3 text-left transition-colors hover:bg-[#f0eee9] ${
                      selectedId === w.id ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]" : ""
                    }`}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base"
                      style={{ backgroundColor: warehouseTypes[w.warehouseType as WarehouseType]?.iconBg ?? "#f0eee9" }}
                    >
                      {warehouseTypes[w.warehouseType as WarehouseType]?.icon ?? "🏭"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs font-bold">{w.warehouseCode}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{w.warehouseName}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <WarehouseTypeBadge type={w.warehouseType as WarehouseType} />
                        {w.stateRegion ? <span className="text-[10px] text-muted-foreground">{w.stateRegion}</span> : null}
                      </span>
                    </span>
                    <span className={w.isActive ? "rounded-md bg-[#e6f5f0] px-2 py-0.5 text-[10px] font-semibold text-[#0a5e45] dark:bg-emerald-950/70 dark:text-emerald-300" : "rounded-md bg-[#f0eee9] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-slate-800 dark:text-slate-400"}>
                      {w.isActive ? pick("활성", "Active") : pick("비활성", "Inactive")}
                    </span>
                  </button>
                ))
              ) : (
                <div className="p-5">
                  <button
                    type="button"
                    onClick={startNewWarehouse}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#cccac4] bg-[#f0eee9] p-10 text-center text-muted-foreground transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd] hover:text-[#1a4db0]"
                  >
                    <span className="text-3xl">🏭</span>
                    <span className="text-sm font-semibold">{pick("첫 창고를 추가하세요", "Add your first warehouse")}</span>
                    <span className="text-xs">{pick("+ 창고 추가 버튼을 클릭하세요", "Click the + Add Warehouse button")}</span>
                  </button>
                </div>
              )}
            </div>
          </aside>

          <main className="min-w-0 bg-white">
            {selectedWarehouse || isNew ? (
              <WarehouseDetail
                form={form}
                editMode={editMode}
                isNew={isNew}
                saving={saving}
                savedMessage={savedMessage}
                inboundContainers={warehouseContainers}
                containersLoading={containersLoading}
                onEdit={() => setEditMode(true)}
                onToggleActive={toggleActive}
                onDelete={deleteWarehouse}
                onCancel={cancelEdit}
                onSave={saveWarehouse}
                onChange={updateForm}
              />
            ) : (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
                <div className="text-5xl opacity-50">🏭</div>
                <div className="text-sm font-medium">{pick("창고를 선택하거나 새로 추가하세요", "Select a warehouse or add a new one")}</div>
                <div className="text-xs">{pick("왼쪽 목록에서 창고를 클릭하면 상세 정보를 볼 수 있습니다", "Click a warehouse in the left list to view details")}</div>
                <button
                  type="button"
                  onClick={startNewWarehouse}
                  className="mt-2 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
                >
                  {pick("+ 창고 추가", "Add Warehouse")}
                </button>
              </div>
            )}
          </main>
        </div>
      </section>
    </AppLayout>
  );
}

function WarehouseStat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function WarehouseTypeBadge({ type }: { type: WarehouseType }) {
  const meta = warehouseTypes[type];
  if (!meta) return null;
  return (
    <span className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

function WarehouseDetail({
  form,
  editMode,
  isNew,
  saving,
  savedMessage,
  inboundContainers,
  containersLoading,
  onEdit,
  onToggleActive,
  onDelete,
  onCancel,
  onSave,
  onChange,
}: {
  form: WarehouseForm;
  editMode: boolean;
  isNew: boolean;
  saving: boolean;
  savedMessage: string;
  inboundContainers: WarehouseContainer[];
  containersLoading: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
  onChange: <K extends keyof WarehouseForm>(key: K, value: WarehouseForm[K]) => void;
}) {
  const { pick } = useI18n();
  const detailType = warehouseTypes[form.warehouseType];
  const readonly = !editMode;
  const editableFieldClass = readonly ? "form-input bg-[#f0eee9]" : "form-input bg-white";
  const [containersOpen, setContainersOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e2dfd8] pb-4">
        <div>
          <div className="font-mono text-base font-semibold">
            {isNew ? `🏭 ${pick("새 창고", "New Warehouse")}` : `${detailType?.icon ?? "🏭"} ${form.warehouseCode}`}{" "}
            {!isNew ? <WarehouseTypeBadge type={form.warehouseType} /> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isNew ? pick("정보를 입력하고 저장하세요", "Enter the details and save") : `${form.warehouseName}${form.city ? ` · ${form.city}, ${form.stateRegion}` : ""}`}
          </div>
        </div>
        <div className="flex gap-2">
          {!isNew ? (
            <>
              <button
                type="button"
                onClick={onEdit}
                disabled={saving}
                className="rounded-md bg-[#1a5cdb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
              >
                {editMode ? pick("편집 중", "Editing") : pick("편집", "Edit")}
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={saving}
                className="rounded-md bg-[#c42b2b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#9b2020] disabled:opacity-50"
              >
                {pick("삭제", "Delete")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <WarehouseSection title={pick("기본 정보", "Basic Information")}>
        <div className="grid gap-3 md:grid-cols-2">
          <WarehouseField label={pick("창고 코드 (warehouse_code)", "Warehouse Code (warehouse_code)")}>
            <input className={`${editableFieldClass} font-mono uppercase`} readOnly={readonly} value={form.warehouseCode} onChange={(e) => onChange("warehouseCode", e.target.value.toUpperCase())} placeholder="WEST" />
          </WarehouseField>
          <WarehouseField label={pick("창고명 (warehouse_name)", "Warehouse Name (warehouse_name)")}>
            <input className={editableFieldClass} readOnly={readonly} value={form.warehouseName} onChange={(e) => onChange("warehouseName", e.target.value)} placeholder="West Coast Warehouse (California)" />
          </WarehouseField>
          <WarehouseField label={pick("창고 유형 (warehouse_type)", "Warehouse Type (warehouse_type)")}>
            <select className={editableFieldClass} disabled={readonly} value={form.warehouseType} onChange={(e) => onChange("warehouseType", e.target.value as WarehouseType)}>
              <option value="own">own — {pick("자사 창고", "Owned Warehouse")}</option>
              <option value="fba">fba — Amazon FBA</option>
              <option value="3pl">3pl — {pick("외부 3PL 창고", "External 3PL warehouse")}</option>
              <option value="transit">transit — {pick("운송 중 가상 창고", "In-transit virtual warehouse")}</option>
            </select>
          </WarehouseField>
          <WarehouseField label={pick("시간대 (timezone)", "Timezone (timezone)")}>
            <select className={editableFieldClass} disabled={readonly} value={form.timezone} onChange={(e) => onChange("timezone", e.target.value)}>
              <option value="America/Los_Angeles">America/Los_Angeles (PT — California)</option>
              <option value="America/New_York">America/New_York (ET — New Jersey/New York)</option>
              <option value="America/Chicago">America/Chicago (CT — Central)</option>
              <option value="America/Denver">America/Denver (MT — Mountain)</option>
              <option value="Asia/Seoul">Asia/Seoul (KST — Korea)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (CST — China)</option>
              <option value="UTC">UTC</option>
            </select>
          </WarehouseField>
        </div>
      </WarehouseSection>

      <WarehouseSection title={pick("위치 정보", "Location Information")}>
        <div className="grid gap-3 md:grid-cols-3">
          <WarehouseField label={pick("국가 (country)", "Country (country)")}>
            <input className={editableFieldClass} readOnly={readonly} value={form.country} onChange={(e) => onChange("country", e.target.value)} placeholder="United States" />
          </WarehouseField>
          <WarehouseField label={pick("주 / 지역 (state_region)", "State / Region (state_region)")}>
            <input className={editableFieldClass} readOnly={readonly} value={form.stateRegion} onChange={(e) => onChange("stateRegion", e.target.value)} placeholder="California" />
          </WarehouseField>
          <WarehouseField label={pick("도시 (city)", "City (city)")}>
            <input className={editableFieldClass} readOnly={readonly} value={form.city} onChange={(e) => onChange("city", e.target.value)} placeholder="Los Angeles" />
          </WarehouseField>
        </div>
      </WarehouseSection>

      <WarehouseSection title={pick("운영 설정", "Operating Settings")}>
        <div className="rounded-lg border border-[#e2dfd8] bg-[#f0eee9] p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{pick("활성 창고", "Active Warehouses")}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{pick("비활성화 시 PO 및 컨테이너 목적지 옵션에서 숨겨집니다", "When inactive, this warehouse is hidden from PO and container destination options")}</div>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => isNew ? onChange("isActive", !form.isActive) : onToggleActive()}
              aria-pressed={form.isActive}
              aria-label="Toggle warehouse active status"
              className={`relative h-6 w-11 overflow-hidden rounded-full transition-colors disabled:opacity-50 ${
                form.isActive ? "bg-[#0f7b5c]" : "bg-[#d2d0cb]"
              }`}
            >
              <span
                className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-[left] ${
                  form.isActive ? "left-[23px]" : "left-[3px]"
                }`}
              />
            </button>
          </div>
        </div>
      </WarehouseSection>

      {!isNew ? (
        <section className="mb-6">
          <button
            type="button"
            onClick={() => setContainersOpen((prev) => !prev)}
            className="mb-3 flex w-full items-center justify-between border-b border-[#e2dfd8] pb-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {containersOpen
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />}
              {pick("이 창고의 입고 컨테이너", "Inbound Containers for This Warehouse")}
            </span>
            <span className="text-[10px] font-normal normal-case text-muted-foreground">
              {containersLoading ? "..." : `${inboundContainers.length} ${pick("건", "records")}`}
            </span>
          </button>
          {containersOpen ? (
            containersLoading ? (
              <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-xs text-muted-foreground">
                {pick("컨테이너 불러오는 중...", "Loading containers...")}
              </div>
            ) : inboundContainers.length > 0 ? (
              <div className="space-y-2">
                {inboundContainers.map((container) => (
                  <Link
                    key={container.id}
                    href={withBasePath(`/planning/container-planning?containerId=${encodeURIComponent(container.id)}`)}
                    className="flex items-center gap-3 rounded-lg border border-[#e2dfd8] bg-white p-3 transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#ebf0fd] text-[#1a4db0] dark:bg-blue-950/70 dark:text-blue-300">
                      <PackageOpen className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="flex-1">
                      <div className="font-mono text-xs font-semibold">{pick("컨테이너", "Container")} {container.containerNumber}</div>
                      <div className="text-xs text-muted-foreground">
                        ETA: {container.etaDate ?? "-"} · {container.itemCount} SKUs · {formatNumber(container.totalQty)} {pick("개", "units")} · {container.totalCbm.toFixed(2)} CBM
                      </div>
                    </div>
                    <span className="rounded-lg bg-[#ebf0fd] px-2 py-0.5 text-[10px] font-semibold text-[#1a4db0]">
                      {container.status}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-xs text-muted-foreground">
                {pick("입고 컨테이너 없음", "No inbound containers")}
              </div>
            )
          ) : null}
        </section>
      ) : null}

      <div className="mt-4 flex items-center gap-2 border-t border-[#e2dfd8] pt-4">
        {editMode ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
            >
              {saving ? pick("저장 중...", "Saving...") : pick("저장", "Save")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border border-[#cccac4] bg-white px-4 py-2 text-sm hover:bg-[#f0eee9] disabled:opacity-50"
            >
              {pick("취소", "Cancel")}
            </button>
          </>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">{savedMessage ? pick("✓ 저장됨", "✓ Saved") : ""}</span>
      </div>
    </div>
  );
}

function WarehouseSection({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between border-b border-[#e2dfd8] pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        <span>{title}</span>
        {right ? <span className="text-[10px] font-normal normal-case">{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

function WarehouseField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
