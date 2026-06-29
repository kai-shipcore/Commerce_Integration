"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { apiPath } from "@/lib/api-path";
import {
  PERM_SECTIONS,
  PERM_ACTIONS,
  PERM_SECTION_GROUP_LABELS,
  PERM_SECTION_ACTIONS,
  MANAGED_ROLES,
  ROLE_LABEL,
  DEFAULT_ROLE_PERMISSIONS,
  blendRolePermissions,
  type ManagedRole,
  type RolePermMatrix,
  type PermSection,
  type PermAction,
} from "@/lib/permissions-config";

// Group sections by their group field, preserving order
const GROUPED_SECTIONS = (() => {
  const map = new Map<string, (typeof PERM_SECTIONS)[number][]>();
  for (const sec of PERM_SECTIONS) {
    const group = sec.group;
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(sec);
  }
  return [...map.entries()].map(([group, sections]) => ({ group, sections }));
})();

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a5cdb]/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-[#1a5cdb]" : "bg-[#d1c9be]"
      }`}
    >
      <span
        className={`pointer-events-none mt-[2px] ml-[2px] block h-[14px] w-[14px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-150 ${
          checked ? "translate-x-[14px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

const ROLE_BADGE: Record<ManagedRole, string> = {
  admin:      "bg-[#1a1917] text-[#fafaf7]",
  dev:        "bg-[#1a1917] text-[#fafaf7]",
  planner:    "bg-[#dbeafe] text-[#1d4ed8]",
  operation:  "bg-[#d1fae5] text-[#065f46]",
  production: "bg-[#fef3c7] text-[#92400e]",
  user:       "bg-[#f3f4f6] text-[#374151]",
};

export function RolePermissionsTab() {
  const { pick } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentRole, setCurrentRole] = useState<ManagedRole>("admin");
  const [savedPerms, setSavedPerms] = useState<Record<ManagedRole, RolePermMatrix>>(
    deepClone(DEFAULT_ROLE_PERMISSIONS)
  );
  const [pendingPerms, setPendingPerms] = useState<Record<ManagedRole, RolePermMatrix>>(
    deepClone(DEFAULT_ROLE_PERMISSIONS)
  );
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const hasChanges =
    JSON.stringify(pendingPerms[currentRole]) !== JSON.stringify(savedPerms[currentRole]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(apiPath("/api/admin/role-permissions"));
        const json = (await res.json()) as { success: boolean; data?: Record<string, unknown> };
        if (json.success && json.data) {
          const loaded = deepClone(DEFAULT_ROLE_PERMISSIONS);
          for (const role of MANAGED_ROLES) {
            const rows = json.data[role];
            if (rows && typeof rows === "object") {
              loaded[role] = rows as RolePermMatrix;
            }
          }
          setSavedPerms(loaded);
          setPendingPerms(deepClone(loaded));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function handleGroupToggle(group: string, action: PermAction, value: boolean) {
    const allGroupSections = GROUPED_SECTIONS.find((g) => g.group === group)?.sections ?? [];
    // Only toggle sections that actually support this action
    const groupSections = allGroupSections.filter((sec) =>
      PERM_SECTION_ACTIONS[sec.id as PermSection].includes(action)
    );
    setPendingPerms((prev) => {
      const updated = { ...prev[currentRole] };
      for (const sec of groupSections) {
        const id = sec.id as PermSection;
        const next = { ...updated[id], [action]: value };
        if (action === "read" && !value) {
          next.create = false;
          next.edit = false;
          next.status = false;
          next.delete = false;
        }
        updated[id] = next;
      }
      return { ...prev, [currentRole]: updated };
    });
  }

  function handleToggle(section: PermSection, action: PermAction, value: boolean) {
    setPendingPerms((prev) => {
      const updated = { ...prev[currentRole][section], [action]: value };
      // Turning off read disables all other actions
      if (action === "read" && !value) {
        updated.create = false;
        updated.edit = false;
        updated.status = false;
        updated.delete = false;
      }
      return {
        ...prev,
        [currentRole]: { ...prev[currentRole], [section]: updated },
      };
    });
  }

  function handleDiscard() {
    setPendingPerms((prev) => ({ ...prev, [currentRole]: deepClone(savedPerms[currentRole]) }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(apiPath("/api/admin/role-permissions"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: currentRole, permissions: pendingPerms[currentRole] }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? "Save failed");
      setSavedPerms((prev) => ({ ...prev, [currentRole]: deepClone(pendingPerms[currentRole]) }));
      setToast({ msg: pick(`${ROLE_LABEL[currentRole]} 권한 저장됨`, `${ROLE_LABEL[currentRole]} permissions saved`), ok: true });
    } catch {
      setPendingPerms((prev) => ({ ...prev, [currentRole]: deepClone(savedPerms[currentRole]) }));
      setToast({ msg: pick("저장 실패", "Save failed"), ok: false });
    } finally {
      setSaving(false);
    }
  }

  function switchRole(role: ManagedRole) {
    if (
      hasChanges &&
      !window.confirm(
        pick("저장하지 않은 변경사항이 있습니다. 다른 역할로 이동하시겠습니까?", "You have unsaved changes. Switch role anyway?")
      )
    )
      return;
    setCurrentRole(role);
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const perms = pendingPerms[currentRole];

  return (
    <div className="space-y-5 p-5">
      {/* Role selector */}
      <div className="flex flex-wrap gap-2">
        {MANAGED_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => switchRole(role)}
            className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[11px] font-bold transition-colors ${
              role === currentRole
                ? "border-[#1a5cdb] bg-[#1a5cdb] text-white"
                : "border-[#ccc7be] bg-white text-[#6b6359] hover:border-[#1a5cdb] hover:text-[#1a5cdb]"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                role === currentRole ? "bg-white/60" : ROLE_BADGE[role].split(" ")[0]
              }`}
            />
            {ROLE_LABEL[role]}
          </button>
        ))}
      </div>

      {/* Matrix card */}
      <div className="overflow-hidden rounded-lg border border-[#e2dfd8] bg-white">
        {/* Card header */}
        <div className="flex items-center justify-between border-b border-[#e2dfd8] bg-[#fafaf7] px-5 py-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${ROLE_BADGE[currentRole]}`}
            >
              {ROLE_LABEL[currentRole]}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#6b6359]">
              {pick("역할 기본 권한", "Role Permissions")}
            </span>
            {hasChanges && (
              <span className="rounded bg-[#e8eefb] px-2 py-0.5 text-[10px] font-semibold text-[#1a5cdb]">
                {pick("변경됨", "Unsaved")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                type="button"
                onClick={handleDiscard}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[#6b6359] transition-colors hover:text-[#1a1917]"
              >
                <RotateCcw className="h-3 w-3" />
                {pick("되돌리기", "Discard")}
              </button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={!hasChanges || saving}
              onClick={() => void handleSave()}
              className="h-8 gap-1.5 text-[11px] font-bold"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              {pick("저장", "Save changes")}
            </Button>
          </div>
        </div>

        {/* Grid */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-[#e2dfd8] bg-[#fafaf7]">
                <th className="w-[220px] px-5 py-2.5 text-left text-[9px] font-bold uppercase tracking-[0.08em] text-[#9b9189]">
                  {pick("섹션", "Section")}
                </th>
                {PERM_ACTIONS.map((act) => (
                  <th
                    key={act.id}
                    className="px-4 py-2.5 text-center text-[9px] font-bold uppercase tracking-[0.08em] text-[#9b9189] whitespace-nowrap"
                  >
                    {pick(act.labelKo, act.labelEn)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPED_SECTIONS.map(({ group, sections }) => (
                <>
                  <tr key={`group-${group}`} className="border-b border-[#e2dfd8] bg-[#f0ede8]">
                    <td className="px-5 py-2 text-[9px] font-bold uppercase tracking-[0.08em] text-[#6b6359]">
                      {pick(PERM_SECTION_GROUP_LABELS[group].ko, PERM_SECTION_GROUP_LABELS[group].en)}
                    </td>
                    {PERM_ACTIONS.map((act) => {
                      const supported = sections.filter((sec) =>
                        PERM_SECTION_ACTIONS[sec.id as PermSection].includes(act.id)
                      );
                      if (supported.length === 0) {
                        return (
                          <td key={act.id} className="px-4 py-2 text-center">
                            <span className="text-[13px] text-[#d6d3cc]">—</span>
                          </td>
                        );
                      }
                      const allOn = supported.every(
                        (sec) => perms[sec.id as PermSection][act.id as PermAction]
                      );
                      return (
                        <td key={act.id} className="px-4 py-2 text-center">
                          <div className="flex justify-center">
                            <Toggle
                              checked={allOn}
                              onChange={(v) => handleGroupToggle(group, act.id as PermAction, v)}
                              disabled={saving}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  {sections.map((sec, idx) => (
                    <tr
                      key={sec.id}
                      className={`border-b border-[#e2dfd8] transition-colors hover:bg-[#fafaf7] ${idx === sections.length - 1 ? "border-b-2 border-[#d6d3cc]" : ""}`}
                    >
                      <td className="px-5 py-3">
                        <div className="text-[12px] font-semibold text-[#1a1917]">
                          {pick(sec.nameKo, sec.nameEn)}
                        </div>
                      </td>
                      {PERM_ACTIONS.map((act) => {
                        const supported = PERM_SECTION_ACTIONS[sec.id as PermSection].includes(act.id);
                        return (
                          <td key={act.id} className="px-4 py-3 text-center">
                            <div className="flex justify-center">
                              {supported ? (
                                <Toggle
                                  checked={perms[sec.id as PermSection][act.id as PermAction]}
                                  onChange={(v) =>
                                    handleToggle(sec.id as PermSection, act.id as PermAction, v)
                                  }
                                  disabled={saving}
                                />
                              ) : (
                                <span className="text-[13px] text-[#d6d3cc]">—</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-[12px] font-medium text-white shadow-lg transition-all ${
            toast.ok ? "bg-[#1a1917]" : "bg-red-700"
          }`}
        >
          <div className={`h-1.5 w-1.5 rounded-full ${toast.ok ? "bg-[#34d399]" : "bg-red-300"}`} />
          {toast.msg}
        </div>
      )}
    </div>
  );
}
