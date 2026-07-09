"use client";

import { useEffect, useMemo, useState } from "react";
import { Barcode } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SeatDiagramPicker, FRONT_SEAT_ZONES } from "@/components/production/seat-diagram-picker";
import type { SeatCoverPartRow } from "@/lib/seat-cover-part-catalog";

type ProductionPart = {
  id: string;
  partName: string;
  description: string | null;
  seatRow: string | null;
  position: string | null;
  category: string | null;
  isActive: boolean;
};
type ProductionCode = { id: string; code: string; description: string | null; isActive: boolean };
type DesignerInitialRecord = { id: string; initial: string; designerName: string; isActive: boolean };

type PartSkuRecord = {
  id: string;
  sku: string;
  partName: string;
  make: string;
  makeAbbr: string;
  model: string;
  modelAbbr: string;
  code: string;
  initial: string;
  side: string;
  createdByName: string | null;
  isActive: boolean;
};

type ChecklistItem = {
  id: string;
  description: string;
  status: string;
};

const SIDE_OPTIONS = [
  { value: "D", labelKo: "운전석 (Driver)", labelEn: "Driver" },
  { value: "P", labelKo: "조수석 (Passenger)", labelEn: "Passenger" },
  { value: "MD", labelKo: "운전석 대칭 (Mirror Driver)", labelEn: "Mirror Driver" },
  { value: "MP", labelKo: "조수석 대칭 (Mirror Passenger)", labelEn: "Mirror Passenger" },
  { value: "Universal", labelKo: "유니버설 (Universal)", labelEn: "Universal" },
] as const;

const STATUS_OPTIONS = ["Pending", "In Progress", "Done"] as const;

export function PartSkuGeneratorPage() {
  const { pick } = useI18n();
  const { can } = usePermissions();

  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [make, setMake] = useState("");
  const [makeAbbr, setMakeAbbr] = useState("");
  const [model, setModel] = useState("");
  const [modelAbbr, setModelAbbr] = useState("");
  const [code, setCode] = useState("");
  const [initial, setInitial] = useState("");

  const [parts, setParts] = useState<ProductionPart[]>([]);
  const [codes, setCodes] = useState<ProductionCode[]>([]);
  const [initials, setInitials] = useState<DesignerInitialRecord[]>([]);

  const [partName, setPartName] = useState("");
  const [side, setSide] = useState("");
  const [generating, setGenerating] = useState(false);
  const [diagramRow, setDiagramRow] = useState<SeatCoverPartRow>("Front");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const [partSkus, setPartSkus] = useState<PartSkuRecord[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [newItemDescription, setNewItemDescription] = useState("");
  const [newItemStatus, setNewItemStatus] = useState<string>("Pending");
  const [savingChecklist, setSavingChecklist] = useState(false);

  async function fetchMakes() {
    const res = await fetch(apiPath("/api/production/vehicle-options"));
    const json = await res.json();
    if (json.success) setMakes(json.data);
  }

  async function fetchModels(forMake: string) {
    if (!forMake) {
      setModels([]);
      return;
    }
    const res = await fetch(apiPath(`/api/production/vehicle-options?make=${encodeURIComponent(forMake)}`));
    const json = await res.json();
    if (json.success) setModels(json.data);
  }

  async function fetchParts() {
    const res = await fetch(apiPath("/api/production/parts?active=true"));
    const json = await res.json();
    if (json.success) setParts(json.data);
  }

  async function fetchCodes() {
    const res = await fetch(apiPath("/api/production/codes?active=true"));
    const json = await res.json();
    if (json.success) setCodes(json.data);
  }

  async function fetchInitials() {
    const res = await fetch(apiPath("/api/production/designer-initials?active=true"));
    const json = await res.json();
    if (json.success) setInitials(json.data);
  }

  async function fetchPartSkus() {
    setLoadingList(true);
    try {
      const res = await fetch(apiPath("/api/production/part-skus"));
      const json = await res.json();
      if (json.success) setPartSkus(json.data);
    } finally {
      setLoadingList(false);
    }
  }

  async function fetchChecklist(partSkuId: string) {
    setLoadingChecklist(true);
    try {
      const res = await fetch(apiPath(`/api/production/part-skus/${partSkuId}/checklist`));
      const json = await res.json();
      if (json.success) setChecklist(json.data);
    } finally {
      setLoadingChecklist(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMakes();
    fetchParts();
    fetchCodes();
    fetchInitials();
    fetchPartSkus();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchModels(make);
  }, [make]);

  useEffect(() => {
    if (!selectedId) {
      const timer = window.setTimeout(() => setChecklist([]), 0);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchChecklist(selectedId);
  }, [selectedId]);

  const sessionReady = Boolean(
    make.trim() && makeAbbr.trim() && model.trim() && modelAbbr.trim() && initial.trim()
  );

  const skuPreview = sessionReady && partName && code && side
    ? [partName, makeAbbr.trim(), modelAbbr.trim(), code, initial, ...(side === "Universal" ? [] : [side])].join("-")
    : "";

  const selectedPartDescription = parts.find((p) => p.partName === partName)?.description ?? "";
  const selectedCodeDescription = codes.find((c) => c.code === code)?.description ?? "";

  function matchesZone(part: ProductionPart, zone: (typeof FRONT_SEAT_ZONES)[number]) {
    if (part.seatRow !== zone.seatRow || part.category !== zone.category) return false;
    if (part.position === zone.position) return true;
    return zone.position !== "Middle" && part.position === "Universal";
  }

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const zone of FRONT_SEAT_ZONES) {
      counts[zone.id] = parts.filter((p) => matchesZone(p, zone)).length;
    }
    return counts;
  }, [parts]);

  const partOptions = useMemo(() => {
    if (!selectedZoneId) return parts.map((p) => p.partName);
    const zone = FRONT_SEAT_ZONES.find((z) => z.id === selectedZoneId);
    if (!zone) return parts.map((p) => p.partName);
    return parts.filter((p) => matchesZone(p, zone)).map((p) => p.partName);
  }, [parts, selectedZoneId]);

  function handleZoneSelect(zoneId: string) {
    setSelectedZoneId((current) => (current === zoneId ? null : zoneId));
    setPartName("");
  }

  const filteredPartSkus = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return partSkus.filter((p) => {
      if (!showInactive && !p.isActive) return false;
      if (!normalizedQuery) return true;
      return p.sku.toLowerCase().includes(normalizedQuery) || p.partName.toLowerCase().includes(normalizedQuery);
    });
  }, [partSkus, query, showInactive]);

  const selectedPartSku = partSkus.find((p) => p.id === selectedId) ?? null;

  function resetSession() {
    setMake("");
    setMakeAbbr("");
    setModel("");
    setModelAbbr("");
    setInitial("");
    setModels([]);
  }

  async function generatePartSku() {
    if (!can("part-sku-generator", "create")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!sessionReady) {
      window.alert(pick("Make/Model/Initial을 먼저 모두 입력하세요.", "Fill in Make/Model/Initial first."));
      return;
    }
    if (!partName || !code || !side) {
      window.alert(pick("Part/Code/Side를 선택하세요.", "Select a Part, Code, and Side."));
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch(apiPath("/api/production/part-skus"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partName,
          make,
          makeAbbr: makeAbbr.trim(),
          model,
          modelAbbr: modelAbbr.trim(),
          code,
          initial,
          side,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        window.alert(json.error ?? pick("생성에 실패했습니다.", "Failed to generate."));
        return;
      }
      setPartName("");
      setCode("");
      setSide("");
      await fetchPartSkus();
      setSelectedId(json.data.id);
    } finally {
      setGenerating(false);
    }
  }

  async function deletePartSku(id: string) {
    if (!can("part-sku-generator", "delete")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!window.confirm(pick("이 Part SKU를 삭제하시겠습니까?", "Delete this Part SKU?"))) return;
    const res = await fetch(apiPath(`/api/production/part-skus/${id}`), { method: "DELETE" });
    const json = await res.json();
    if (!json.success) {
      window.alert(json.error ?? pick("삭제에 실패했습니다.", "Failed to delete."));
      return;
    }
    if (selectedId === id) setSelectedId(null);
    await fetchPartSkus();
  }

  async function addChecklistItem() {
    if (!selectedId) return;
    if (!can("part-sku-generator", "edit")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!newItemDescription.trim()) {
      window.alert(pick("설명을 입력하세요.", "Enter a description."));
      return;
    }
    setSavingChecklist(true);
    try {
      const res = await fetch(apiPath(`/api/production/part-skus/${selectedId}/checklist`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: newItemDescription.trim(), status: newItemStatus }),
      });
      const json = await res.json();
      if (!json.success) {
        window.alert(json.error ?? pick("추가에 실패했습니다.", "Failed to add."));
        return;
      }
      setNewItemDescription("");
      setNewItemStatus("Pending");
      await fetchChecklist(selectedId);
    } finally {
      setSavingChecklist(false);
    }
  }

  async function updateChecklistItemStatus(itemId: string, status: string) {
    if (!selectedId) return;
    if (!can("part-sku-generator", "edit")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    const res = await fetch(apiPath(`/api/production/part-skus/${selectedId}/checklist/${itemId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();
    if (json.success) await fetchChecklist(selectedId);
  }

  async function deleteChecklistItem(itemId: string) {
    if (!selectedId) return;
    if (!can("part-sku-generator", "edit")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    if (!window.confirm(pick("이 항목을 삭제하시겠습니까?", "Delete this item?"))) return;
    const res = await fetch(apiPath(`/api/production/part-skus/${selectedId}/checklist/${itemId}`), { method: "DELETE" });
    const json = await res.json();
    if (json.success) await fetchChecklist(selectedId);
  }

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4">
        <div className="flex items-start gap-2">
          <Barcode className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">{pick("Part SKU 생성기", "Part SKU Generator")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {pick(
                "차종/디자이너를 한 번 정하고, Part/Code/Side만 바꿔가며 여러 Part SKU를 연속으로 생성합니다",
                "Set Make/Model/Initial once, then generate multiple Part SKUs by varying Part, Code, and Side"
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="border-b border-[#e2dfd8] bg-white px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {pick("세션 설정 (Make / Model / Initial)", "Session Setup (Make / Model / Initial)")}
          </span>
          <button type="button" onClick={resetSession} className="text-xs text-muted-foreground underline hover:text-foreground">
            {pick("초기화", "Reset")}
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Make</span>
            <SearchableSelect
              options={makes}
              value={make}
              onChange={(next) => {
                setMake(next);
                setModel("");
                setModelAbbr("");
              }}
              placeholder={pick("선택", "Select")}
              searchPlaceholder={pick("Make 검색...", "Search Make...")}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Make Abbr</span>
            <input
              className="form-input h-9 bg-white text-xs"
              value={makeAbbr}
              onChange={(e) => setMakeAbbr(e.target.value)}
              placeholder="HY"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Model</span>
            <SearchableSelect
              options={models}
              value={model}
              onChange={setModel}
              placeholder={pick("선택", "Select")}
              searchPlaceholder={pick("Model 검색...", "Search Model...")}
              disabled={!make}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Model Abbr</span>
            <input
              className="form-input h-9 bg-white text-xs"
              value={modelAbbr}
              onChange={(e) => setModelAbbr(e.target.value)}
              placeholder="PA"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Initial</span>
            <SearchableSelect
              options={initials.map((i) => i.initial)}
              value={initial}
              onChange={setInitial}
              placeholder={pick("선택", "Select")}
              searchPlaceholder={pick("Initial 검색...", "Search Initial...")}
            />
          </label>
        </div>
      </div>

      <SeatDiagramPicker
        row={diagramRow}
        onRowChange={setDiagramRow}
        selectedZoneId={selectedZoneId}
        onZoneSelect={handleZoneSelect}
        zoneCounts={zoneCounts}
      />

      <div className="border-b border-[#e2dfd8] bg-[#f0eee9] px-6 py-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_2fr_auto]">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Part</span>
            <SearchableSelect
              options={partOptions}
              value={partName}
              onChange={setPartName}
              placeholder={pick("선택", "Select")}
              searchPlaceholder={pick("Part 검색...", "Search Part...")}
              disabled={!sessionReady}
            />
            {selectedPartDescription ? (
              <span className="truncate text-xs text-muted-foreground" title={selectedPartDescription}>
                {selectedPartDescription}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Code</span>
            <SearchableSelect
              options={codes.map((c) => c.code)}
              value={code}
              onChange={setCode}
              placeholder={pick("선택", "Select")}
              searchPlaceholder={pick("Code 검색...", "Search Code...")}
              disabled={!sessionReady}
            />
            {selectedCodeDescription ? (
              <span className="truncate text-xs text-muted-foreground" title={selectedCodeDescription}>
                {selectedCodeDescription}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Side</span>
            <select
              className="form-input h-9 bg-white text-xs"
              disabled={!sessionReady}
              value={side}
              onChange={(e) => setSide(e.target.value)}
            >
              <option value="">{pick("선택", "Select")}</option>
              {SIDE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{pick(s.labelKo, s.labelEn)}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">{pick("미리보기", "Preview")}</span>
            <div className="flex h-9 items-center overflow-x-auto rounded-md border border-[#cccac4] bg-white px-3 font-mono text-xs">
              {skuPreview || pick("모든 값을 채우면 SKU가 표시됩니다", "Fill in all fields to preview the SKU")}
            </div>
          </div>
          <div className="flex items-end">
            {can("part-sku-generator", "create") ? (
              <button
                type="button"
                disabled={!skuPreview || generating}
                onClick={generatePartSku}
                className="h-9 whitespace-nowrap rounded-md bg-[#1a5cdb] px-4 text-xs font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
              >
                {generating ? pick("생성 중...", "Generating...") : pick("+ 생성", "+ Generate")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[380px_1fr]">
        <aside className="border-r border-[#e2dfd8] bg-white">
          <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
            <span className="text-sm font-semibold text-muted-foreground">
              {loadingList ? "..." : `${filteredPartSkus.length} ${pick("건", "records")}`}
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              {pick("비활성 포함", "Include inactive")}
            </label>
          </div>
          <div className="border-b border-[#e2dfd8] px-4 py-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="form-input h-9 w-full bg-white"
              placeholder={pick("SKU/Part 검색...", "Search SKU/Part...")}
            />
          </div>
          <div className="h-full overflow-y-auto">
            {loadingList ? (
              <div className="p-5 text-center text-xs text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
            ) : filteredPartSkus.length > 0 ? (
              filteredPartSkus.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-full items-start gap-3 border-b border-[#e2dfd8] px-4 py-3 text-left transition-colors hover:bg-[#f0eee9] ${
                    selectedId === p.id ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]" : ""
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0eee9] text-base">🏷️</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-all font-mono text-xs font-bold">{p.sku}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{p.partName}</span>
                    {p.createdByName ? (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {pick("생성자", "By")}: {p.createdByName}
                      </span>
                    ) : null}
                  </span>
                  <span className={p.isActive ? "rounded-md bg-[#e6f5f0] px-2 py-0.5 text-[10px] font-semibold text-[#0a5e45] dark:bg-emerald-950/70 dark:text-emerald-300" : "rounded-md bg-[#f0eee9] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-slate-800 dark:text-slate-400"}>
                    {p.isActive ? pick("활성", "Active") : pick("비활성", "Inactive")}
                  </span>
                </button>
              ))
            ) : (
              <div className="p-5 text-center text-xs text-muted-foreground">
                {pick("생성된 Part SKU가 없습니다.", "No Part SKUs generated yet.")}
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 bg-white">
          {selectedPartSku ? (
            <div className="h-full overflow-y-auto px-7 py-6">
              <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e2dfd8] pb-4">
                <div>
                  <div className="break-all font-mono text-base font-semibold">{selectedPartSku.sku}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{selectedPartSku.partName}</div>
                </div>
                {can("part-sku-generator", "delete") ? (
                  <button
                    type="button"
                    onClick={() => deletePartSku(selectedPartSku.id)}
                    className="whitespace-nowrap rounded-md bg-[#c42b2b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#9b2020]"
                  >
                    {pick("삭제", "Delete")}
                  </button>
                ) : null}
              </div>

              <section className="mb-6">
                <div className="mb-3 border-b border-[#e2dfd8] pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {pick("구성 정보", "Breakdown")}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
                  <div>
                    <div className="font-semibold text-muted-foreground">Make</div>
                    <div>{selectedPartSku.make} ({selectedPartSku.makeAbbr})</div>
                  </div>
                  <div>
                    <div className="font-semibold text-muted-foreground">Model</div>
                    <div>{selectedPartSku.model} ({selectedPartSku.modelAbbr})</div>
                  </div>
                  <div>
                    <div className="font-semibold text-muted-foreground">Code</div>
                    <div>{selectedPartSku.code}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-muted-foreground">Initial</div>
                    <div>{selectedPartSku.initial}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-muted-foreground">Side</div>
                    <div>{selectedPartSku.side}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-muted-foreground">{pick("생성자", "Created by")}</div>
                    <div>{selectedPartSku.createdByName ?? "-"}</div>
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-3 border-b border-[#e2dfd8] pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {pick("체크리스트", "Checklist")}
                </div>
                {loadingChecklist ? (
                  <div className="text-xs text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
                ) : (
                  <div className="space-y-2">
                    {checklist.length === 0 ? (
                      <div className="rounded-lg bg-[#f0eee9] p-4 text-center text-xs text-muted-foreground">
                        {pick("체크리스트 항목이 없습니다.", "No checklist items yet.")}
                      </div>
                    ) : (
                      checklist.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 rounded-lg border border-[#e2dfd8] bg-white p-3">
                          <span className="flex-1 text-xs">{item.description}</span>
                          {can("part-sku-generator", "edit") ? (
                            <select
                              className="form-input h-8 w-32 bg-white text-xs"
                              value={item.status}
                              onChange={(e) => updateChecklistItemStatus(item.id, e.target.value)}
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-muted-foreground">{item.status}</span>
                          )}
                          {can("part-sku-generator", "edit") ? (
                            <button
                              type="button"
                              onClick={() => deleteChecklistItem(item.id)}
                              className="text-xs text-[#c42b2b] hover:underline"
                            >
                              {pick("삭제", "Delete")}
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {can("part-sku-generator", "edit") ? (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      className="form-input h-9 flex-1 bg-white text-xs"
                      value={newItemDescription}
                      onChange={(e) => setNewItemDescription(e.target.value)}
                      placeholder={pick("설명 입력...", "Enter description...")}
                    />
                    <select
                      className="form-input h-9 w-32 bg-white text-xs"
                      value={newItemStatus}
                      onChange={(e) => setNewItemStatus(e.target.value)}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={savingChecklist || !newItemDescription.trim()}
                      onClick={addChecklistItem}
                      className="h-9 whitespace-nowrap rounded-md bg-[#1a5cdb] px-3 text-xs font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                    >
                      {pick("추가", "Add")}
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          ) : (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="text-5xl opacity-50">🏷️</div>
              <div className="text-sm font-medium">{pick("생성된 Part SKU를 선택하세요", "Select a generated Part SKU")}</div>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
