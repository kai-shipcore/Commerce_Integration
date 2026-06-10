"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  filterToValidMenuIds,
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  navigationItems,
} from "@/components/layout/navigation-config";
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
import { Loader2, Search, ShieldAlert, ShieldCheck } from "lucide-react";

interface ManagedUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  menuVisibility: string[];
  createdAt: string;
  updatedAt: string;
}

interface UserPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export default function UserAccessPage() {
  const { data: session, status } = useSession();
  const isElevatedRole = (role: string) => role === "admin" || role === "dev" || role === "planner";
  const configurableMenus = useMemo(
    () => navigationItems.filter((item) => item.hideable !== false && !item.adminOnly && !item.hidden),
    []
  );

  const menuGroups = useMemo(() => {
    const groupMap = new Map<string, typeof configurableMenus>();
    for (const item of configurableMenus) {
      const g = item.group ?? "Other";
      if (!groupMap.has(g)) groupMap.set(g, []);
      groupMap.get(g)!.push(item);
    }
    return [...groupMap.entries()].map(([group, items]) => ({ group, items }));
  }, [configurableMenus]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<UserPagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
      setPagination((current) => ({ ...current, page: 1 }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

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

      if (!isAdminLikeRole(session?.user?.role)) {
        setError("Admin access required");
        setLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams({
          page: String(pagination.page),
          limit: String(pagination.limit),
        });
        if (debouncedSearchTerm) params.set("search", debouncedSearchTerm);
        if (roleFilter) params.set("role", roleFilter);
        const response = await fetch(`/api/admin/users?${params.toString()}`, {
          cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Failed to load users");
        }

        const nextUsers = result.data?.users ?? [];
        const nextPagination = result.data?.pagination as UserPagination | undefined;
        setUsers(nextUsers);
        if (nextPagination) setPagination(nextPagination);
        setSelectedUserId((current) =>
          nextUsers.some((user: ManagedUser) => user.id === current)
            ? current
            : nextUsers[0]?.id ?? null
        );
        setError(null);
      } catch (fetchError: unknown) {
        setError(getErrorMessage(fetchError));
      } finally {
        setLoading(false);
      }
    };

    void loadUsers();
  }, [debouncedSearchTerm, roleFilter, pagination.limit, pagination.page, session?.user?.role, status]);

  const selectedUser =
    users.find((user) => user.id === selectedUserId) ||
    users[0] ||
    null;

  const refreshUsers = async () => {
    const params = new URLSearchParams({
      page: String(pagination.page),
      limit: String(pagination.limit),
    });
    if (debouncedSearchTerm) params.set("search", debouncedSearchTerm);
    if (roleFilter) params.set("role", roleFilter);
    const reloadResponse = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
    const reloadResult = await reloadResponse.json();
    if (reloadResponse.ok && reloadResult.success) {
      setUsers(reloadResult.data?.users ?? []);
      setPagination(reloadResult.data?.pagination ?? pagination);
    }
  };

  const updateUserMenus = async (userId: string, nextVisibleMenuIds: string[]) => {
    const sanitized = filterToValidMenuIds(nextVisibleMenuIds);

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
                menuVisibility: filterToValidMenuIds(result.data?.menuVisibility),
                updatedAt: result.data?.updatedAt ?? user.updatedAt,
              }
            : user
        )
      );
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError));
      await refreshUsers();
    } finally {
      setSavingUserId(null);
    }
  };

  const updateUserRole = async (
    userId: string,
    nextRole: "user" | "admin" | "dev" | "planner"
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
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError));
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

  if (!isAdminLikeRole(session?.user?.role)) {
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
      <section className="relative left-1/2 flex min-h-[calc(100vh-7rem)] w-[min(1600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-1 h-5 w-5" />
            <div>
              <h1 className="text-lg font-semibold">User Access</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Review users in the list, then open one user to manage role and menu access.
              </p>
            </div>
          </div>
          <Badge variant="secondary">{pagination.total.toLocaleString()} users</Badge>
        </header>

        {error && (
          <Alert variant="destructive" className="m-5 mb-0">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(400px,0.85fr)]">
          <div className="flex min-h-[560px] flex-col border-b border-[#e2dfd8] bg-white dark:border-slate-700 dark:bg-slate-950 xl:min-h-0 xl:border-b-0 xl:border-r xl:border-[#e2dfd8] xl:dark:border-slate-700">
            <div className="space-y-4 border-b border-[#e2dfd8] px-5 py-4 dark:border-slate-700">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold">User List</h2>
                <span className="text-xs text-muted-foreground">
                  Page {pagination.total === 0 ? 0 : pagination.page} / {pagination.total === 0 ? 0 : pagination.totalPages}
                </span>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search by email or name"
                    className="pl-9"
                  />
                </div>
                <select
                  value={roleFilter}
                  onChange={(event) => {
                    setRoleFilter(event.target.value);
                    setPagination((current) => ({ ...current, page: 1 }));
                  }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">All Roles</option>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                  <option value="dev">dev</option>
                  <option value="planner">planner</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2dfd8] pt-4 text-sm text-muted-foreground dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <span>Rows</span>
                  <select
                    value={pagination.limit}
                    onChange={(event) => setPagination((current) => ({
                      ...current,
                      page: 1,
                      limit: Number(event.target.value),
                    }))}
                    className="h-8 rounded-md border bg-background px-2 text-foreground dark:border-slate-700 dark:bg-slate-950"
                  >
                    {[10, 20, 50].map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </div>
                <span>
                  Page {pagination.total === 0 ? 0 : pagination.page} of {pagination.total === 0 ? 0 : pagination.totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pagination.page <= 1 || loading}
                    onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages || pagination.total === 0 || loading}
                    onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 p-5">
              <div className="h-full overflow-y-auto rounded-md border border-[#e2dfd8] dark:border-slate-700">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-[#f8f7f4] dark:bg-slate-900">
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 ? (
                      <TableRow
                        className="hover:bg-transparent"
                      >
                        <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                          No users match your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((user) => (
                        <TableRow
                          key={user.id}
                          className="cursor-pointer"
                          data-state={selectedUser?.id === user.id ? "selected" : undefined}
                          onClick={() => setSelectedUserId(user.id)}
                        >
                          <TableCell className="max-w-[240px] truncate font-medium">
                            {user.email}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground">
                            {user.name ?? "—"}
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
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatJoinedDate(user.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-white dark:bg-slate-950">
            <div className="flex flex-col gap-3 border-b border-[#e2dfd8] px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">
                  {selectedUser ? selectedUser.name?.trim() || selectedUser.email : "User Details"}
                </h2>
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
                      onValueChange={(value: "user" | "admin" | "dev" | "planner") => {
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
                        <SelectItem value="planner">planner</SelectItem>
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
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {!selectedUser ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground dark:border-slate-700">
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

                  <div className="grid gap-3 rounded-lg border p-4 text-sm dark:border-slate-700 sm:grid-cols-2">
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
                    <div>
                      <p className="font-medium">Joined</p>
                      <p className="text-muted-foreground">
                        {formatJoinedDate(selectedUser.createdAt)}
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

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-medium">Menu Permissions</h2>
                        <p className="text-xs text-muted-foreground">
                          Choose which menus this user can access.
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={savingUserId === selectedUser.id}
                          onClick={() =>
                            void updateUserMenus(
                              selectedUser.id,
                              configurableMenus.map((item) => item.id)
                            )
                          }
                        >
                          Select All
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={savingUserId === selectedUser.id}
                          onClick={() => void updateUserMenus(selectedUser.id, [])}
                        >
                          Deselect All
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
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

                    {menuGroups.map(({ group, items }) => {
                      const groupIds = items.map((item) => item.id);
                      const disabled = savingUserId === selectedUser.id;
                      const allChecked = groupIds.every((id) =>
                        selectedUser.menuVisibility.includes(id)
                      );

                      return (
                        <div key={group} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                              {group}
                            </span>
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                disabled={disabled || allChecked}
                                onClick={() => {
                                  const next = [...new Set([...selectedUser.menuVisibility, ...groupIds])];
                                  void updateUserMenus(selectedUser.id, next);
                                }}
                              >
                                All
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                disabled={disabled || groupIds.every((id) => !selectedUser.menuVisibility.includes(id))}
                                onClick={() => {
                                  const groupIdSet = new Set(groupIds);
                                  const next = selectedUser.menuVisibility.filter((id) => !groupIdSet.has(id));
                                  void updateUserMenus(selectedUser.id, next);
                                }}
                              >
                                None
                              </Button>
                            </div>
                          </div>

                          <div className="grid gap-2">
                            {items.map((item) => {
                              const checked = selectedUser.menuVisibility.includes(item.id);
                              return (
                                <div
                                  key={`${selectedUser.id}-${item.id}`}
                                  className="flex items-center justify-between rounded-lg border px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40"
                                >
                                  <div className="space-y-0.5">
                                    <Label
                                      htmlFor={`${selectedUser.id}-${item.id}`}
                                      className="cursor-pointer text-sm font-medium"
                                    >
                                      {item.name}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">{item.href}</p>
                                  </div>
                                  <Checkbox
                                    id={`${selectedUser.id}-${item.id}`}
                                    checked={checked}
                                    disabled={disabled}
                                    onCheckedChange={(value) => {
                                      const next =
                                        value === true
                                          ? [...selectedUser.menuVisibility, item.id]
                                          : selectedUser.menuVisibility.filter((id) => id !== item.id);
                                      void updateUserMenus(selectedUser.id, next);
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}

function formatJoinedDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
