"use client";

// Code Guide:
// Root for the two OOS-impact screens from the planning doc:
//   1) Shopify Pre-Order conversion drop rate  → preorder-screen.tsx
//   2) Marketplace restock recovery            → recovery-screen.tsx
// This file only owns the tab switcher and page header — split out so two
// people can each own one screen file without touching this one. Shared
// pieces (Chip, Kpi, LineChart, etc.) live in shared.tsx.

import { useEffect, useState } from "react";
import { ChevronRight, PackageX, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { PreorderScreen } from "./preorder-screen";
import { RecoveryScreen } from "./recovery-screen";

export function OosImpactContent() {
  const { pick } = useI18n();
  const { can, ready: permissionsReady } = usePermissions();
  const [screen, setScreen] = useState<"preorder" | "recovery">("preorder");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Bumped on a successful sync and used as the screens' React key — remounts
  // PreorderScreen/RecoveryScreen so their mount-time fetch picks up the
  // freshly-synced data instead of whatever was cached in state pre-sync.
  const [syncNonce, setSyncNonce] = useState(0);
  const canSync = permissionsReady && can("demand-planning", "edit");

  // "언제 마지막으로 동기화됐는지" — this button triggers the same shared
  // refreshStats pipeline as the Demand Planning dashboard's own Sync button,
  // so it reads/refreshes the same MAX(fc_stats.calculated_at) timestamp
  // rather than tracking a separate OOS-Impact-only concept of "last synced."
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiPath("/api/planning/stats/last-sync"))
      .then((r) => r.json())
      .then((json: { success: boolean; lastSync?: string | null }) => {
        if (json.success) setLastSync(json.lastSync ?? null);
      })
      .catch(() => {});
  }, [syncNonce]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch(apiPath("/api/planning/stats/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSyncNonce((n) => n + 1);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section
      className={cn(
        "oos-impact-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950",
        "[--chart-blue:#2a78d6] [--chart-orange:#eb6834] [--chart-aqua:#1baf7a] [--chart-baseline-bar:#c3c2b7]",
        "dark:[--chart-blue:#3987e5] dark:[--chart-orange:#d95926] dark:[--chart-aqua:#199e70] dark:[--chart-baseline-bar:#383835]"
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2dfd8] bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <PackageX className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">{pick("품절 영향 분석", "OOS Impact Analysis")}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span suppressHydrationWarning className="font-mono text-[11px] text-muted-foreground">
            {lastSync ? pick(`동기화: ${lastSync}`, `Synced ${lastSync}`) : "—"}
          </span>
          <button
            type="button"
            disabled={!canSync || syncing}
            onClick={handleSync}
            title={!canSync && permissionsReady ? pick("동기화 권한이 없습니다 (수요 계획 수정 권한 필요)", "Sync requires Demand Planning edit permission") : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background",
              (!canSync || syncing) && "cursor-not-allowed opacity-50"
            )}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? pick("동기화 중…", "Syncing…") : pick("동기화", "Sync")}
          </button>
        </div>
      </header>

      {syncError && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive">
          {pick("동기화 실패", "Sync failed")}: {syncError}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4 md:p-5">
        <div className="flex w-fit gap-1.5 rounded-xl bg-muted p-1">
          {(
            [
              ["preorder", pick("Shopify · Pre-Order 전환 감소율", "Shopify · Pre-Order Conversion Drop")],
              ["recovery", pick("타 채널 · 재입고 회복 추이", "Marketplaces · Restock Recovery")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScreen(key)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors",
                screen === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-full font-mono text-[10.5px] font-bold", screen === key ? "bg-foreground text-background" : "bg-background/60 text-muted-foreground")}>
                {key === "preorder" ? 1 : 2}
              </span>
              {label}
              <ChevronRight className="h-3 w-3 opacity-40" />
            </button>
          ))}
        </div>

        {screen === "preorder" ? <PreorderScreen key={syncNonce} /> : <RecoveryScreen key={syncNonce} />}
      </div>
    </section>
  );
}
