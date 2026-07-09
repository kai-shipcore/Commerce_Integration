"use client";

import { useEffect, useMemo, useState } from "react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SEAT_COVER_PART_CATALOG } from "@/lib/seat-cover-part-catalog";

type ProductionPartRecord = {
  id: string;
  partName: string;
  description: string | null;
  seatRow: string | null;
  position: string | null;
  category: string | null;
  isActive: boolean;
};

const PAGE_SIZE = 20;

export function PartRegistrationTab() {
  const { pick } = useI18n();
  const { can } = usePermissions();

  const [records, setRecords] = useState<ProductionPartRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [catalogChoice, setCatalogChoice] = useState("");
  const [partNameInput, setPartNameInput] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [savedMessage, setSavedMessage] = useState("");

  async function fetchRecords() {
    setLoading(true);
    try {
      const res = await fetch(apiPath("/api/production/parts"));
      const json = await res.json();
      if (json.success) setRecords(json.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRecords();
  }, []);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (!showInactive && !record.isActive) return false;
      if (!normalizedQuery) return true;
      return record.partName.toLowerCase().includes(normalizedQuery);
    });
  }, [query, showInactive, records]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRecords = filteredRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectedRecord = records.find((record) => record.id === selectedId) ?? null;

  // The catalog is a reusable classification (Row/Position/Category tag), not a unique
  // identifier — many different Part Names can share the same classification, so it's
  // never "used up" the way a unique code would be.
  const catalogOptions = useMemo(() => SEAT_COVER_PART_CATALOG.map((option) => option.name), []);
  const chosenCatalogEntry = SEAT_COVER_PART_CATALOG.find((option) => option.name === catalogChoice) ?? null;

  function selectRecord(record: ProductionPartRecord) {
    setSelectedId(record.id);
    setDescription(record.description ?? "");
    setIsActive(record.isActive);
    setCatalogChoice("");
    setEditMode(false);
    setIsNew(false);
    setSavedMessage("");
  }

  function startNew() {
    setSelectedId(null);
    setCatalogChoice("");
    setPartNameInput("");
    setDescription("");
    setIsActive(true);
    setEditMode(true);
    setIsNew(true);
    setSavedMessage("");
  }

  function cancelEdit() {
    if (isNew) {
      setIsNew(false);
      setEditMode(false);
      setSelectedId(null);
      setCatalogChoice("");
      setPartNameInput("");
      return;
    }
    if (selectedRecord) {
      setDescription(selectedRecord.description ?? "");
      setIsActive(selectedRecord.isActive);
    }
    setEditMode(false);
  }

  async function saveRecord() {
    const requiredAction = isNew ? "create" : "edit";
    if (!can("parts-codes", requiredAction)) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }

    if (isNew && !chosenCatalogEntry) {
      window.alert(pick("Part 분류를 선택하세요.", "Select a Part classification."));
      return;
    }
    if (isNew && !partNameInput.trim()) {
      window.alert(pick("Part Name을 입력하세요.", "Enter a Part Name."));
      return;
    }

    setSaving(true);
    try {
      if (isNew && chosenCatalogEntry) {
        const payload = {
          partName: partNameInput.trim(),
          seatRow: chosenCatalogEntry.seatRow,
          position: chosenCatalogEntry.position,
          category: chosenCatalogEntry.category,
          description: description.trim() || undefined,
          isActive,
        };
        const res = await fetch(apiPath("/api/production/parts"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) {
          window.alert(json.error ?? pick("생성에 실패했습니다.", "Failed to create."));
          return;
        }
        setSelectedId(json.data.id);
        setIsNew(false);
      } else if (selectedId) {
        const payload = { description: description.trim() || undefined, isActive };
        const res = await fetch(apiPath(`/api/production/parts/${selectedId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) {
          window.alert(json.error ?? pick("수정에 실패했습니다.", "Failed to update."));
          return;
        }
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
    if (!can("parts-codes", "delete")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!window.confirm(pick(`"${selectedRecord.partName}"을(를) 삭제하시겠습니까?`, `Delete "${selectedRecord.partName}"?`))) return;
    setSaving(true);
    try {
      const res = await fetch(apiPath(`/api/production/parts/${selectedRecord.id}`), { method: "DELETE" });
      const json = await res.json();
      if (!json.success) {
        window.alert(json.error ?? pick("삭제에 실패했습니다.", "Failed to delete."));
        return;
      }
      setSelectedId(null);
      setEditMode(false);
      setIsNew(false);
      await fetchRecords();
    } finally {
      setSaving(false);
    }
  }

  const readonly = !editMode;
  const editableFieldClass = readonly ? "form-input bg-[#f0eee9]" : "form-input bg-white";
  const breakdown = isNew ? chosenCatalogEntry : selectedRecord;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[380px_1fr]">
      <aside className="flex flex-col border-r border-[#e2dfd8] bg-white">
        <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
          <span className="text-sm font-semibold text-muted-foreground">
            {loading ? "..." : `${filteredRecords.length} ${pick("건", "records")}`}
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => {
                setShowInactive(e.target.checked);
                setPage(1);
              }}
            />
            {pick("비활성 포함", "Include inactive")}
          </label>
        </div>

        <div className="flex items-center gap-2 border-b border-[#e2dfd8] px-4 py-3">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            className="form-input h-9 flex-1 bg-white"
            placeholder={pick("Part 검색...", "Search Part...")}
          />
          {can("parts-codes", "create") ? (
            <button
              type="button"
              onClick={startNew}
              className="whitespace-nowrap rounded-md bg-[#1a5cdb] px-3 py-2 text-xs font-medium text-white hover:bg-[#1650c4]"
            >
              {pick("+ 추가", "+ Add")}
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-5 text-center text-xs text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
          ) : pagedRecords.length > 0 ? (
            pagedRecords.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => selectRecord(record)}
                className={`flex w-full items-start gap-3 border-b border-[#e2dfd8] px-4 py-3 text-left transition-colors hover:bg-[#f0eee9] ${
                  selectedId === record.id ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]" : ""
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0eee9] text-base">🔩</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">{record.partName}</span>
                  {record.seatRow ? (
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {record.seatRow} · {record.position} · {record.category}
                    </span>
                  ) : null}
                </span>
                <span className={record.isActive ? "rounded-md bg-[#e6f5f0] px-2 py-0.5 text-[10px] font-semibold text-[#0a5e45] dark:bg-emerald-950/70 dark:text-emerald-300" : "rounded-md bg-[#f0eee9] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-slate-800 dark:text-slate-400"}>
                  {record.isActive ? pick("활성", "Active") : pick("비활성", "Inactive")}
                </span>
              </button>
            ))
          ) : (
            <div className="p-5">
              {can("parts-codes", "create") ? (
                <button
                  type="button"
                  onClick={startNew}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#cccac4] bg-[#f0eee9] p-10 text-center text-muted-foreground transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd] hover:text-[#1a4db0]"
                >
                  <span className="text-3xl">🔩</span>
                  <span className="text-sm font-semibold">{pick("첫 Part를 추가하세요", "Add your first Part")}</span>
                  <span className="text-xs">{pick("+ 추가 버튼을 클릭하세요", "Click the + Add button")}</span>
                </button>
              ) : (
                <div className="p-5 text-center text-xs text-muted-foreground">{pick("등록된 항목이 없습니다.", "No records yet.")}</div>
              )}
            </div>
          )}
        </div>

        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-[#e2dfd8] px-4 py-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-[#cccac4] bg-white px-2.5 py-1 text-xs hover:bg-[#f0eee9] disabled:opacity-40"
            >
              {pick("이전", "Prev")}
            </button>
            <span className="text-xs text-muted-foreground">
              {pick("페이지", "Page")} {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-md border border-[#cccac4] bg-white px-2.5 py-1 text-xs hover:bg-[#f0eee9] disabled:opacity-40"
            >
              {pick("다음", "Next")}
            </button>
          </div>
        ) : null}
      </aside>

      <main className="min-w-0 bg-white">
        {selectedRecord || isNew ? (
          <div className="h-full overflow-y-auto px-7 py-6">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e2dfd8] pb-4">
              <div>
                <div className="text-base font-semibold">
                  {isNew ? `🔩 ${pick("새 Part", "New Part")}` : `🔩 ${selectedRecord?.partName}`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {isNew ? pick("분류를 선택하고 Part Name을 입력하세요", "Select a classification and enter a Part Name") : pick("표준 카탈로그 항목", "Standard catalog entry")}
                </div>
              </div>
              <div className="flex gap-2">
                {!isNew ? (
                  <>
                    {can("parts-codes", "edit") ? (
                      <button
                        type="button"
                        onClick={() => setEditMode(true)}
                        disabled={saving}
                        className="rounded-md bg-[#1a5cdb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                      >
                        {editMode ? pick("편집 중", "Editing") : pick("편집", "Edit")}
                      </button>
                    ) : null}
                    {can("parts-codes", "delete") ? (
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
              <div className="mb-3 border-b border-[#e2dfd8] pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {pick("기본 정보", "Basic Information")}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {isNew ? (
                  <>
                    <label className="flex flex-col gap-1 md:col-span-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                        {pick("Part 선택 (분류)", "Select Part (classification)")}
                      </span>
                      <SearchableSelect
                        options={catalogOptions}
                        value={catalogChoice}
                        onChange={setCatalogChoice}
                        placeholder={pick("선택", "Select")}
                        searchPlaceholder={pick("Part 검색...", "Search Part...")}
                      />
                    </label>
                    <label className="flex flex-col gap-1 md:col-span-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                        Part Name
                      </span>
                      <input
                        className="form-input bg-white"
                        value={partNameInput}
                        onChange={(e) => setPartNameInput(e.target.value)}
                        placeholder={pick("등록할 Part 이름 입력", "Enter the name to register")}
                      />
                    </label>
                  </>
                ) : null}

                {breakdown ? (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">Row</span>
                      <div className="form-input bg-[#f0eee9]">{breakdown.seatRow}</div>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">Position</span>
                      <div className="form-input bg-[#f0eee9]">{breakdown.position}</div>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">Category</span>
                      <div className="form-input bg-[#f0eee9]">{breakdown.category}</div>
                    </label>
                  </>
                ) : null}

                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                    {pick("설명 (description)", "Description")}
                  </span>
                  <textarea
                    className={`${editableFieldClass} min-h-[72px]`}
                    readOnly={readonly}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="mb-6">
              <div className="mb-3 border-b border-[#e2dfd8] pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {pick("상태", "Status")}
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
                    onClick={() => setIsActive((current) => !current)}
                    aria-pressed={isActive}
                    aria-label="Toggle active status"
                    className={`relative h-6 w-11 overflow-hidden rounded-full transition-colors disabled:opacity-50 ${
                      isActive ? "bg-[#0f7b5c]" : "bg-[#d2d0cb]"
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-[left] ${
                        isActive ? "left-[23px]" : "left-[3px]"
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
            <div className="text-5xl opacity-50">🔩</div>
            <div className="text-sm font-medium">{pick("Part를 선택하거나 새로 추가하세요", "Select a Part or add a new one")}</div>
            {can("parts-codes", "create") ? (
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
