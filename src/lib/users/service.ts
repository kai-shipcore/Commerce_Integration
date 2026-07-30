/**
 * Business logic for user-account administration: list/search/pagination,
 * role/status/name/menu mutations (with the self-change and last-admin
 * guards), login history, and the activity dashboards. Permission-matrix
 * and permission-override CRUD live in
 * src/lib/users/permission-admin-service.ts — a distinct set of tables and
 * concerns, even though both back tabs on the same admin page.
 */

import type { Prisma } from "@prisma/client";
import {
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  mergeVisibleMenuIdsWithPermissions,
  filterToValidMenuIds,
} from "@/components/layout/navigation-config";
import { getEffectivePermissions } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ACTIVITY_TIME_ZONE, getActivityDate } from "@/lib/activity-date";
import { UsersRepository, type UserListRow } from "@/lib/users/repository";

type Who = { userId: string | null; userName: string | null; userEmail: string | null };

const SORT_FIELDS = ["email", "name", "role", "createdAt", "lastLoginAt", "authProvider"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export interface ListUsersQuery {
  pageParam: string | null;
  limitParam: string | null;
  search: string;
  roleFilter: string;
  statusFilter: string;
  sortByParam: string | null;
  sortDirParam: string | null;
  loginFilter: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SKU_LIKE_LABEL_PATTERN = /^(?:CA|CC|CL|ICC)-/i;

function explicitSkuSubject(label: unknown): { type: "sku" | "part_sku"; id: string } | undefined {
  if (typeof label !== "string") return undefined;
  const partSku = label.match(/^(?:Part SKU 선택|Select Part SKU):\s*(.+)$/i)?.[1]?.trim();
  if (partSku) return { type: "part_sku", id: partSku };
  const sku = label.match(/^(?:SKU 선택|Select SKU):\s*(.+)$/i)?.[1]?.trim();
  return sku ? { type: "sku", id: sku } : undefined;
}

export const UsersService = {
  async listUsers(query: ListUsersQuery) {
    const page = Math.max(1, Number.parseInt(query.pageParam ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(5, Number.parseInt(query.limitParam ?? "10", 10) || 10));

    const rawSortBy = query.sortByParam ?? "role";
    const safeSortBy: SortField = (SORT_FIELDS as readonly string[]).includes(rawSortBy)
      ? (rawSortBy as SortField)
      : "role";
    const sortDir = query.sortDirParam === "desc" ? ("desc" as const) : ("asc" as const);

    const now = new Date();
    const loginFilterClause = query.loginFilter === "30d"
      ? { OR: [{ lastLoginAt: { lt: new Date(now.getTime() - 30 * 86400_000) } }, { lastLoginAt: null }] }
      : query.loginFilter === "90d"
      ? { OR: [{ lastLoginAt: { lt: new Date(now.getTime() - 90 * 86400_000) } }, { lastLoginAt: null }] }
      : query.loginFilter === "never"
      ? { lastLoginAt: null }
      : undefined;

    const searchClause = query.search
      ? {
          OR: [
            { id: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
            { name: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : undefined;

    const andClauses: Prisma.UserWhereInput[] = [
      ...(searchClause ? [searchClause] : []),
      ...(query.roleFilter ? [{ role: query.roleFilter }] : []),
      ...(query.statusFilter === "active" ? [{ isActive: true }] : []),
      ...(query.statusFilter === "inactive" ? [{ isActive: false }] : []),
      ...(loginFilterClause ? [loginFilterClause] : []),
    ];
    const where = andClauses.length > 0 ? { AND: andClauses } : undefined;

    const orderBy: Prisma.UserOrderByWithRelationInput[] = safeSortBy === "authProvider"
      ? [{ accounts: { _count: sortDir } }, { createdAt: "asc" as const }]
      : [
          { [safeSortBy]: sortDir },
          ...(safeSortBy !== "createdAt" ? [{ createdAt: "asc" as const }] : []),
        ];

    const { total, users } = await UsersRepository.listUsers({ where, orderBy, skip: (page - 1) * limit, take: limit });
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const exCountMap = await UsersRepository.countPermissionOverridesByUser(users.map((u) => u.id));

    const usersWithEffectiveMenus = await Promise.all(
      users.map(async (user: UserListRow) => {
        const permissions = await getEffectivePermissions(user.id, user.role);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          menuVisibility: mergeVisibleMenuIdsWithPermissions(user.menuVisibility, user.role, permissions),
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
          authProviders: [...new Set(user.accounts.map((account) => account.provider))],
          hasGoogleAccount: user.accounts.some((account) => account.provider === "google"),
          exceptionCount: exCountMap.get(user.id) ?? 0,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        };
      }),
    );

    return {
      defaults: {
        admin: getDefaultVisibleMenuIds("admin"),
        dev: getDefaultVisibleMenuIds("dev"),
        user: getDefaultVisibleMenuIds("user"),
      },
      users: usersWithEffectiveMenus,
      pagination: { page, limit, total, totalPages },
    };
  },

  async updateUserRole(actorUserId: string, targetUserId: string, role: string, who: Who, ip: string | null) {
    if (targetUserId === actorUserId) {
      throw new ValidationError("You cannot change your own role");
    }

    const targetUser = await UsersRepository.findById(targetUserId);
    const updatedUser = await UsersRepository.updateRole(targetUserId, role, getDefaultVisibleMenuIds(role));

    void logAudit({
      entityType: "user_role",
      entityId: targetUserId,
      entityLabel: targetUser?.email ?? targetUser?.name ?? targetUserId,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "role_change",
      before: { role: targetUser?.role ?? null },
      after: { role },
      ip,
    });

    return updatedUser;
  },

  async updateUserStatus(actorUserId: string, targetUserId: string, who: Who, ip: string | null) {
    if (targetUserId === actorUserId) {
      throw new ValidationError("Cannot change your own active status");
    }

    const target = await UsersRepository.findById(targetUserId);
    if (!target) throw new NotFoundError("User not found");

    const nextActive = !target.isActive;

    if (!nextActive && isAdminLikeRole(target.role)) {
      const activeAdminCount = await UsersRepository.countActiveAdmins();
      if (activeAdminCount <= 1) {
        throw new ValidationError("Cannot deactivate the last active admin account");
      }
    }

    const updated = await UsersRepository.updateActive(targetUserId, nextActive);

    void logAudit({
      entityType: "user_role",
      entityId: targetUserId,
      entityLabel: target.email ?? target.name ?? targetUserId,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "status_change",
      before: { isActive: target.isActive },
      after: { isActive: nextActive },
      ip,
    });

    return updated;
  },

  async updateUserName(targetUserId: string, name: string, who: Who, ip: string | null) {
    const targetUser = await UsersRepository.findById(targetUserId);
    if (!targetUser) throw new NotFoundError("User not found");

    const updatedUser = await UsersRepository.updateName(targetUserId, name);

    void logAudit({
      entityType: "user_name",
      entityId: targetUserId,
      entityLabel: targetUser.email ?? targetUser.name ?? targetUserId,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "update",
      before: { name: targetUser.name },
      after: { name },
      ip,
    });

    return updatedUser;
  },

  async updateUserMenu(targetUserId: string, visibleMenuIds: unknown[], who: Who, ip: string | null) {
    const targetUser = await UsersRepository.findById(targetUserId);
    if (!targetUser) throw new NotFoundError("User not found");

    const filtered = filterToValidMenuIds(visibleMenuIds);
    const updatedUser = await UsersRepository.updateMenuVisibility(targetUserId, filtered);
    const targetPermissions = await getEffectivePermissions(targetUser.id, targetUser.role);

    void logAudit({
      entityType: "user_menu",
      entityId: targetUserId,
      entityLabel: targetUser.email ?? targetUser.name ?? targetUserId,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "update",
      after: { visibleMenuIds: filtered },
      ip,
    });

    return {
      ...updatedUser,
      defaults: getDefaultVisibleMenuIds(targetUser.role),
      menuVisibility: mergeVisibleMenuIdsWithPermissions(updatedUser.menuVisibility, targetUser.role, targetPermissions),
    };
  },

  getLoginHistory(userId: string) {
    return UsersRepository.getLoginHistory(userId);
  },

  async getActivityTimeline(userId: string, requestedDate: string | null) {
    const date = requestedDate && DATE_PATTERN.test(requestedDate) ? requestedDate : getActivityDate();

    let user, eventsRows, loginRows, auditRows;
    try {
      [user, eventsRows, loginRows, auditRows] = await Promise.all([
        UsersRepository.getActivityTimelineUser(userId),
        UsersRepository.getActivityTimelineEvents(userId, date),
        UsersRepository.getActivityTimelineLogins(userId, date),
        UsersRepository.getActivityTimelineAuditEvents(userId, date),
      ]);
    } catch (error) {
      console.error("[UserActivityTimeline] Failed to load timeline:", error);
      throw new Error("Failed to load activity timeline");
    }

    if (!user) throw new NotFoundError("User not found");

    try {
      // Older selectable SKU rows were logged using the button's concatenated
      // text (SKU + metrics/status). Resolve both master and Part SKUs by their
      // longest prefix so historical activity remains human-readable.
      const legacySelectableLabels = [...new Set(
        eventsRows
          .filter((row) => (
            row.event_type === "button_click"
            && typeof row.label === "string"
            && (row.path === "/planning/sku-forecasts" || SKU_LIKE_LABEL_PATTERN.test(row.label))
          ))
          .map((row) => row.label as string),
      )];
      const legacySubjectByLabel = legacySelectableLabels.length > 0
        ? await UsersRepository.resolveLegacySkuLabels(legacySelectableLabels)
        : new Map<string, { type: "sku" | "part_sku"; id: string }>();

      const events = [
        ...eventsRows.map((row) => {
          const legacySubject = explicitSkuSubject(row.label)
            ?? (typeof row.label === "string" ? legacySubjectByLabel.get(row.label) : undefined);
          return {
            id: `event:${row.id}`,
            source: "activity",
            occurredAt: (row.occurred_at as Date).toISOString(),
            eventType: row.event_type,
            path: row.path,
            label: row.label,
            target: row.target,
            ip: row.ip,
            subjectType: legacySubject?.type ?? null,
            subjectId: legacySubject?.id ?? null,
          };
        }),
        ...loginRows.map((row) => ({
          id: `login:${row.id}`,
          source: "login",
          occurredAt: (row.occurred_at as Date).toISOString(),
          eventType: "login",
          path: null,
          label: "Login",
          target: row.user_agent,
          ip: row.ip,
        })),
        ...auditRows.map((row) => ({
          id: `audit:${row.id}`,
          source: "audit",
          occurredAt: (row.created_at as Date).toISOString(),
          eventType: "data_change",
          path: null,
          label: row.entity_label,
          target: row.action,
          ip: row.ip,
          entityType: row.entity_type,
          entityId: row.entity_id,
          before: row.before,
          after: row.after,
          note: row.note,
        })),
      ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

      return { user, date, events };
    } catch (error) {
      console.error("[UserActivityTimeline] Failed to load timeline:", error);
      throw new Error("Failed to load activity timeline");
    }
  },

  async getUserActivitySummary(daysParam: string | null) {
    const requestedDays = Number.parseInt(daysParam ?? "30", 10);
    const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
    const today = getActivityDate();
    const startDate = getActivityDate(-(days - 1));
    const weekStart = getActivityDate(-6);
    const monthStart = getActivityDate(-29);

    try {
      const [summary, trend, users] = await Promise.all([
        UsersRepository.getActivitySummary(today, weekStart, monthStart),
        UsersRepository.getActivityTrend(startDate, today),
        UsersRepository.getActivityUsers(startDate, today),
      ]);

      return {
        timeZone: ACTIVITY_TIME_ZONE,
        periodDays: days,
        summary: {
          today: Number(summary.today_active),
          last7Days: Number(summary.week_active),
          last30Days: Number(summary.month_active),
        },
        trend: trend.map((row) => ({
          date: row.activity_date instanceof Date
            ? row.activity_date.toISOString().slice(0, 10)
            : String(row.activity_date).slice(0, 10),
          activeUsers: Number(row.active_users),
        })),
        users: users.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          isActive: row.is_active,
          lastSeenAt: row.last_seen_at?.toISOString() ?? null,
          activityDays: Number(row.activity_days),
          activityCount: Number(row.activity_count),
          lastPath: row.last_path,
          activeToday: row.active_today,
        })),
      };
    } catch (error) {
      console.error("[UserActivity] Failed to load activity summary:", error);
      throw new Error("Failed to load user activity");
    }
  },
};
