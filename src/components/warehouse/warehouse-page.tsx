"use client";

import Link from "next/link";
import { PackageOpen, Warehouse } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { apiPath } from "@/lib/api-path";

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
    icon: "ðŸ¢",
    badge: "bg-[#ebf0fd] text-[#1a4db0]",
    iconBg: "#ebf0fd",
  },
  fba: {
    label: "Amazon FBA",
    icon: "ðŸ“¦",
    badge: "bg-[#e6f5f0] text-[#0a5e45]",
    iconBg: "#e6f5f0",
  },
  "3pl": {
    label: "3PL External",
    icon: "ðŸš›",
    badge: "bg-[#fef3e2] text-[#8a5300]",
    iconBg: "#fef3e2",
  },
  transit: {
    label: "In Transit",
    icon: "ðŸš¢",
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
      // silently fail â€” page will show empty list
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
    const code = form.warehouseCode.trim().toUpperCase();
    const name = form.warehouseName.trim();

    if (!code) { window.alert("Enter a warehouse code."); return; }
    if (!name) { window.alert("Enter a warehouse name."); return; }

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
        if (!json.success) { window.alert(json.error ?? "Failed to create warehouse"); return; }
        setSelectedId(json.data.id);
        setIsNew(false);
      } else if (selectedId) {
        const res = await fetch(apiPath(`/api/warehouses/${selectedId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) { window.alert(json.error ?? "Failed to update warehouse"); return; }
      }

      setEditMode(false);
      setSavedMessage("âœ“ Saved");
      window.setTimeout(() => setSavedMessage(""), 2500);
      await fetchWarehouses();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!selectedWarehouse) return;
    const nextActive = !selectedWarehouse.isActive;
    setSaving(true);
    try {
      const res = await fetch(apiPath(`/api/warehouses/${selectedWarehouse.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const json = await res.json();
      if (!json.success) { window.alert(json.error ?? "Failed to update status"); return; }
      await fetchWarehouses();
      setForm((current) => ({ ...current, isActive: nextActive }));
    } finally {
      setSaving(false);
    }
  }

  async function deleteWarehouse() {
    if (!selectedWarehouse) return;
    if (!window.confirm(`Delete warehouse "${selectedWarehouse.warehouseCode}"?`)) return;
    setSaving(true);
    try {
      const res = await fetch(apiPath(`/api/warehouses/${selectedWarehouse.id}`), { method: "DELETE" });
      const json = await res.json();
      if (!json.success) { window.alert(json.error ?? "Failed to delete warehouse"); return; }
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
              <h1 className="text-lg font-semibold">Warehouse Management</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Manage warehouse master records and SKU-level inventory status (DB: fc_warehouses)
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="form-input h-9 w-64 bg-white"
              placeholder="Search warehouse code/name..."
            />
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as WarehouseType | "")}
              className="form-input h-9 w-36 bg-white text-xs"
            >
              <option value="">All Types</option>
              <option value="own">Owned Warehouse</option>
              <option value="fba">Amazon FBA</option>
              <option value="3pl">3PL</option>
              <option value="transit">In Transit</option>
            </select>
            <button
              type="button"
              onClick={startNewWarehouse}
              className="rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
            >
              + Add Warehouse
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 border-b border-[#e2dfd8] bg-[#f0eee9] md:grid-cols-4">
          <WarehouseStat label="Total Warehouses" value={stats.total} sub="Registered warehouses" />
          <WarehouseStat label="Active Warehouses" value={stats.active} sub="Currently in use" />
          <WarehouseStat label="Owned / 3PL" value={stats.own3pl} sub="own + 3pl" />
          <WarehouseStat label="FBA Warehouses" value={stats.fba} sub="Amazon FBA" />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[380px_1fr]">
          <aside className="border-r border-[#e2dfd8] bg-white">
            <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
              <span className="text-sm font-semibold text-muted-foreground">
                {loading ? "..." : `${filteredWarehouses.length} Warehouses`}
              </span>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Include inactive
              </label>
            </div>

            <div className="h-full overflow-y-auto">
              {loading ? (
                <div className="p-5 text-center text-xs text-muted-foreground">Loading...</div>
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
                      {warehouseTypes[w.warehouseType as WarehouseType]?.icon ?? "ðŸ­"}
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
                      {w.isActive ? "Active" : "Inactive"}
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
                    <span className="text-3xl">ðŸ­</span>
                    <span className="text-sm font-semibold">Add your first warehouse</span>
                    <span className="text-xs">Click the + Add Warehouse button</span>
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
                <div className="text-5xl opacity-50">ðŸ­</div>
                <div className="text-sm font-medium">Select a warehouse or add a new one</div>
                <div className="text-xs">Click a warehouse in the left list to view details</div>
                <button
                  type="button"
                  onClick={startNewWarehouse}
                  className="mt-2 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
                >
                  + Add Warehouse
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
  const detailType = warehouseTypes[form.warehouseType];
  const readonly = !editMode;
  const editableFieldClass = readonly ? "form-input bg-[#f0eee9]" : "form-input bg-white";

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e2dfd8] pb-4">
        <div>
          <div className="font-mono text-base font-semibold">
            {isNew ? "ðŸ­ New Warehouse" : `${detailType?.icon ?? "ðŸ­"} ${form.warehouseCode}`}{" "}
            {!isNew ? <WarehouseTypeBadge type={form.warehouseType} /> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isNew ? "Enter the details and save" : `${form.warehouseName}${form.city ? ` Â· ${form.city}, ${form.stateRegion}` : ""}`}
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
                {editMode ? "Editing" : "Edit"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={saving}
                className="rounded-md bg-[#c42b2b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#9b2020] disabled:opacity-50"
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>

      <WarehouseSection title="Basic Information">
        <div className="grid gap-3 md:grid-cols-2">
          <WarehouseField label="Warehouse Code (warehouse_code)">
            <input className={`${editableFieldClass} font-mono uppercase`} readOnly={readonly} value={form.warehouseCode} onChange={(e) => onChange("warehouseCode", e.target.value.toUpperCase())} placeholder="WEST" />
          </WarehouseField>
          <WarehouseField label="Warehouse Name (warehouse_name)">
            <input className={editableFieldClass} readOnly={readonly} value={form.warehouseName} onChange={(e) => onChange("warehouseName", e.target.value)} placeholder="West Coast Warehouse (California)" />
          </WarehouseField>
          <WarehouseField label="Warehouse Type (warehouse_type)">
            <select className={editableFieldClass} disabled={readonly} value={form.warehouseType} onChange={(e) => onChange("warehouseType", e.target.value as WarehouseType)}>
              <option value="own">own â€” Owned Warehouse</option>
              <option value="fba">fba â€” Amazon FBA</option>
              <option value="3pl">3pl â€” External 3PL warehouse</option>
              <option value="transit">transit â€” In-transit virtual warehouse</option>
            </select>
          </WarehouseField>
          <WarehouseField label="Timezone (timezone)">
            <select className={editableFieldClass} disabled={readonly} value={form.timezone} onChange={(e) => onChange("timezone", e.target.value)}>
              <option value="America/Los_Angeles">America/Los_Angeles (PT â€” California)</option>
              <option value="America/New_York">America/New_York (ET â€” New Jersey/New York)</option>
              <option value="America/Chicago">America/Chicago (CT â€” Central)</option>
              <option value="America/Denver">America/Denver (MT â€” Mountain)</option>
              <option value="Asia/Seoul">Asia/Seoul (KST â€” Korea)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (CST â€” China)</option>
              <option value="UTC">UTC</option>
            </select>
          </WarehouseField>
        </div>
      </WarehouseSection>

      <WarehouseSection title="Location Information">
        <div className="grid gap-3 md:grid-cols-3">
          <WarehouseField label="Country (country)">
            <input className={editableFieldClass} readOnly={readonly} value={form.country} onChange={(e) => onChange("country", e.target.value)} placeholder="United States" />
          </WarehouseField>
          <WarehouseField label="State / Region (state_region)">
            <input className={editableFieldClass} readOnly={readonly} value={form.stateRegion} onChange={(e) => onChange("stateRegion", e.target.value)} placeholder="California" />
          </WarehouseField>
          <WarehouseField label="City (city)">
            <input className={editableFieldClass} readOnly={readonly} value={form.city} onChange={(e) => onChange("city", e.target.value)} placeholder="Los Angeles" />
          </WarehouseField>
        </div>
      </WarehouseSection>

      <WarehouseSection title="Operating Settings">
        <div className="rounded-lg border border-[#e2dfd8] bg-[#f0eee9] p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Active Warehouses (is_active)</div>
              <div className="mt-0.5 text-xs text-muted-foreground">When inactive, this warehouse is hidden from PO and container destination options</div>
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
        <WarehouseSection title="Inbound Containers for This Warehouse" right={`${inboundContainers.length} records`}>
          {containersLoading ? (
            <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-xs text-muted-foreground">
              Loading containers...
            </div>
          ) : inboundContainers.length > 0 ? (
            <div className="space-y-2">
              {inboundContainers.map((container) => (
                <Link
                  key={container.id}
                  href={`/planning/container-planning?containerId=${encodeURIComponent(container.id)}`}
                  className="flex items-center gap-3 rounded-lg border border-[#e2dfd8] bg-white p-3 transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#ebf0fd] text-[#1a4db0] dark:bg-blue-950/70 dark:text-blue-300">
                    <PackageOpen className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="flex-1">
                    <div className="font-mono text-xs font-semibold">Container {container.containerNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      ETA: {container.etaDate ?? "-"} Â· {container.itemCount} SKUs Â· {formatNumber(container.totalQty)} units Â· {container.totalCbm.toFixed(2)} CBM
                    </div>
                  </div>
                  <span className="rounded-lg bg-[#ebf0fd] px-2 py-0.5 text-[10px] font-semibold text-[#1a4db0]">
                    {container.status}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-xs text-muted-foreground">No inbound containers</div>
          )}
        </WarehouseSection>
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
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border border-[#cccac4] bg-white px-4 py-2 text-sm hover:bg-[#f0eee9] disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">{savedMessage}</span>
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
