"use client";

/**
 * Code Guide:
 * "Colour rules" tab of the Min Sales page. A rule plans every SKU of one
 * colour on a percent of the same SKU in another colour, which is how a new
 * colour with no sales history is usually planned (Seat Cover IB on 30% of BE,
 * Car Cover Fabric 03 BK on 30% of GR). It covers SKUs added later too, so
 * nothing has to be registered per SKU; a per-SKU reference on the other tab
 * wins where one SKU needs something different.
 *
 * Before saving, Preview shows how many active SKUs the rule reaches and which
 * ones have no active SKU in the reference colour. Those keep their own sales.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

type Coverage = { matched: number; paired: number; unpaired: string[] };

type ColorRule = {
  id: number;
  categoryCode: "CC" | "SC";
  material: string | null;
  color: string;
  referenceColor: string;
  referencePct: number;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string;
  coverage: Coverage;
};

type RuleForm = { categoryCode: "CC" | "SC"; material: string; color: string; referenceColor: string; referencePct: string; note: string };

const ENDPOINT = "/api/planning/sku-min-sales/color-rules";
const EMPTY_FORM: RuleForm = { categoryCode: "SC", material: "", color: "", referenceColor: "", referencePct: "30", note: "" };
const UNPAIRED_PREVIEW = 12;

function formatPct(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** The request body for a form, or null while a required field is missing or unreadable. */
function toPayload(form: RuleForm) {
  const color = form.color.trim().toUpperCase();
  const referenceColor = form.referenceColor.trim().toUpperCase();
  const referencePct = Number(form.referencePct);
  if (!color || !referenceColor || color === referenceColor) return null;
  if (!Number.isFinite(referencePct) || referencePct <= 0 || referencePct > 1000) return null;
  return {
    categoryCode: form.categoryCode,
    material: form.material.trim().toUpperCase() || null,
    color,
    referenceColor,
    referencePct,
    note: form.note.trim() || null,
  };
}

export function ColorRulesPanel({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }) {
  const { pick } = useI18n();
  const [rules, setRules] = useState<ColorRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [preview, setPreview] = useState<Coverage | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const categoryLabel = (code: "CC" | "SC") => (code === "CC" ? pick("카 커버", "Car Cover") : pick("시트 커버", "Seat Cover"));
  const materialLabel = form.categoryCode === "CC" ? pick("패브릭", "Fabric") : pick("소재", "Material");
  const failed = pick("요청에 실패했습니다.", "The request failed.");
  const invalid = pick(
    "신규 색상, 기준 색상(서로 달라야 함), %(0 초과, 1000 이하)를 입력하세요.",
    "Enter the new colour, the reference colour (they must differ) and a percent (above 0, up to 1000).",
  );

  async function loadRules() {
    setLoading(true);
    try {
      const response = await fetch(apiPath(ENDPOINT), { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? failed);
      setRules(json.data as ColorRule[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : failed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateForm(patch: Partial<RuleForm>) {
    setForm((current) => ({ ...current, ...patch }));
    // A preview describes the fields as they were when it ran.
    setPreview(null);
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch(apiPath(ENDPOINT), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error ?? failed);
    return json.data as unknown;
  }

  async function runPreview() {
    const payload = toPayload(form);
    if (!payload) { setMessage(invalid); return; }
    setBusy(true);
    setMessage("");
    try {
      setPreview(await post({ ...payload, preview: true }) as Coverage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : failed);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const payload = toPayload(form);
    if (!payload) { setMessage(invalid); return; }
    setBusy(true);
    setMessage("");
    try {
      await post(payload);
      toast.success(pick(
        `${payload.color} → ${payload.referenceColor} ${formatPct(payload.referencePct)} 규칙을 저장했습니다.`,
        `Saved ${payload.color} → ${payload.referenceColor} at ${formatPct(payload.referencePct)}.`,
      ));
      setForm(EMPTY_FORM);
      setPreview(null);
      await loadRules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : failed);
    } finally {
      setBusy(false);
    }
  }

  function edit(rule: ColorRule) {
    setForm({
      categoryCode: rule.categoryCode,
      material: rule.material ?? "",
      color: rule.color,
      referenceColor: rule.referenceColor,
      referencePct: String(rule.referencePct),
      note: rule.note ?? "",
    });
    setPreview(null);
    setMessage("");
  }

  async function remove(rule: ColorRule) {
    const confirmText = pick(
      `${categoryLabel(rule.categoryCode)} ${rule.color} → ${rule.referenceColor} 규칙을 삭제할까요? 해당 ${rule.coverage.paired}개 SKU는 자체 실적으로 돌아갑니다.`,
      `Delete the ${categoryLabel(rule.categoryCode)} ${rule.color} → ${rule.referenceColor} rule? Its ${rule.coverage.paired} SKUs go back to their own sales.`,
    );
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiPath(`${ENDPOINT}?id=${rule.id}`), { method: "DELETE" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? failed);
      await loadRules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : failed);
    } finally {
      setBusy(false);
    }
  }

  const existing = rules.find((rule) =>
    rule.categoryCode === form.categoryCode
    && (rule.material ?? "") === form.material.trim().toUpperCase()
    && rule.color === form.color.trim().toUpperCase());

  const gridCols = "grid-cols-[110px_90px_90px_90px_80px_150px_minmax(140px,1fr)_140px_100px]";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="border-b border-[#e2dfd8] bg-[#f8f7f4] px-6 py-3 text-xs text-muted-foreground">
        {pick(
          "신규 색상의 모든 SKU를 같은 SKU의 기준 색상 실적 × %로 계획합니다. 각 세일즈 구간은 자체 실적과 비교해 큰 값을 쓰고, 기준 색상 실적은 차감하지 않습니다. 이후 추가되는 SKU에도 자동 적용되며, SKU별 설정에 등록한 참조가 있으면 그쪽이 우선합니다.",
          "Plans every SKU of a new colour on the same SKU in the reference colour × %. Each sales window uses the higher of that and the SKU's own sales, and the reference colour's sales are not reduced. SKUs added later are covered automatically; a reference registered under Per SKU wins.",
        )}
      </p>

      {canEdit ? (
        <div className="border-b border-[#e2dfd8] bg-[#f8f7f4] px-5 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {pick("색상 규칙 등록", "Add a colour rule")}
          </div>
          <div className="grid gap-2 md:grid-cols-[130px_110px_110px_110px_90px_minmax(140px,1fr)_auto_auto]">
            <select
              className="form-input h-8 w-full bg-white text-xs"
              aria-label={pick("카테고리", "Category")}
              value={form.categoryCode}
              onChange={(event) => updateForm({ categoryCode: event.target.value as "CC" | "SC" })}
            >
              <option value="SC">{categoryLabel("SC")}</option>
              <option value="CC">{categoryLabel("CC")}</option>
            </select>
            <input
              className="form-input h-8 w-full bg-white font-mono text-xs uppercase"
              aria-label={materialLabel}
              placeholder={pick(`${materialLabel} (전체)`, `${materialLabel} (all)`)}
              value={form.material}
              onChange={(event) => updateForm({ material: event.target.value })}
            />
            <input
              className="form-input h-8 w-full bg-white font-mono text-xs uppercase"
              aria-label={pick("신규 색상", "New colour")}
              placeholder={pick("신규 색상 (IB)", "New colour (IB)")}
              value={form.color}
              onChange={(event) => updateForm({ color: event.target.value })}
            />
            <input
              className="form-input h-8 w-full bg-white font-mono text-xs uppercase"
              aria-label={pick("기준 색상", "Reference colour")}
              placeholder={pick("기준 색상 (BE)", "Reference colour (BE)")}
              value={form.referenceColor}
              onChange={(event) => updateForm({ referenceColor: event.target.value })}
            />
            <input
              className="form-input h-8 w-full bg-white text-right text-xs"
              type="number"
              step="any"
              min="0"
              max="1000"
              aria-label="%"
              placeholder="%"
              value={form.referencePct}
              onChange={(event) => updateForm({ referencePct: event.target.value })}
            />
            <input
              className="form-input h-8 w-full bg-white text-xs"
              placeholder={pick("메모 (선택)", "Note (optional)")}
              value={form.note}
              onChange={(event) => updateForm({ note: event.target.value })}
            />
            <button type="button" disabled={busy} onClick={() => void runPreview()} className="h-8 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9] disabled:opacity-50">
              {pick("미리보기", "Preview")}
            </button>
            <button type="button" disabled={busy} onClick={() => void save()} className="h-8 rounded-md border border-[#1a5cdb] bg-white px-4 text-xs font-semibold text-[#1a5cdb] disabled:opacity-50">
              {existing ? pick("덮어쓰기", "Overwrite") : pick("등록", "Add")}
            </button>
          </div>
          {existing ? (
            <div className="mt-1 text-[11px] font-semibold text-[#b45309]">
              {pick(
                `이미 등록된 규칙입니다 (${existing.color} → ${existing.referenceColor} ${formatPct(existing.referencePct)}). 저장하면 덮어씁니다.`,
                `This rule already exists (${existing.color} → ${existing.referenceColor} at ${formatPct(existing.referencePct)}). Saving overwrites it.`,
              )}
            </div>
          ) : null}
          {preview ? (
            <div className="mt-2 rounded-md border border-[#e2dfd8] bg-white px-3 py-2 text-xs">
              <div>
                {pick(
                  `활성 SKU ${preview.matched}개 중 ${preview.paired}개에 적용됩니다.`,
                  `Applies to ${preview.paired} of ${preview.matched} active SKUs.`,
                )}
              </div>
              {preview.unpaired.length > 0 ? (
                <div className="mt-1 text-[#8a5300]">
                  {pick(
                    `기준 색상의 활성 SKU가 없어 자체 실적을 그대로 쓰는 SKU ${preview.unpaired.length}개: `,
                    `${preview.unpaired.length} with no active SKU in the reference colour, keeping their own sales: `,
                  )}
                  <span className="font-mono">{preview.unpaired.slice(0, UNPAIRED_PREVIEW).join(", ")}</span>
                  {preview.unpaired.length > UNPAIRED_PREVIEW ? pick(` 외 ${preview.unpaired.length - UNPAIRED_PREVIEW}개`, ` and ${preview.unpaired.length - UNPAIRED_PREVIEW} more`) : null}
                </div>
              ) : null}
              {preview.matched === 0 ? (
                <div className="mt-1 text-[#8a5300]">
                  {pick("이 색상의 활성 SKU가 아직 없습니다. 규칙은 저장되고 SKU가 생기면 적용됩니다.", "No active SKU has this colour yet. The rule is saved and applies once one exists.")}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? <div className="border-b border-[#e2dfd8] px-6 py-2 text-xs text-[#8a5300]">{message}</div> : null}

      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        <div className={`grid ${gridCols} min-w-[1040px] bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground`}>
          <span>{pick("카테고리", "Category")}</span>
          <span>{pick("패브릭/소재", "Fabric / Material")}</span>
          <span>{pick("신규 색상", "New colour")}</span>
          <span>{pick("기준 색상", "Reference")}</span>
          <span className="pr-3 text-right">%</span>
          <span>{pick("적용 SKU", "SKUs covered")}</span>
          <span>{pick("메모", "Note")}</span>
          <span>{pick("수정", "Updated")}</span>
          <span>{pick("작업", "Actions")}</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
        ) : rules.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{pick("등록된 색상 규칙이 없습니다.", "No colour rules yet.")}</div>
        ) : (
          rules.map((rule) => (
            <div key={rule.id} className="min-w-[1040px] border-b border-[#e2dfd8]">
              <div className={`grid ${gridCols} items-center px-3 py-2 text-sm`}>
                <span className="text-xs">{categoryLabel(rule.categoryCode)}</span>
                <span className="font-mono text-xs">{rule.material ?? pick("전체", "All")}</span>
                <span className="font-mono text-xs font-semibold">{rule.color}</span>
                <span className="font-mono text-xs">{rule.referenceColor}</span>
                <span className="pr-3 text-right font-mono text-xs font-semibold">{formatPct(rule.referencePct)}</span>
                <span className="text-xs">
                  {rule.coverage.paired} / {rule.coverage.matched}
                  {rule.coverage.unpaired.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}
                      className="ml-2 font-semibold text-[#b45309] underline-offset-2 hover:underline"
                    >
                      {pick(`짝 없음 ${rule.coverage.unpaired.length}`, `${rule.coverage.unpaired.length} unpaired`)}
                    </button>
                  ) : null}
                </span>
                <span className="truncate text-xs text-muted-foreground" title={rule.note ?? undefined}>{rule.note || "-"}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">
                  <span className="block font-mono">{formatDate(rule.updatedAt)}</span>
                  {rule.updatedBy ? <span className="block truncate">{rule.updatedBy}</span> : null}
                </span>
                <div className="flex gap-2">
                  {canEdit ? <button type="button" onClick={() => edit(rule)} className="text-xs font-semibold text-[#1a5cdb]">{pick("편집", "Edit")}</button> : null}
                  {canDelete ? <button type="button" disabled={busy} onClick={() => void remove(rule)} className="text-xs font-semibold text-[#c42b2b]">{pick("삭제", "Delete")}</button> : null}
                </div>
              </div>
              {expanded === rule.id ? (
                <div className="px-3 pb-2 text-[11px] text-[#8a5300]">
                  {pick("기준 색상의 활성 SKU가 없어 자체 실적을 쓰는 SKU: ", "No active SKU in the reference colour, keeping their own sales: ")}
                  <span className="font-mono">{rule.coverage.unpaired.join(", ")}</span>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
