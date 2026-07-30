"use client";

/**
 * Code Guide:
 * The failure card for planning pages.
 *
 * It replaces a card that said "Could not reach the forecast server" for every
 * failure, including a 500 from a server that was plainly reachable. That
 * heading sent readers to check whether the service was running when it was,
 * and the real detail, "Internal Server Error", told them nothing.
 *
 * Four failures with four different fixes:
 *   unreachable  nothing is listening
 *   no_data      up, but the gitignored data files are absent
 *   outdated     up with data, but predates these endpoints
 *   error        something else, shown verbatim rather than guessed at
 *
 * The proxy classifies, because only the server can see the upstream status and
 * ask /health. This renders.
 */

import { AlertTriangle, Database, PlugZap, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/i18n-provider";

export type PlanningErrorKind = "unreachable" | "no_data" | "outdated" | "error";

export interface PlanningErrorBody {
  kind?: PlanningErrorKind;
  error?: string;
  detail?: string;
  missingRequired?: string[];
  files?: { name: string; path: string; produced_by: string }[];
  repoRoot?: string | null;
}

/** Pull the structured body off a failed response, falling back to a bare
 *  message so callers that only have a string still render something. */
export function planningErrorFrom(body: unknown, fallback: string): PlanningErrorBody {
  if (body && typeof body === "object") {
    const b = body as PlanningErrorBody;
    if (b.error || b.detail || b.kind) return b;
  }
  return { kind: "error", detail: fallback };
}

export function PlanningError({
  body,
  onRetry,
}: {
  body: PlanningErrorBody;
  onRetry?: () => void;
}) {
  const { pick } = useI18n();
  const kind: PlanningErrorKind = body.kind ?? "error";

  const Icon = { unreachable: PlugZap, no_data: Database, outdated: AlertTriangle, error: XCircle }[kind];

  const heading: Record<PlanningErrorKind, string> = {
    unreachable: pick("예측 서버가 실행되고 있지 않습니다.", "The forecast server is not running."),
    no_data: pick("예측 서버에 읽을 데이터가 없습니다.", "The forecast server has no data to read."),
    outdated: pick("예측 서버가 최신 버전이 아닙니다.", "The forecast server is out of date."),
    error: pick("예측 서버에서 오류가 발생했습니다.", "The forecast server returned an error."),
  };

  const guidance: Record<PlanningErrorKind, string> = {
    unreachable: pick(
      "이 페이지를 열면 자동으로 시작을 시도합니다. 계속 실패한다면 아래 내용을 확인하세요.",
      "Opening this page tries to start it. If that keeps failing, the detail below says why.",
    ),
    no_data: pick(
      "서버 자체는 정상입니다. data/processed 와 outputs/reports 는 git에 포함되지 않으므로, 새로 클론한 저장소에는 코드만 있고 데이터 파일이 없습니다.",
      "The service itself is fine. data/processed and outputs/reports are gitignored, so a fresh checkout has the code and none of the data files.",
    ),
    outdated: pick(
      "Time_Series_Forecasting 저장소에서 최신 코드를 받은 뒤 서버를 다시 시작하세요.",
      "Pull the latest in the Time_Series_Forecasting checkout and restart the server.",
    ),
    error: pick(
      "아래는 서버가 반환한 내용 그대로입니다.",
      "Below is what the server returned, verbatim.",
    ),
  };

  const tone: Record<PlanningErrorKind, string> = {
    unreachable: "text-red-600 dark:text-red-400",
    no_data: "text-amber-600 dark:text-amber-400",
    outdated: "text-amber-600 dark:text-amber-400",
    error: "text-red-600 dark:text-red-400",
  };

  return (
    <Card>
      <CardContent className="p-6 text-sm">
        <div className={`flex items-center gap-2 font-medium ${tone[kind]}`}>
          <Icon className="h-4 w-4 shrink-0" />
          {heading[kind]}
        </div>

        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{guidance[kind]}</p>

        {kind === "no_data" && body.files && body.files.length > 0 && (
          <ul className="mt-3 space-y-1 text-[11.5px] text-muted-foreground">
            {body.files.map((f) => (
              <li key={f.name}>
                <code className="font-mono text-[11px] text-foreground">{f.path}</code>
                <span className="opacity-80"> — {pick("생성", "produced by")} {f.produced_by}</span>
              </li>
            ))}
          </ul>
        )}

        {kind === "no_data" && body.repoRoot && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {pick("서버가 읽는 위치", "Server is reading from")}:{" "}
            <code className="font-mono text-[10.5px]">{body.repoRoot}</code>
          </p>
        )}

        {body.detail && kind !== "no_data" && (
          <p className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
            {body.detail}
          </p>
        )}

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/60"
          >
            <RefreshCw className="h-3 w-3" />
            {pick("다시 시도", "Try again")}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
