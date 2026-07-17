"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { AppLayout } from "@/components/layout/app-layout";
import {
  isAdminLikeRole,
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
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Pencil, Search, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { RolePermissionsTab } from "@/components/settings/role-permissions-tab";
import { UserExceptionsTab } from "@/components/settings/user-exceptions-tab";
import { UserActivityTab } from "@/components/settings/user-activity-tab";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SettingsTab = "menu" | "role-permissions" | "exceptions" | "activity";

type UserRole = "user" | "admin" | "dev" | "planner" | "operation" | "production" | "guest";
type SortBy = "email" | "name" | "role" | "createdAt" | "lastLoginAt" | "authProvider";
type LoginFilter = "" | "30d" | "90d" | "never";
type StatusFilter = "" | "active" | "inactive";
type SortDir = "asc" | "desc";

const ROLES: { value: UserRole; descKo: string; descEn: string }[] = [
  { value: "guest",      descKo: "읽기 전용, 제한된 메뉴만 접근",   descEn: "Read-only, limited menu access" },
  { value: "user",       descKo: "일반 사용자, 기본 기능 접근",      descEn: "Standard user, basic features" },
  { value: "planner",    descKo: "컨테이너 계획 · SKU 조회 · 수출", descEn: "Container planning, SKU, export" },
  { value: "operation",  descKo: "운영 관리, 창고·공장 편집",        descEn: "Operations, warehouse & factory edit" },
  { value: "production", descKo: "생산 현황 관리",                   descEn: "Production status management" },
  { value: "admin",      descKo: "모든 설정, 사용자 관리",           descEn: "All settings, user management" },
  { value: "dev",        descKo: "전체 접근 + 개발 기능",            descEn: "Full access + dev features" },
];

interface ManagedUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  menuVisibility: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  authProviders: string[];
  hasGoogleAccount: boolean;
  exceptionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface LoginLogEntry {
  id: string;
  loggedInAt: string;
  ip: string | null;
  userAgent: string | null;
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

function parseBrowserInfo(userAgent: string | null): string {
  if (!userAgent) return "-";
  const ua = userAgent;

  let browser = "Unknown";
  const edge = ua.match(/Edg\/([\d.]+)/);
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  const firefox = ua.match(/Firefox\/([\d.]+)/);
  const safari = ua.match(/Version\/([\d.]+).*Safari/);

  if (edge) browser = `Edge ${majorVersion(edge[1])}`;
  else if (chrome && !ua.includes("Chromium")) browser = `Chrome ${majorVersion(chrome[1])}`;
  else if (firefox) browser = `Firefox ${majorVersion(firefox[1])}`;
  else if (safari && !chrome) browser = `Safari ${majorVersion(safari[1])}`;

  let os = "Unknown OS";
  if (ua.includes("Windows NT 10.0")) os = "Windows 10/11";
  else if (ua.includes("Windows NT")) os = "Windows";
  else if (ua.includes("Mac OS X")) os = "macOS";
  else if (ua.includes("iPhone")) os = "iPhone";
  else if (ua.includes("iPad")) os = "iPad";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("Linux")) os = "Linux";

  return `${browser} / ${os}`;
}

function majorVersion(version: string): string {
  return version.split(".")[0] ?? version;
}


export default function UserAccessPage() {
  const { pick } = useI18n();
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can, ready: permissionsReady } = usePermissions();
  const [activeTab, setActiveTab] = useState<SettingsTab>("menu");
  const requestedUserId = searchParams.get("userId")?.trim() ?? "";

  const isElevatedRole = (role: string) =>
    role === "admin" || role === "dev" || role === "planner" || role === "operation" || role === "production";


  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);
  const [showRoleConfirm, setShowRoleConfirm] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("role");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loginFilter, setLoginFilter] = useState<LoginFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [loginHistory, setLoginHistory] = useState<LoginLogEntry[]>([]);
  const [loginHistoryLoading, setLoginHistoryLoading] = useState(false);
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
    const timer = window.setTimeout(() => {
      setPendingRole(null);
      setLoginHistory([]);
      setEditingName(false);
      setNameDraft("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedUserId || activeTab !== "menu") return;
    const fetchHistory = async () => {
      setLoginHistoryLoading(true);
      try {
        const res = await fetch(apiPath(`/api/admin/users/${selectedUserId}/login-history`), { cache: "no-store" });
        const json = await res.json();
        if (res.ok && json.success) setLoginHistory(json.data ?? []);
      } catch {
        // silently ignore
      } finally {
        setLoginHistoryLoading(false);
      }
    };
    void fetchHistory();
  }, [selectedUserId, activeTab]);

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
          page: requestedUserId ? "1" : String(pagination.page),
          limit: String(pagination.limit),
        });
        if (requestedUserId) {
          params.set("search", requestedUserId);
        } else if (debouncedSearchTerm) {
          params.set("search", debouncedSearchTerm);
        }
        if (!requestedUserId && roleFilter) params.set("role", roleFilter);
        if (!requestedUserId && loginFilter) params.set("loginFilter", loginFilter);
        if (!requestedUserId && statusFilter) params.set("status", statusFilter);
        params.set("sortBy", sortBy);
        params.set("sortDir", sortDir);
        const response = await fetch(apiPath(`/api/admin/users?${params.toString()}`), { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || pick("사용자 목록을 불러오지 못했습니다.", "Failed to load users"));
        }
        const nextUsers = result.data?.users ?? [];
        const nextPagination = result.data?.pagination as UserPagination | undefined;
        setUsers(nextUsers);
        if (nextPagination) setPagination(nextPagination);
        setSelectedUserId((current) => {
          if (requestedUserId && nextUsers.some((user: ManagedUser) => user.id === requestedUserId)) {
            return requestedUserId;
          }
          return nextUsers.some((user: ManagedUser) => user.id === current)
            ? current
            : nextUsers[0]?.id ?? null;
        });
        setError(null);
      } catch (fetchError: unknown) {
        setError(getErrorMessage(fetchError));
      } finally {
        setLoading(false);
      }
    };
    void loadUsers();
  }, [can, debouncedSearchTerm, requestedUserId, roleFilter, loginFilter, statusFilter, sortBy, sortDir, pagination.limit, pagination.page, permissionsReady, pick, session?.user?.role, status]);

  const selectedUser = users.find((user) => user.id === selectedUserId) || users[0] || null;

  const toggleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const refreshUsers = async () => {
    const params = new URLSearchParams({ page: String(pagination.page), limit: String(pagination.limit) });
    if (debouncedSearchTerm) params.set("search", debouncedSearchTerm);
    if (roleFilter) params.set("role", roleFilter);
    if (loginFilter) params.set("loginFilter", loginFilter);
    if (statusFilter) params.set("status", statusFilter);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    const reloadResponse = await fetch(apiPath(`/api/admin/users?${params.toString()}`), { cache: "no-store" });
    const reloadResult = await reloadResponse.json();
    if (reloadResponse.ok && reloadResult.success) {
      setUsers(reloadResult.data?.users ?? []);
      setPagination(reloadResult.data?.pagination ?? pagination);
    }
  };

  const clearFocusedUser = () => {
    setSearchTerm("");
    setDebouncedSearchTerm("");
    setRoleFilter("");
    setLoginFilter("");
    setStatusFilter("");
    setPagination((current) => ({ ...current, page: 1 }));
    router.replace("/settings/users");
  };

  const toggleUserActive = async (userId: string) => {
    setSavingUserId(userId);
    setError(null);
    setUsers((current) =>
      current.map((u) => (u.id === userId ? { ...u, isActive: !u.isActive } : u))
    );
    try {
      const response = await fetch(apiPath(`/api/admin/users/${userId}/status`), {
        method: "PATCH",
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || pick("상태 변경에 실패했습니다.", "Failed to update status"));
      }
      setUsers((current) =>
        current.map((u) =>
          u.id === userId ? { ...u, isActive: result.data?.isActive ?? u.isActive } : u
        )
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      await refreshUsers();
    } finally {
      setSavingUserId(null);
    }
  };

  const updateUserName = async (userId: string, nextName: string) => {
    setSavingUserId(userId);
    setError(null);
    setUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, name: nextName } : user))
    );
    try {
      const response = await fetch(apiPath(`/api/admin/users/${userId}/name`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || pick("이름 수정에 실패했습니다.", "Failed to update name"));
      }
      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? { ...user, name: result.data?.name ?? user.name, updatedAt: result.data?.updatedAt ?? user.updatedAt }
            : user
        )
      );
      setEditingName(false);
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError));
      await refreshUsers();
    } finally {
      setSavingUserId(null);
    }
  };

  const updateUserRole = async (
    userId: string,
    nextRole: "user" | "admin" | "dev" | "planner" | "operation" | "production" | "guest"
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
    { id: "exceptions",       label: pick("사용자 권한", "User Permissions") },
    { id: "activity",         label: pick("사용 현황", "User Activity") },
  ];

  const showUserList = activeTab === "menu" || activeTab === "exceptions";

  return (
    <AppLayout>
      <section className="user-access-surface relative left-1/2 flex min-h-[calc(100vh-7rem)] w-[min(1600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950">

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

        {activeTab === "activity" && (
          <div className="min-h-0 flex-1 overflow-auto bg-[#f5f4f0] dark:bg-slate-950">
            <UserActivityTab />
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
                  {requestedUserId && (
                    <Button type="button" variant="outline" size="sm" onClick={clearFocusedUser}>
                      {pick("전체 조회", "View All")}
                    </Button>
                  )}
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
                      className="pl-9 pr-9"
                    />
                    {searchTerm ? (
                      <button
                        type="button"
                        aria-label={pick("검색어 초기화", "Clear search")}
                        onClick={() => {
                          setSearchTerm("");
                          setPagination((current) => ({ ...current, page: 1 }));
                        }}
                        className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <Select
                    value={roleFilter || "all"}
                    onValueChange={(value) => {
                      setRoleFilter(value === "all" ? "" : value);
                      setPagination((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    <SelectTrigger className="h-10 w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{pick("전체 역할", "All Roles")}</SelectItem>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={loginFilter || "all"}
                    onValueChange={(value) => {
                      setLoginFilter(value === "all" ? "" : value as LoginFilter);
                      setPagination((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    <SelectTrigger className="h-10 w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{pick("전체 접속", "All Activity")}</SelectItem>
                      <SelectItem value="30d">{pick("30일 미접속", "30d Inactive")}</SelectItem>
                      <SelectItem value="90d">{pick("90일 미접속", "90d Inactive")}</SelectItem>
                      <SelectItem value="never">{pick("로그인 없음", "Never Logged In")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={statusFilter || "all"}
                    onValueChange={(value) => {
                      setStatusFilter(value === "all" ? "" : value as StatusFilter);
                      setPagination((current) => ({ ...current, page: 1 }));
                    }}
                  >
                    <SelectTrigger className="h-10 w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{pick("전체 상태", "All Status")}</SelectItem>
                      <SelectItem value="active">{pick("활성", "Active")}</SelectItem>
                      <SelectItem value="inactive">{pick("비활성", "Inactive")}</SelectItem>
                    </SelectContent>
                  </Select>
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
                        <TableHead className="w-6 px-3" />
                        <SortableHead col="email"     label={pick("이메일", "Email")}  sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                        <SortableHead col="name"      label={pick("이름", "Name")}     sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                        <SortableHead col="role"      label={pick("역할", "Role")}     sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                        <SortableHead col="authProvider" label={pick("인증", "Auth")} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                        <TableHead>{pick("예외", "Exc.")}</TableHead>
                        <SortableHead col="lastLoginAt" label={pick("마지막 로그인", "Last Login")} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                        <SortableHead col="createdAt" label={pick("가입일", "Joined")} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="pr-5" align="right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
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
                            <TableCell className="w-6 px-3">
                              <span
                                className={`block h-2 w-2 rounded-full ${user.isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}
                                title={user.isActive ? pick("계정 활성화됨", "Account enabled") : pick("계정 비활성화됨", "Account disabled")}
                              />
                            </TableCell>
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
                            <TableCell>
                              {user.exceptionCount > 0 ? (
                                <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                                  {user.exceptionCount}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-0.5">
                                <LoginActivityBadge lastLoginAt={user.lastLoginAt} pick={pick} />
                                {user.lastLoginAt && (
                                  <span className="tabular-nums text-[10px] text-muted-foreground">
                                    {formatJoinedDate(user.lastLoginAt)}
                                  </span>
                                )}
                              </div>
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
                  <div className="flex flex-col gap-3 border-b border-[#e2dfd8] px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                    {selectedUser ? (
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8e5df] text-[11px] font-bold text-[#6b6359] dark:bg-slate-700 dark:text-slate-300">
                          {(selectedUser.name ?? selectedUser.email).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-[#1a1917] dark:text-slate-100">
                            {selectedUser.name?.trim() || selectedUser.email}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] ${{
                              admin: "bg-[#1a1917] text-[#fafaf7]",
                              dev: "bg-[#1a1917] text-[#fafaf7]",
                              planner: "bg-[#dbeafe] text-[#1d4ed8]",
                              operation: "bg-[#d1fae5] text-[#065f46]",
                              production: "bg-[#fef3c7] text-[#92400e]",
                            }[selectedUser.role] ?? "bg-[#f3f4f6] text-[#374151]"}`}>
                              {selectedUser.role}
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">{selectedUser.email}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {pick("목록에서 사용자를 선택하여 접근 권한을 조회하고 수정하세요.", "Select a user from the list to view and update access.")}
                      </p>
                    )}
                    {selectedUser && (
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="min-w-[160px]">
                          <Select
                            value={pendingRole ?? selectedUser.role}
                            disabled={savingUserId === selectedUser.id || session?.user?.id === selectedUser.id}
                            onValueChange={(value: UserRole) => {
                              setPendingRole(value === selectedUser.role ? null : value);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={pick("역할 선택", "Select role")} />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map((r) => (
                                <SelectItem key={r.value} value={r.value} className="items-start py-2">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium leading-snug">{r.value}</span>
                                    <span className="text-xs leading-snug text-muted-foreground">{pick(r.descKo, r.descEn)}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {pendingRole !== null && pendingRole !== selectedUser.role ? (
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              disabled={savingUserId === selectedUser.id}
                              onClick={() => setShowRoleConfirm(true)}
                            >
                              {pick("역할 변경", "Change Role")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingRole(null)}
                            >
                              {pick("취소", "Cancel")}
                            </Button>
                          </div>
                        ) : (
                          <Badge variant={isElevatedRole(selectedUser.role) ? "default" : "secondary"}>
                            {selectedUser.role}
                          </Badge>
                        )}
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
                            {editingName ? (
                              <div className="mt-1 flex items-center gap-1.5">
                                <Input
                                  value={nameDraft}
                                  onChange={(event) => setNameDraft(event.target.value)}
                                  className="h-7 text-xs"
                                  autoFocus
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-7 px-2"
                                  disabled={savingUserId === selectedUser.id || !nameDraft.trim()}
                                  onClick={() => void updateUserName(selectedUser.id, nameDraft.trim())}
                                >
                                  {pick("저장", "Save")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => setEditingName(false)}
                                >
                                  {pick("취소", "Cancel")}
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <p className="text-muted-foreground">{selectedUser.name?.trim() || "-"}</p>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setNameDraft(selectedUser.name ?? "");
                                    setEditingName(true);
                                  }}
                                  aria-label={pick("이름 편집", "Edit name")}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                            )}
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

                        <div className="rounded-lg border border-[#e2dfd8] bg-[#f0eee9] p-3 dark:border-slate-700 dark:bg-slate-900">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium">{pick("계정 활성화", "Account Active")}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {selectedUser.isActive
                                  ? pick("사용자가 로그인할 수 있습니다.", "User can sign in.")
                                  : pick("사용자가 로그인할 수 없습니다.", "User cannot sign in.")}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={savingUserId === selectedUser.id || session?.user?.id === selectedUser.id}
                              onClick={() => toggleUserActive(selectedUser.id)}
                              aria-pressed={selectedUser.isActive}
                              className={`relative h-6 w-11 flex-shrink-0 overflow-hidden rounded-full transition-colors disabled:opacity-50 ${
                                selectedUser.isActive ? "bg-[#0f7b5c]" : "bg-[#d2d0cb] dark:bg-slate-600"
                              }`}
                            >
                              <span
                                className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-[left] ${
                                  selectedUser.isActive ? "left-[23px]" : "left-[3px]"
                                }`}
                              />
                            </button>
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

                        {/* Login history */}
                        <div>
                          <p className="mb-2 text-sm font-medium">{pick("최근 로그인 기록", "Recent Logins")}</p>
                          {loginHistoryLoading ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {pick("불러오는 중…", "Loading…")}
                            </div>
                          ) : loginHistory.length === 0 ? (
                            <p className="text-xs text-muted-foreground">{pick("로그인 기록이 없습니다.", "No login records.")}</p>
                          ) : (
                            <div className="overflow-hidden rounded-md border border-[#e2dfd8] dark:border-slate-700">
                              {loginHistory.map((log, idx) => (
                                <div
                                  key={log.id}
                                  className={`grid grid-cols-[minmax(135px,1fr)_minmax(80px,0.7fr)_minmax(145px,1.2fr)] items-center gap-2 px-3 py-2 text-xs ${
                                    idx !== loginHistory.length - 1 ? "border-b border-[#e2dfd8] dark:border-slate-700" : ""
                                  }`}
                                >
                                  <span className="tabular-nums text-muted-foreground">
                                    {new Date(log.loggedInAt).toLocaleString(pick("ko-KR", "en-US"), {
                                      year: "numeric", month: "2-digit", day: "2-digit",
                                      hour: "2-digit", minute: "2-digit",
                                    })}
                                  </span>
                                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                                    {log.ip ?? "-"}
                                  </span>
                                  <span
                                    className="truncate text-right text-[10px] text-muted-foreground"
                                    title={log.userAgent ?? undefined}
                                  >
                                    {parseBrowserInfo(log.userAgent)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                      </>
                    )}
                  </div>
                </>
              )}

              {/* Tab 3: User Exceptions */}
              {activeTab === "exceptions" && (
                <UserExceptionsTab user={selectedUser} onOverridesChange={() => void refreshUsers()} />
              )}
            </div>
          </div>
        )}
      </section>

      <AlertDialog open={showRoleConfirm} onOpenChange={setShowRoleConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pick("역할을 변경하시겠습니까?", "Change role?")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1">
                {selectedUser && pendingRole && (
                  <>
                    <p>
                      <strong>{selectedUser.name?.trim() || selectedUser.email}</strong>
                      {pick(
                        `의 역할을 변경합니다.`,
                        `'s role will be changed.`
                      )}
                    </p>
                    <p className="text-sm">
                      {selectedUser.role} → <strong>{pendingRole}</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {pick(
                        ROLES.find((r) => r.value === pendingRole)?.descKo ?? "",
                        ROLES.find((r) => r.value === pendingRole)?.descEn ?? ""
                      )}
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingRole(null)}>
              {pick("취소", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedUser && pendingRole) {
                  void updateUserRole(selectedUser.id, pendingRole);
                  setPendingRole(null);
                }
                setShowRoleConfirm(false);
              }}
            >
              {pick("변경", "Change")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

type LoginActivityStatus = "recent" | "inactive30" | "inactive90" | "never";

function getLoginActivity(lastLoginAt: string | null): LoginActivityStatus {
  if (!lastLoginAt) return "never";
  const diffDays = (Date.now() - new Date(lastLoginAt).getTime()) / 86400_000;
  if (diffDays < 30) return "recent";
  if (diffDays < 90) return "inactive30";
  return "inactive90";
}

function LoginActivityBadge({ lastLoginAt, pick }: { lastLoginAt: string | null; pick: (ko: string, en: string) => string }) {
  const status = getLoginActivity(lastLoginAt);
  if (status === "never") return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
      {pick("미접속", "Never")}
    </span>
  );
  if (status === "recent") return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">
      {pick("30일 이내", "Recent")}
    </span>
  );
  if (status === "inactive30") return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
      {pick("30일+", "30d+")}
    </span>
  );
  return (
    <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
      {pick("90일+", "90d+")}
    </span>
  );
}

function formatJoinedDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function SortableHead({
  col,
  label,
  sortBy,
  sortDir,
  onSort,
  className,
  align = "left",
}: {
  col: SortBy;
  label: string;
  sortBy: SortBy;
  sortDir: SortDir;
  onSort: (col: SortBy) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sortBy === col;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors group ${align === "right" ? "w-full justify-end" : ""}`}
      >
        {label}
        <Icon
          className={`h-3 w-3 flex-shrink-0 transition-opacity ${
            active ? "text-[#1a5cdb]" : "opacity-0 group-hover:opacity-40"
          }`}
        />
      </button>
    </TableHead>
  );
}
