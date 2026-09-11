"use client";

/**
 * The Demand Planning grid's sheet tabs.
 *
 * The leftmost tab is Live — the real container plan, with no row of its own in
 * the database. Every other tab is a scenario: its own saved view plus its own
 * container quantities and ETAs, which stay off the real plan until someone
 * applies them.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Lock, Users, ChevronDown, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ScenarioSummary } from "@/features/planning/scenarios";

export const LIVE_TAB_ID = "live";

export interface ScenarioTabBarProps {
  scenarios: ScenarioSummary[];
  /** null while the Live tab is active. */
  activeId: string | null;
  busy: boolean;
  canEditPlanning: boolean;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onDuplicate: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onToggleShared: (scenario: ScenarioSummary) => void;
  onToggleLock: (scenario: ScenarioSummary) => void;
  onDelete: (scenario: ScenarioSummary) => void;
  onApplyToLive: (scenario: ScenarioSummary) => void;
  onReorder: (orderedIds: string[]) => void;
}

export function ScenarioTabBar({
  scenarios,
  activeId,
  busy,
  canEditPlanning,
  onSelect,
  onCreate,
  onDuplicate,
  onRename,
  onToggleShared,
  onToggleLock,
  onDelete,
  onApplyToLive,
  onReorder,
}: ScenarioTabBarProps) {
  const { pick } = useI18n();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  function startRename(scenario: ScenarioSummary) {
    setRenamingId(scenario.id);
    setDraftName(scenario.name);
  }

  function commitRename() {
    if (!renamingId) return;
    const name = draftName.trim();
    const previous = scenarios.find((s) => s.id === renamingId);
    setRenamingId(null);
    if (name && previous && name !== previous.name) onRename(renamingId, name);
  }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = scenarios.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDragId(null);
    onReorder(ids);
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-t border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={tabClass(activeId === null)}
        title={pick(
          "실제 계획입니다. 여기서 고친 수량은 컨테이너 계획에 그대로 반영됩니다.",
          "The real plan. Quantities edited here go straight to Container Planning.",
        )}
      >
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Live
      </button>

      {scenarios.map((scenario) => {
        const active = scenario.id === activeId;
        return (
          <div
            key={scenario.id}
            draggable={renamingId !== scenario.id}
            onDragStart={() => setDragId(scenario.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(scenario.id)}
            className={`flex items-center ${dragId === scenario.id ? "opacity-50" : ""}`}
          >
            {renamingId === scenario.id ? (
              <input
                ref={renameInputRef}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename();
                  if (event.key === "Escape") setRenamingId(null);
                }}
                maxLength={60}
                className="h-7 w-32 rounded-t-md border border-blue-500 bg-white px-2 text-xs outline-none dark:bg-slate-800"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(scenario.id)}
                onDoubleClick={() => { if (scenario.can_edit) startRename(scenario); }}
                className={tabClass(active)}
                style={scenario.color ? { borderBottomColor: scenario.color } : undefined}
              >
                {scenario.visibility === "shared" && (
                  <Users className="size-3 text-slate-400" aria-label={pick("공유 탭", "Shared tab")} />
                )}
                {scenario.locked_by && (
                  <Lock
                    className="size-3 text-amber-500"
                    aria-label={pick("잠긴 탭", "Locked tab")}
                  />
                )}
                <span className="max-w-40 truncate">{scenario.name}</span>
              </button>
            )}

            {active && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="ml-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                    aria-label={pick("탭 메뉴", "Tab menu")}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem
                    disabled={!scenario.can_edit}
                    onClick={() => startRename(scenario)}
                  >
                    {pick("이름 변경", "Rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canEditPlanning}
                    onClick={() => onDuplicate(scenario.id)}
                  >
                    {pick("복사본 만들기", "Duplicate")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!scenario.is_owner}
                    onClick={() => onToggleShared(scenario)}
                  >
                    {scenario.visibility === "shared"
                      ? pick("공유 해제", "Stop sharing")
                      : pick("팀에 공유", "Share with the team")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canEditPlanning}
                    onClick={() => onToggleLock(scenario)}
                  >
                    {scenario.locked_by
                      ? pick("수정 잠금 해제", "Unlock editing")
                      : pick("수정 잠금", "Lock editing")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!canEditPlanning}
                    onClick={() => onApplyToLive(scenario)}
                  >
                    {pick("Live에 반영…", "Apply to Live…")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!scenario.is_owner}
                    onClick={() => onDelete(scenario)}
                  >
                    {pick("탭 삭제", "Delete tab")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onCreate}
        disabled={!canEditPlanning || busy}
        className="ml-1 rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-700"
        title={pick("새 탭", "New tab")}
        aria-label={pick("새 탭", "New tab")}
      >
        <Plus className="size-4" />
      </button>

      <button
        type="button"
        onClick={() => onDuplicate(null)}
        disabled={!canEditPlanning || busy}
        className="rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-700"
        title={pick(
          "지금 Live 수량을 그대로 복사한 새 탭을 만듭니다.",
          "Creates a new tab starting from the current Live quantities.",
        )}
      >
        {pick("Live 복사", "Copy Live")}
      </button>

      {busy && <Loader2 className="size-3.5 animate-spin text-slate-400" />}
    </div>
  );
}

function tabClass(active: boolean): string {
  return [
    "flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-1 text-xs transition-colors",
    active
      ? "border-blue-600 bg-white font-semibold text-slate-900 dark:bg-slate-800 dark:text-slate-100"
      : "border-transparent text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700",
  ].join(" ");
}
