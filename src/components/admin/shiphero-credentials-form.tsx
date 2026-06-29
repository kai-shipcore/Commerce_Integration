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
import { Pencil, Trash2 } from "lucide-react";
import { apiPath } from "@/lib/api-path";

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

const STATUS_BADGE: Record<TokenStatus, { label: string; className: string }> = {
  valid:         { label: "Valid",          className: "bg-green-50 text-green-700 border-green-200" },
  expiring_soon: { label: "Expiring Soon",  className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  expired:       { label: "Expired",        className: "bg-red-50 text-red-700 border-red-200" },
  none:          { label: "—",              className: "bg-gray-50 text-gray-400 border-gray-200" },
};

export function ShipHeroCredentialsForm() {
  const [rows, setRows] = useState<UserCredentialRow[] | null>(null);
  const [editTarget, setEditTarget] = useState<UserCredentialRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [shEmail, setShEmail] = useState("");
  const [shPassword, setShPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<UserCredentialRow | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      if (!json.success) throw new Error(json.error ?? "Save failed");
      setDialogOpen(false);
      loadData();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
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
      if (!json.success) throw new Error(json.error ?? "Delete failed");
      setDeleteTarget(null);
      loadData();
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  }

  if (rows === null) {
    return <div style={{ padding: 32, color: "#7A766F", fontSize: 14 }}>Loading…</div>;
  }

  return (
    <div style={{ padding: "24px 32px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1A1917", margin: 0 }}>
          ShipHero Credentials
        </h1>
        <p style={{ fontSize: 13, color: "#7A766F", marginTop: 4 }}>
          Manage ShipHero login credentials per user. Stored credentials are used to authenticate ShipHero API calls (order creation).
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>ShipHero Email</TableHead>
            <TableHead>Password</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Last Updated</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const badge = STATUS_BADGE[row.tokenStatus];
            return (
              <TableRow key={row.userId}>
                <TableCell>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{row.name ?? row.userEmail}</div>
                  {row.name && (
                    <div style={{ fontSize: 11, color: "#9A9790" }}>{row.userEmail}</div>
                  )}
                </TableCell>
                <TableCell>
                  <span style={{ fontSize: 12, color: "#7A766F" }}>{row.role}</span>
                </TableCell>
                <TableCell>
                  <span style={{ fontSize: 13 }}>{row.shipHeroEmail ?? <span style={{ color: "#C0BAB4" }}>—</span>}</span>
                </TableCell>
                <TableCell>
                  <span style={{ fontSize: 12, color: row.passwordSet ? "#3D9A5A" : "#C0BAB4" }}>
                    {row.passwordSet ? "Set" : "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={badge.className} style={{ fontSize: 11 }}>
                    {badge.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span style={{ fontSize: 11, color: "#9A9790" }}>
                    {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      variant="ghost"
                      size="icon"
                      style={{ height: 28, width: 28 }}
                      onClick={() => openEdit(row)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {row.shipHeroEmail && (
                      deleteTarget?.userId === row.userId ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <Button
                            variant="destructive"
                            size="sm"
                            style={{ height: 26, fontSize: 11, padding: "0 8px" }}
                            onClick={() => void handleDelete(row)}
                            disabled={deleting}
                          >
                            {deleting ? "…" : "Confirm"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            style={{ height: 26, fontSize: 11, padding: "0 6px" }}
                            onClick={() => setDeleteTarget(null)}
                            disabled={deleting}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          style={{ height: 28, width: 28, color: "#c0392b" }}
                          onClick={() => setDeleteTarget(row)}
                          title="Delete"
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

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent style={{ maxWidth: 420 }}>
          <DialogHeader>
            <DialogTitle style={{ fontSize: 15 }}>
              {editTarget?.shipHeroEmail ? "Edit" : "Set"} ShipHero Credentials
            </DialogTitle>
            {editTarget && (
              <p style={{ fontSize: 12, color: "#7A766F", marginTop: 2 }}>
                {editTarget.name ?? editTarget.userEmail}
              </p>
            )}
          </DialogHeader>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "8px 0" }}>
            <div>
              <Label htmlFor="sh-email" style={{ fontSize: 12, color: "#7A766F" }}>ShipHero Email</Label>
              <Input
                id="sh-email"
                type="email"
                value={shEmail}
                onChange={(e) => setShEmail(e.target.value)}
                placeholder="shiphero@example.com"
                style={{ marginTop: 4, fontSize: 13 }}
              />
            </div>
            <div>
              <Label htmlFor="sh-password" style={{ fontSize: 12, color: "#7A766F" }}>Password</Label>
              <Input
                id="sh-password"
                type="password"
                value={shPassword}
                onChange={(e) => setShPassword(e.target.value)}
                placeholder={editTarget?.passwordSet ? "••••••••" : "Enter password"}
                style={{ marginTop: 4, fontSize: 13 }}
              />
              {editTarget?.passwordSet && (
                <p style={{ fontSize: 11, color: "#9A9790", marginTop: 4 }}>
                  Leave blank to keep existing password.
                </p>
              )}
            </div>
          </div>

          {saveError && (
            <Alert variant="destructive">
              <AlertDescription style={{ fontSize: 13 }}>{saveError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !shEmail.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
