"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { AppLayout } from "@/components/layout/app-layout";
import {
  isAdminLikeRole,
  navigationItems,
} from "@/components/layout/navigation-config";
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
import { apiPath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { RolePermissionsTab } from "@/components/settings/role-permissions-tab";
import { UserExceptionsTab } from "@/components/settings/user-exceptions-tab";

type SettingsTab = "menu" | "role-permissions" | "exceptions";

interface ManagedUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  menuVisibility: string[];
  authProviders: string[];
  hasGoogleAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface PermOverride {
  section: string;
  action: string;
  allowed: boolean;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}


export default function UserAccessPage() {
  const { pick } = useI18n();
  const { data: session, status } = useSession();
  const { can, ready: permissionsReady } = usePermissions();
  const [activeTab, setActiveTab] = useState<SettingsTab>("menu");

  const isElevatedRole = (role: string) =>
    role === "admin" || role === "dev" || role === "planner" || role === "operation" || role === "production";


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
      if (status === "loading") return;
      if (status !== "authenticated") {
        setError(pick("로그인이 필요합니다.", "Sign in required"));
        setLoading(false);
        return;
      }
      if (!permissionsReady) return;
      if (!isAdminLikeRole(session?.user?.role) && !can("user-permissions", "read")) {
        setError(pick("사용자 권한 조회 권한이 필요합니다.", "User Permissions view access required"));
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
        const response = await fetch(apiPath(`/api/admin/users?${params.toString()}`), { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || pick("사용자 목록을 불러오지 못했습니다.", "Failed to load users"));
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
  }, [can, debouncedSearchTerm, roleFilter, pagination.limit, pagination.page, permissionsReady, pick, session?.user?.role, status]);

  const selectedUser = users.find((user) => user.id === selectedUserId) || users[0] || null;

  const refreshUsers = async () => {
    const params = new URLSearchParams({ page: String(pagination.page), limit: String(pagination.limit) });
    if (debouncedSearchTerm) params.set("search", debouncedSearchTerm);
    if (roleFilter) params.set("role", roleFilter);
    const reloadResponse = await fetch(apiPath(`/api/admin/users?${params.toString()}`), { cache: "no-store" });
    const reloadResult = await reloadResponse.json();
    if (reloadResponse.ok && reloadResult.success) {
      setUsers(reloadResult.data?.users ?? []);
      setPagination(reloadResult.data?.pagination ?? pagination);
    }
  };

  const updateUserRole = async (
    userId: string,
    nextRole: "user" | "admin" | "dev" | "planner" | "operation" | "production"
  ) => {
    setSavingUserId(userId);
    setError(null);
    setUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, role: nextRole } : user))
    );
    try {
      const response = await fetch(apiPath(`/api/admin/users/${userId}/role`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || pick("사용자 역할 수정에 실패했습니다.", "Failed to update user role"));
      }
      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? { ...user, role: result.data?.role ?? user.role, updatedAt: result.data?.updatedAt ?? user.updatedAt }
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

  if (!isAdminLikeRole(session?.user?.role) && !can("user-permissions", "read")) {
    return (
      <AppLayout>
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            {pick(
              "사용자 권한 조회 권한이 필요합니다.",
              "User Permissions view access required."
            )}
          </AlertDescription>
        </Alert>
      </AppLayout>
    );
  }

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "menu",             label: pick("사용자 관리", "Users") },
    { id: "role-permissions", label: pick("역할 권한",  "Role Permissions") },
    { id: "exceptions",       label: pick("사용자 예외", "User Exceptions") },
  ];

  const showUserList = activeTab === "menu" || activeTab === "exceptions";

  return (
    <AppLayout>
      <section className="relative left-1/2 flex min-h-[calc(100vh-7rem)] w-[min(1600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950">

        {/* Page header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-1 h-5 w-5" />
            <div>
              <h1 className="text-lg font-semibold">{pick("사용자 권한", "User Access")}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {pick(
                  "메뉴 표시 권한, 역할별 기능 권한, 사용자별 예외 권한을 관리합니다.",
                  "Manage menu visibility, role-based feature permissions, and per-user exceptions."
                )}
              </p>
            </div>
          </div>
          <Badge variant="secondary">{pagination.total.toLocaleString()} {pick("명", "users")}</Badge>
        </header>

        {/* Tab bar */}
        <div className="flex border-b border-[#e2dfd8] bg-white px-5 dark:border-slate-700 dark:bg-slate-900">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-5 py-3 text-[12px] font-semibold transition-colors ${
                activeTab === tab.id
                  ? "border-[#1a5cdb] text-[#1a5cdb]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <Alert variant="destructive" className="m-5 mb-0">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Tab 2: Role Permissions — full width */}
        {activeTab === "role-permissions" && (
          <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-slate-950">
            <RolePermissionsTab />
          </div>
        )}

        {/* Tabs 1 & 3: Two-panel layout with shared user list */}
        {showUserList && (
          <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(400px,0.85fr)]">

            {/* Left panel: user list (shared) */}
            <div className="flex min-h-[560px] flex-col border-b border-[#e2dfd8] bg-white dark:border-slate-700 dark:bg-slate-950 xl:min-h-0 xl:border-b-0 xl:border-r xl:border-[#e2dfd8] xl:dark:border-slate-700">
              <div className="space-y-4 border-b border-[#e2dfd8] px-5 py-4 dark:border-slate-700">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-sm font-semibold">{pick("사용자 목록", "User List")}</h2>
                  <span className="text-xs text-muted-foreground">
                    {pick("페이지", "Page")} {pagination.total === 0 ? 0 : pagination.page} / {pagination.total === 0 ? 0 : pagination.totalPages}
                  </span>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder={pick("이메일 또는 이름 검색", "Search by email or name")}
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
                    <option value="">{pick("전체 역할", "All Roles")}</option>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="dev">dev</option>
                    <option value="planner">planner</option>
                    <option value="operation">operation</option>
                    <option value="production">production</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2dfd8] pt-4 text-sm text-muted-foreground dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span>{pick("행", "Rows")}</span>
                    <select
                      value={pagination.limit}
                      onChange={(event) =>
                        setPagination((current) => ({ ...current, page: 1, limit: Number(event.target.value) }))
                      }
                      className="h-8 rounded-md border bg-background px-2 text-foreground dark:border-slate-700 dark:bg-slate-950"
                    >
                      {[10, 20, 50].map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>
                  <span>
                    {pick("페이지", "Page")} {pagination.total === 0 ? 0 : pagination.page} {pick("/", "of")} {pagination.total === 0 ? 0 : pagination.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pagination.page <= 1 || loading}
                      onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))}
                    >
                      {pick("이전", "Previous")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pagination.page >= pagination.totalPages || pagination.total === 0 || loading}
                      onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))}
                    >
                      {pick("다음", "Next")}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 p-5">
                <div className="h-full overflow-y-auto rounded-md border border-[#e2dfd8] dark:border-slate-700">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-[#f8f7f4] dark:bg-slate-900">
                      <TableRow>
                        <TableHead>{pick("이메일", "Email")}</TableHead>
                        <TableHead>{pick("이름", "Name")}</TableHead>
                        <TableHead>{pick("역할", "Role")}</TableHead>
                        <TableHead>{pick("인증", "Auth")}</TableHead>
                        <TableHead className="pr-5 text-right">{pick("가입일", "Joined")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                            {pick("검색 결과가 없습니다.", "No users match your search.")}
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
                            <TableCell className="max-w-[240px] truncate font-medium">{user.email}</TableCell>
                            <TableCell className="max-w-[200px] truncate text-muted-foreground">{user.name ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant={isElevatedRole(user.role) ? "default" : "secondary"}>
                                {user.role}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {user.hasGoogleAccount ? (
                                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                                  Google
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">{pick("비밀번호", "Password")}</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap pr-5 text-right tabular-nums text-muted-foreground">
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

            {/* Right panel */}
            <div className="flex min-h-0 flex-col bg-white dark:bg-slate-950">

              {/* Tab 1: Menu Permissions */}
              {activeTab === "menu" && (
                <>
                  <div className="flex flex-col gap-3 border-b border-[#e2dfd8] px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold">
                        {selectedUser ? selectedUser.name?.trim() || selectedUser.email : pick("사용자 상세", "User Details")}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedUser
                          ? selectedUser.email
                          : pick("목록에서 사용자를 선택하여 접근 권한을 조회하고 수정하세요.", "Select a user from the list to view and update access.")}
                      </p>
                    </div>
                    {selectedUser && (
                      <div className="flex items-center gap-2">
                        <div className="min-w-[140px]">
                          <Select
                            value={selectedUser.role}
                            disabled={savingUserId === selectedUser.id || session?.user?.id === selectedUser.id}
                            onValueChange={(value: "user" | "admin" | "dev" | "planner" | "operation" | "production") => {
                              void updateUserRole(selectedUser.id, value);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={pick("역할 선택", "Select role")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">user</SelectItem>
                              <SelectItem value="admin">admin</SelectItem>
                              <SelectItem value="dev">dev</SelectItem>
                              <SelectItem value="planner">planner</SelectItem>
                              <SelectItem value="operation">operation</SelectItem>
                              <SelectItem value="production">production</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Badge variant={isElevatedRole(selectedUser.role) ? "default" : "secondary"}>
                          {selectedUser.role}
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                    {!selectedUser ? (
                      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground dark:border-slate-700">
                        {pick("목록에서 사용자를 선택하여 상세 권한을 관리하세요.", "Select a user from the list to manage detailed permissions.")}
                      </div>
                    ) : (
                      <>
                        {savingUserId === selectedUser.id && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {pick("저장 중...", "Saving changes")}
                          </div>
                        )}

                        <div className="grid gap-3 rounded-lg border p-4 text-sm dark:border-slate-700 sm:grid-cols-2">
                          <div>
                            <p className="font-medium">{pick("사용자 ID", "User ID")}</p>
                            <p className="break-all text-muted-foreground">{selectedUser.id}</p>
                          </div>
                          <div>
                            <p className="font-medium">{pick("역할", "Role")}</p>
                            <p className="text-muted-foreground">{selectedUser.role}</p>
                          </div>
                          <div>
                            <p className="font-medium">{pick("이메일", "Email")}</p>
                            <p className="break-all text-muted-foreground">{selectedUser.email}</p>
                          </div>
                          <div>
                            <p className="font-medium">{pick("이름", "Name")}</p>
                            <p className="text-muted-foreground">{selectedUser.name?.trim() || "-"}</p>
                          </div>
                          <div>
                            <p className="font-medium">{pick("인증", "Auth")}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {selectedUser.hasGoogleAccount ? (
                                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                                  Google
                                </Badge>
                              ) : null}
                              {selectedUser.authProviders.length === 0 ? (
                                <Badge variant="secondary">{pick("비밀번호", "Password")}</Badge>
                              ) : (
                                selectedUser.authProviders
                                  .filter((provider) => provider !== "google")
                                  .map((provider) => (
                                    <Badge key={provider} variant="secondary">{provider}</Badge>
                                  ))
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="font-medium">Joined</p>
                            <p className="text-muted-foreground">{formatJoinedDate(selectedUser.createdAt)}</p>
                          </div>
                        </div>

                        {session?.user?.id === selectedUser.id && (
                          <Alert>
                            <AlertDescription>
                              {pick(
                                "마지막 활성 관리자 세션이 사라지는 것을 방지하기 위해 본인의 관리자 역할은 변경할 수 없습니다.",
                                "Your own administrator role is locked to avoid removing the last active admin session."
                              )}
                            </AlertDescription>
                          </Alert>
                        )}

                      </>
                    )}
                  </div>
                </>
              )}

              {/* Tab 3: User Exceptions */}
              {activeTab === "exceptions" && (
                <UserExceptionsTab user={selectedUser} />
              )}
            </div>
          </div>
        )}
      </section>
    </AppLayout>
  );
}

function formatJoinedDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
