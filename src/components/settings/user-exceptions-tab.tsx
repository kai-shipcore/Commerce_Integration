"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { apiPath } from "@/lib/api-path";
import {
  PERM_SECTIONS,
  PERM_ACTIONS,
  DEFAULT_ROLE_PERMISSIONS,
  type PermSection,
  type PermAction,
  type ManagedRole,
} from "@/lib/permissions-config";

export interface UserSummary {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface PermOverride {
  section: string;
  action: string;
  allowed: boolean;
}

const SECTION_LABEL_MAP = Object.fromEntries(
  PERM_SECTIONS.map((s) => [s.id, { ko: s.nameKo, en: s.nameEn }])
);
const ACTION_LABEL_MAP = Object.fromEntries(
  PERM_ACTIONS.map((a) => [a.id, { ko: a.labelKo, en: a.labelEn }])
);

function getEffective(
  role: string,
  section: string,
  action: string,
  overrides: PermOverride[]
): { value: boolean; isOverride: boolean } {
  const ov = overrides.find((o) => o.section === section && o.action === action);
  if (ov !== undefined) return { value: ov.allowed, isOverride: true };
  const rolePerms = DEFAULT_ROLE_PERMISSIONS[role as ManagedRole] ?? DEFAULT_ROLE_PERMISSIONS.user;
  const val = rolePerms[section as PermSection]?.[action as PermAction] ?? false;
  return { value: val, isOverride: false };
}

export function UserExceptionsTab({ user }: { user: UserSummary | null }) {
  const { pick } = useI18n();
  const [overrides, setOverrides] = useState<PermOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formSection, setFormSection] = useState<string>(PERM_SECTIONS[0].id);
  const [formAction, setFormAction] = useState<string>(PERM_ACTIONS[0].id);
  const [formAllowed, setFormAllowed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!user) { setOverrides([]); return; }
    setLoading(true);
    setShowAddForm(false);
    setPreviewOpen(false);
    void fetch(apiPath(`/api/admin/users/${user.id}/permission-overrides`))
      .then((r) => r.json())
      .then((json: { success: boolean; data?: PermOverride[] }) => {
        if (json.success) setOverrides(json.data ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.id]);

  async function handleAddOverride() {
    if (!user) return;
    setSubmitting(true);
    try {
      const res = await fetch(apiPath(`/api/admin/users/${user.id}/permission-overrides`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: formSection, action: formAction, allowed: formAllowed }),
      });
      const json = (await res.json()) as { success: boolean };
      if (!json.success) throw new Error("Failed");
      setOverrides((prev) => {
        const next = prev.filter((o) => !(o.section === formSection && o.action === formAction));
        return [...next, { section: formSection, action: formAction, allowed: formAllowed }];
      });
      setShowAddForm(false);
      setFormSection(PERM_SECTIONS[0].id);
      setFormAction(PERM_ACTIONS[0].id);
      setFormAllowed(true);
      setToast(pick("예외 권한이 추가되었습니다", "Exception added"));
    } catch {
      setToast(pick("저장에 실패했습니다", "Failed to save"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveOverride(section: string, action: string) {
    if (!user) return;
    try {
      await fetch(apiPath(`/api/admin/users/${user.id}/permission-overrides`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, action }),
      });
      setOverrides((prev) => prev.filter((o) => !(o.section === section && o.action === action)));
      setToast(pick("예외 권한이 삭제되었습니다", "Exception removed"));
    } catch {
      setToast(pick("삭제에 실패했습니다", "Failed to remove"));
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-[200px] items-center justify-center p-8 text-center text-[12px] text-muted-foreground">
        {pick("목록에서 사용자를 선택하세요.", "Select a user from the list.")}
      </div>
    );
  }

  const roleBadgeClass: Record<string, string> = {
    admin:      "bg-[#1a1917] text-[#fafaf7]",
    dev:        "bg-[#1a1917] text-[#fafaf7]",
    planner:    "bg-[#dbeafe] text-[#1d4ed8]",
    operation:  "bg-[#d1fae5] text-[#065f46]",
    production: "bg-[#fef3c7] text-[#92400e]",
    user:       "bg-[#f3f4f6] text-[#374151]",
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* User header */}
      <div className="flex items-center gap-3 border-b border-[#e2dfd8] px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8e5df] text-[11px] font-bold text-[#6b6359]">
          {(user.name ?? user.email).slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#1a1917]">
            {user.name?.trim() || user.email}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] ${roleBadgeClass[user.role] ?? roleBadgeClass.user}`}
            >
              {user.role}
            </span>
            <span className="text-[11px] text-muted-foreground">{user.email}</span>
          </div>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Exceptions section */}
      <div className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
              {pick("예외 권한", "Permission Exceptions")}
            </p>
            {overrides.length === 0 && !loading && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {pick(`모든 권한이 ${user.role} 역할 기본값을 따릅니다.`, `All permissions follow the ${user.role} role defaults.`)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-[#ccc7be] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#1a1917] transition-colors hover:bg-[#fafaf7]"
          >
            <Plus className="h-3 w-3" />
            {pick("예외 추가", "Add exception")}
          </button>
        </div>

        {/* Inline add form */}
        {showAddForm && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#b8cffa] bg-[#e8eefb] p-3">
            <select
              value={formSection}
              onChange={(e) => setFormSection(e.target.value)}
              className="rounded-md border border-[#ccc7be] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#1a1917] outline-none focus:border-[#1a5cdb]"
            >
              {PERM_SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {pick(s.nameKo, s.nameEn)}
                </option>
              ))}
            </select>
            <select
              value={formAction}
              onChange={(e) => setFormAction(e.target.value)}
              className="rounded-md border border-[#ccc7be] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#1a1917] outline-none focus:border-[#1a5cdb]"
            >
              {PERM_ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {pick(a.labelKo, a.labelEn)}
                </option>
              ))}
            </select>
            {/* Allow / Block toggle */}
            <div className="flex overflow-hidden rounded-md border border-[#ccc7be]">
              <button
                type="button"
                onClick={() => setFormAllowed(true)}
                className={`px-3 py-1.5 text-[10px] font-bold transition-colors ${
                  formAllowed
                    ? "bg-[#ecfdf5] text-[#059669]"
                    : "bg-white text-[#6b6359] hover:bg-[#fafaf7]"
                }`}
              >
                {pick("허용", "Allow")}
              </button>
              <div className="w-px bg-[#ccc7be]" />
              <button
                type="button"
                onClick={() => setFormAllowed(false)}
                className={`px-3 py-1.5 text-[10px] font-bold transition-colors ${
                  !formAllowed
                    ? "bg-[#fef2f2] text-[#dc2626]"
                    : "bg-white text-[#6b6359] hover:bg-[#fafaf7]"
                }`}
              >
                {pick("차단", "Block")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handleAddOverride()}
              disabled={submitting}
              className="flex items-center gap-1 rounded-md bg-[#1a5cdb] px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-[#1650c4] disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              {pick("추가", "Add")}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {pick("취소", "Cancel")}
            </button>
          </div>
        )}

        {/* Override list */}
        {overrides.length > 0 && (
          <div className="space-y-1.5">
            {overrides.map((ov) => (
              <div
                key={`${ov.section}-${ov.action}`}
                className="flex items-center gap-2 rounded-lg border border-[#e2dfd8] bg-[#fafaf7] px-3 py-2"
              >
                <span className="flex-1 text-[12px] font-semibold text-[#1a1917]">
                  {pick(
                    SECTION_LABEL_MAP[ov.section]?.ko ?? ov.section,
                    SECTION_LABEL_MAP[ov.section]?.en ?? ov.section
                  )}
                </span>
                <span className="rounded border border-[#e2dfd8] bg-white px-2 py-0.5 text-[10px] font-medium text-[#6b6359]">
                  {pick(
                    ACTION_LABEL_MAP[ov.action]?.ko ?? ov.action,
                    ACTION_LABEL_MAP[ov.action]?.en ?? ov.action
                  )}
                </span>
                <span
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                    ov.allowed
                      ? "bg-[#ecfdf5] text-[#059669]"
                      : "bg-[#fef2f2] text-[#dc2626]"
                  }`}
                >
                  {ov.allowed ? "✓" : "✗"}
                  {ov.allowed ? pick("허용", "Allow") : pick("차단", "Block")}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRemoveOverride(ov.section, ov.action)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]"
                  title={pick("예외 삭제", "Remove exception")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview effective permissions */}
      <div className="border-t border-[#e2dfd8]">
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-[#fafaf7] hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${previewOpen ? "rotate-180" : ""}`}
            />
            {pick("최종 적용 권한 미리보기", "Preview effective permissions")}
          </span>
          <span className="text-[10px] font-normal text-muted-foreground/70">
            {pick("역할 기본값 + 예외 합산", "Role defaults + exceptions")}
          </span>
        </button>

        {previewOpen && (
          <div className="overflow-x-auto border-t border-[#e2dfd8] px-5 pb-5 pt-3">
            <table className="w-full min-w-[480px] border-collapse text-[10px]">
              <thead>
                <tr className="border-b border-[#e2dfd8] bg-[#fafaf7]">
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-[0.07em] text-[#9b9189]">
                    {pick("섹션", "Section")}
                  </th>
                  {PERM_ACTIONS.map((a) => (
                    <th
                      key={a.id}
                      className="px-2 py-2 text-center font-bold uppercase tracking-[0.07em] text-[#9b9189] whitespace-nowrap"
                    >
                      {pick(a.labelKo, a.labelEn)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERM_SECTIONS.map((sec) => (
                  <tr
                    key={sec.id}
                    className="border-b border-[#e2dfd8] last:border-0"
                  >
                    <td className="px-3 py-2 text-[11px] font-medium text-[#1a1917]">
                      {pick(sec.nameKo, sec.nameEn)}
                    </td>
                    {PERM_ACTIONS.map((act) => {
                      const { value, isOverride } = getEffective(
                        user.role,
                        sec.id,
                        act.id,
                        overrides
                      );
                      return (
                        <td key={act.id} className="px-2 py-2 text-center">
                          {isOverride ? (
                            <span
                              className={`inline-flex items-center justify-center rounded px-1 py-0.5 text-[11px] font-bold ${
                                value
                                  ? "bg-[#ecfdf5] text-[#059669]"
                                  : "bg-[#fef2f2] text-[#dc2626]"
                              }`}
                            >
                              {value ? "✓" : "✗"}
                            </span>
                          ) : (
                            <span
                              className={`text-[12px] ${value ? "text-[#059669]" : "text-[#d1c9be]"}`}
                            >
                              {value ? "✓" : "—"}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm bg-[#ecfdf5] ring-1 ring-[#059669]/30" />
                {pick("예외로 허용", "Override · allowed")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm bg-[#fef2f2] ring-1 ring-[#dc2626]/30" />
                {pick("예외로 차단", "Override · blocked")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm bg-white ring-1 ring-[#e2dfd8]" />
                {pick("역할 기본값", "Role default")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-[#1a1917] px-4 py-2.5 text-[12px] font-medium text-white shadow-lg">
          <div className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
          {toast}
        </div>
      )}
    </div>
  );
}
