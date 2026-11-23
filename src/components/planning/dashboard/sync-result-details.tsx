"use client";

// The Sync History detail pane's reading of a job's `result`: every number
// with what it counts, and for the Workbench container push, why containers
// failed (the SKUs Workbench lacks, then anything else it said). The raw JSON
// stays available underneath for debugging.

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

type Pick = (ko: string, en: string) => string;
type Result = Record<string, unknown>;

type FieldSpec = { key: string; ko: string; en: string; koHelp: string; enHelp: string };

const STATS_FIELDS: FieldSpec[] = [
  {
    key: "inventoryUpserted",
    ko: "재고 갱신 SKU",
    en: "Inventory SKUs",
    koHelp: "창고별 재고 수량을 새로 받아 저장한 SKU 수",
    enHelp: "SKUs whose per-warehouse stock was refreshed",
  },
  {
    key: "linkSalesUpserted",
    ko: "판매 통계 SKU (Link)",
    en: "Sales stats SKUs (Link)",
    koHelp: "최근 98일 안에 주문이 있는 SKU의 West·FBA·East 90/60/30/15/7일 판매량을 Link 매핑 기준으로 계산해 저장한 수. 대시보드 Link 모드의 판매 컬럼입니다.",
    enHelp: "SKUs with orders in the last 98 days whose West/FBA/East 90/60/30/15/7-day sales were computed on the Link mapping. The dashboard's Link-mode sales columns.",
  },
  {
    key: "customSalesUpserted",
    ko: "판매 통계 SKU (Custom)",
    en: "Sales stats SKUs (Custom)",
    koHelp: "위와 같은 계산을 Custom 매핑 기준으로 한 수. 대시보드 Custom 모드의 판매 컬럼입니다.",
    enHelp: "The same on the Custom mapping. The dashboard's Custom-mode sales columns.",
  },
  {
    key: "velocityLinkUpserted",
    ko: "판매 스냅샷 행 (Link)",
    en: "Sales snapshot rows (Link)",
    koHelp: "Supabase 주문 데이터에서 받아 Link 판매 스냅샷에 저장한 행 수 (SKU × 날짜 × 채널). 위 판매 통계의 원천 데이터입니다.",
    enHelp: "Rows pulled from Supabase orders into the Link sales snapshot (SKU × date × channel); the source of the sales stats.",
  },
  {
    key: "velocityCustomUpserted",
    ko: "판매 스냅샷 행 (Custom)",
    en: "Sales snapshot rows (Custom)",
    koHelp: "같은 것의 Custom 버전",
    enHelp: "The same for Custom",
  },
  {
    key: "productsBackfilled",
    ko: "SKU 마스터 추가",
    en: "SKUs added to SKU Master",
    koHelp: "판매·재고 데이터에는 있지만 SKU 마스터에 없어서 새로 추가한 SKU 수",
    enHelp: "SKUs seen in sales or stock data that SKU Master lacked, now added",
  },
];

const PUSH_COUNT_FIELDS: FieldSpec[] = [
  { key: "considered", ko: "전송 대상", en: "Eligible", koHelp: "최종·선적·완료 상태인 Demand Pilot 컨테이너", enHelp: "Demand Pilot containers that are Final, Shipped or Complete" },
  { key: "created", ko: "신규", en: "Created", koHelp: "Workbench에 새로 만든 컨테이너", enHelp: "New in Workbench" },
  { key: "updated", ko: "변경", en: "Updated", koHelp: "상태·창고·ETA·SKU 수량이 바뀌어 갱신한 컨테이너", enHelp: "Status, warehouse, ETAs or SKU quantities changed" },
  { key: "unchanged", ko: "동일", en: "Unchanged", koHelp: "Workbench와 내용이 같아 바뀐 것이 없는 컨테이너", enHelp: "Already identical in Workbench" },
  { key: "failed", ko: "실패", en: "Failed", koHelp: "Workbench가 거부해 저장되지 않은 컨테이너", enHelp: "Rejected by Workbench; not saved" },
  { key: "skipped", ko: "제외", en: "Not sent", koHelp: "Demand Pilot 데이터 문제로 보내지 않은 컨테이너", enHelp: "Not sent because of Demand Pilot data" },
];

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function skipReasonLabel(reason: string, pick: Pick): string {
  if (reason === "no destination warehouse") return pick("Demand Pilot에 도착 창고가 비어 있음", "No destination warehouse in Demand Pilot");
  const warehouse = /^warehouse (.+) not found in Workbench$/.exec(reason);
  if (warehouse) return pick(`Workbench에 창고 ${warehouse[1]} 없음`, `Warehouse ${warehouse[1]} is not in Workbench`);
  const tooMany = /^more than (\d+) SKUs in one container$/.exec(reason);
  if (tooMany) return pick(`한 컨테이너에 SKU ${tooMany[1]}개 초과`, `More than ${tooMany[1]} SKUs in one container`);
  return reason;
}

function pushStatusText(status: unknown, pick: Pick): { label: string; help: string; tone: string } {
  switch (status) {
    case "succeeded":
      return {
        label: pick("모두 반영됨", "All applied"),
        help: pick("보낸 컨테이너가 모두 Workbench에 저장됐거나 이미 같은 내용입니다.", "Every container sent is saved in Workbench or already matched it."),
        tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      };
    case "partial":
      return {
        label: pick("일부 실패", "Partly failed"),
        help: pick("일부 컨테이너가 거부됐습니다. 거부된 컨테이너는 저장되지 않았고, 나머지는 정상 반영됐습니다.", "Some containers were rejected and not saved; the rest were applied."),
        tone: "border-amber-200 bg-amber-50 text-amber-800",
      };
    case "failed":
      return {
        label: pick("실패", "Failed"),
        help: pick("Workbench에 저장된 컨테이너가 없습니다.", "No container was saved in Workbench."),
        tone: "border-red-200 bg-red-50 text-red-800",
      };
    default:
      return {
        label: pick("전송 안 함", "Not sent"),
        help: pick("이번 Sync에서는 Workbench로 보내지 않았습니다.", "This Sync did not push to Workbench."),
        tone: "border-[#d8d5ce] bg-white text-[#57534e]",
      };
  }
}

function FieldRow({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="border-b border-[#ece9e2] py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="font-semibold text-[#1a1917]">{label}</dt>
        <dd className="font-mono tabular-nums text-[#1a1917]">{value}</dd>
      </div>
      <p className="mt-0.5 leading-5 text-muted-foreground">{help}</p>
    </div>
  );
}

function CopyButton({ text, pick }: { text: string; pick: Pick }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        });
      }}
      className="inline-flex min-h-7 items-center gap-1 rounded border bg-white px-2 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? pick("복사됨", "Copied") : pick("목록 복사", "Copy list")}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border bg-white p-3">
      <h4 className="mb-1 text-[13px] font-semibold text-[#1a1917]">{title}</h4>
      {children}
    </section>
  );
}

function WorkbenchPushDetails({ push, pick }: { push: Result; pick: Pick }) {
  const status = pushStatusText(push.status, pick);
  const skipReasons = push.skipReasons && typeof push.skipReasons === "object"
    ? Object.entries(push.skipReasons as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")
    : [];
  const missingSkus = strings(push.missingSkus);
  const missingCount = num(push.missingSkuCount) ?? missingSkus.length;
  const failedContainers = Array.isArray(push.failedContainers)
    ? (push.failedContainers as Array<{ containerNumber?: unknown; missingSkuCount?: unknown; problems?: unknown }>)
    : [];
  const errors = strings(push.errors);
  const reason = typeof push.reason === "string" ? push.reason : null;
  const durationMs = num(push.durationMs);

  return (
    <Section title={pick("Workbench 컨테이너 전송", "Workbench container push")}>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${status.tone}`}>{status.label}</span>
        {typeof push.target === "string" ? <span className="font-mono text-muted-foreground">{push.target}</span> : null}
        {durationMs !== null ? <span className="text-muted-foreground">· {(durationMs / 1000).toFixed(1)}{pick("초", "s")}</span> : null}
      </div>
      <p className="mt-1.5 leading-5 text-muted-foreground">{status.help}</p>
      {reason ? (
        <p className="mt-1.5 leading-5 text-[#57534e]">
          {reason.includes("is not set")
            ? pick("Workbench 설정(WORKBENCH_API_URL / WORKBENCH_API_KEY)이 없어 건너뛰었습니다.", "Skipped: WORKBENCH_API_URL / WORKBENCH_API_KEY is not set.")
            : reason}
        </p>
      ) : null}

      {push.status !== "skipped" ? (
        <dl className="mt-2">
          {PUSH_COUNT_FIELDS.map((field) => {
            const value = num(push[field.key]);
            return value === null ? null : (
              <FieldRow key={field.key} label={pick(field.ko, field.en)} value={value.toLocaleString()} help={pick(field.koHelp, field.enHelp)} />
            );
          })}
        </dl>
      ) : null}

      {skipReasons.length > 0 ? (
        <div className="mt-3">
          <div className="font-semibold text-[#1a1917]">{pick("제외 사유", "Why containers were not sent")}</div>
          <ul className="mt-1 space-y-0.5">
            {skipReasons.map(([key, count]) => (
              <li key={key} className="flex justify-between gap-3">
                <span>{skipReasonLabel(key, pick)}</span>
                <span className="font-mono tabular-nums">{count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {missingCount > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-amber-900">
              {pick(`Workbench에 없는 SKU ${missingCount.toLocaleString()}개`, `${missingCount.toLocaleString()} SKUs not in Workbench`)}
            </div>
            {missingSkus.length > 0 ? <CopyButton text={missingSkus.join("\n")} pick={pick} /> : null}
          </div>
          <p className="mt-1 leading-5 text-amber-900/80">
            {pick(
              "이 SKU가 Workbench 마스터 상품에 없어서, 이 SKU가 실린 컨테이너가 거부됐습니다. Workbench에 등록하면 다음 Sync 때 반영됩니다.",
              "Workbench has no master product for these SKUs, so containers carrying them were rejected. Register them in Workbench and the next Sync applies those containers.",
            )}
          </p>
          {push.missingSkusComplete === false ? (
            <p className="mt-1 leading-5 text-amber-900">
              {pick(
                "일부 컨테이너는 Workbench가 문제를 50개까지만 알려줘서, 실제로 빠진 SKU가 더 있을 수 있습니다.",
                "Workbench lists at most 50 problems per container, so more SKUs may be missing than shown.",
              )}
            </p>
          ) : null}
          {missingCount > missingSkus.length ? (
            <p className="mt-1 leading-5 text-amber-900">
              {pick(`앞의 ${missingSkus.length.toLocaleString()}개만 저장했습니다.`, `Only the first ${missingSkus.length.toLocaleString()} are stored.`)}
            </p>
          ) : null}
          <pre className="mt-2 max-h-48 overflow-auto rounded border bg-white p-2 font-mono leading-5">{missingSkus.join("\n")}</pre>
        </div>
      ) : null}

      {failedContainers.length > 0 ? (
        <div className="mt-3">
          <div className="font-semibold text-[#1a1917]">
            {pick(`실패한 컨테이너 ${failedContainers.length.toLocaleString()}개`, `${failedContainers.length.toLocaleString()} failed containers`)}
          </div>
          <div className="mt-1 max-h-64 overflow-auto rounded border bg-white">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-[#f8f7f3] text-[#57534e]">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">{pick("컨테이너", "Container")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{pick("없는 SKU", "Missing SKUs")}</th>
                  <th className="px-2 py-1.5 font-semibold">{pick("다른 사유", "Other problems")}</th>
                </tr>
              </thead>
              <tbody>
                {failedContainers.map((container, index) => (
                  <tr key={`${String(container.containerNumber)}-${index}`} className="border-t align-top">
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">{String(container.containerNumber ?? "—")}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{(num(container.missingSkuCount) ?? 0).toLocaleString()}</td>
                    <td className="px-2 py-1.5 break-words">{strings(container.problems).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="mt-3">
          <div className="font-semibold text-red-800">{pick("오류", "Errors")}</div>
          <ul className="mt-1 space-y-1">
            {errors.map((message, index) => (
              <li key={index} className="rounded border border-red-200 bg-red-50 p-2 break-words text-red-800">{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

const SALES_RATE_COUNT_FIELDS = [
  { key: "considered", ko: "대상 SKU", en: "SKUs considered", koHelp: "판매율을 보낼 활성 SKU", enHelp: "Active SKUs with a sales rate to send" },
  { key: "sent", ko: "전송됨", en: "Sent", koHelp: "Workbench가 받아 저장한 판매율", enHelp: "Rates Workbench accepted" },
  { key: "changed", ko: "변경됨", en: "Changed", koHelp: "그중 Workbench에서 새로 생겼거나 값이 바뀐 판매율", enHelp: "Of those, the rates that were new or different in Workbench" },
  { key: "unknownSkuCount", ko: "Workbench에 없는 SKU", en: "Not in Workbench", koHelp: "Workbench 마스터 상품에 없어서 보내지 않은 SKU", enHelp: "No master product in Workbench; not sent" },
  { key: "draftSkuCount", ko: "Draft 상품 SKU", en: "Draft in Workbench", koHelp: "Workbench에서 아직 Draft라 보내지 않은 SKU. 활성화하면 다음 Sync 때 반영됩니다.", enHelp: "Still a draft in Workbench; not sent. Activate it and the next Sync applies it." },
  { key: "failed", ko: "실패", en: "Failed", koHelp: "다른 이유로 저장되지 않은 판매율", enHelp: "Rates not saved for another reason" },
] as const;

function salesRateStatusText(status: unknown, pick: Pick): { label: string; help: string; tone: string } {
  const base = pushStatusText(status, pick);
  switch (status) {
    case "succeeded":
      return { ...base, help: pick("Workbench가 받을 수 있는 판매율을 모두 저장했습니다.", "Every rate Workbench could take was saved.") };
    case "partial":
      return { ...base, help: pick("일부 판매율이 저장되지 않았습니다. 나머지는 정상 반영됐습니다.", "Some rates were not saved; the rest were applied.") };
    case "failed":
      return { ...base, help: pick("Workbench에 저장된 판매율이 없습니다.", "No rate was saved in Workbench.") };
    default:
      return { ...base, help: pick("이번 Sync에서는 판매율을 Workbench로 보내지 않았습니다.", "This Sync did not push sales rates to Workbench.") };
  }
}

/** The sales rate push: each active SKU's T.Avg current, sent after a successful refresh. */
function WorkbenchSalesRateDetails({ push, pick }: { push: Result; pick: Pick }) {
  const status = salesRateStatusText(push.status, pick);
  const notSentSkus = strings(push.notSentSkus);
  const notSentCount = (num(push.unknownSkuCount) ?? 0) + (num(push.draftSkuCount) ?? 0);
  const errors = strings(push.errors);
  const reason = typeof push.reason === "string" ? push.reason : null;
  const durationMs = num(push.durationMs);

  return (
    <Section title={pick("Workbench 판매율 전송", "Workbench sales rate push")}>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${status.tone}`}>{status.label}</span>
        {typeof push.target === "string" ? <span className="font-mono text-muted-foreground">{push.target}</span> : null}
        {durationMs !== null ? <span className="text-muted-foreground">· {(durationMs / 1000).toFixed(1)}{pick("초", "s")}</span> : null}
      </div>
      <p className="mt-1.5 leading-5 text-muted-foreground">{status.help}</p>
      {reason ? (
        <p className="mt-1.5 leading-5 text-[#57534e]">
          {reason.includes("is not set")
            ? pick("Workbench 설정(WORKBENCH_API_URL / WORKBENCH_API_KEY)이 없어 건너뛰었습니다.", "Skipped: WORKBENCH_API_URL / WORKBENCH_API_KEY is not set.")
            : reason}
        </p>
      ) : null}

      {push.status !== "skipped" ? (
        <dl className="mt-2">
          {SALES_RATE_COUNT_FIELDS.map((field) => {
            const value = num(push[field.key]);
            return value === null ? null : (
              <FieldRow key={field.key} label={pick(field.ko, field.en)} value={value.toLocaleString()} help={pick(field.koHelp, field.enHelp)} />
            );
          })}
        </dl>
      ) : null}

      {notSentSkus.length > 0 ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-[#1a1917]">
              {pick(`보내지 않은 SKU ${notSentCount.toLocaleString()}개`, `${notSentCount.toLocaleString()} SKUs not sent`)}
            </div>
            <CopyButton text={notSentSkus.join("\n")} pick={pick} />
          </div>
          {notSentCount > notSentSkus.length ? (
            <p className="mt-1 leading-5 text-muted-foreground">
              {pick(`앞의 ${notSentSkus.length.toLocaleString()}개만 저장했습니다.`, `Only the first ${notSentSkus.length.toLocaleString()} are stored.`)}
            </p>
          ) : null}
          <pre className="mt-2 max-h-48 overflow-auto rounded border bg-white p-2 font-mono leading-5">{notSentSkus.join("\n")}</pre>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <ul className="mt-3 space-y-1 text-red-800">
          {errors.map((error) => <li key={error} className="break-words">{error}</li>)}
        </ul>
      ) : null}
    </Section>
  );
}

export function SyncResultDetails({ result, pick }: { result: Result; pick: Pick }) {
  const statsRows = STATS_FIELDS.flatMap((field) => {
    const value = num(result[field.key]);
    return value === null ? [] : [{ ...field, value }];
  });
  const stale = result.velocitySnapshotStale;
  const push = result.workbench && typeof result.workbench === "object" ? (result.workbench as Result) : null;
  const salesRatePush = result.workbenchSalesRates && typeof result.workbenchSalesRates === "object"
    ? (result.workbenchSalesRates as Result)
    : null;

  return (
    <div className="grid gap-3">
      {statsRows.length > 0 || typeof stale === "boolean" ? (
        <Section title={pick("Demand Pilot 통계 갱신", "Demand Pilot stats refresh")}>
          <dl>
            {statsRows.map((row) => (
              <FieldRow key={row.key} label={pick(row.ko, row.en)} value={row.value.toLocaleString()} help={pick(row.koHelp, row.enHelp)} />
            ))}
            {typeof stale === "boolean" ? (
              <FieldRow
                label={pick("판매 스냅샷", "Sales snapshot")}
                value={stale ? pick("이전 것 사용", "Previous one used") : pick("최신", "Fresh")}
                help={stale
                  ? pick("다른 Velocity 동기화가 진행 중이라, 이번 Sync는 이전에 받아 둔 판매 스냅샷으로 계산했습니다.", "Another Velocity sync was running, so this Sync computed from the previously pulled sales snapshot.")
                  : pick("이번 Sync에서 판매 스냅샷을 최신으로 받아 계산했습니다.", "This Sync pulled a fresh sales snapshot before computing.")}
              />
            ) : null}
          </dl>
        </Section>
      ) : null}

      {push ? <WorkbenchPushDetails push={push} pick={pick} /> : null}
      {salesRatePush ? <WorkbenchSalesRateDetails push={salesRatePush} pick={pick} /> : null}

      <details className="rounded-md border bg-white p-3">
        <summary className="cursor-pointer font-semibold text-muted-foreground">{pick("원본 JSON", "Raw JSON")}</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}
