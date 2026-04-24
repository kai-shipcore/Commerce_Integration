"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  getDefaultVisibleMenuIds,
  navigationItems,
  sanitizeVisibleMenuIds,
} from "@/components/layout/navigation-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Search, ShieldAlert } from "lucide-react";

interface ManagedUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  menuVisibility: string[];
  createdAt: string;
  updatedAt: string;
}

export default function UserAccessPage() {
  const { data: session, status } = useSession();
  const isElevatedRole = (role: string) => role === "admin" || role === "dev";
  const configurableMenus = useMemo(
    () => navigationItems.filter((item) => item.hideable !== false && !item.adminOnly),
    []
  );
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    const loadUsers = async () => {
      if (status === "loading") {
        return;
      }

      if (status !== "authenticated") {
        setError("Sign in required");
        setLoading(false);
        return;
      }

      if (session?.user?.role !== "admin") {
        setError("Admin access required");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch("/api/admin/users", {
          cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Failed to load users");
        }

        const nextUsers = result.data?.users ?? [];
        setUsers(nextUsers);
        setSelectedUserId((current) => current ?? nextUsers[0]?.id ?? null);
        setError(null);
      } catch (fetchError: any) {
        setError(fetchError.message);
      } finally {
        setLoading(false);
      }
    };

    void loadUsers();
  }, [session?.user?.role, status]);

  const filteredUsers = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();

    if (!normalized) {
      return users;
    }

    return users.filter((user) => {
      const name = user.name?.toLowerCase() || "";
      return (
        user.id.toLowerCase().includes(normalized) ||
        user.email.toLowerCase().includes(normalized) ||
        user.role.toLowerCase().includes(normalized) ||
        name.includes(normalized)
      );
    });
  }, [searchTerm, users]);

  const selectedUser =
    filteredUsers.find((user) => user.id === selectedUserId) ||
    users.find((user) => user.id === selectedUserId) ||
    filteredUsers[0] ||
    null;

  useEffect(() => {
    if (!selectedUserId && filteredUsers.length > 0) {
      setSelectedUserId(filteredUsers[0].id);
      return;
    }

    if (selectedUserId && filteredUsers.length > 0) {
      const existsInFiltered = filteredUsers.some((user) => user.id === selectedUserId);
      if (!existsInFiltered) {
        setSelectedUserId(filteredUsers[0].id);
      }
    }
  }, [filteredUsers, selectedUserId]);

  const refreshUsers = async () => {
    const reloadResponse = await fetch("/api/admin/users", { cache: "no-store" });
    const reloadResult = await reloadResponse.json();
    if (reloadResponse.ok && reloadResult.success) {
      setUsers(reloadResult.data?.users ?? []);
    }
  };

  const updateUserMenus = async (userId: string, nextVisibleMenuIds: string[]) => {
    const targetUser = users.find((user) => user.id === userId);
    const sanitized = sanitizeVisibleMenuIds(nextVisibleMenuIds, targetUser?.role);

    setSavingUserId(userId);
    setError(null);
    setUsers((current) =>
      current.map((user) =>
        user.id === userId ? { ...user, menuVisibility: sanitized } : user
      )
    );

    try {
      const response = await fetch(`/api/admin/users/${userId}/menu`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibleMenuIds: sanitized }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to update user access");
      }

      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? {
                ...user,
                menuVisibility: sanitizeVisibleMenuIds(result.data?.menuVisibility, user.role),
                updatedAt: result.data?.updatedAt ?? user.updatedAt,
              }
            : user
        )
      );
    } catch (saveError: any) {
      setError(saveError.message);
      await refreshUsers();
    } finally {
      setSavingUserId(null);
    }
  };

  const updateUserRole = async (
    userId: string,
    nextRole: "user" | "admin" | "dev"
  ) => {
    setSavingUserId(userId);
    setError(null);
    setUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, role: nextRole } : user))
    );

    try {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to update user role");
      }

      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? {
                ...user,
                role: result.data?.role ?? user.role,
                updatedAt: result.data?.updatedAt ?? user.updatedAt,
              }
            : user
        )
      );
    } catch (saveError: any) {
      setError(saveError.message);
      await refreshUsers();
    } finally {
      setSavingUserId(null);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[300px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (session?.user?.role !== "admin") {
    return (
      <AppLayout>
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            Only administrators can view and update user menu access.
          </AlertDescription>
        </Alert>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Access</h1>
          <p className="text-muted-foreground">
            Review users in the list, then open one user to manage role and menu access.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <Card>
            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <CardTitle>User List</CardTitle>
                <Badge variant="secondary">{filteredUsers.length} users</Badge>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by id, email, name, or role"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                        No users match your search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow
                        key={user.id}
                        className="cursor-pointer"
                        data-state={selectedUser?.id === user.id ? "selected" : undefined}
                        onClick={() => setSelectedUserId(user.id)}
                      >
                        <TableCell className="max-w-[220px] truncate font-medium">
                          {user.id}
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate">
                          {user.email}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              isElevatedRole(user.role) ? "default" : "secondary"
                            }
                          >
                            {user.role}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle>
                  {selectedUser ? selectedUser.name?.trim() || selectedUser.email : "User Details"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {selectedUser
                    ? selectedUser.email
                    : "Select a user from the list to view and update access."}
                </p>
              </div>
              {selectedUser && (
                <div className="flex items-center gap-2">
                  <div className="min-w-[140px]">
                    <Select
                      value={selectedUser.role}
                      disabled={
                        savingUserId === selectedUser.id || session?.user?.id === selectedUser.id
                      }
                      onValueChange={(value: "user" | "admin" | "dev") => {
                        void updateUserRole(selectedUser.id, value);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">user</SelectItem>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="dev">dev</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Badge
                    variant={
                      isElevatedRole(selectedUser.role) ? "default" : "secondary"
                    }
                  >
                    {selectedUser.role}
                  </Badge>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedUser ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Select a user from the list to manage detailed permissions.
                </div>
              ) : (
                <>
                  {savingUserId === selectedUser.id && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving changes
                    </div>
                  )}

                  <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
                    <div>
                      <p className="font-medium">User ID</p>
                      <p className="break-all text-muted-foreground">{selectedUser.id}</p>
                    </div>
                    <div>
                      <p className="font-medium">Role</p>
                      <p className="text-muted-foreground">{selectedUser.role}</p>
                    </div>
                    <div>
                      <p className="font-medium">Email</p>
                      <p className="break-all text-muted-foreground">{selectedUser.email}</p>
                    </div>
                    <div>
                      <p className="font-medium">Name</p>
                      <p className="text-muted-foreground">
                        {selectedUser.name?.trim() || "-"}
                      </p>
                    </div>
                  </div>

                  {session?.user?.id === selectedUser.id && (
                    <Alert>
                      <AlertDescription>
                        Your own administrator role is locked to avoid removing the last active admin session.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-3">
                    <div>
                      <h2 className="text-sm font-medium">Menu Permissions</h2>
                      <p className="text-sm text-muted-foreground">
                        Choose which top navigation menus this user can access.
                      </p>
                    </div>

                    <div className="grid gap-3">
                      {configurableMenus.map((item) => {
                        const checked = selectedUser.menuVisibility.includes(item.id);
                        const disabled = savingUserId === selectedUser.id;

                        return (
                          <div
                            key={`${selectedUser.id}-${item.id}`}
                            className="flex items-center justify-between rounded-lg border p-4"
                          >
                            <div className="space-y-1">
                              <Label
                                htmlFor={`${selectedUser.id}-${item.id}`}
                                className="text-sm font-medium"
                              >
                                {item.name}
                              </Label>
                              <p className="text-sm text-muted-foreground">{item.href}</p>
                            </div>
                            <Checkbox
                              id={`${selectedUser.id}-${item.id}`}
                              checked={checked}
                              disabled={disabled}
                              onCheckedChange={(value) => {
                                const nextValue =
                                  value === true
                                    ? [...selectedUser.menuVisibility, item.id]
                                    : selectedUser.menuVisibility.filter(
                                        (menuId) => menuId !== item.id
                                      );
                                void updateUserMenus(selectedUser.id, nextValue);
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={savingUserId === selectedUser.id}
                        onClick={() =>
                          void updateUserMenus(
                            selectedUser.id,
                            getDefaultVisibleMenuIds(selectedUser.role)
                          )
                        }
                      >
                        Reset Default
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
