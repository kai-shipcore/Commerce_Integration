"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KeyRound, Loader2, Pencil, Trash2 } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

type TokenStatus = "valid" | "expiring_soon" | "expired" | "none";

interface UserCredentialRow {
  userId: string;
  name: string | null;
  userEmail: string;
  role: string;
  shipHeroEmail: string | null;
  passwordSet: boolean;
  tokenExpiresAt: string | null;
  tokenStatus: TokenStatus;
  updatedAt: string | null;
}

const ROLE_BADGE_CLASS: Record<string, string> = {
  admin:      "bg-[#1a1917] text-[#fafaf7]",
  dev:        "bg-[#1a1917] text-[#fafaf7]",
  planner:    "bg-[#dbeafe] text-[#1d4ed8]",
  operation:  "bg-[#d1fae5] text-[#065f46]",
  production: "bg-[#fef3c7] text-[#92400e]",
  user:       "bg-[#f3f4f6] text-[#374151]",
  guest:      "bg-[#f3f4f6] text-[#374151]",
};

export function ShipHeroCredentialsForm() {
  const { pick } = useI18n();
  const [rows, setRows] = useState<UserCredentialRow[] | null>(null);
  const [editTarget, setEditTarget] = useState<UserCredentialRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shEmail, setShEmail] = useState("");
  const [shPassword, setShPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserCredentialRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const tokenStatusConfig: Record<TokenStatus, { label: string; className: string }> = {
    valid:         { label: pick("유효", "Valid"),       className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400" },
    expiring_soon: { label: pick("만료 임박", "Expiring"), className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400" },
    expired:       { label: pick("만료됨", "Expired"),   className: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400" },
    none:          { label: "—",                         className: "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800" },
  };

  const loadData = useCallback(() => {
    fetch(apiPath("/api/admin/shiphero-credentials"))
      .then((r) => r.json())
      .then((json: { success: boolean; data: UserCredentialRow[] }) => {
        setRows(json.data ?? []);
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function openEdit(row: UserCredentialRow) {
    setEditTarget(row);
    setShEmail(row.shipHeroEmail ?? "");
    setShPassword("");
    setSaveError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!editTarget) return;
    setSaveError(null);
    setSaving(true);
    try {
      const res = await fetch(apiPath("/api/admin/shiphero-credentials"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: editTarget.userId, email: shEmail, password: shPassword }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) throw new Error(json.error ?? pick("저장에 실패했습니다.", "Save failed"));
      setDialogOpen(false);
      loadData();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : pick("저장에 실패했습니다.", "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: UserCredentialRow) {
    setDeleting(true);
    try {
      const res = await fetch(apiPath("/api/admin/shiphero-credentials"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) throw new Error(json.error ?? pick("삭제에 실패했습니다.", "Delete failed"));
      setDeleteTarget(null);
      loadData();
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="relative left-1/2 flex min-h-[calc(100vh-7rem)] w-[min(1600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950">

      {/* Page header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-2">
          <KeyRound className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">ShipHero {pick("자격 증명", "Credentials")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {pick(
                "사용자별 ShipHero 로그인 자격 증명을 관리합니다. 저장된 자격 증명은 ShipHero API 호출(주문 생성)에 사용됩니다.",
                "Manage ShipHero login credentials per user. Used to authenticate ShipHero API calls (order creation)."
              )}
            </p>
          </div>
        </div>
        {rows !== null && (
          <Badge variant="secondary">{rows.length.toLocaleString()} {pick("명", "users")}</Badge>
        )}
      </header>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-slate-950">
        {rows === null ? (
          <div className="flex min-h-[300px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
            {pick("사용자 데이터가 없습니다.", "No users found.")}
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-[#f8f7f4] dark:bg-slate-900">
              <TableRow>
                <TableHead>{pick("사용자", "User")}</TableHead>
                <TableHead>{pick("역할", "Role")}</TableHead>
                <TableHead>ShipHero {pick("이메일", "Email")}</TableHead>
                <TableHead>{pick("비밀번호", "Password")}</TableHead>
                <TableHead>{pick("토큰", "Token")}</TableHead>
                <TableHead>{pick("최종 수정", "Last Updated")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const tokenCfg = tokenStatusConfig[row.tokenStatus];
                return (
                  <TableRow key={row.userId}>
                    {/* User: avatar + name + email */}
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8e5df] text-[11px] font-bold text-[#6b6359] dark:bg-slate-700 dark:text-slate-300">
                          {(row.name ?? row.userEmail).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium leading-tight">{row.name ?? row.userEmail}</div>
                          {row.name && (
                            <div className="text-[11px] text-muted-foreground">{row.userEmail}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    {/* Role badge */}
                    <TableCell>
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] ${ROLE_BADGE_CLASS[row.role] ?? ROLE_BADGE_CLASS.user}`}>
                        {row.role}
                      </span>
                    </TableCell>
                    {/* ShipHero email */}
                    <TableCell className="text-[13px]">
                      {row.shipHeroEmail ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    {/* Password status */}
                    <TableCell>
                      <span className={`text-xs font-medium ${row.passwordSet ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {row.passwordSet ? pick("설정됨", "Set") : "—"}
                      </span>
                    </TableCell>
                    {/* Token status */}
                    <TableCell>
                      <Badge variant="outline" className={`text-[11px] ${tokenCfg.className}`}>
                        {tokenCfg.label}
                      </Badge>
                    </TableCell>
                    {/* Last updated */}
                    <TableCell className="tabular-nums text-xs text-muted-foreground">
                      {row.updatedAt
                        ? new Date(row.updatedAt).toLocaleDateString(pick("ko-KR", "en-US"))
                        : "—"}
                    </TableCell>
                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(row)}
                          title={pick("수정", "Edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {row.shipHeroEmail && (
                          deleteTarget?.userId === row.userId ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="destructive"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => void handleDelete(row)}
                                disabled={deleting}
                              >
                                {deleting
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : pick("확인", "Confirm")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => setDeleteTarget(null)}
                                disabled={deleting}
                              >
                                {pick("취소", "Cancel")}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(row)}
                              title={pick("삭제", "Delete")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Edit / Set Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {editTarget?.shipHeroEmail
                ? pick("ShipHero 자격 증명 수정", "Edit ShipHero Credentials")
                : pick("ShipHero 자격 증명 등록", "Set ShipHero Credentials")}
            </DialogTitle>
            {editTarget && (
              <p className="text-sm text-muted-foreground">
                {editTarget.name ?? editTarget.userEmail}
              </p>
            )}
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="sh-email">ShipHero {pick("이메일", "Email")}</Label>
              <Input
                id="sh-email"
                type="email"
                value={shEmail}
                onChange={(e) => setShEmail(e.target.value)}
                placeholder="shiphero@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sh-password">{pick("비밀번호", "Password")}</Label>
              <Input
                id="sh-password"
                type="password"
                value={shPassword}
                onChange={(e) => setShPassword(e.target.value)}
                placeholder={editTarget?.passwordSet ? "••••••••" : pick("비밀번호 입력", "Enter password")}
              />
              {editTarget?.passwordSet && (
                <p className="text-[11px] text-muted-foreground">
                  {pick("비워두면 기존 비밀번호를 유지합니다.", "Leave blank to keep existing password.")}
                </p>
              )}
            </div>
          </div>

          {saveError && (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {pick("취소", "Cancel")}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !shEmail.trim()}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {pick("저장 중…", "Saving…")}
                </>
              ) : pick("저장", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
