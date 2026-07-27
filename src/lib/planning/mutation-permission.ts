import { guardPermission } from "@/lib/permissions";
import type { PermAction, PermSection } from "@/lib/permissions-config";

const DEMAND_PLANNING_CONTEXT = "demand-planning";

/**
 * Shared container APIs are used by both Container Planning and Demand
 * Planning. Requests originating from the demand dashboard explicitly carry
 * its permission context and must pass demand-planning.edit on the server.
 */
export function guardPlanningMutation(
  request: Request,
  fallbackSection: PermSection,
  fallbackAction: PermAction,
) {
  if (request.headers.get("x-planning-permission-context") === DEMAND_PLANNING_CONTEXT) {
    return guardPermission("demand-planning", "edit");
  }
  return guardPermission(fallbackSection, fallbackAction);
}
