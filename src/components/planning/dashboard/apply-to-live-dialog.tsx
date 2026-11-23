"use client";

/**
 * Confirmation for writing a scenario tab onto the real container plan.
 *
 * Applying is not reversible — it goes straight into fc_container_items and
 * shows up in Container Planning and on packing lists — so every change is
 * listed before anything is written, and a run with nothing to do says so
 * rather than offering a button that would do nothing.
 *
 * Quantities are ticked by default; ETAs are not. A tab copied from Live keeps
 * the ETAs it was made with, so a date Live changed afterwards also shows up
 * here as a difference, and writing it back would undo that change. The
 * planning team asked (2026-11-23) to choose whether dates come over, and to
 * pick single changes; only the ticked rows are sent.
 */

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ScenarioApplyDiff, ScenarioApplySelection } from "@/features/planning/scenarios";

interface ApplyToLiveDialogProps {
  scenarioName: string;
  diff: ScenarioApplyDiff;
  onCancel: () => void;
  onConfirm: (selection: ScenarioApplySelection) => void;
}

interface QuantityRow {
  key: string;
  containerName: string;
  isDraft: boolean;
  masterSku: string;
  from: number;
  to: number;
  kind: "added" | "changed" | "removed";
}

function cellKey(containerId: number, masterSku: string): string {
  return `${containerId}::${masterSku}`;
}

function quantityRows(diff: ScenarioApplyDiff): QuantityRow[] {
  const rows: QuantityRow[] = [
    ...diff.added.map((row) => ({ row, from: 0, to: row.qty, kind: "added" as const })),
    ...diff.changed.map((row) => ({ row, from: row.from, to: row.to, kind: "changed" as const })),
    ...diff.removed.map((row) => ({ row, from: row.from, to: 0, kind: "removed" as const })),
  ].map(({ row, from, to, kind }) => ({
    key: cellKey(row.container_id, row.master_sku),
    containerName: row.container_name,
    isDraft: row.container_status === "draft",
    masterSku: row.master_sku,
    from,
    to,
    kind,
  }));
  return rows.sort((a, b) =>
    a.containerName.localeCompare(b.containerName) || a.masterSku.localeCompare(b.masterSku));
}

const KIND_TONE: Record<QuantityRow["kind"], string> = {
  added: "text-emerald-700 dark:text-emerald-400",
  changed: "text-blue-700 dark:text-blue-400",
  removed: "text-red-700 dark:text-red-400",
};

export function ApplyToLiveDialog({
  scenarioName,
  diff,
  onCancel,
  onConfirm,
}: ApplyToLiveDialogProps) {
  const { pick } = useI18n();
  const quantities = useMemo(() => quantityRows(diff), [diff]);
  const etaRows = useMemo(
    () => [...diff.eta_changes].sort((a, b) => a.container_name.localeCompare(b.container_name)),
    [diff],
  );

  const [cells, setCells] = useState<Set<string>>(() => new Set(quantities.map((row) => row.key)));
  const [applyEtas, setApplyEtas] = useState(false);
  const [etaIds, setEtaIds] = useState<Set<number>>(() => new Set(etaRows.map((row) => row.container_id)));

  const selectedEtaCount = applyEtas ? etaIds.size : 0;
  const total = cells.size + selectedEtaCount;
  const nothingToApply = quantities.length === 0 && etaRows.length === 0;

  const kindLabel = (kind: QuantityRow["kind"]) => (
    kind === "added" ? pick("추가", "Added")
      : kind === "removed" ? pick("제외", "Removed")
        : pick("변경", "Changed")
  );

  function toggleCell(key: string) {
    setCells((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function toggleEta(id: number) {
    setEtaIds((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function confirm() {
    onConfirm({
      cells: [...cells],
      eta_container_ids: applyEtas ? [...etaIds] : [],
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {pick(`"${scenarioName}"을 Live에 반영`, `Apply "${scenarioName}" to Live`)}
          </DialogTitle>
          <DialogDescription>
            {pick(
              "실제 컨테이너 계획이 바뀝니다. 컨테이너 계획 화면과 패킹리스트에 그대로 나타나며 되돌릴 수 없습니다. 체크한 항목만 반영됩니다.",
              "This changes the real container plan. It shows up in Container Planning and on packing lists, and cannot be undone. Only the ticked rows are applied.",
            )}
          </DialogDescription>
        </DialogHeader>

        {nothingToApply ? (
          <p className="py-2 text-sm text-slate-600 dark:text-slate-300">
            {pick(
              "이 탭의 수량과 ETA는 이미 Live와 같습니다. 반영할 내용이 없습니다.",
              "This tab already matches Live. There is nothing to apply.",
            )}
          </p>
        ) : (
          <div className="space-y-4 py-1 text-sm">
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                  {pick("수량", "Quantities")}
                  <span className="ml-2 font-normal text-slate-500">
                    {pick(`${cells.size} / ${quantities.length}건 선택`, `${cells.size} of ${quantities.length} selected`)}
                  </span>
                </h3>
              </div>
              {quantities.length === 0 ? (
                <p className="text-slate-500">{pick("바뀐 수량이 없습니다.", "No quantity differs from Live.")}</p>
              ) : (
                <div className="max-h-72 overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="w-9 px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={pick("수량 전체 선택", "Select all quantities")}
                            checked={cells.size === quantities.length}
                            onChange={(event) => setCells(event.target.checked ? new Set(quantities.map((row) => row.key)) : new Set())}
                          />
                        </th>
                        <th className="px-2 py-1.5 font-medium">{pick("컨테이너", "Container")}</th>
                        <th className="px-2 py-1.5 font-medium">SKU</th>
                        <th className="px-2 py-1.5 text-right font-medium">Live</th>
                        <th className="px-2 py-1.5 text-right font-medium">{pick("이 탭", "This tab")}</th>
                        <th className="px-2 py-1.5 font-medium">{pick("구분", "Change")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quantities.map((row) => (
                        <tr key={row.key} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              aria-label={`${row.containerName} ${row.masterSku}`}
                              checked={cells.has(row.key)}
                              onChange={() => toggleCell(row.key)}
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1">
                            {row.containerName}
                            {row.isDraft && (
                              <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] font-medium uppercase text-slate-500 dark:bg-slate-800">
                                Draft
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-xs">{row.masterSku}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-500">{row.from}</td>
                          <td className="px-2 py-1 text-right font-semibold tabular-nums">{row.to}</td>
                          <td className={`px-2 py-1 ${KIND_TONE[row.kind]}`}>{kindLabel(row.kind)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {etaRows.length > 0 && (
              <section>
                <label className="mb-1.5 flex cursor-pointer items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={applyEtas}
                    onChange={(event) => setApplyEtas(event.target.checked)}
                  />
                  {pick("ETA도 반영", "Also apply ETAs")}
                  <span className="font-normal text-slate-500">
                    {pick(`${selectedEtaCount} / ${etaRows.length}건 선택`, `${selectedEtaCount} of ${etaRows.length} selected`)}
                  </span>
                </label>
                <p className="mb-1.5 text-xs text-slate-500">
                  {pick(
                    "탭을 만든 뒤 Live에서 바뀐 날짜도 여기에 나옵니다. 반영하면 Live의 날짜가 이 탭의 날짜로 바뀝니다.",
                    "A date changed on Live after this tab was made is listed here too. Applying it sets Live back to this tab's date.",
                  )}
                </p>
                <div className={`max-h-48 overflow-auto rounded-md border border-slate-200 dark:border-slate-700 ${applyEtas ? "" : "opacity-50"}`}>
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="w-9 px-2 py-1.5" />
                        <th className="px-2 py-1.5 font-medium">{pick("컨테이너", "Container")}</th>
                        <th className="px-2 py-1.5 font-medium">{pick("Live ETA", "Live ETA")}</th>
                        <th className="px-2 py-1.5 font-medium">{pick("이 탭 ETA", "This tab's ETA")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {etaRows.map((row) => (
                        <tr key={row.container_id} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              aria-label={row.container_name}
                              disabled={!applyEtas}
                              checked={applyEtas && etaIds.has(row.container_id)}
                              onChange={() => toggleEta(row.container_id)}
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1">
                            {row.container_name}
                            {row.container_status === "draft" && (
                              <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] font-medium uppercase text-slate-500 dark:bg-slate-800">
                                Draft
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-slate-500">{row.from ?? "—"}</td>
                          <td className="px-2 py-1 font-semibold tabular-nums">{row.to}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {pick("취소", "Cancel")}
          </Button>
          <Button variant="destructive" disabled={total === 0} onClick={confirm}>
            {pick(`${total}건 반영`, `Apply ${total} change${total === 1 ? "" : "s"}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
