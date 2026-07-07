"use client";

import { useEffect, useMemo, useState } from "react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";
import type { PermSection } from "@/lib/permissions-config";

type MasterRecord = {
  id: string;
  isActive: boolean;
  [key: string]: unknown;
};

type MasterForm = {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
};

export type MasterDataTabConfig = {
  apiPath: string;
  permissionSection: PermSection;
  codeField: string;
  nameField?: string;
  hasDescription: boolean;
  uppercaseCode: boolean;
  icon: string;
  codeLabel: { ko: string; en: string };
  namePlaceholder?: { ko: string; en: string };
  codePlaceholder: string;
  entityLabel: { ko: string; en: string };
};

const emptyForm: MasterForm = { code: "", name: "", description: "", isActive: true };

function toForm(record: MasterRecord, config: MasterDataTabConfig): MasterForm {
  return {
    code: String(record[config.codeField] ?? ""),
    name: config.nameField ? String(record[config.nameField] ?? "") : "",
    description: config.hasDescription ? String(record.description ?? "") : "",
    isActive: record.isActive,
  };
}

function subtitleOf(form: MasterForm, config: MasterDataTabConfig): string {
  if (config.nameField) return form.name;
  if (config.hasDescription) return form.description;
  return "";
}

export function MasterDataTab({ config }: { config: MasterDataTabConfig }) {
  const { pick } = useI18n();
  const { can } = usePermissions();
  const [records, setRecords] = useState<MasterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<MasterForm>(emptyForm);
  const [savedMessage, setSavedMessage] = useState("");

  async function fetchRecords() {
    setLoading(true);
    try {
      const res = await fetch(apiPath(config.apiPath));
      const json = await res.json();
      if (json.success) {
        setRecords(json.data);
      }
    } catch {
      // silently fail — tab will show empty list
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.apiPath]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (!showInactive && !record.isActive) return false;
      if (!normalizedQuery) return true;
      const code = String(record[config.codeField] ?? "").toLowerCase();
      const name = config.nameField ? String(record[config.nameField] ?? "").toLowerCase() : "";
      const description = config.hasDescription ? String(record.description ?? "").toLowerCase() : "";
      return code.includes(normalizedQuery) || name.includes(normalizedQuery) || description.includes(normalizedQuery);
    });
  }, [query, showInactive, records, config.codeField, config.nameField, config.hasDescription]);

  const selectedRecord = records.find((record) => record.id === selectedId) ?? null;

  function selectRecord(record: MasterRecord) {
    setSelectedId(record.id);
    setForm(toForm(record, config));
    setEditMode(false);
    setIsNew(false);
    setSavedMessage("");
  }

  function startNew() {
    setSelectedId(null);
    setForm(emptyForm);
    setEditMode(true);
    setIsNew(true);
    setSavedMessage("");
  }

  function updateForm<K extends keyof MasterForm>(key: K, value: MasterForm[K]) {
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
    if (selectedRecord) setForm(toForm(selectedRecord, config));
    setEditMode(false);
  }

  function buildPayload() {
    const code = form.code.trim();
    const payload: Record<string, unknown> = {
      [config.codeField]: config.uppercaseCode ? code.toUpperCase() : code,
      isActive: form.isActive,
    };
    if (config.nameField) payload[config.nameField] = form.name.trim();
    if (config.hasDescription) payload.description = form.description.trim() || undefined;
    return payload;
  }

  async function saveRecord() {
    const requiredAction = isNew ? "create" : "edit";
    if (!can(config.permissionSection, requiredAction)) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!form.code.trim()) { window.alert(pick("코드를 입력하세요.", "Enter a code.")); return; }
    if (config.nameField && !form.name.trim()) { window.alert(pick("명칭을 입력하세요.", "Enter a name.")); return; }

    setSaving(true);
    try {
      const payload = buildPayload();

      if (isNew) {
        const res = await fetch(apiPath(config.apiPath), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) { window.alert(json.error ?? pick("생성에 실패했습니다.", "Failed to create.")); return; }
        setSelectedId(json.data.id);
        setIsNew(false);
      } else if (selectedId) {
        const res = await fetch(apiPath(`${config.apiPath}/${selectedId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) { window.alert(json.error ?? pick("수정에 실패했습니다.", "Failed to update.")); return; }
      }

      setEditMode(false);
      setSavedMessage(pick("✓ 저장됨", "✓ Saved"));
      window.setTimeout(() => setSavedMessage(""), 2500);
      await fetchRecords();
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (!selectedRecord) return;
    if (!can(config.permissionSection, "delete")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    const code = String(selectedRecord[config.codeField] ?? "");
    if (!window.confirm(pick(`"${code}"을(를) 삭제하시겠습니까?`, `Delete "${code}"?`))) return;
    setSaving(true);
    try {
      const res = await fetch(apiPath(`${config.apiPath}/${selectedRecord.id}`), { method: "DELETE" });
      const json = await res.json();
      if (!json.success) { window.alert(json.error ?? pick("삭제에 실패했습니다.", "Failed to delete.")); return; }
      setSelectedId(null);
      setEditMode(false);
      setIsNew(false);
      setForm(emptyForm);
      await fetchRecords();
    } finally {
      setSaving(false);
    }
  }

  const readonly = !editMode;
  const editableFieldClass = readonly ? "form-input bg-[#f0eee9]" : "form-input bg-white";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[380px_1fr]">
      <aside className="border-r border-[#e2dfd8] bg-white">
        <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
          <span className="text-sm font-semibold text-muted-foreground">
            {loading ? "..." : `${filteredRecords.length} ${pick("건", "records")}`}
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

        <div className="flex items-center gap-2 border-b border-[#e2dfd8] px-4 py-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="form-input h-9 flex-1 bg-white"
            placeholder={pick("검색...", "Search...")}
          />
          {can(config.permissionSection, "create") ? (
            <button
              type="button"
              onClick={startNew}
              className="whitespace-nowrap rounded-md bg-[#1a5cdb] px-3 py-2 text-xs font-medium text-white hover:bg-[#1650c4]"
            >
              {pick("+ 추가", "+ Add")}
            </button>
          ) : null}
        </div>

        <div className="h-full overflow-y-auto">
          {loading ? (
            <div className="p-5 text-center text-xs text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
          ) : filteredRecords.length > 0 ? (
            filteredRecords.map((record) => {
              const recordForm = toForm(record, config);
              const subtitle = subtitleOf(recordForm, config);
              return (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => selectRecord(record)}
                  className={`flex w-full items-start gap-3 border-b border-[#e2dfd8] px-4 py-3 text-left transition-colors hover:bg-[#f0eee9] ${
                    selectedId === record.id ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]" : ""
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0eee9] text-base">
                    {config.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-xs font-bold">{String(record[config.codeField] ?? "")}</span>
                    {subtitle ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
                    ) : null}
                  </span>
                  <span className={record.isActive ? "rounded-md bg-[#e6f5f0] px-2 py-0.5 text-[10px] font-semibold text-[#0a5e45] dark:bg-emerald-950/70 dark:text-emerald-300" : "rounded-md bg-[#f0eee9] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-slate-800 dark:text-slate-400"}>
                    {record.isActive ? pick("활성", "Active") : pick("비활성", "Inactive")}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="p-5">
              {can(config.permissionSection, "create") ? (
                <button
                  type="button"
                  onClick={startNew}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#cccac4] bg-[#f0eee9] p-10 text-center text-muted-foreground transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd] hover:text-[#1a4db0]"
                >
                  <span className="text-3xl">{config.icon}</span>
                  <span className="text-sm font-semibold">
                    {pick(`첫 ${config.entityLabel.ko}을(를) 추가하세요`, `Add your first ${config.entityLabel.en}`)}
                  </span>
                  <span className="text-xs">{pick("+ 추가 버튼을 클릭하세요", "Click the + Add button")}</span>
                </button>
              ) : (
                <div className="p-5 text-center text-xs text-muted-foreground">{pick("등록된 항목이 없습니다.", "No records yet.")}</div>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 bg-white">
        {selectedRecord || isNew ? (
          <div className="h-full overflow-y-auto px-7 py-6">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e2dfd8] pb-4">
              <div>
                <div className="font-mono text-base font-semibold">
                  {isNew ? `${config.icon} ${pick(`새 ${config.entityLabel.ko}`, `New ${config.entityLabel.en}`)}` : `${config.icon} ${form.code}`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {isNew ? pick("정보를 입력하고 저장하세요", "Enter the details and save") : subtitleOf(form, config)}
                </div>
              </div>
              <div className="flex gap-2">
                {!isNew ? (
                  <>
                    {can(config.permissionSection, "edit") ? (
                      <button
                        type="button"
                        onClick={() => setEditMode(true)}
                        disabled={saving}
                        className="rounded-md bg-[#1a5cdb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                      >
                        {editMode ? pick("편집 중", "Editing") : pick("편집", "Edit")}
                      </button>
                    ) : null}
                    {can(config.permissionSection, "delete") ? (
                      <button
                        type="button"
                        onClick={deleteRecord}
                        disabled={saving}
                        className="rounded-md bg-[#c42b2b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#9b2020] disabled:opacity-50"
                      >
                        {pick("삭제", "Delete")}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between border-b border-[#e2dfd8] pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                <span>{pick("기본 정보", "Basic Information")}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                    {pick(config.codeLabel.ko, config.codeLabel.en)}
                  </span>
                  <input
                    className={`${editableFieldClass} font-mono ${config.uppercaseCode ? "uppercase" : ""}`}
                    readOnly={readonly}
                    value={form.code}
                    onChange={(e) => updateForm("code", config.uppercaseCode ? e.target.value.toUpperCase() : e.target.value)}
                    placeholder={config.codePlaceholder}
                  />
                </label>
                {config.nameField && config.namePlaceholder ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                      {pick(config.namePlaceholder.ko, config.namePlaceholder.en)}
                    </span>
                    <input
                      className={editableFieldClass}
                      readOnly={readonly}
                      value={form.name}
                      onChange={(e) => updateForm("name", e.target.value)}
                    />
                  </label>
                ) : null}
                {config.hasDescription ? (
                  <label className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                      {pick("설명 (description)", "Description")}
                    </span>
                    <textarea
                      className={`${editableFieldClass} min-h-[72px]`}
                      readOnly={readonly}
                      value={form.description}
                      onChange={(e) => updateForm("description", e.target.value)}
                    />
                  </label>
                ) : null}
              </div>
            </section>

            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between border-b border-[#e2dfd8] pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                <span>{pick("상태", "Status")}</span>
              </div>
              <div className="rounded-lg border border-[#e2dfd8] bg-[#f0eee9] p-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{pick("활성 상태", "Active")}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {pick("비활성화 시 선택 목록에서 숨겨집니다", "When inactive, this is hidden from selection lists")}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={saving || (!isNew && !editMode)}
                    onClick={() => updateForm("isActive", !form.isActive)}
                    aria-pressed={form.isActive}
                    aria-label="Toggle active status"
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
            </section>

            <div className="mt-4 flex items-center gap-2 border-t border-[#e2dfd8] pt-4">
              {editMode ? (
                <>
                  <button
                    type="button"
                    onClick={saveRecord}
                    disabled={saving}
                    className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                  >
                    {saving ? pick("저장 중...", "Saving...") : pick("저장", "Save")}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="rounded-md border border-[#cccac4] bg-white px-4 py-2 text-sm hover:bg-[#f0eee9] disabled:opacity-50"
                  >
                    {pick("취소", "Cancel")}
                  </button>
                </>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">{savedMessage}</span>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="text-5xl opacity-50">{config.icon}</div>
            <div className="text-sm font-medium">
              {pick(`${config.entityLabel.ko}을(를) 선택하거나 새로 추가하세요`, `Select a ${config.entityLabel.en} or add a new one`)}
            </div>
            {can(config.permissionSection, "create") ? (
              <button
                type="button"
                onClick={startNew}
                className="mt-2 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
              >
                {pick("+ 추가", "+ Add")}
              </button>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
