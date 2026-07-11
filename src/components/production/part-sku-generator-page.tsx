"use client";

import { useEffect, useMemo, useState } from "react";
import { Barcode } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SeatDiagramPicker, ALL_SEAT_ZONES, type SeatZone } from "@/components/production/seat-diagram-picker";
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

const SIDE_OPTIONS = [
  { value: "D", labelKo: "운전석 (Driver)", labelEn: "Driver" },
  { value: "P", labelKo: "조수석 (Passenger)", labelEn: "Passenger" },
  { value: "MD", labelKo: "운전석 대칭 (Mirror Driver)", labelEn: "Mirror Driver" },
  { value: "MP", labelKo: "조수석 대칭 (Mirror Passenger)", labelEn: "Mirror Passenger" },
  { value: "Universal", labelKo: "유니버설 (Universal)", labelEn: "Universal" },
] as const;

const TABS: { key: "generator" | "list"; labelKo: string; labelEn: string }[] = [
  { key: "generator", labelKo: "생성기", labelEn: "Generator" },
  { key: "list", labelKo: "목록", labelEn: "List" },
];

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

  const [activeTab, setActiveTab] = useState<"generator" | "list">("generator");

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

  const sessionReady = Boolean(
    make.trim() && makeAbbr.trim() && model.trim() && modelAbbr.trim() && initial.trim()
  );

  const skuPreview = sessionReady && partName && code && side
    ? [partName, makeAbbr.trim(), modelAbbr.trim(), code, initial, ...(side === "Universal" ? [] : [side])].join("-")
    : "";

  const selectedCodeDescription = codes.find((c) => c.code === code)?.description ?? "";

  // "Rear" and "Second Row" are the same physical row (2-row vs 3-row vehicle terminology) —
  // a part classified under either seatRow matches the diagram's single "Rear" zone.
  const REAR_ROW_ALIASES = ["Rear", "Second Row"];
  function seatRowMatches(partSeatRow: string | null, zoneSeatRow: string): boolean {
    if (partSeatRow === zoneSeatRow) return true;
    return REAR_ROW_ALIASES.includes(zoneSeatRow) && REAR_ROW_ALIASES.includes(partSeatRow ?? "");
  }

  function matchesZone(part: ProductionPart, zone: SeatZone) {
    if (!seatRowMatches(part.seatRow, zone.seatRow) || part.category !== zone.category) return false;
    if (part.position === zone.position) return true;
    return zone.position !== "Middle" && part.position === "Universal";
  }

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const zone of ALL_SEAT_ZONES) {
      counts[zone.id] = parts.filter((p) => matchesZone(p, zone)).length;
    }
    return counts;
  }, [parts]);

  const selectedZone = ALL_SEAT_ZONES.find((z) => z.id === selectedZoneId) ?? null;

  // A zone can have more than one matching Part (e.g. a Rear-classified and a Second-Row-classified
  // Side Bolster both apply to the same diagram zone) — list them so the user can pick.
  const zoneParts = useMemo(() => {
    if (!selectedZone) return [];
    return parts.filter((p) => matchesZone(p, selectedZone));
  }, [parts, selectedZone]);

  const selectedPartRecord = parts.find((p) => p.partName === partName) ?? null;

  function handleZoneSelect(zoneId: string) {
    setSelectedZoneId((current) => {
      const next = current === zoneId ? null : zoneId;
      const zone = next ? ALL_SEAT_ZONES.find((z) => z.id === next) : null;
      const matches = zone ? parts.filter((p) => matchesZone(p, zone)) : [];
      // Auto-select only when the zone has exactly one match; otherwise require an explicit pick.
      setPartName(matches.length === 1 ? matches[0].partName : "");
      return next;
    });
  }

  function handleDiagramRowChange(nextRow: SeatCoverPartRow) {
    setDiagramRow(nextRow);
    setSelectedZoneId(null);
  }

  const partSeatRowByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of parts) map.set(p.partName, p.seatRow ?? "");
    return map;
  }, [parts]);

  const filteredPartSkus = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return partSkus.filter((p) => {
      if (!showInactive && !p.isActive) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        p.sku,
        p.partName,
        p.make,
        p.makeAbbr,
        p.model,
        p.modelAbbr,
        p.code,
        p.initial,
        p.side,
        p.createdByName ?? "",
        partSeatRowByName.get(p.partName) ?? "",
      ];
      return haystack.some((field) => field.toLowerCase().includes(normalizedQuery));
    });
  }, [partSkus, query, showInactive, partSeatRowByName]);

  const selectedPartSku = partSkus.find((p) => p.id === selectedId) ?? null;
  const selectedPartSkuPart = selectedPartSku ? parts.find((p) => p.partName === selectedPartSku.partName) ?? null : null;

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
      setActiveTab("list");
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

  async function reactivatePartSku(id: string) {
    if (!can("part-sku-generator", "status")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    const res = await fetch(apiPath(`/api/production/part-skus/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    const json = await res.json();
    if (!json.success) {
      window.alert(json.error ?? pick("활성화에 실패했습니다.", "Failed to activate."));
      return;
    }
    await fetchPartSkus();
  }

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4">
        <div className="flex items-start gap-2">
          <Barcode className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">Part SKU</h1>
          </div>
        </div>
      </header>

      <div className="flex gap-1 border-b border-[#e2dfd8] bg-white px-6 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-[#1a5cdb] text-[#1a4db0]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {pick(tab.labelKo, tab.labelEn)}
          </button>
        ))}
      </div>

      {activeTab === "generator" ? (
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[#e2dfd8] bg-white lg:grid-cols-[1fr_460px] lg:divide-x lg:divide-y-0">
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <SeatDiagramPicker
            row={diagramRow}
            onRowChange={handleDiagramRowChange}
            selectedZoneId={selectedZoneId}
            onZoneSelect={handleZoneSelect}
            zoneCounts={zoneCounts}
          />
        </div>

        <div className="min-h-0 overflow-y-auto bg-[#f9f8f5] p-6">
          {selectedZone ? (
            <div className="flex flex-col gap-4">
              <div>
                <span className="text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {pick("선택된 Part", "Selected Part")}
                </span>
                {zoneParts.length > 1 ? (
                  <div className="mt-1 flex flex-col gap-1">
                    {zoneParts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPartName(p.partName)}
                        className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors ${
                          partName === p.partName
                            ? "border-[#1a5cdb] bg-[#ebf0fd]"
                            : "border-[#cccac4] bg-white hover:bg-[#f0eee9]"
                        }`}
                      >
                        <span className="text-base font-bold">{p.partName}</span>
                        {p.description ? (
                          <span className="truncate text-sm text-muted-foreground" title={p.description}>
                            {p.description}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : selectedPartRecord ? (
                  <div className="mt-1 rounded-md border border-[#cccac4] bg-white px-3 py-2">
                    <div className="text-base font-bold">{selectedPartRecord.partName}</div>
                    {selectedPartRecord.description ? (
                      <div className="mt-0.5 text-base text-muted-foreground">{selectedPartRecord.description}</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-1 rounded-md border border-dashed border-[#cccac4] px-3 py-2 text-base text-muted-foreground">
                    {pick("이 부위에 등록된 Part가 없습니다.", "No Part registered for this zone.")}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {pick("Make / Model / Initial", "Make / Model / Initial")}
                </span>
                <button type="button" onClick={resetSession} className="text-base text-muted-foreground underline hover:text-foreground">
                  {pick("초기화", "Reset")}
                </button>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-muted-foreground">Make</span>
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
                  className="h-11 text-base"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-muted-foreground">Make Abbr</span>
                <input
                  className="form-input h-11 bg-white text-base"
                  value={makeAbbr}
                  onChange={(e) => setMakeAbbr(e.target.value)}
                  placeholder="HY"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-muted-foreground">Model</span>
                <SearchableSelect
                  options={models}
                  value={model}
                  onChange={setModel}
                  placeholder={pick("선택", "Select")}
                  searchPlaceholder={pick("Model 검색...", "Search Model...")}
                  className="h-11 text-base"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-muted-foreground">Model Abbr</span>
                <input
                  className="form-input h-11 bg-white text-base"
                  value={modelAbbr}
                  onChange={(e) => setModelAbbr(e.target.value)}
                  placeholder="PA"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-muted-foreground">Initial</span>
                <SearchableSelect
                  options={initials.map((i) => i.initial)}
                  value={initial}
                  onChange={setInitial}
                  placeholder={pick("선택", "Select")}
                  searchPlaceholder={pick("Initial 검색...", "Search Initial...")}
                  className="h-11 text-base"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-muted-foreground">Code</span>
                <SearchableSelect
                  options={codes.map((c) => c.code)}
                  value={code}
                  onChange={setCode}
                  placeholder={pick("선택", "Select")}
                  searchPlaceholder={pick("Code 검색...", "Search Code...")}
                  className="h-11 text-base"
                />
                {selectedCodeDescription ? (
                  <span className="truncate text-base text-muted-foreground" title={selectedCodeDescription}>
                    {selectedCodeDescription}
                  </span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-muted-foreground">Side</span>
                <select
                  className="form-input h-11 bg-white text-base"
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
                <span className="text-sm font-semibold text-muted-foreground">{pick("미리보기", "Preview")}</span>
                <div className="flex min-h-[140px] items-center justify-center break-all rounded-lg border-2 border-[#1a5cdb] bg-white px-4 py-6 text-center font-mono text-2xl font-bold leading-snug text-[#1a4db0]">
                  {skuPreview || (
                    <span className="text-lg font-normal text-muted-foreground">
                      {pick("모든 값을 채우면 SKU가 표시됩니다", "Fill in all fields to preview the SKU")}
                    </span>
                  )}
                </div>
              </div>
              {can("part-sku-generator", "create") ? (
                <button
                  type="button"
                  disabled={!skuPreview || generating}
                  onClick={generatePartSku}
                  className="h-11 whitespace-nowrap rounded-md bg-[#1a5cdb] px-4 text-base font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
                >
                  {generating ? pick("생성 중...", "Generating...") : pick("+ 생성", "+ Generate")}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-[200px] items-center justify-center text-center text-base text-muted-foreground">
              {pick("다이어그램에서 부위를 선택하세요.", "Select a zone in the diagram.")}
            </div>
          )}
        </div>
      </div>
      ) : null}

      {activeTab === "list" ? (
      <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[380px_1fr]">
        <aside className="border-r border-[#e2dfd8] bg-white">
          <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
            <span className="text-base font-semibold text-muted-foreground">
              {loadingList ? "..." : `${filteredPartSkus.length} ${pick("건", "records")}`}
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              {pick("비활성 포함", "Include inactive")}
            </label>
          </div>
          <div className="border-b border-[#e2dfd8] px-4 py-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="form-input h-10 w-full bg-white text-sm"
              placeholder={pick("SKU/Part/차종/코드 검색...", "Search SKU, Part, Make, Model, Code...")}
            />
          </div>
          <div className="h-full overflow-y-auto">
            {loadingList ? (
              <div className="p-5 text-center text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
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
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0eee9] text-lg">🏷️</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-all font-mono text-sm font-bold">{p.sku}</span>
                    {p.createdByName ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {pick("생성자", "By")}: {p.createdByName}
                      </span>
                    ) : null}
                  </span>
                  <span className={p.isActive ? "rounded-md bg-[#e6f5f0] px-2 py-0.5 text-xs font-semibold text-[#0a5e45] dark:bg-emerald-950/70 dark:text-emerald-300" : "rounded-md bg-[#f0eee9] px-2 py-0.5 text-xs font-semibold text-muted-foreground dark:bg-slate-800 dark:text-slate-400"}>
                    {p.isActive ? pick("활성", "Active") : pick("비활성", "Inactive")}
                  </span>
                </button>
              ))
            ) : (
              <div className="p-5 text-center text-sm text-muted-foreground">
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
                  <div className="break-all font-mono text-xl font-semibold">{selectedPartSku.sku}</div>
                </div>
                {selectedPartSku.isActive ? (
                  can("part-sku-generator", "delete") ? (
                    <button
                      type="button"
                      onClick={() => deletePartSku(selectedPartSku.id)}
                      className="whitespace-nowrap rounded-md bg-[#c42b2b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#9b2020]"
                    >
                      {pick("삭제", "Delete")}
                    </button>
                  ) : null
                ) : can("part-sku-generator", "status") ? (
                  <button
                    type="button"
                    onClick={() => reactivatePartSku(selectedPartSku.id)}
                    className="whitespace-nowrap rounded-md bg-[#0a5e45] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#084d39]"
                  >
                    {pick("활성화", "Activate")}
                  </button>
                ) : null}
              </div>

              <section className="mb-6">
                <div className="mb-3 border-b border-[#e2dfd8] pb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {pick("구성 정보", "Breakdown")}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                  <div>
                    <div className="font-semibold text-muted-foreground">{pick("열 (Row)", "Row")}</div>
                    <div>{selectedPartSkuPart?.seatRow ?? "-"}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-muted-foreground">Part</div>
                    <div>{selectedPartSku.partName}</div>
                  </div>
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
            </div>
          ) : (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="text-5xl opacity-50">🏷️</div>
              <div className="text-base font-medium">{pick("생성된 Part SKU를 선택하세요", "Select a generated Part SKU")}</div>
            </div>
          )}
        </main>
      </div>
      ) : null}
    </section>
  );
}
