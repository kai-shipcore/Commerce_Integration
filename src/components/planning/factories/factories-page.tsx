"use client";

import { useEffect, useMemo, useState } from "react";

type FactoryRecord = {
  id: string;
  factoryCode: string | null;
  factoryName: string;
  origin: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type FactoryForm = {
  factoryCode: string;
  factoryName: string;
  origin: string;
  contactName: string;
  email: string;
  phone: string;
  isActive: boolean;
};

const emptyForm: FactoryForm = {
  factoryCode: "",
  factoryName: "",
  origin: "",
  contactName: "",
  email: "",
  phone: "",
  isActive: true,
};

function toForm(f: FactoryRecord): FactoryForm {
  return {
    factoryCode: f.factoryCode ?? "",
    factoryName: f.factoryName,
    origin: f.origin ?? "",
    contactName: f.contactName ?? "",
    email: f.email ?? "",
    phone: f.phone ?? "",
    isActive: f.isActive,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function FactoriesPage() {
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<FactoryForm>(emptyForm);
  const [savedMessage, setSavedMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function fetchFactories() {
    setLoading(true);
    try {
      const res = await fetch("/api/factories", { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setFactories(json.data as FactoryRecord[]);
        if (!selectedId && json.data.length > 0) {
          const first = json.data[0] as FactoryRecord;
          setSelectedId(first.id);
          setForm(toForm(first));
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchFactories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredFactories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return factories.filter((f) => {
      if (!showInactive && !f.isActive) return false;
      if (
        q &&
        !f.factoryName.toLowerCase().includes(q) &&
        !(f.factoryCode ?? "").toLowerCase().includes(q) &&
        !(f.origin ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [factories, query, showInactive]);

  const selectedFactory = factories.find((f) => f.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const active = factories.filter((f) => f.isActive).length;
    return { total: factories.length, active, inactive: factories.length - active };
  }, [factories]);

  function selectFactory(f: FactoryRecord) {
    setSelectedId(f.id);
    setForm(toForm(f));
    setEditMode(false);
    setIsNew(false);
    setSavedMessage("");
    setErrorMsg("");
  }

  function startNew() {
    setSelectedId(null);
    setForm(emptyForm);
    setEditMode(true);
    setIsNew(true);
    setSavedMessage("");
    setErrorMsg("");
  }

  function cancelEdit() {
    if (isNew) {
      setIsNew(false);
      setEditMode(false);
      setSelectedId(null);
      setForm(emptyForm);
      return;
    }
    if (selectedFactory) setForm(toForm(selectedFactory));
    setEditMode(false);
    setErrorMsg("");
  }

  function updateForm<K extends keyof FactoryForm>(key: K, value: FactoryForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveFactory() {
    const name = form.factoryName.trim();
    if (!name) { setErrorMsg("Factory name is required."); return; }

    setSaving(true);
    setErrorMsg("");
    try {
      const payload = {
        factoryName: name,
        origin: form.origin.trim() || undefined,
        contactName: form.contactName.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
      };

      if (isNew) {
        const res = await fetch("/api/factories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) { setErrorMsg(json.error ?? "Failed to create factory"); return; }
        setSelectedId((json.data as FactoryRecord).id);
        setIsNew(false);
      } else if (selectedId) {
        const res = await fetch(`/api/factories/${selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) { setErrorMsg(json.error ?? "Failed to update factory"); return; }
      }

      setEditMode(false);
      setSavedMessage("✓ Saved");
      window.setTimeout(() => setSavedMessage(""), 2500);
      await fetchFactories();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!selectedFactory) return;
    const next = !selectedFactory.isActive;
    setSaving(true);
    try {
      const res = await fetch(`/api/factories/${selectedFactory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const json = await res.json();
      if (!json.success) { window.alert(json.error ?? "Failed to update status"); return; }
      await fetchFactories();
      setForm((prev) => ({ ...prev, isActive: next }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="factories-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">🏭 Factory Management</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage factory master records used across planning workflows
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="form-input h-9 w-64 bg-white"
              placeholder="Search name, code, or origin..."
            />
            <button
              type="button"
              onClick={startNew}
              className="rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
            >
              + Add Factory
            </button>
          </div>
        </header>

        {/* Stats bar */}
        <div className="grid grid-cols-3 border-b border-[#e2dfd8] bg-[#f0eee9]">
          <FactoryStat label="Total Factories" value={stats.total} sub="Registered factories" />
          <FactoryStat label="Active" value={stats.active} sub="Currently in use" />
          <FactoryStat label="Inactive" value={stats.inactive} sub="Deactivated" />
        </div>

        {/* Body: list + detail */}
        <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[360px_1fr]">

          {/* Left sidebar */}
          <aside className="border-r border-[#e2dfd8] bg-white">
            <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
              <span className="text-sm font-semibold text-muted-foreground">
                {loading ? "..." : `${filteredFactories.length} Factories`}
              </span>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                Include inactive
              </label>
            </div>

            <div className="h-full overflow-y-auto">
              {loading ? (
                <div className="p-5 text-center text-xs text-muted-foreground">Loading...</div>
              ) : filteredFactories.length > 0 ? (
                filteredFactories.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => selectFactory(f)}
                    className={`flex w-full items-start gap-3 border-b border-[#e2dfd8] px-4 py-3 text-left transition-colors hover:bg-[#f0eee9] ${
                      selectedId === f.id ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]" : ""
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0eee9] text-base">
                      🏭
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {f.factoryName}
                      </span>
                      {f.factoryCode ? (
                        <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                          {f.factoryCode}
                        </span>
                      ) : null}
                      {f.origin ? (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {f.origin}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={
                        f.isActive
                          ? "rounded-md bg-[#e6f5f0] px-2 py-0.5 text-[10px] font-semibold text-[#0a5e45] dark:bg-emerald-950/70 dark:text-emerald-300"
                          : "rounded-md bg-[#f0eee9] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-slate-800 dark:text-slate-400"
                      }
                    >
                      {f.isActive ? "Active" : "Inactive"}
                    </span>
                  </button>
                ))
              ) : (
                <div className="p-5">
                  <button
                    type="button"
                    onClick={startNew}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#cccac4] bg-[#f0eee9] p-10 text-center text-muted-foreground transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd] hover:text-[#1a4db0]"
                  >
                    <span className="text-3xl">🏭</span>
                    <span className="text-sm font-semibold">Add your first factory</span>
                    <span className="text-xs">Click the + Add Factory button</span>
                  </button>
                </div>
              )}
            </div>
          </aside>

          {/* Right detail pane */}
          <main className="min-w-0 bg-white">
            {selectedFactory || isNew ? (
              <FactoryDetail
                form={form}
                editMode={editMode}
                isNew={isNew}
                saving={saving}
                savedMessage={savedMessage}
                errorMsg={errorMsg}
                selectedFactory={selectedFactory}
                onEdit={() => setEditMode(true)}
                onToggleActive={toggleActive}
                onCancel={cancelEdit}
                onSave={saveFactory}
                onChange={updateForm}
              />
            ) : (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
                <div className="text-5xl opacity-50">🏭</div>
                <div className="text-sm font-medium">Select a factory or add a new one</div>
                <div className="text-xs">Click a factory in the left list to view details</div>
                <button
                  type="button"
                  onClick={startNew}
                  className="mt-2 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
                >
                  + Add Factory
                </button>
              </div>
            )}
          </main>
        </div>
    </section>
  );
}

function FactoryStat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function FactorySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 border-b border-[#e2dfd8] pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {title}
      </div>
      {children}
    </section>
  );
}

function FactoryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function FactoryDetail({
  form,
  editMode,
  isNew,
  saving,
  savedMessage,
  errorMsg,
  selectedFactory,
  onEdit,
  onToggleActive,
  onCancel,
  onSave,
  onChange,
}: {
  form: FactoryForm;
  editMode: boolean;
  isNew: boolean;
  saving: boolean;
  savedMessage: string;
  errorMsg: string;
  selectedFactory: FactoryRecord | null;
  onEdit: () => void;
  onToggleActive: () => void;
  onCancel: () => void;
  onSave: () => void;
  onChange: <K extends keyof FactoryForm>(key: K, value: FactoryForm[K]) => void;
}) {
  const readonly = !editMode;
  const fieldClass = readonly ? "form-input bg-[#f0eee9]" : "form-input bg-white";

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      {/* Detail header */}
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e2dfd8] pb-4">
        <div>
          <div className="text-base font-semibold">
            {isNew
              ? "🏭 New Factory"
              : `🏭 ${form.factoryName}`}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isNew
              ? "Enter the details and save"
              : `${form.factoryCode || "No code"}${form.origin ? ` · ${form.origin}` : ""}`}
          </div>
          {selectedFactory ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              Created {formatDate(selectedFactory.createdAt)}
              {selectedFactory.updatedAt && selectedFactory.updatedAt !== selectedFactory.createdAt
                ? ` · Updated ${formatDate(selectedFactory.updatedAt)}`
                : ""}
            </div>
          ) : null}
        </div>
        {!isNew ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEdit}
              disabled={saving}
              className="rounded-md bg-[#1a5cdb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
            >
              {editMode ? "Editing" : "Edit"}
            </button>
          </div>
        ) : null}
      </div>

      {/* Basic Information */}
      <FactorySection title="Basic Information">
        <div className="grid gap-3 md:grid-cols-2">
          <FactoryField label="Factory Name (factory_name) *">
            <input
              className={fieldClass}
              readOnly={readonly}
              value={form.factoryName}
              onChange={(e) => onChange("factoryName", e.target.value)}
              placeholder="e.g. Guangzhou Textiles Co."
            />
          </FactoryField>
          <FactoryField label="Origin (origin)">
            <input
              className={fieldClass}
              readOnly={readonly}
              value={form.origin}
              onChange={(e) => onChange("origin", e.target.value)}
              placeholder="e.g. China"
            />
          </FactoryField>
        </div>
      </FactorySection>

      {/* Contact Information */}
      <FactorySection title="Contact Information">
        <div className="grid gap-3 md:grid-cols-2">
          <FactoryField label="Contact Name (contact_name)">
            <input
              className={fieldClass}
              readOnly={readonly}
              value={form.contactName}
              onChange={(e) => onChange("contactName", e.target.value)}
              placeholder="e.g. Li Wei"
            />
          </FactoryField>
          <FactoryField label="Phone (phone)">
            <input
              className={fieldClass}
              readOnly={readonly}
              value={form.phone}
              onChange={(e) => onChange("phone", e.target.value)}
              placeholder="e.g. +86 20 1234 5678"
            />
          </FactoryField>
          <FactoryField label="Email (email)">
            <input
              type={readonly ? "text" : "email"}
              className={fieldClass}
              readOnly={readonly}
              value={form.email}
              onChange={(e) => onChange("email", e.target.value)}
              placeholder="e.g. contact@factory.com"
            />
          </FactoryField>
        </div>
      </FactorySection>

      {/* Operating Settings */}
      <FactorySection title="Operating Settings">
        <div className="rounded-lg border border-[#e2dfd8] bg-[#f0eee9] p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Active (is_active)</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                When inactive, this factory is hidden from purchase order options
              </div>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                isNew ? onChange("isActive", !form.isActive) : onToggleActive()
              }
              aria-pressed={form.isActive}
              aria-label="Toggle factory active status"
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
      </FactorySection>

      {/* Footer actions */}
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
        {errorMsg ? (
          <span className="text-xs text-red-600">{errorMsg}</span>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">{savedMessage}</span>
        )}
      </div>
    </div>
  );
}
