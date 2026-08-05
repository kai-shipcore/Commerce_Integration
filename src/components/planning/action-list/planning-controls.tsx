"use client";

/**
 * Code Guide:
 * The four planning assumptions, with what each one does, shared by both screens.
 *
 * One component rather than two copies. Every figure on both pages is computed
 * under these, so a reader who changes lead time on the list and then opens a SKU
 * must see the same assumption there; and the explanations cannot drift if there
 * is only one of them.
 *
 * Each control says what it changes, because two of them look alike and are not.
 * Lead time and reorder cycle both move quantities: they add together into the
 * coverage window, and the caption states that sum, since it is the thing they
 * jointly produce and neither states alone. Service level scales the buffer. The
 * risk window changes no quantity at all and only decides which rows are counted
 * as urgent, which is worth saying plainly next to three controls that do move
 * numbers.
 */

import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { ActionListParams } from "./types";

const SERVICE_LEVELS: { label: string; z: number }[] = [
  { label: "84% (z=1.0)", z: 1.0 },
  { label: "90% (z=1.28)", z: 1.28 },
  { label: "95% (z=1.65)", z: 1.65 },
  { label: "98% (z=2.05)", z: 2.05 },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1" title={hint}>
      <span className="text-muted-foreground">{label}</span>
      {children}
      {/* Written out rather than left on hover. The question these answer came
          from someone looking straight at the controls, so an explanation that
          only appears on hover would not have been found. */}
      <span className="max-w-[15rem] text-[11.5px] leading-snug text-muted-foreground/80">
        {hint}
      </span>
    </label>
  );
}

export function PlanningControls({
  params,
  onChange,
  busy,
}: {
  params: ActionListParams;
  onChange: (next: ActionListParams) => void;
  /** Shown while a recomputation is in flight, since every figure on the page
   *  moves with these and the previous answer stays on screen meanwhile. */
  busy?: boolean;
}) {
  const { pick } = useI18n();
  const coverage = params.lead_time_weeks + params.review_period_weeks;
  const set = (patch: Partial<ActionListParams>) => onChange({ ...params, ...patch });
  // Just the percentage for the collapsed line. The z value belongs beside the
  // control that sets it, not in a summary read at a glance.
  const serviceLabel =
    SERVICE_LEVELS.find((s) => s.z === params.service_z)?.label.split(" ")[0] ??
    `z=${params.service_z}`;

  // Collapsed by default.
  //
  // Two of these four cannot honestly be answered by the person being asked.
  // The real lead time is not known, and the service level currently scales a
  // buffer whose own error term is substituted on 40% of SKUs. Presenting them
  // open, as four editable inputs above the worklist, asks a purchaser to
  // supply numbers nobody has while every figure on the page moves with their
  // guess.
  //
  // The summary keeps the values on screen while closed, so this hides the
  // controls without hiding the assumptions: a reader still sees the coverage
  // window every quantity below was computed over, which is the part they need
  // and the part they cannot reconstruct.
  const summary = pick(
    `가정: 커버 ${coverage}주 (리드타임 ${params.lead_time_weeks}주 + 발주 주기 ${params.review_period_weeks}주) · 서비스 ${serviceLabel} · 위험 기간 ${params.stockout_horizon_days}일`,
    `Assumptions: ${coverage}-week coverage (${params.lead_time_weeks}w lead + ${params.review_period_weeks}w cycle) · ${serviceLabel} service · ${params.stockout_horizon_days}-day risk window`,
  );

  return (
    <details className="group rounded-md border bg-muted/30 text-[14px]">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-muted/50">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium tabular-nums">{summary}</span>
        <span className="text-[13px] text-muted-foreground">
          {pick("· 변경하려면 클릭", "· click to change")}
        </span>
        {busy && (
          <span className="text-[13px] opacity-70">{pick("다시 계산 중…", "recomputing…")}</span>
        )}
      </summary>

      <div className="flex flex-col gap-2.5 border-t px-3 py-3">
      <div className="flex flex-wrap items-start gap-4">
        <Field
          label={pick("리드타임(주)", "Lead time (weeks)")}
          hint={pick(
            "공급사 생산 + 운송. 발주가 감당해야 할 수요 기간을 결정합니다.",
            "Supplier plus transit. Drives how much demand an order must cover.",
          )}
        >
          <Input
            type="number" min={1} max={52} value={params.lead_time_weeks}
            onChange={(e) =>
              set({ lead_time_weeks: Math.max(1, Math.min(52, Number(e.target.value) || 1)) })
            }
            className="h-8 w-20"
          />
        </Field>

        <Field
          label={pick("발주 주기(주)", "Reorder cycle (weeks)")}
          hint={pick(
            "얼마나 자주 발주하는지. 이번 발주는 다음 발주가 도착할 때까지 버텨야 하므로, 리드타임에 이 기간을 더한 만큼을 감당합니다.",
            "How often orders are placed. An order covers the lead time plus this, so stock lasts until the next one arrives.",
          )}
        >
          <Input
            type="number" min={1} max={13} value={params.review_period_weeks}
            onChange={(e) =>
              set({ review_period_weeks: Math.max(1, Math.min(13, Number(e.target.value) || 1)) })
            }
            className="h-8 w-20"
          />
        </Field>

        <Field
          label={pick("서비스 수준", "Service level")}
          hint={pick(
            "예측 오차에 대비해 얼마나 여유 재고를 둘지. 높을수록 안전재고가 늘고 재고가 많아집니다.",
            "How much safety stock to hold against forecast error. Higher service means more buffer and more stock.",
          )}
        >
          <select
            value={params.service_z}
            onChange={(e) => set({ service_z: Number(e.target.value) })}
            className="h-8 rounded-md border bg-background px-2"
          >
            {SERVICE_LEVELS.map((s) => (
              <option key={s.z} value={s.z}>{s.label}</option>
            ))}
          </select>
        </Field>

        <Field
          label={pick("품절 위험 기간(일)", "Risk window (days)")}
          hint={pick(
            "며칠 안에 품절되면 '임박'으로 볼지. 어떤 행에 표시가 붙는지만 바꾸며, 발주 수량은 전혀 달라지지 않습니다.",
            "How soon a stockout counts as urgent. Changes only which rows are flagged and counted; no order quantity moves.",
          )}
        >
          <Input
            type="number" min={1} max={365} value={params.stockout_horizon_days}
            onChange={(e) =>
              set({
                stockout_horizon_days: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
              })
            }
            className="h-8 w-20"
          />
        </Field>
      </div>

      {/* The sum the first two controls produce. Neither states it alone, and it
          is the window every quantity on these screens is computed over. */}
      <p className="text-[13px] text-muted-foreground">
        {pick(
          `발주는 ${coverage}주치를 감당합니다 (리드타임 ${params.lead_time_weeks}주 + 발주 주기 ${params.review_period_weeks}주).`,
          `Orders cover ${coverage} weeks (${params.lead_time_weeks}w lead + ${params.review_period_weeks}w cycle).`,
        )}
      </p>
      </div>
    </details>
  );
}
