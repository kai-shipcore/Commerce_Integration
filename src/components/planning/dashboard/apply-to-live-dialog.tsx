"use client";

/**
 * Confirmation for writing a scenario tab onto the real container plan.
 *
 * Applying is not reversible — it goes straight into fc_container_items and
 * shows up in Container Planning and on packing lists — so the counts are
 * spelled out before anything is written, and a run with nothing to do says so
 * rather than offering a button that would do nothing.
 */

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
import type { ScenarioApplyDiff } from "@/features/planning/scenarios";

interface ApplyToLiveDialogProps {
  scenarioName: string;
  diff: ScenarioApplyDiff;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ApplyToLiveDialog({
  scenarioName,
  diff,
  onCancel,
  onConfirm,
}: ApplyToLiveDialogProps) {
  const { pick } = useI18n();
  const total = diff.added.length + diff.changed.length + diff.removed.length + diff.eta_changes.length;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {pick(`"${scenarioName}"을 Live에 반영`, `Apply "${scenarioName}" to Live`)}
          </DialogTitle>
          <DialogDescription>
            {pick(
              "실제 컨테이너 계획이 바뀝니다. 컨테이너 계획 화면과 패킹리스트에 그대로 나타나며 되돌릴 수 없습니다.",
              "This changes the real container plan. It shows up in Container Planning and on packing lists, and cannot be undone.",
            )}
          </DialogDescription>
        </DialogHeader>

        {total === 0 ? (
          <p className="py-2 text-sm text-slate-600 dark:text-slate-300">
            {pick(
              "이 탭의 수량은 이미 Live와 같습니다. 반영할 내용이 없습니다.",
              "This tab already matches Live. There is nothing to apply.",
            )}
          </p>
        ) : (
          <ul className="space-y-1.5 py-2 text-sm">
            <DiffLine
              count={diff.added.length}
              label={pick("새로 추가되는 SKU", "SKUs added")}
              tone="text-emerald-700 dark:text-emerald-400"
            />
            <DiffLine
              count={diff.changed.length}
              label={pick("수량이 바뀌는 SKU", "SKUs with a changed quantity")}
              tone="text-blue-700 dark:text-blue-400"
            />
            <DiffLine
              count={diff.removed.length}
              label={pick("컨테이너에서 빠지는 SKU", "SKUs removed from a container")}
              tone="text-red-700 dark:text-red-400"
            />
            <DiffLine
              count={diff.eta_changes.length}
              label={pick("ETA가 바뀌는 컨테이너", "Containers with a changed ETA")}
              tone="text-amber-700 dark:text-amber-400"
            />
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {pick("취소", "Cancel")}
          </Button>
          <Button variant="destructive" disabled={total === 0} onClick={onConfirm}>
            {pick(`${total}건 반영`, `Apply ${total} change${total === 1 ? "" : "s"}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffLine({ count, label, tone }: { count: number; label: string; tone: string }) {
  if (count === 0) return null;
  return (
    <li className="flex items-baseline gap-2">
      <span className={`min-w-10 text-right font-semibold tabular-nums ${tone}`}>{count}</span>
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
    </li>
  );
}
